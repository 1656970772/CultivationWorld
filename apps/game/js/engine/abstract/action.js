/**
 * Action - 原子行为基类（GOAP 核心）
 *
 * 每个 Action 封装：
 * - preconditions: 执行前必须满足的状态条件
 * - effects: 执行后对状态的改变
 * - costs: 消耗的物品/资源
 * - yields: 产出的物品/资源
 * - weight: GOAP 搜索时的路径代价
 *
 * 命令模式 + 策略模式：Action 是可序列化的命令，executor 可替换。
 */

/**
 * @typedef {Object} ActionConfig
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {Object} preconditions  { stateKey: { op, value } }
 * @property {Object} effects        { stateKey: value | { op, value } }
 * @property {Array}  [costs]        [{ itemId, amount }]
 * @property {Array}  [yields]       [{ itemId, amount }]
 * @property {number} [weight=1]     GOAP 路径代价
 * @property {string} [category]     行为分类
 * @property {number} [duration=1]   基础耗时（游戏日）：到达目标地点后执行行为本身所需天数
 * @property {boolean} [requiresTravel=false] 是否需先移动到目标地点再执行
 * @property {string} [targetResolver='self'] 目标地点解析方式（self/faction_hq/market/nearest_monster ...）
 * @property {number} [distanceCostPerTile=0] 每格移动折算的 GOAP weight 系数（仅影响规划代价）
 * @property {ActionExecutor} [executor]
 */

export class Action {
  /**
   * @param {ActionConfig} config
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description || '';
    this.preconditions = config.preconditions || {};
    this.effects = config.effects || {};
    this.costs = config.costs || [];
    this.yields = config.yields || [];
    this.weight = config.weight ?? 1;
    this.category = config.category || 'general';
    this.executor = config.executor || null;

    // 价值-风险决策（ADR-017）：基础价值与风险键，供 NPC 决策成本计算读取。
    // valueScore 越高的行为在 decisionCost 中减项越大（更想做）；riskKey 映射 risk.json。
    this.valueScore = config.valueScore ?? 0;
    this.riskKey = config.riskKey ?? null;

    // 行为耗时与移动（向后兼容：未声明时为瞬时、原地行为）
    this.duration = Math.max(1, config.duration ?? 1);
    this.requiresTravel = config.requiresTravel === true;
    this.targetResolver = config.targetResolver || 'self';
    this.distanceCostPerTile = config.distanceCostPerTile ?? 0;

    // 预计算：effects/preconditions 在 Action 构造后不可变，GOAP 热路径上被反复读取。
    // 规范化 effects 为 { key: {op,value} } 形式并缓存，免去 getEffects() 每次重建对象 + Object.entries。
    this._effectsNorm = this._normalizeEffects(this.effects);
    this._effectEntries = Object.entries(this._effectsNorm); // [ [key, {op,value}], ... ]
    this._preconditionEntries = Object.entries(this.preconditions);
    // GOAP 规划代价（getPlanCost 在搜索中每节点调用，结果恒定，预存）
    this._planCost = this.weight + (this.duration - 1);
  }

  _normalizeEffects(effects) {
    const result = {};
    for (const [key, effect] of Object.entries(effects)) {
      if (typeof effect === 'object' && effect !== null && 'op' in effect) {
        result[key] = effect;
      } else {
        result[key] = { op: 'set', value: effect };
      }
    }
    return result;
  }

  /**
   * GOAP 规划代价：基础 weight + 耗时代价。
   * 耗时越长、需要长途移动的行为，规划上代价越高（更真实）。
   * @returns {number}
   */
  getPlanCost() {
    return this._planCost;
  }

  /**
   * 基础消耗（getPlanCost 的语义别名，ADR-017）。
   * 价值-风险决策成本以此为基底，再叠加风险/价值；Action 本身无 entity 上下文，
   * 故不在此处计算风险/价值（由 npc-actions.js 的 computeDecisionCost 负责）。
   * @returns {number}
   */
  getBaseCost() {
    return this._planCost;
  }

  /**
   * 检查前置条件是否满足
   * @param {Object} stateSnapshot 扁平化的状态快照
   * @param {Object} worldContext
   * @returns {boolean}
   */
  checkPreconditions(stateSnapshot, worldContext) {
    for (const [key, condition] of Object.entries(this.preconditions)) {
      const actual = this._resolveValue(key, stateSnapshot, worldContext);
      if (!this._matchCondition(actual, condition)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 检查物品消耗是否可承受
   * @param {import('./inventory.js').Inventory} inventory
   * @returns {boolean}
   */
  checkCosts(inventory) {
    for (const cost of this.costs) {
      if (!inventory.has(cost.itemId, cost.amount)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 综合检查是否可执行
   */
  canExecute(stateSnapshot, worldContext, inventory) {
    return this.checkPreconditions(stateSnapshot, worldContext)
      && this.checkCosts(inventory);
  }

  /**
   * 执行行为
   * @param {import('./base-entity.js').BaseEntity} entity
   * @param {Object} worldContext
   * @returns {Object} 执行结果
   */
  execute(entity, worldContext) {
    this._consumeItems(entity.inventory);

    let result = {};
    if (this.executor) {
      result = this.executor.run(entity, worldContext, this) || {};
    }

    this._produceItems(entity.inventory);
    this._applyEffects(entity.state);

    return {
      actionId: this.id,
      actionName: this.name,
      costs: [...this.costs],
      yields: [...this.yields],
      ...result,
    };
  }

  /**
   * 获取此行为对状态的效果（供 GOAP 使用）
   * @returns {Object} 效果键值对
   */
  getEffects() {
    return this._effectsNorm;
  }

  /** 规范化后的 effects 入口数组（GOAP 热路径用，避免重复 Object.entries） */
  getEffectEntries() {
    return this._effectEntries;
  }

  /** preconditions 入口数组（GOAP 热路径用） */
  getPreconditionEntries() {
    return this._preconditionEntries;
  }

  /**
   * 检查此行为的效果是否能推进某个目标条件
   * @param {string} goalKey
   * @param {Object} goalCondition
   * @returns {boolean}
   */
  contributesToGoal(goalKey, goalCondition) {
    const effects = this.getEffects();
    if (!(goalKey in effects)) return false;

    const effect = effects[goalKey];
    switch (goalCondition.op) {
      case 'gte':
      case 'gt':
        return effect.op === 'add' && effect.value > 0
          || effect.op === 'set' && effect.value >= goalCondition.value;
      case 'lte':
      case 'lt':
        return effect.op === 'add' && effect.value < 0
          || effect.op === 'set' && effect.value <= goalCondition.value;
      case 'eq':
        return effect.op === 'set' && effect.value === goalCondition.value;
      case 'true':
        return effect.op === 'set' && effect.value === true;
      case 'false':
        return effect.op === 'set' && effect.value === false;
      default:
        return true;
    }
  }

  _consumeItems(inventory) {
    for (const cost of this.costs) {
      inventory.remove(cost.itemId, cost.amount);
    }
  }

  _produceItems(inventory) {
    for (const item of this.yields) {
      inventory.add(item.itemId, item.amount);
    }
  }

  _applyEffects(state) {
    for (const [key, effect] of Object.entries(this.effects)) {
      if (typeof effect === 'object' && effect !== null && 'op' in effect) {
        const current = state.get(key) ?? 0;
        switch (effect.op) {
          case 'add':
            state.set(key, current + effect.value);
            break;
          case 'multiply':
            state.set(key, current * effect.value);
            break;
          case 'set':
            state.set(key, effect.value);
            break;
          case 'max':
            state.set(key, Math.max(current, effect.value));
            break;
          case 'min':
            state.set(key, Math.min(current, effect.value));
            break;
        }
      } else {
        state.set(key, effect);
      }
    }
  }

  _resolveValue(key, stateSnapshot, worldContext) {
    if (key.startsWith('world.')) {
      return worldContext[key.substring(6)];
    }
    return stateSnapshot[key];
  }

  _matchCondition(actual, condition) {
    if (typeof condition !== 'object' || condition === null) {
      return actual === condition;
    }
    const { op, value } = condition;
    switch (op) {
      case 'lt': return actual < value;
      case 'lte': return actual <= value;
      case 'gt': return actual > value;
      case 'gte': return actual >= value;
      case 'eq': return actual === value;
      case 'neq': return actual !== value;
      case 'true': return !!actual;
      case 'false': return !actual;
      case 'exists': return actual != null;
      case 'in': return Array.isArray(value) && value.includes(actual);
      default: return actual === value;
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      weight: this.weight,
      preconditions: this.preconditions,
      effects: this.effects,
      costs: this.costs,
      yields: this.yields,
    };
  }
}

/**
 * ActionExecutor - 行为执行器接口
 * 策略模式：每种行为类型实现自己的 run 方法。
 */
export class ActionExecutor {
  /**
   * @param {import('./base-entity.js').BaseEntity} entity
   * @param {Object} worldContext
   * @param {Action} action
   * @returns {Object} 执行结果附加数据
   */
  run(entity, worldContext, action) {
    throw new Error('ActionExecutor.run() must be overridden');
  }
}
