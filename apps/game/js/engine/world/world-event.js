/**
 * WorldEventSystem - 动态世界事件生命周期。
 *
 * 只维护事件模型、阶段推进与可见窗口；NPC 感知、动态目标与中断策略由后续系统消费。
 */

export const WorldEventPhase = Object.freeze({
  SCHEDULED: 'scheduled',
  ANNOUNCED: 'announced',
  ACTIVE: 'active',
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
});

export const WorldEventType = Object.freeze({
  SECRET_REALM: 'secret_realm',
  SECT_TOURNAMENT: 'sect_tournament',
  AUCTION: 'auction',
  TREASURE_BORN: 'treasure_born',
  FALLEN_MASTER: 'fallen_master',
  RELATIONSHIP_DEATH: 'relationship_death',
});

const DEFAULT_CONFIDENCE_BY_SCOPE = Object.freeze({
  public: 0.55,
  faction: 0.9,
  relationship: 1,
});

function cloneJSONCompatible(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

export class WorldEvent {
  /**
   * @param {Object} cfg
   */
  constructor(cfg = {}) {
    this.id = cfg.id;
    this.type = cfg.type || WorldEventType.SECRET_REALM;
    this.name = cfg.name || this.type;
    this.announceDay = cfg.announceDay ?? 0;
    this.startDay = cfg.startDay ?? this.announceDay ?? 0;
    this.endDay = cfg.endDay ?? this.startDay ?? 0;
    this.expireDay = cfg.expireDay ?? null;
    this.value = cfg.value ?? 0;
    this.riskKey = cloneJSONCompatible(cfg.riskKey ?? null);
    this.scope = cfg.scope || 'public';
    this.source = cloneJSONCompatible(cfg.source ?? 'config');
    this.pos = cfg.pos ? cloneJSONCompatible(cfg.pos) : null;
    this.subjectId = cloneJSONCompatible(cfg.subjectId ?? null);
    this.relatedNpcIds = Array.isArray(cfg.relatedNpcIds) ? cloneJSONCompatible(cfg.relatedNpcIds) : [];
    this.opportunityType = cloneJSONCompatible(cfg.opportunityType ?? null);
    this.rewardSource = cloneJSONCompatible(cfg.rewardSource ?? null);
    this.phase = cfg.phase || WorldEventPhase.SCHEDULED;
    this.preparedBy = new Set(cfg.preparedBy || []);
    this.participants = new Set(cfg.participants || []);
  }

  updatePhase(day) {
    const previous = this.phase;
    if (this.expireDay != null && day >= this.expireDay) {
      this.phase = WorldEventPhase.EXPIRED;
    } else if (this.endDay != null && day > this.endDay) {
      this.phase = WorldEventPhase.RESOLVED;
    } else if (this.startDay != null && day >= this.startDay) {
      this.phase = WorldEventPhase.ACTIVE;
    } else if (this.announceDay != null && day >= this.announceDay) {
      this.phase = WorldEventPhase.ANNOUNCED;
    } else {
      this.phase = WorldEventPhase.SCHEDULED;
    }
    return previous !== this.phase;
  }

  isVisibleWindow(day) {
    if (this.expireDay != null && day >= this.expireDay) return false;
    const visibleFrom = this.announceDay ?? this.startDay ?? 0;
    return day >= visibleFrom;
  }

  daysUntilStart(day) {
    return Math.max(0, (this.startDay ?? day) - day);
  }

  markPrepared(npcId) {
    if (!npcId) return false;
    this.preparedBy.add(npcId);
    return true;
  }

  markParticipant(npcId) {
    if (!npcId) return false;
    this.participants.add(npcId);
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      announceDay: this.announceDay,
      startDay: this.startDay,
      endDay: this.endDay,
      expireDay: this.expireDay,
      value: this.value,
      riskKey: cloneJSONCompatible(this.riskKey),
      scope: this.scope,
      source: cloneJSONCompatible(this.source),
      pos: this.pos ? cloneJSONCompatible(this.pos) : null,
      subjectId: cloneJSONCompatible(this.subjectId),
      relatedNpcIds: cloneJSONCompatible(this.relatedNpcIds),
      opportunityType: cloneJSONCompatible(this.opportunityType),
      rewardSource: cloneJSONCompatible(this.rewardSource),
      phase: this.phase,
      preparedBy: [...this.preparedBy],
      participants: [...this.participants],
    };
  }
}

export class WorldEventSystem {
  /**
   * @param {Object} [config] data/world/dynamic-events.json
   */
  constructor(config = {}) {
    this.config = config || {};
    /** @type {WorldEvent[]} */
    this.events = [];
    this._byId = new Map();
    this._phaseChanges = [];
  }

  get enabled() {
    return this.config?.enabled === true;
  }

  seedScheduledEvents(currentDay = 0) {
    if (!this.enabled) return [];
    const added = [];
    for (const eventConfig of this.config.events || []) {
      if (!eventConfig?.id || this._byId.has(eventConfig.id)) continue;
      const event = this.addEvent(eventConfig, currentDay);
      if (event) added.push(event);
    }
    return added;
  }

  addEvent(config, currentDay = 0) {
    if (!this.enabled || !config?.id) return null;
    if (this._byId.has(config.id)) return this._byId.get(config.id);
    const event = config instanceof WorldEvent ? config : new WorldEvent(config);
    event.updatePhase(currentDay);
    this.events.push(event);
    this._byId.set(event.id, event);
    return event;
  }

  publishRuntimeEvent(config, currentDay) {
    if (!this.enabled || !config?.type) return null;
    const id = config.id || `evt_${config.type}_${currentDay}_${this.events.length + 1}`;
    return this.addEvent({
      announceDay: currentDay,
      startDay: currentDay,
      endDay: currentDay + (config.durationDays ?? 20),
      expireDay: currentDay + (config.expireDays ?? 60),
      scope: 'public',
      ...config,
      id,
      source: config.source || 'runtime',
    }, currentDay);
  }

  publishDeathEvents(npc, info, pos, currentDay, relationshipSystem = null) {
    if (!this.enabled || !npc) return [];
    const events = [];
    const roleRank = npc.state?.get?.('roleRank') ?? 0;
    if (roleRank >= 3 && pos) {
      const fallen = this.publishRuntimeEvent({
        type: WorldEventType.FALLEN_MASTER,
        name: `${npc.name || npc.id}陨落遗泽`,
        value: 700 + roleRank * 120,
        riskKey: 'plunder',
        pos,
        subjectId: npc.id,
        durationDays: 20,
        expireDays: 45,
      }, currentDay);
      if (fallen) events.push(fallen);
    }

    const relatedNpcIds = new Set();
    const companionId = npc.state?.get?.('daoCompanionId');
    if (companionId) relatedNpcIds.add(companionId);
    if (relationshipSystem && typeof relationshipSystem.edgesOfType === 'function') {
      for (const type of ['master', 'disciple', 'same_sect', 'ally']) {
        for (const edge of relationshipSystem.edgesOfType(npc.id, type)) {
          if (edge.strength >= 40) relatedNpcIds.add(edge.toId);
        }
      }
    }
    if (relatedNpcIds.size > 0) {
      const rel = this.publishRuntimeEvent({
        type: WorldEventType.RELATIONSHIP_DEATH,
        name: `${npc.name || npc.id}身死`,
        value: 900,
        riskKey: 'pvp',
        scope: 'relationship',
        pos,
        subjectId: npc.id,
        relatedNpcIds: [...relatedNpcIds],
        durationDays: 30,
        expireDays: 120,
      }, currentDay);
      if (rel) events.push(rel);
    }
    return events;
  }

  getById(id) {
    return this._byId.get(id) || null;
  }

  tick(currentDay) {
    this._phaseChanges = [];
    if (!this.enabled) return [];

    for (const event of this.events) {
      const from = event.phase;
      if (event.updatePhase(currentDay)) {
        this._phaseChanges.push({
          type: 'dynamic_event_phase_changed',
          eventId: event.id,
          eventType: event.type,
          name: event.name,
          from,
          to: event.phase,
          phase: event.phase,
          day: currentDay,
          event: event.toJSON(),
        });
      }
    }

    this.events = this.events.filter(event => event.phase !== WorldEventPhase.EXPIRED);
    this._rebuildIndex();
    return this.phaseChanges();
  }

  phaseChanges() {
    return cloneJSONCompatible(this._phaseChanges);
  }

  visibleEventsFor(entity, currentDay) {
    if (!this.enabled) return [];
    return this._visibleEventInstancesFor(entity, currentDay).map(event => event.toJSON());
  }

  _visibleEventInstancesFor(entity, currentDay) {
    return this.events.filter(event =>
      event.isVisibleWindow(currentDay) && this._scopeVisible(event, entity)
    );
  }

  awarenessConfidence(event, entity) {
    if (!event || !this._scopeVisible(event, entity)) return 0;
    const scope = event.scope || 'public';
    const configured = this.config?.awareness?.defaultConfidenceByScope || {};
    return configured[scope] ?? DEFAULT_CONFIDENCE_BY_SCOPE[scope] ?? 0;
  }

  markPrepared(eventId, npcId) {
    const event = this.getById(eventId);
    return event ? event.markPrepared(npcId) : false;
  }

  markParticipant(eventId, npcId) {
    const event = this.getById(eventId);
    return event ? event.markParticipant(npcId) : false;
  }

  snapshot() {
    return {
      enabled: this.enabled,
      events: this.events.map(event => event.toJSON()),
    };
  }

  _scopeVisible(event, entity) {
    const scope = event.scope || 'public';
    if (scope === 'public') return true;
    if (!entity) return false;

    if (scope === 'faction') {
      const factionId = entity.state?.get ? entity.state.get('factionId') : entity.factionId;
      return !!factionId && factionId === event.subjectId;
    }

    if (scope === 'relationship') {
      const ids = new Set([event.subjectId, ...event.relatedNpcIds].filter(Boolean));
      return ids.has(entity.id);
    }

    return false;
  }

  _rebuildIndex() {
    this._byId = new Map(this.events.map(event => [event.id, event]));
  }
}
