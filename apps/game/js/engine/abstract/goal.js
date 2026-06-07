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
  DYNAMIC: 'dynamic',
});

const DEFAULT_SCORE_CONFIG = Object.freeze({
  minBiasMult: 0.25,
  maxBiasMult: 3,
  defaultConsiderationFloor: 0.05,
  rewardWeight: 0.5,
  riskWeight: 1,
});

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n > max ? max : n;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp01Or(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 0, 1);
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

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
     * @type {{ id: string, value: number, weight: number, floor: number|null }[]|null}
     */
    this._considerationTrace = null;

    /**
     * 评分上下文（NPC 效用评分公式升级）。
     * 默认 null 表示仅按 priority / modulators / considerations 计算；
     * npc-utility 在 Utility 激活态写入 expectedValue、goalRisk 与评分参数。
     * @type {null|Object}
     */
    this._scoreContext = null;
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
      weight: c.weight,
      floor: c.floor,
    }));
  }

  /** 考量因素加权几何平均（无考量因素时为 1）。 */
  _considerationMean(defaultFloor = DEFAULT_SCORE_CONFIG.defaultConsiderationFloor) {
    if (!this._considerationTrace || this._considerationTrace.length === 0) return 1;

    let weightedLog = 0;
    let weightSum = 0;
    const fallbackFloor = clamp01(defaultFloor);

    for (const t of this._considerationTrace) {
      const weight = positiveNumber(t.weight, 1);
      if (weight <= 0) continue;

      const floor = t.floor == null ? fallbackFloor : clamp01(t.floor);
      const safeValue = Math.max(clamp01(t.value), floor);
      weightedLog += weight * Math.log(safeValue);
      weightSum += weight;
    }

    if (weightSum <= 0) return 1;
    return Math.exp(weightedLog / weightSum);
  }

  /**
   * 叠加一个调制项（情绪/执念调制层用，ADR-019）。
   * @param {{ label?: string, deltaPriority?: number, deltaUrgency?: number, mult?: number }} mod
   */
  addModulator(mod) {
    if (!mod) return;
    this.modulators.push({
      label: mod.label || 'modulator',
      deltaPriority: finiteNumber(mod.deltaPriority, 0),
      deltaUrgency: finiteNumber(mod.deltaUrgency, 0),
      mult: mod.mult == null ? 1 : finiteNumber(mod.mult, 1),
    });
  }

  /**
   * 写入评分上下文。由 Utility 层注入收益、风险和评分参数。
   * @param {Object} [context]
   * @returns {Goal}
   */
  setScoreContext(context = {}) {
    context = context || {};
    const config = {
      ...DEFAULT_SCORE_CONFIG,
      ...(context.scoreConfig || {}),
    };

    const hardGate = context.hardGate == null ? 1 : clamp01Or(context.hardGate, 1);
    const expectedValue = clamp01(context.expectedValue ?? 0);
    const goalRisk = positiveNumber(context.goalRisk, 0);
    const rewardWeight = positiveNumber(context.rewardWeight ?? config.rewardWeight, DEFAULT_SCORE_CONFIG.rewardWeight);
    const riskWeight = positiveNumber(context.riskWeight ?? config.riskWeight, DEFAULT_SCORE_CONFIG.riskWeight);

    this._scoreContext = {
      hardGate,
      expectedValue,
      goalRisk,
      rewardWeight,
      riskWeight,
      scoreConfig: {
        minBiasMult: positiveNumber(config.minBiasMult, DEFAULT_SCORE_CONFIG.minBiasMult),
        maxBiasMult: positiveNumber(config.maxBiasMult, DEFAULT_SCORE_CONFIG.maxBiasMult),
        defaultConsiderationFloor: clamp01Or(config.defaultConsiderationFloor, DEFAULT_SCORE_CONFIG.defaultConsiderationFloor),
        rewardWeight,
        riskWeight,
      },
    };

    if (this._scoreContext.scoreConfig.maxBiasMult < this._scoreContext.scoreConfig.minBiasMult) {
      const min = this._scoreContext.scoreConfig.maxBiasMult;
      const max = this._scoreContext.scoreConfig.minBiasMult;
      this._scoreContext.scoreConfig.minBiasMult = min;
      this._scoreContext.scoreConfig.maxBiasMult = max;
    }

    return this;
  }

  /**
   * 返回当前评分上下文快照，供测试和调试面板读取。
   * @returns {null|Object}
   */
  getScoreContext() {
    return this._scoreContext ? {
      hardGate: this._scoreContext.hardGate,
      expectedValue: this._scoreContext.expectedValue,
      goalRisk: this._scoreContext.goalRisk,
      rewardWeight: this._scoreContext.rewardWeight,
      riskWeight: this._scoreContext.riskWeight,
      scoreConfig: { ...this._scoreContext.scoreConfig },
    } : null;
  }

  /**
   * 目标综合评分（Utility 选目标的最终依据，ADR-020）。
   *
   * 公式：score = hardGate × 100 × base × considerationMean × biasMult × rewardMult × riskMult
   *
   * - 无 considerations 且无 modulators 时严格等于 priority。
   * - considerations 提供加权几何平均考量因素(修炼需求×瓶颈程度×资源充足度)，∈[0,1]，
   *   缺省时乘积为 1，不影响评分。
   * @returns {number}
   */
  score() {
    if (!this._scoreContext && (!this._considerationTrace || this._considerationTrace.length === 0) && this.modulators.length === 0) {
      return this.priority;
    }

    const ctx = this._scoreContext || {
      hardGate: 1,
      expectedValue: 0,
      goalRisk: 0,
      rewardWeight: DEFAULT_SCORE_CONFIG.rewardWeight,
      riskWeight: DEFAULT_SCORE_CONFIG.riskWeight,
      scoreConfig: DEFAULT_SCORE_CONFIG,
    };

    let p = this.priority;
    let biasMult = 1;
    for (const m of this.modulators) {
      p += finiteNumber(m?.deltaPriority, 0);
      biasMult *= m?.mult == null ? 1 : finiteNumber(m.mult, 1);
    }

    const base = clamp01(p / 100);
    const minBias = ctx.scoreConfig.minBiasMult;
    const maxBias = ctx.scoreConfig.maxBiasMult;
    const clampedBias = clamp(biasMult, minBias, maxBias);
    const considerationMean = this._considerationMean(ctx.scoreConfig.defaultConsiderationFloor);
    const rewardMult = 1 + ctx.rewardWeight * ctx.expectedValue;
    const riskMult = 1 / (1 + ctx.riskWeight * ctx.goalRisk);

    return ctx.hardGate * 100 * base * considerationMean * clampedBias * rewardMult * riskMult;
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
      scoreContext: this.getScoreContext() || undefined,
    };
  }
}
