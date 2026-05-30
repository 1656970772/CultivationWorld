/**
 * MemorySystem - 实体长期记忆系统（GOBT 长期心智，ADR-019）。
 *
 * 设计参考矮人要塞/仙逆：NPC 会记住"被背叛/被灭门/道侣陨落/获得传承"等重大事件，
 * 这些记忆带强度(intensity)并随时间衰减(decay)，是执念(Obsession)与情绪(Emotion)的来源。
 *
 * 实现要点：
 * - 定长环形队列，超出容量丢弃最旧记忆，保证内存与遍历成本恒定（性能护栏）。
 * - 记忆类型为枚举（遵循项目规则），来源/配置（强度/衰减/恩怨增量）数据驱动于 memory.json。
 */

/**
 * 记忆事件类型枚举。
 * @enum {string}
 */
export const MemoryType = Object.freeze({
  BETRAYED: 'betrayed',           // 被背叛
  SECT_DESTROYED: 'sect_destroyed', // 门派被灭/势力覆灭
  COMPANION_LOST: 'companion_lost', // 道侣陨落
  INHERITANCE: 'inheritance',     // 获得传承/机缘
  DEMOTED: 'demoted',             // 被贬谪
  ATTACKED: 'attacked',           // 所属势力遭攻击
  HUMILIATED: 'humiliated',       // 受辱（挑战失败/被夺职）
  SAVED_BY: 'saved_by',           // 被某人所救（恩义）
  PROMOTED: 'promoted',           // 晋升（正向）
});

/**
 * @typedef {Object} MemoryRecord
 * @property {MemoryType} type      事件类型
 * @property {string|null} actorId  事件相关方（仇人/恩人/势力）实体 id
 * @property {string|null} factionId 相关势力 id
 * @property {number} tick          发生时的世界日
 * @property {{x:number,y:number}|null} location 发生坐标
 * @property {number} intensity     初始强度（0-100）
 * @property {number} decay         每日衰减量
 */

export class MemorySystem {
  /**
   * @param {Object} [options]
   * @param {number} [options.capacity=32] 环形队列容量
   */
  constructor(options = {}) {
    this.capacity = options.capacity ?? 32;
    /** @type {MemoryRecord[]} */
    this.records = [];
  }

  /**
   * 记入一条记忆。超出容量时丢弃最旧。
   * @param {MemoryRecord} record
   */
  add(record) {
    this.records.push({
      type: record.type,
      actorId: record.actorId ?? null,
      factionId: record.factionId ?? null,
      tick: record.tick ?? 0,
      location: record.location ?? null,
      intensity: record.intensity ?? 0,
      decay: record.decay ?? 0,
    });
    if (this.records.length > this.capacity) {
      this.records.shift();
    }
  }

  /**
   * 每日衰减并清理强度归零的记忆。
   * @param {number} [days=1]
   */
  decayTick(days = 1) {
    for (const r of this.records) {
      if (r.decay > 0) r.intensity = Math.max(0, r.intensity - r.decay * days);
    }
    if (this.records.some(r => r.intensity <= 0)) {
      this.records = this.records.filter(r => r.intensity > 0);
    }
  }

  /** 按类型筛选记忆。 */
  getByType(type) {
    return this.records.filter(r => r.type === type);
  }

  /**
   * 取强度最高的某类记忆（如最深的仇恨来源）。
   * @param {MemoryType} type
   * @returns {MemoryRecord|null}
   */
  getStrongest(type) {
    let best = null;
    for (const r of this.records) {
      if (r.type !== type) continue;
      if (!best || r.intensity > best.intensity) best = r;
    }
    return best;
  }

  /** 某类记忆的强度总和（情绪聚合用）。 */
  totalIntensity(type) {
    let sum = 0;
    for (const r of this.records) {
      if (r.type === type) sum += r.intensity;
    }
    return sum;
  }

  size() {
    return this.records.length;
  }

  snapshot() {
    return { capacity: this.capacity, records: this.records.map(r => ({ ...r })) };
  }

  loadFrom(snap) {
    if (!snap) return;
    this.capacity = snap.capacity ?? this.capacity;
    this.records = Array.isArray(snap.records) ? snap.records.map(r => ({ ...r })) : [];
  }

  toJSON() {
    return { size: this.records.length, records: this.records.map(r => ({ ...r })) };
  }
}
