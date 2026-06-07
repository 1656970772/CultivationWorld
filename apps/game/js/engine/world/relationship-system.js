/**
 * RelationshipSystem - 三层关系平台门面。
 *
 * 新实现把关系真相源收敛到三层账本：
 *   - IndividualRelation：subject 如何看 object。
 *   - GroupStanding：group 如何评价 subject。
 *   - FactionReputation：faction 如何公开评价 subject。
 *
 * 旧 ADR-027 边模型 API 仍保留为兼容投影，避免旧调用点在迁移期崩溃。
 * 新业务应优先调用 handleEvent/addMark/addTag/getSignals，并通过 data/relationships
 * 中的规则配置表达关系逻辑。
 */
import { LedgerRepository } from '../relationship/ledger-repository.js';
import { ExpressionEvaluator } from '../relationship/expression-evaluator.js';
import { SelectorResolver } from '../relationship/selector-resolver.js';
import { RelationImpactEngine } from '../relationship/impact-engine.js';
import { RelationEventEmitter } from '../relationship/relation-event-emitter.js';
import { RelationshipSignalProvider } from '../relationship/signal-provider.js';

/**
 * 旧关系类型枚举（兼容旧调用点和旧测试）。
 * @enum {string}
 */
export const RelationType = Object.freeze({
  MASTER: 'master',
  DISCIPLE: 'disciple',
  DAO_COMPANION: 'dao_companion',
  KIN: 'kin',
  SAME_SECT: 'same_sect',
  ALLY: 'ally',
  RIVAL: 'rival',
  ENEMY: 'enemy',
  BENEFACTOR: 'benefactor',
  GRUDGE: 'grudge',
  GRATITUDE: 'gratitude',
  SPIRIT_PET: 'spirit_pet',
  MOUNT: 'mount',
  BEAST_GRUDGE: 'beast_grudge',
  TERRITORY_THREAT: 'territory_threat',
  PACK_MEMBER: 'pack_member',
  PACK_LEADER: 'pack_leader',
  BEAST_RIVAL: 'beast_rival',
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function normalizePlatform(config) {
  return config?.platform || config?.relationshipPlatform || null;
}

function normalizeLegacyProjectionConfig(platform) {
  return platform?.projections?.legacyEdges
    || platform?.legacyEdgeProjections
    || platform?.projections
    || null;
}

function compileLegacyProjectionIndex(platform) {
  const config = normalizeLegacyProjectionConfig(platform);
  const index = {
    edgeToMarkType: new Map(),
    edgeToTagType: new Map(),
    edgeTypesByMarkType: new Map(),
    edgeTypesByTagType: new Map(),
  };

  for (const entry of config?.edgeToLedger || []) {
    if (!entry?.edgeType || !entry?.type) continue;
    if (entry.ledgerKind === 'mark') index.edgeToMarkType.set(entry.edgeType, entry.type);
    if (entry.ledgerKind === 'tag') index.edgeToTagType.set(entry.edgeType, entry.type);
  }

  for (const entry of config?.ledgerToEdges || []) {
    if (!entry?.type || !Array.isArray(entry.edgeTypes)) continue;
    const target = entry.ledgerKind === 'mark'
      ? index.edgeTypesByMarkType
      : (entry.ledgerKind === 'tag' ? index.edgeTypesByTagType : null);
    if (!target) continue;
    target.set(entry.type, [...entry.edgeTypes]);
  }

  return index;
}

function markWeight(ledger, type) {
  return (ledger?.marks || [])
    .filter(mark => mark.type === type && mark.consumed !== true)
    .reduce((sum, mark) => sum + (Number(mark.weight) || 0), 0);
}

function projectedTypesFor(source, fallbackTypes) {
  const edgeType = source?.edgeType || null;
  if (edgeType && fallbackTypes.includes(edgeType)) return [edgeType];
  return fallbackTypes;
}

export class RelationshipSystem {
  constructor(config = {}) {
    this._config = config || {};
    this.enabled = config?.enabled !== false;
    this._edgeTypes = config?.edgeTypes || {};
    this._bindings = config?.eventBindings || {};
    this._edges = new Map();

    this._platformConfig = normalizePlatform(config);
    this._legacyProjectionIndex = compileLegacyProjectionIndex(this._platformConfig);
    this.repository = null;
    this.impactEngine = null;
    this.eventEmitter = null;
    this.signals = null;

    if (this._platformConfig) {
      const evaluator = new ExpressionEvaluator();
      const selectorResolver = new SelectorResolver();
      this.repository = new LedgerRepository({
        schema: this._platformConfig.schemas?.ledgers || {},
        dictionaries: {
          marks: this._platformConfig.dictionaries?.marks || {},
          tags: this._platformConfig.dictionaries?.tags || {},
        },
      });
      this.impactEngine = new RelationImpactEngine({
        repository: this.repository,
        rules: this._platformConfig.impactRules || [],
        evaluator,
        selectorResolver,
      });
      this.eventEmitter = new RelationEventEmitter({
        hooks: this._platformConfig.eventHooks || [],
        selectorResolver,
      });
      this.signals = new RelationshipSignalProvider({
        repository: this.repository,
        rules: this._platformConfig.signalRules || [],
        evaluator,
        selectorResolver,
      });
    }
  }

  static _key(toId, type) { return `${toId}|${type}`; }

  _typeDef(type) { return this._edgeTypes[type] || {}; }

  _hasPlatform() { return !!(this.repository && this.impactEngine && this.signals); }

  _edgeIdentity(edge) {
    return `${edge?.fromId || ''}|${edge?.toId || ''}|${edge?.type || ''}`;
  }

  _legacyEdges(filter = {}) {
    const out = [];
    const buckets = filter.fromId
      ? [this._edges.get(filter.fromId)].filter(Boolean)
      : [...this._edges.values()];
    for (const bucket of buckets) {
      for (const edge of bucket.values()) {
        if (filter.type && edge.type !== filter.type) continue;
        out.push(edge);
      }
    }
    return out;
  }

  _projectedEdge(fromId, toId, type, source) {
    const def = this._typeDef(type);
    return {
      fromId,
      toId,
      type,
      affinity: clamp(def.affinity ?? 0, -100, 100),
      strength: clamp(source.strength ?? def.strength ?? 0, 0, 100),
      originTick: source.createdDay ?? 0,
      originEventType: source.originEventType ?? null,
      _projected: true,
    };
  }

  _projectedEdges(filter = {}) {
    if (!this.repository) return [];
    const out = [];
    const ledgers = this.repository.findLedgers({ layer: 'individual', subjectId: filter.fromId });
    for (const ledger of ledgers) {
      if (!ledger.subjectId || !ledger.objectId) continue;
      for (const mark of ledger.marks || []) {
        if (mark.consumed === true || (Number(mark.weight) || 0) <= 0) continue;
        const projectedTypes = this._legacyProjectionIndex.edgeTypesByMarkType.get(mark.type) || [];
        for (const type of projectedTypesFor(mark.source, projectedTypes)) {
          if (filter.type && type !== filter.type) continue;
          out.push(this._projectedEdge(ledger.subjectId, ledger.objectId, type, {
            strength: mark.weight,
            createdDay: mark.createdDay,
            originEventType: mark.source?.eventId || mark.source?.id || null,
          }));
        }
      }
      for (const tag of ledger.tags || []) {
        if (tag.active === false) continue;
        const projectedTypes = this._legacyProjectionIndex.edgeTypesByTagType.get(tag.type) || [];
        for (const type of projectedTypesFor(tag.source, projectedTypes)) {
          if (filter.type && type !== filter.type) continue;
          out.push(this._projectedEdge(ledger.subjectId, ledger.objectId, type, {
            strength: this._typeDef(type).strength ?? 100,
            createdDay: tag.createdDay,
            originEventType: tag.source?.eventId || tag.source?.id || null,
          }));
        }
      }
    }
    return out;
  }

  _mergedEdges(filter = {}) {
    const byKey = new Map();
    for (const edge of this._legacyEdges(filter)) byKey.set(this._edgeIdentity(edge), edge);
    for (const edge of this._projectedEdges(filter)) byKey.set(this._edgeIdentity(edge), edge);
    return [...byKey.values()];
  }

  /**
   * 新标准入口：把标准 RelationEvent 写入三层账本。
   * @param {Object} event
   * @returns {Array} trace
   */
  handleEvent(event) {
    if (!this.enabled || !this._hasPlatform() || !event?.type) return [];
    const normalized = {
      visibility: 'private',
      witness: { count: 0 },
      day: 0,
      ...event,
      actor: typeof event.actor === 'string' ? { id: event.actor } : (event.actor || {}),
      target: typeof event.target === 'string' ? { id: event.target } : (event.target || {}),
    };
    return this.impactEngine.apply(normalized);
  }

  addMark(ref) {
    if (!this.enabled || !this.repository) return null;
    return this.repository.addMark(ref);
  }

  addTag(ref) {
    if (!this.enabled || !this.repository) return null;
    return this.repository.addTag(ref);
  }

  getIndividualRelation(subjectId, objectId, opts = {}) {
    return this.repository ? this.repository.getIndividual(subjectId, objectId, opts) : null;
  }

  getGroupStanding(groupId, subjectId, opts = {}) {
    return this.repository ? this.repository.getGroup(groupId, subjectId, opts) : null;
  }

  getFactionReputation(factionId, subjectId, opts = {}) {
    return this.repository ? this.repository.getFaction(factionId, subjectId, opts) : null;
  }

  getSignals(input = {}) {
    return this.signals
      ? this.signals.getSignals(input)
      : { facts: {}, gates: {}, modifiers: {}, targetPreferences: {}, traces: [] };
  }

  getFacts(input = {}) {
    return this.signals ? this.signals.getFacts(input) : {};
  }

  topWantedTargetForFaction(factionId, actorId = null) {
    if (!this.repository || !factionId) return null;
    const candidates = this.repository
      .findLedgers({ layer: 'faction', factionId })
      .map(ledger => ({
        targetId: ledger.subjectId,
        weight: markWeight(ledger, 'wantedOrder'),
        ledger,
      }))
      .filter(c => c.weight > 0)
      .sort((a, b) => b.weight - a.weight);

    for (const cand of candidates) {
      const signals = this.getSignals({
        actor: { id: actorId, factionId },
        target: { id: cand.targetId },
        contextType: 'action',
        actionId: 'act_npc_job_hunt_enemy',
      });
      if (signals.facts.hasLifeDebt && !signals.facts.hasBloodFeud) continue;
      return { ...cand, signals };
    }
    return null;
  }

  _mirrorEdgeToLedger(fromId, toId, type, edge, opts = {}) {
    if (!this.repository) return;
    const day = opts.tick ?? opts.day ?? edge?.originTick ?? 0;
    const weight = edge?.strength ?? opts.strengthDelta ?? 0;
    const markType = this._legacyProjectionIndex.edgeToMarkType.get(type);
    if (markType) {
      this.addMark({
        layer: 'individual',
        subjectId: fromId,
        objectId: toId,
        type: markType,
        weight,
        day,
        source: { eventId: opts.eventType || edge?.originEventType || null, edgeType: type },
      });
    }
    const tagType = this._legacyProjectionIndex.edgeToTagType.get(type);
    if (tagType) {
      this.addTag({
        layer: 'individual',
        subjectId: fromId,
        objectId: toId,
        type: tagType,
        day,
        source: { eventId: opts.eventType || edge?.originEventType || null, edgeType: type },
      });
    }
  }

  addEdge(fromId, toId, type, opts = {}) {
    if (!this.enabled) return null;
    if (!fromId || !toId || !type || fromId === toId) return null;
    const def = this._typeDef(type);

    let bucket = this._edges.get(fromId);
    if (!bucket) { bucket = new Map(); this._edges.set(fromId, bucket); }
    const key = RelationshipSystem._key(toId, type);

    const hasDelta = typeof opts.strengthDelta === 'number';
    const delta = hasDelta ? opts.strengthDelta : (def.strength ?? 0);
    let edge = bucket.get(key);
    if (edge) {
      edge.strength = clamp(edge.strength + delta, 0, 100);
    } else {
      const initStrength = hasDelta ? delta : (def.strength ?? 0);
      edge = {
        fromId, toId, type,
        affinity: clamp(def.affinity ?? 0, -100, 100),
        strength: clamp(initStrength, 0, 100),
        originTick: opts.tick ?? 0,
        originEventType: opts.eventType ?? null,
      };
      bucket.set(key, edge);
    }

    this._mirrorEdgeToLedger(fromId, toId, type, edge, opts);

    if (!opts._skipSymmetric && def.symmetricType) {
      this.addEdge(toId, fromId, def.symmetricType, { ...opts, _skipSymmetric: true });
    }
    return edge;
  }

  applyEvent(eventType, fromId, toId, opts = {}) {
    if (!this.enabled) return null;
    const binding = this._bindings[eventType];
    const edge = binding?.edgeType
      ? this.addEdge(fromId, toId, binding.edgeType, {
        tick: opts.tick ?? 0,
        eventType,
        strengthDelta: typeof binding.strengthDelta === 'number' ? binding.strengthDelta : undefined,
      })
      : null;

    if (this.eventEmitter) {
      const event = this.eventEmitter.fromLegacy(eventType, fromId, toId, opts);
      if (event) this.handleEvent(event);
    }
    return edge;
  }

  getEdge(fromId, toId, type) {
    const bucket = this._edges.get(fromId);
    const projected = this._projectedEdges({ fromId, type }).find(e => e.toId === toId);
    return projected || bucket?.get(RelationshipSystem._key(toId, type)) || null;
  }

  edgesFrom(fromId) {
    return this._mergedEdges({ fromId });
  }

  edgesOfType(fromId, type) {
    return this._mergedEdges({ fromId, type }).sort((a, b) => b.strength - a.strength);
  }

  topEdgeOfType(fromId, type) {
    const list = this.edgesOfType(fromId, type);
    return list.length ? list[0] : null;
  }

  removeEntity(entityId) {
    this._edges.delete(entityId);
    for (const bucket of this._edges.values()) {
      for (const [key, edge] of bucket) {
        if (edge.toId === entityId) bucket.delete(key);
      }
    }
    if (this.repository) this.repository.removeEntity(entityId);
  }

  tick(day = 0) {
    if (!this.enabled) return;
    for (const bucket of this._edges.values()) {
      for (const [key, edge] of bucket) {
        const def = this._typeDef(edge.type);
        const decay = def.decay ?? 0;
        if (decay <= 0) continue;
        const floor = def.decayFloor ?? 0;
        if (edge.strength > floor) edge.strength = Math.max(floor, edge.strength - decay);
        if (edge.strength <= 0 && floor <= 0) bucket.delete(key);
      }
    }
    if (this.repository) this.repository.tick(day);
  }

  allEdges() {
    return this._mergedEdges();
  }

  _legacyStats() {
    const byType = {};
    let total = 0;
    for (const bucket of this._edges.values()) {
      for (const edge of bucket.values()) {
        byType[edge.type] = (byType[edge.type] || 0) + 1;
        total++;
      }
    }
    return { total, byType };
  }

  stats() {
    const legacy = this._legacyStats();
    if (!this.repository) return legacy;
    const platform = this.repository.stats();
    return {
      total: platform.total,
      byType: legacy.byType,
      legacyEdges: legacy.total,
      byLayer: platform.byLayer,
      marksByType: platform.marksByType,
      tagsByType: platform.tagsByType,
    };
  }

  snapshot() {
    return {
      edges: this.allEdges(),
      relationshipPlatform: this.repository ? this.repository.snapshot() : null,
    };
  }

  loadFrom(snap) {
    this._edges = new Map();
    const hasPlatformSnapshot = !!(snap?.relationshipPlatform || snap?.ledgers);
    if (snap && Array.isArray(snap.edges)) {
      for (const e of snap.edges) {
        if (hasPlatformSnapshot && e._projected === true) continue;
        if (!e.fromId || !e.toId || !e.type) continue;
        let bucket = this._edges.get(e.fromId);
        if (!bucket) { bucket = new Map(); this._edges.set(e.fromId, bucket); }
        bucket.set(RelationshipSystem._key(e.toId, e.type), { ...e });
      }
    }
    if (this.repository && (snap?.relationshipPlatform || snap?.ledgers)) {
      this.repository.loadFrom(snap.relationshipPlatform || snap);
    }
  }

  toJSON() { return this.snapshot(); }
}
