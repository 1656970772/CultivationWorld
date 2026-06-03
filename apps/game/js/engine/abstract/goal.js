/**
 * Goal - 目标抽象
 *
 * GOBT 三层架构（ADR-018）中"Utility 选目标"层的统一数据载体。
 * 在此之前，目标隐含在 Need.goalState 里；抽出独立 Goal 后，需求(Need)、执念(Obsession)
 * 等不同来源都能产出 Goal，统一进入 PlannerNode 的 Utility 选择与 GOAP 规划。
 *
 * 设计要点：
 * - Goal 是"想达成的世界状态"+ 一个可比较的优先级评分(score)。
 * - score 默认等于 priority（沿用 Need 排序口径）；
 *   情绪/执念等调制层后续通过 modulators 叠加，不改动既有口径。
 */

/**
 * 目标来源枚举（遵循项目规则：多分支用枚举而非字符串字面量散落各处）。
 * @enum {string}
 */
export const GoalSource = Object.freeze({
  NEED: 'need',
  OBSESSION: 'obsession',
  REACTION: 'reaction',
  OPPORTUNITY: 'opportunity',
  RELATIONSHIP: 'relationship',
});

/**
 * @typedef {Object} GoalConfig
 * @property {string} id                       目标唯一标识（同一来源稳定）
 * @property {string} [name]                   展示名
 * @property {GoalSource} source               目标来源
 * @property {string} [sourceId]               来源实体 id（如 need.id / obsession.id）
 * @property {Object} goalState                GOAP 目标状态：{ key: { op, value } }
 * @property {number} [priority=0]             基础优先级（0-100，口径同 Need.priority）
 * @property {number} [urgency=0]              紧迫度（同分比较用）
 * @property {string} [tag]                    分类标签（调试/可视化用）
 */

export class Goal {
  /**
   * @param {GoalConfig} config
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.source = config.source || GoalSource.NEED;
    this.sourceId = config.sourceId || config.id;
    this.goalState = config.goalState || {};
    this.priority = config.priority || 0;
    this.urgency = config.urgency || 0;
    this.tag = config.tag || null;

    /**
     * 选行策略（2026-06-03，ADR-047）：
     * - 'astar'(缺省)：走 A* 最优规划（折叠多步到目标），适合有明确步骤链的目标。
     * - 'greedy'：跳过 A* 折叠，直接在「能推进目标的可执行行为」间按推进性价比【加权随机】选一步。
     *   适合修炼这类"重复累积、无唯一最优、应换着做"的目标——避免 A* 因游历单步推进量大而恒偏游历、
     *   导致行为一边倒（见 ADR-047 修炼选行均衡）。
     * @type {'astar'|'greedy'}
     */
    this.selectStrategy = config.selectStrategy || 'astar';

    /**
     * 调制项列表，供情绪/执念等层叠加。元素形如 { label, deltaPriority, deltaUrgency, mult }。
     * 仅用于可解释性与调试，最终评分由 score() 汇总。
     */
    this.modulators = [];

    /**
     * 考量因素列表（ADR-020）。每个 consideration 经响应曲线映射到 [0,1]，相乘得到
     * 「乘法式效用」(Utility AI 标准做法)。为空时 score() 退化为纯加法。
     * @type {import('./consideration.js').Consideration[]}
     */
    this.considerations = [];

    /**
     * 考量因素求值缓存（每次 evaluateConsiderations 写入），供调试/可视化。
     * @type {{ id: string, value: number }[]|null}
     */
    this._considerationTrace = null;
  }

  /**
   * 设置考量因素并立即求值缓存其乘积（供 score() 使用）。
   * 由 PlannerNode/实体在排序前调用；不调用则 considerations 不参与评分。
   * @param {import('./consideration.js').Consideration[]} considerations
   * @param {Object} entityState
   * @param {Object} worldContext
   * @param {Object} [derived] 派生输入（如 timeValue）
   */
  evaluateConsiderations(considerations, entityState, worldContext, derived = {}) {
    this.considerations = considerations || [];
    if (this.considerations.length === 0) {
      this._considerationTrace = null;
      return;
    }
    this._considerationTrace = this.considerations.map(c => ({
      id: c.id,
      value: c.evaluate(entityState, worldContext, derived),
    }));
  }

  /** 考量因素乘积（无考量因素时为 1）。 */
  _considerationProduct() {
    if (!this._considerationTrace || this._considerationTrace.length === 0) return 1;
    let prod = 1;
    for (const t of this._considerationTrace) prod *= t.value;
    return prod;
  }

  /**
   * 叠加一个调制项（情绪/执念调制层用，ADR-019）。
   * @param {{ label?: string, deltaPriority?: number, deltaUrgency?: number, mult?: number }} mod
   */
  addModulator(mod) {
    if (!mod) return;
    this.modulators.push({
      label: mod.label || 'modulator',
      deltaPriority: mod.deltaPriority || 0,
      deltaUrgency: mod.deltaUrgency || 0,
      mult: mod.mult == null ? 1 : mod.mult,
    });
  }

  /**
   * 目标综合评分（Utility 选目标的最终依据，ADR-020）。
   *
   * 公式：score = (priority + Σdelta) × Π(modulator.mult) × Π(consideration)
   *
   * - 无 considerations 且无 modulators 时严格等于 priority。
   * - considerations 提供「乘法式」考量因素(修炼需求×瓶颈程度×资源充足度)，∈[0,1]，
   *   缺省时乘积为 1，不影响评分。
   * @returns {number}
   */
  score() {
    let p = this.priority;
    let mult = 1;
    for (const m of this.modulators) {
      p += m.deltaPriority;
      mult *= m.mult;
    }
    return p * mult * this._considerationProduct();
  }

  /**
   * 紧迫度综合评分（同分目标的二级比较依据）。
   */
  urgencyScore() {
    let u = this.urgency;
    for (const m of this.modulators) {
      u += m.deltaUrgency;
    }
    return u;
  }

  /**
   * 从一个已评估的 Need 构造 Goal。
   * priority/urgency/goalState 全部沿用 Need 的评估结果。
   * @param {import('./need.js').Need} need
   * @returns {Goal}
   */
  static fromNeed(need) {
    return new Goal({
      id: `goal_${need.id}`,
      name: need.name,
      source: GoalSource.NEED,
      sourceId: need.id,
      goalState: need.goalState,
      priority: need.priority,
      urgency: need.urgency,
      tag: 'need',
      selectStrategy: need.selectStrategy || 'astar',
    });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      source: this.source,
      sourceId: this.sourceId,
      priority: this.priority,
      urgency: this.urgency,
      score: this.score(),
      tag: this.tag,
      considerations: this._considerationTrace || undefined,
    };
  }
}
