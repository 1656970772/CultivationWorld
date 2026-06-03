/**
 * stimulus —— 反应层输入（四层 AI 架构 Reaction 层，ADR-048）。
 *
 * StimulusQueue 是每个实体一份的「待处理刺激队列」：外部系统（攻击方、世界事件）在事件
 * 发生的同步瞬间向受影响实体压入一条刺激（push），受影响实体在自身 tick 的反应层
 * （ReactiveNode）最先消费这些刺激，从而获得「即时反应」语义——而无需引入子 tick/事件循环，
 * 全程同步、确定性可复现（随机仍走实体 _rng / worldContext.rng，ADR-038）。
 *
 * 设计要点：
 *   - 刺激带 priority，消费时按 priority 降序、同 priority 按入队顺序（稳定）取最高优先一条。
 *   - 队列每日（onPreTick）清理过期刺激（payload.day 早于当前日超过 ttl），避免堆积。
 *   - 反应层是否「打断当前计划」由 ReactiveNode 决定，StimulusQueue 只负责承载与排序，单一职责。
 *
 * 刺激类型用枚举（StimulusType）而非字符串字面量散落各处（项目规则：多种情况用枚举）。
 */

/**
 * 刺激类型枚举。
 * - ATTACKED：被攻击（受伤未死）。最高优先，触发被攻击反应决策（躲避/疗伤/逃跑/反击）。
 * - ENEMY_SPOTTED：发现仇人在感知范围。触发立即重决策（复仇意图）。
 * - TREASURE_SPOTTED：发现宝物/天材地宝。触发立即重决策（机缘意图）。
 * - SECRET_REALM：秘境开启。触发立即重决策。
 * - AUCTION：大型拍卖会。触发立即重决策。
 * - SECT_TOURNAMENT：宗门大比。触发立即重决策。
 * @enum {string}
 */
export const StimulusType = Object.freeze({
  ATTACKED: 'attacked',
  ENEMY_SPOTTED: 'enemy_spotted',
  TREASURE_SPOTTED: 'treasure_spotted',
  SECRET_REALM: 'secret_realm',
  AUCTION: 'auction',
  SECT_TOURNAMENT: 'sect_tournament',
});

/** 各刺激类型的默认优先级（数值越大越先消费）。被攻击优先级最高（生存优先）。 */
export const STIMULUS_DEFAULT_PRIORITY = Object.freeze({
  [StimulusType.ATTACKED]: 100,
  [StimulusType.ENEMY_SPOTTED]: 60,
  [StimulusType.SECRET_REALM]: 50,
  [StimulusType.TREASURE_SPOTTED]: 45,
  [StimulusType.AUCTION]: 40,
  [StimulusType.SECT_TOURNAMENT]: 40,
});

export class StimulusQueue {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.ttl=2] 刺激存活天数：入队日起超过 ttl 天未被消费则视为过期清理。
   * @param {number} [opts.capacity=16] 队列容量上限（超出时丢弃最低优先的旧刺激，防堆积）。
   */
  constructor(opts = {}) {
    this.ttl = opts.ttl ?? 2;
    this.capacity = opts.capacity ?? 16;
    /** @type {Array<{type:string, priority:number, sourceId:(string|null), payload:Object, day:number, _seq:number}>} */
    this._items = [];
    this._seq = 0;
  }

  /**
   * 压入一条刺激。
   * @param {string} type StimulusType 之一
   * @param {Object} [opts]
   * @param {number} [opts.priority] 覆盖默认优先级
   * @param {string|null} [opts.sourceId] 关联实体 id（攻击者/仇人/机会点等）
   * @param {Object} [opts.payload] 附加数据（damage/orderGap/killer 等）
   * @param {number} [opts.day] 入队世界日（用于过期清理）
   */
  push(type, opts = {}) {
    if (!type) return;
    const priority = opts.priority ?? STIMULUS_DEFAULT_PRIORITY[type] ?? 10;
    this._items.push({
      type,
      priority,
      sourceId: opts.sourceId ?? null,
      payload: opts.payload || {},
      day: opts.day ?? 0,
      _seq: this._seq++,
    });
    if (this._items.length > this.capacity) {
      // 超容量：丢弃最低优先、最旧的一条（确定性：按 priority 升序、seq 升序）。
      this._items.sort((a, b) => (a.priority - b.priority) || (a._seq - b._seq));
      this._items.shift();
    }
  }

  /** 是否有指定类型（或任意）的待处理刺激。 */
  has(type = null) {
    if (type == null) return this._items.length > 0;
    return this._items.some(s => s.type === type);
  }

  /**
   * 取出并移除最高优先的一条指定类型刺激（不传 type 则任意类型）。
   * 同优先级按入队顺序（稳定），确定性可复现。
   * @param {string|null} [type]
   * @returns {Object|null}
   */
  pop(type = null) {
    let bestIdx = -1;
    for (let i = 0; i < this._items.length; i++) {
      const s = this._items[i];
      if (type != null && s.type !== type) continue;
      if (bestIdx === -1) { bestIdx = i; continue; }
      const b = this._items[bestIdx];
      if (s.priority > b.priority || (s.priority === b.priority && s._seq < b._seq)) {
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return null;
    const [item] = this._items.splice(bestIdx, 1);
    return item;
  }

  /** 偷看最高优先刺激但不移除（消费决策前用）。 */
  peek(type = null) {
    let best = null;
    for (const s of this._items) {
      if (type != null && s.type !== type) continue;
      if (!best || s.priority > best.priority || (s.priority === best.priority && s._seq < best._seq)) {
        best = s;
      }
    }
    return best;
  }

  /** 清理过期刺激（入队日超过 ttl 天未消费）。在每日 onPreTick 调用。 */
  pruneExpired(currentDay) {
    if (typeof currentDay !== 'number') return;
    this._items = this._items.filter(s => currentDay - s.day <= this.ttl);
  }

  /** 清空队列。 */
  clear() {
    this._items.length = 0;
  }

  get size() {
    return this._items.length;
  }
}
