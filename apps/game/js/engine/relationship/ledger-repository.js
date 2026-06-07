const clamp = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

const deepCopy = (value) => JSON.parse(JSON.stringify(value));

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [];
}

function indexById(items) {
  const out = new Map();
  for (const item of asArray(items)) {
    if (item?.id) out.set(item.id, item);
  }
  return out;
}

function defaultCore(schema, layer) {
  const coreSchema = schema?.layers?.[layer]?.core || {};
  const core = {};
  for (const [key, def] of Object.entries(coreSchema)) {
    core[key] = Number(def?.default) || 0;
  }
  return core;
}

function defaultPotential(schema) {
  const potential = {};
  for (const [key, def] of Object.entries(schema?.potential || {})) {
    potential[key] = Number(def?.default) || 0;
  }
  potential.lastEvaluatedDay = 0;
  return potential;
}

export class LedgerRepository {
  constructor({ schema = {}, dictionaries = {} } = {}) {
    this.schema = schema || {};
    this.markDefs = indexById(dictionaries.marks?.marks || dictionaries.marks || []);
    this.tagDefs = indexById(dictionaries.tags?.tags || dictionaries.tags || []);
    this._individual = new Map();
    this._group = new Map();
    this._faction = new Map();
    this._markSeq = 0;
    this._tagSeq = 0;
  }

  _individualKey(subjectId, objectId) {
    return `${subjectId || ''}|${objectId || ''}`;
  }

  _groupKey(groupId, subjectId) {
    return `${groupId || ''}|${subjectId || ''}`;
  }

  _factionKey(factionId, subjectId) {
    return `${factionId || ''}|${subjectId || ''}`;
  }

  _createLedger(layer, ids) {
    return {
      layer,
      ...ids,
      core: defaultCore(this.schema, layer),
      potential: defaultPotential(this.schema),
      marks: [],
      tags: [],
      lastUpdatedDay: 0,
    };
  }

  _getOrCreate(map, key, layer, ids, create) {
    if (map.has(key)) return map.get(key);
    if (!create) return null;
    const ledger = this._createLedger(layer, ids);
    map.set(key, ledger);
    return ledger;
  }

  getIndividual(subjectId, objectId, opts = {}) {
    if (!subjectId || !objectId) return null;
    return this._getOrCreate(
      this._individual,
      this._individualKey(subjectId, objectId),
      'individual',
      {
        subjectId,
        subjectType: opts.subjectType || 'npc',
        objectId,
        objectType: opts.objectType || 'npc',
      },
      opts.create !== false,
    );
  }

  getGroup(groupId, subjectId, opts = {}) {
    if (!groupId || !subjectId) return null;
    return this._getOrCreate(
      this._group,
      this._groupKey(groupId, subjectId),
      'group',
      {
        groupId,
        subjectId,
        subjectType: opts.subjectType || 'npc',
      },
      opts.create !== false,
    );
  }

  getFaction(factionId, subjectId, opts = {}) {
    if (!factionId || !subjectId) return null;
    return this._getOrCreate(
      this._faction,
      this._factionKey(factionId, subjectId),
      'faction',
      {
        factionId,
        subjectId,
        subjectType: opts.subjectType || 'npc',
      },
      opts.create !== false,
    );
  }

  getLedger(ref, opts = {}) {
    if (!ref) return null;
    if (ref.layer === 'individual') return this.getIndividual(ref.subjectId, ref.objectId, opts);
    if (ref.layer === 'group') return this.getGroup(ref.groupId, ref.subjectId, opts);
    if (ref.layer === 'faction') return this.getFaction(ref.factionId, ref.subjectId, opts);
    return null;
  }

  _markDef(type) {
    return this.markDefs.get(type) || {};
  }

  _tagDef(type) {
    return this.tagDefs.get(type) || {};
  }

  addMark(ref) {
    const ledger = this.getLedger(ref);
    if (!ledger || !ref.type) return null;
    const def = this._markDef(ref.type);
    const maxWeight = Number(def.maxWeight ?? 100);
    const weight = clamp(ref.weight ?? def.defaultWeight ?? 0, 0, maxWeight);
    const createdDay = Number(ref.day ?? ref.createdDay ?? 0) || 0;
    const mark = {
      id: ref.id || `${ref.type}_${createdDay}_${++this._markSeq}`,
      type: ref.type,
      weight,
      source: ref.source || null,
      visibility: ref.visibility || 'private',
      createdDay,
      expiresDay: ref.expiresDay ?? null,
      decayRule: ref.decayRule || def.decay || null,
      consumable: ref.consumable ?? def.consumable ?? false,
      consumed: ref.consumed === true,
    };
    const stacking = ref.stacking || def.stacking || 'max';
    const existing = ledger.marks.find(m => m.type === mark.type && m.consumed !== true);

    if (stacking === 'instance' || !existing) {
      ledger.marks.push(mark);
      ledger.lastUpdatedDay = createdDay;
      return mark;
    }

    if (stacking === 'unique') {
      ledger.lastUpdatedDay = createdDay;
      return existing;
    }

    if (stacking === 'add') {
      existing.weight = clamp((existing.weight || 0) + mark.weight, 0, maxWeight);
      existing.createdDay = createdDay;
      ledger.lastUpdatedDay = createdDay;
      return existing;
    }

    if (stacking === 'refresh') {
      existing.weight = mark.weight;
      existing.source = mark.source;
      existing.visibility = mark.visibility;
      existing.createdDay = createdDay;
      existing.expiresDay = mark.expiresDay;
      ledger.lastUpdatedDay = createdDay;
      return existing;
    }

    if (mark.weight > (existing.weight || 0)) {
      existing.weight = mark.weight;
      existing.source = mark.source;
      existing.visibility = mark.visibility;
      existing.createdDay = createdDay;
      existing.expiresDay = mark.expiresDay;
    }
    ledger.lastUpdatedDay = createdDay;
    return existing;
  }

  addTag(ref) {
    const ledger = this.getLedger(ref);
    if (!ledger || !ref.type) return null;
    const def = this._tagDef(ref.type);
    const createdDay = Number(ref.day ?? ref.createdDay ?? 0) || 0;
    const stacking = ref.stacking || def.stacking || 'unique';
    const existing = ledger.tags.find(t => t.type === ref.type && t.active !== false);
    if (existing && stacking === 'unique') return existing;
    const tag = {
      id: ref.id || `${ref.type}_${createdDay}_${++this._tagSeq}`,
      type: ref.type,
      source: ref.source || null,
      visibility: ref.visibility || 'private',
      createdDay,
      expiresDay: ref.expiresDay ?? null,
      active: ref.active !== false,
      modifiers: ref.modifiers || def.defaultModifiers || {},
    };
    ledger.tags.push(tag);
    ledger.lastUpdatedDay = createdDay;
    return tag;
  }

  consumeMarks(ref) {
    const ledger = this.getLedger(ref, { create: false });
    if (!ledger || !ref.type) return 0;
    let consumed = 0;
    for (const mark of ledger.marks) {
      if (mark.type !== ref.type || mark.consumed === true) continue;
      mark.consumed = true;
      consumed++;
    }
    if (consumed > 0) ledger.lastUpdatedDay = Number(ref.day ?? ledger.lastUpdatedDay) || ledger.lastUpdatedDay;
    return consumed;
  }

  applyCoreDelta(ref, path, delta) {
    const ledger = this.getLedger(ref);
    if (!ledger || !path?.startsWith('core.')) return null;
    const key = path.slice('core.'.length);
    const def = this.schema?.layers?.[ledger.layer]?.core?.[key] || { min: -100, max: 100 };
    const current = Number(ledger.core[key] ?? def.default ?? 0) || 0;
    ledger.core[key] = clamp(current + (Number(delta) || 0), def.min ?? -100, def.max ?? 100);
    ledger.lastUpdatedDay = Number(ref.day ?? ledger.lastUpdatedDay) || ledger.lastUpdatedDay;
    return ledger.core[key];
  }

  applyPotentialDelta(ref, path, delta) {
    const ledger = this.getLedger(ref);
    if (!ledger || !path?.startsWith('potential.')) return null;
    const key = path.slice('potential.'.length);
    const def = this.schema?.potential?.[key] || { min: 0, max: 100 };
    const current = Number(ledger.potential[key] ?? def.default ?? 0) || 0;
    ledger.potential[key] = clamp(current + (Number(delta) || 0), def.min ?? 0, def.max ?? 100);
    ledger.potential.lastEvaluatedDay = Number(ref.day ?? ledger.lastUpdatedDay) || ledger.lastUpdatedDay;
    ledger.lastUpdatedDay = ledger.potential.lastEvaluatedDay;
    return ledger.potential[key];
  }

  findLedgers(query = {}) {
    const layer = query.layer;
    const maps = layer
      ? [[layer, layer === 'individual' ? this._individual : layer === 'group' ? this._group : this._faction]]
      : [['individual', this._individual], ['group', this._group], ['faction', this._faction]];
    const out = [];
    for (const [, map] of maps) {
      for (const ledger of map.values()) {
        if (query.subjectId && ledger.subjectId !== query.subjectId) continue;
        if (query.objectId && ledger.objectId !== query.objectId) continue;
        if (query.groupId && ledger.groupId !== query.groupId) continue;
        if (query.factionId && ledger.factionId !== query.factionId) continue;
        out.push(ledger);
      }
    }
    return out;
  }

  tick(day = 0) {
    const applyDecay = (ledger) => {
      for (const mark of ledger.marks) {
        if (mark.consumed) continue;
        if (mark.expiresDay != null && day >= mark.expiresDay) {
          mark.consumed = true;
          continue;
        }
        const value = Number(mark.decayRule?.value) || 0;
        if (value > 0) mark.weight = Math.max(0, (Number(mark.weight) || 0) - value);
      }
      ledger.marks = ledger.marks.filter(m => m.consumed !== true && (Number(m.weight) || 0) > 0);
      ledger.tags = ledger.tags.filter(t => t.active !== false && (t.expiresDay == null || day < t.expiresDay));
    };
    for (const map of [this._individual, this._group, this._faction]) {
      for (const ledger of map.values()) applyDecay(ledger);
    }
  }

  removeEntity(entityId) {
    for (const [key, ledger] of this._individual) {
      if (ledger.subjectId === entityId || ledger.objectId === entityId) this._individual.delete(key);
    }
    for (const [key, ledger] of this._group) {
      if (ledger.subjectId === entityId) this._group.delete(key);
    }
    for (const [key, ledger] of this._faction) {
      if (ledger.subjectId === entityId) this._faction.delete(key);
    }
  }

  snapshot() {
    return {
      version: 1,
      ledgers: {
        individual: [...this._individual.values()].map(deepCopy),
        group: [...this._group.values()].map(deepCopy),
        faction: [...this._faction.values()].map(deepCopy),
      },
    };
  }

  loadFrom(snapshot) {
    this._individual = new Map();
    this._group = new Map();
    this._faction = new Map();
    const loadLayer = (items, map, keyFn) => {
      for (const ledger of asArray(items)) {
        map.set(keyFn(ledger), deepCopy(ledger));
      }
    };
    loadLayer(snapshot?.ledgers?.individual, this._individual, l => this._individualKey(l.subjectId, l.objectId));
    loadLayer(snapshot?.ledgers?.group, this._group, l => this._groupKey(l.groupId, l.subjectId));
    loadLayer(snapshot?.ledgers?.faction, this._faction, l => this._factionKey(l.factionId, l.subjectId));
  }

  stats() {
    const byLayer = {
      individual: this._individual.size,
      group: this._group.size,
      faction: this._faction.size,
    };
    const marksByType = {};
    const tagsByType = {};
    for (const ledger of [...this._individual.values(), ...this._group.values(), ...this._faction.values()]) {
      for (const mark of ledger.marks) marksByType[mark.type] = (marksByType[mark.type] || 0) + 1;
      for (const tag of ledger.tags) tagsByType[tag.type] = (tagsByType[tag.type] || 0) + 1;
    }
    return {
      total: byLayer.individual + byLayer.group + byLayer.faction,
      byLayer,
      marksByType,
      tagsByType,
    };
  }
}

export { clamp };
