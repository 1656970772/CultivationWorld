/**
 * EventAwareness - NPC 对动态世界事件的个人感知缓存。
 *
 * 只保存事件快照与感知元数据，不依赖 WorldEvent live 实例；读取新鲜事件也只通过
 * worldContext.dynamicEventById 这类窄接口完成。
 */

function cloneJSONCompatible(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

export class EventAwareness {
  constructor() {
    this._known = new Map();
    this._ignoreUntil = new Map();
  }

  /**
   * 记住一个事件快照；同一事件重复学习时保留最高置信度与最早知晓日。
   * @param {Object} event 动态事件快照
   * @param {Object} [opts]
   * @param {number} [opts.confidence=0]
   * @param {string} [opts.source='unknown']
   * @param {number} [opts.day=0]
   * @param {string} [opts.scope]
   * @param {string} [opts.visibilityScope]
   * @returns {Object|null}
   */
  learn(event, { confidence = 0, source = 'unknown', day = 0, scope = null, visibilityScope = null } = {}) {
    if (!event?.id) return null;
    const prev = this._known.get(event.id);
    const eventSnap = cloneJSONCompatible(event);
    const known = {
      eventId: event.id,
      eventType: event.type || prev?.eventType || null,
      confidence: Math.max(prev?.confidence ?? 0, Number(confidence) || 0),
      source: source ?? event.source ?? prev?.source ?? 'unknown',
      scope: scope ?? event.scope ?? prev?.scope ?? null,
      visibilityScope: visibilityScope ?? scope ?? event.scope ?? prev?.visibilityScope ?? null,
      firstKnownDay: prev?.firstKnownDay ?? day,
      lastUpdatedDay: day,
      event: eventSnap,
    };
    this._known.set(event.id, known);
    return cloneJSONCompatible(known);
  }

  ignore(eventId, untilDay) {
    if (!eventId) return;
    this._ignoreUntil.set(eventId, Number(untilDay) || 0);
  }

  isIgnored(eventId, day = 0) {
    const until = this._ignoreUntil.get(eventId);
    if (until == null) return false;
    if (day >= until) return false;
    return true;
  }

  /**
   * @param {Object} [opts]
   * @param {number} [opts.currentDay=0]
   * @param {(id:string)=>Object|null} [opts.eventById]
   * @returns {{event:Object, confidence:number, source:string, scope:string|null, visibilityScope:string|null, day:number, firstKnownDay:number, lastUpdatedDay:number}[]}
   */
  knownEvents({ currentDay = 0, eventById = null } = {}) {
    const out = [];
    for (const known of this._known.values()) {
      if (this.isIgnored(known.eventId, currentDay)) continue;
      let event = null;
      if (typeof eventById === 'function') {
        event = eventById(known.eventId) || null;
      }
      event = event || known.event;
      if (!event) continue;
      out.push({
        event: cloneJSONCompatible(event),
        confidence: known.confidence,
        source: known.source,
        scope: known.scope,
        visibilityScope: known.visibilityScope,
        day: currentDay,
        firstKnownDay: known.firstKnownDay,
        lastUpdatedDay: known.lastUpdatedDay,
      });
    }
    return out;
  }

  snapshot() {
    return {
      known: [...this._known.values()].map(known => ({
        eventId: known.eventId,
        eventType: known.eventType,
        confidence: known.confidence,
        source: known.source,
        scope: known.scope,
        visibilityScope: known.visibilityScope,
        firstKnownDay: known.firstKnownDay,
        lastUpdatedDay: known.lastUpdatedDay,
        event: cloneJSONCompatible(known.event),
      })),
      ignoreUntil: [...this._ignoreUntil.entries()].map(([eventId, untilDay]) => ({ eventId, untilDay })),
    };
  }
}
