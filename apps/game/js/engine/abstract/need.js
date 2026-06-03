/**
 * Need - 需求基类
 *
 * 每个需求类型有 ID、优先级评估器、目标状态。
 * 策略模式：NeedEvaluator 可替换，不同评估逻辑可热插拔。
 */

/**
 * @typedef {Object} NeedConfig
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {NeedEvaluator} evaluator  优先级评估策略
 * @property {Object} [goalState]       GOAP 目标状态模板
 * @property {number} [basePriority=0]  基础优先级
 */

export class Need {
  /**
   * @param {NeedConfig} config
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description || '';
    this.evaluator = config.evaluator;
    this.goalStateTemplate = config.goalState || {};
    this.basePriority = config.basePriority || 0;
    // 选行策略（ADR-047）：'greedy' 表示该需求的目标应跳过 A* 折叠、走加权随机选一步（换着做）。
    this.selectStrategy = config.selectStrategy || 'astar';

    this.priority = 0;
    this.urgency = 0;
    this.goalState = {};
    this.satisfied = false;
  }

  /**
   * 评估当前优先级
   * @param {RuntimeState} entityState  实体运行时状态
   * @param {Object} worldContext       世界上下文
   * @returns {{ priority: number, urgency: number, goalState: Object, satisfied: boolean }}
   */
  evaluate(entityState, worldContext) {
    const result = this.evaluator.calculate(entityState, worldContext, this);
    this.priority = result.priority;
    this.urgency = result.urgency ?? 0;
    this.goalState = result.goalState || this.goalStateTemplate;
    this.satisfied = result.satisfied ?? false;
    return result;
  }

  /** 是否需要行动 */
  needsAction() {
    return !this.satisfied && this.priority > 0;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      priority: this.priority,
      urgency: this.urgency,
      satisfied: this.satisfied,
    };
  }
}

/**
 * NeedEvaluator - 需求优先级评估器接口
 *
 * 策略模式：每种需求类型实现自己的 calculate 方法。
 */
export class NeedEvaluator {
  /**
   * @param {RuntimeState} entityState
   * @param {Object} worldContext
   * @param {Need} need
   * @returns {{ priority: number, urgency: number, goalState: Object, satisfied: boolean }}
   */
  calculate(entityState, worldContext, need) {
    throw new Error('NeedEvaluator.calculate() must be overridden');
  }
}

/**
 * 通用表达式评估器 - 根据 JSON 配置的条件计算优先级
 * 适用于数据驱动的需求定义。
 */
export class ConfigurableEvaluator extends NeedEvaluator {
  /**
   * @param {Object} config
   * @param {Array} config.rules 规则列表 [{ condition, priorityBoost, goalStateOverride }]
   * @param {number} config.basePriority 基础优先级
   */
  constructor(config) {
    super();
    this.rules = config.rules || [];
    this.basePriority = config.basePriority || 0;
    this.satisfiedCondition = config.satisfiedCondition || null;
  }

  calculate(entityState, worldContext, need) {
    let priority = this.basePriority;
    let urgency = 0;
    let goalState = { ...need.goalStateTemplate };
    let satisfied = false;

    if (this.satisfiedCondition) {
      satisfied = this._evaluateCondition(this.satisfiedCondition, entityState, worldContext);
    }

    for (const rule of this.rules) {
      if (this._evaluateCondition(rule.condition, entityState, worldContext)) {
        priority += rule.priorityBoost || 0;
        urgency += rule.urgencyBoost || 0;
        if (rule.goalStateOverride) {
          Object.assign(goalState, rule.goalStateOverride);
        }
      }
    }

    // 增量式目标解析（2026-06-03，破解「GOAP 想一次规划到进度完成」）：
    //   goalState 模板里标了 incrementOf 的条目，表示目标不是终极值而是"在当前值上再推进 step"。
    //   每次评估按【实体当前值 + step】(夹 max) 算出本轮阈值。如此 A* 每次只规划推进一小步、做完重评估、
    //   下轮再往前一步——NPC 行为变成"缺啥补啥、换着做"，而非一口气折叠上百次闭关到 1.0 卡死（见 ADR-039/042）。
    goalState = this._resolveIncrementalGoals(goalState, entityState);

    // 性格加成（数据驱动）：根据实体 personality 与 personality.json 的 needBoosts 表，
    // 为本需求叠加优先级/紧迫度。详见 wiki/rules/personality.md。
    const personalityDelta = this._personalityBoost(entityState, worldContext, need);
    priority += personalityDelta.priority;
    urgency += personalityDelta.urgency;

    priority = Math.max(0, Math.min(100, priority));
    urgency = Math.max(0, Math.min(100, urgency));

    return { priority, urgency, goalState, satisfied };
  }

  /**
   * 把 goalState 中标了 incrementOf 的条目解析为「当前值 + step」(夹 max) 的本轮增量阈值。
   *
   * 条目形如 { op:'gte', incrementOf:'totalProgress', step:0.05, max:1.0 }：
   *   value = min((实体[incrementOf] || 0) + step, max)。
   * 已是终极完成（当前 >= max）时阈值取 max（满足即 satisfied，不再产出无意义子目标）。
   * 无 incrementOf 的条目原样保留（行为不变）。
   * @returns {Object} 新的 goalState（不修改入参）
   */
  _resolveIncrementalGoals(goalState, entityState) {
    let resolved = null;
    for (const [key, cond] of Object.entries(goalState)) {
      if (cond && typeof cond === 'object' && typeof cond.incrementOf === 'string') {
        if (!resolved) resolved = { ...goalState };
        const base = entityState.get(cond.incrementOf) || 0;
        const step = typeof cond.step === 'number' ? cond.step : 0.05;
        const max = typeof cond.max === 'number' ? cond.max : Infinity;
        const value = Math.min(base + step, max);
        resolved[key] = { op: cond.op || 'gte', value };
      }
    }
    return resolved || goalState;
  }

  /**
   * 计算性格对本需求的加成。
   * 加成量 = round((trait - minThreshold) / (100 - minThreshold) × maxBoost)，阈值处为 0、满值为 maxBoost。
   * @returns {{ priority:number, urgency:number }}
   */
  _personalityBoost(entityState, worldContext, need) {
    const result = { priority: 0, urgency: 0 };
    const personality = entityState && entityState.personality;
    const cfg = worldContext && worldContext.balanceConfig && worldContext.balanceConfig.personality;
    if (!personality || !cfg || !cfg.needBoosts || !need) return result;

    for (const [trait, boosts] of Object.entries(cfg.needBoosts)) {
      if (!Array.isArray(boosts)) continue;
      const traitVal = personality[trait];
      if (typeof traitVal !== 'number') continue;
      for (const b of boosts) {
        if (b.need !== need.id) continue;
        const minT = b.minThreshold ?? 0;
        if (traitVal <= minT) continue;
        const ratio = (traitVal - minT) / Math.max(1, 100 - minT);
        if (b.requireState && !this._evaluateCondition(b.requireState, entityState, worldContext)) continue;
        result.priority += Math.round(ratio * (b.maxPriorityBoost || 0));
        result.urgency += Math.round(ratio * (b.maxUrgencyBoost || 0));
      }
    }
    return result;
  }

  _evaluateCondition(condition, entityState, worldContext) {
    if (!condition) return true;
    const { key, op, value, source } = condition;

    let actual;
    if (source === 'world') {
      actual = worldContext[key];
    } else {
      actual = entityState.get(key);
    }

    switch (op) {
      case 'lt': return actual < value;
      case 'lte': return actual <= value;
      case 'gt': return actual > value;
      case 'gte': return actual >= value;
      case 'eq': return actual === value;
      case 'neq': return actual !== value;
      case 'exists': return actual != null;
      default: return false;
    }
  }
}
