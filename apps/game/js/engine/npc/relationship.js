/**
 * RelationshipGraph - NPC 个人恩怨/恩义图（GOBT 长期心智，ADR-019）。
 *
 * 与势力间 relations（faction.state.relations）分层：这里记录"个人对个人"的
 * 仇恨(grudge)与恩义(gratitude)。由 MemorySystem 的事件聚合驱动，是执念(复仇/报恩)的依据。
 *
 * grudge/gratitude 取值约定为非负累积量，越大表示恩怨越深；可随记忆衰减而由调用方更新。
 */
export class RelationshipGraph {
  constructor() {
    /** @type {Map<string, number>} 对某 NPC 的仇恨值 */
    this.grudge = new Map();
    /** @type {Map<string, number>} 对某 NPC 的恩义值 */
    this.gratitude = new Map();
  }

  /** 增加对某人的仇恨。 */
  addGrudge(actorId, amount) {
    if (!actorId || !(amount > 0)) return;
    this.grudge.set(actorId, (this.grudge.get(actorId) || 0) + amount);
  }

  /** 增加对某人的恩义。 */
  addGratitude(actorId, amount) {
    if (!actorId || !(amount > 0)) return;
    this.gratitude.set(actorId, (this.gratitude.get(actorId) || 0) + amount);
  }

  getGrudge(actorId) {
    return this.grudge.get(actorId) || 0;
  }

  getGratitude(actorId) {
    return this.gratitude.get(actorId) || 0;
  }

  /** 仇恨最深的对象 { actorId, value }，无则 null。 */
  topGrudge() {
    let bestId = null, bestVal = 0;
    for (const [id, v] of this.grudge) {
      if (v > bestVal) { bestVal = v; bestId = id; }
    }
    return bestId ? { actorId: bestId, value: bestVal } : null;
  }

  /** 恩义最重的对象 { actorId, value }，无则 null。 */
  topGratitude() {
    let bestId = null, bestVal = 0;
    for (const [id, v] of this.gratitude) {
      if (v > bestVal) { bestVal = v; bestId = id; }
    }
    return bestId ? { actorId: bestId, value: bestVal } : null;
  }

  snapshot() {
    return {
      grudge: Object.fromEntries(this.grudge),
      gratitude: Object.fromEntries(this.gratitude),
    };
  }

  loadFrom(snap) {
    if (!snap) return;
    this.grudge = new Map(Object.entries(snap.grudge || {}));
    this.gratitude = new Map(Object.entries(snap.gratitude || {}));
  }

  toJSON() {
    return this.snapshot();
  }
}
