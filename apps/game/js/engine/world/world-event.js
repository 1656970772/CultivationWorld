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
    this.riskKey = cfg.riskKey ?? null;
    this.scope = cfg.scope || 'public';
    this.source = cfg.source ?? 'config';
    this.pos = cfg.pos ? { ...cfg.pos } : null;
    this.subjectId = cfg.subjectId ?? null;
    this.relatedNpcIds = Array.isArray(cfg.relatedNpcIds) ? [...cfg.relatedNpcIds] : [];
    this.opportunityType = cfg.opportunityType ?? null;
    this.rewardSource = cfg.rewardSource ?? null;
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
      riskKey: this.riskKey,
      scope: this.scope,
      source: this.source,
      pos: this.pos ? { ...this.pos } : null,
      subjectId: this.subjectId,
      relatedNpcIds: [...this.relatedNpcIds],
      opportunityType: this.opportunityType,
      rewardSource: this.rewardSource,
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
        });
      }
    }

    this.events = this.events.filter(event => event.phase !== WorldEventPhase.EXPIRED);
    this._rebuildIndex();
    return this.phaseChanges();
  }

  phaseChanges() {
    return this._phaseChanges.map(change => ({ ...change }));
  }

  visibleEventsFor(entity, currentDay) {
    if (!this.enabled) return [];
    return this.events.filter(event =>
      event.isVisibleWindow(currentDay) && this._scopeVisible(event, entity)
    );
  }

  awarenessConfidence(event, entity) {
    if (!event || !this._scopeVisible(event, entity)) return 0;
    if (event.scope === 'relationship') return 1;
    if (event.scope === 'faction') return 0.9;
    if (event.scope === 'public') return 0.55;
    return 0;
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
