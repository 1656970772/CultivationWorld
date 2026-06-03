/**
 * GOAPPlanner - 目标导向行动规划器
 *
 * 核心算法：A* 反向搜索
 * 从目标状态出发，反向应用 action 的 effects，直到匹配当前状态。
 * 返回正序的最低代价行为链。
 */
export class GOAPPlanner {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxDepth=10]       最大搜索深度
   * @param {number} [options.maxIterations=1000] 最大迭代次数
   */
  constructor(options = {}) {
    this.maxDepth = options.maxDepth ?? 10;
    this.maxIterations = options.maxIterations ?? 1000;
  }

  /**
   * 生成行为链
   *
   * @param {Object} currentState  当前状态 { key: value }
   * @param {Object} goalState     目标状态 { key: { op, value } }
   * @param {import('./action.js').Action[]} availableActions
   * @param {?(action: import('./action.js').Action) => number} [costFn]
   *   可选的 step cost 函数：给定 action 返回【本次规划固定】的代价（价值-风险决策用，见 ADR-017）。
   *   A* 要求 step cost 单次规划内稳定，故 costFn 必须对同一 action 返回恒定值（调用方在进规划前算好）。
   *   不传时回退 action.getPlanCost()，保证既有调用方行为不变。
   * @returns {{ success: boolean, plan: import('./action.js').Action[], cost: number, iterations: number }}
   */
  plan(currentState, goalState, availableActions, costFn = null) {
    if (this._goalSatisfied(currentState, goalState)) {
      return { success: true, plan: [], cost: 0, iterations: 0 };
    }

    // 本次规划的固定 step cost 解析器：优先 costFn，否则 getPlanCost。
    this._costOf = costFn
      ? (action) => costFn(action)
      : (action) => (typeof action.getPlanCost === 'function' ? action.getPlanCost() : action.weight);

    // 本次规划内所有状态都从 currentState 派生，键集合不变。
    this._stateKeyOrder = Object.keys(currentState).sort();
    this._goalEntries = Object.entries(goalState);
    this._goalEntriesFor = goalState;

    // 尝试编译为"定长值数组"快路径：把所有键映射到固定下标，状态以数组表示，
    // 行为/目标/前置编译为下标化操作。这样每节点扩展只需 slice 数组 + 写少量下标，
    // stateKey 仅拼接值（不含键名），消除原 plain-object 的 {...state} 与全键拼接开销。
    // 仅当所有 effect/precondition/goal 键都在 currentState 键集合内时启用；否则回退慢路径。
    const compiled = this._compileFast(currentState, goalState, availableActions);
    if (compiled) {
      return this._planFast(compiled, availableActions);
    }

    // ---- 慢路径（plain object，向后兼容：行为引入了新键等罕见情形）----
    const openList = new MinHeap();
    const closedSet = new Set();
    let iterations = 0;

    const startNode = {
      state: { ...currentState },
      actions: [],
      gCost: 0,
      hCost: this._heuristic(currentState, goalState),
    };
    startNode.fCost = startNode.gCost + startNode.hCost;
    openList.push(startNode);

    while (openList.size > 0 && iterations < this.maxIterations) {
      iterations++;
      const current = openList.pop();

      if (this._goalSatisfied(current.state, goalState)) {
        return { success: true, plan: current.actions, cost: current.gCost, iterations };
      }

      const stateKey = this._stateKey(current.state);
      if (closedSet.has(stateKey)) continue;
      closedSet.add(stateKey);

      for (const action of availableActions) {
        if (!this._actionApplicable(current.state, action)) continue;

        const repeat = this._repeatToReachGoal(current.state, action, goalState);
        const newState = this._applyActionForward(current.state, action, repeat);
        const newStateKey = this._stateKey(newState);
        if (closedSet.has(newStateKey)) continue;

        const newActions = [...current.actions, action];
        if (newActions.length > this.maxDepth) continue;

        const stepCost = this._costOf(action);
        const gCost = current.gCost + stepCost * repeat;

        const hCost = this._heuristic(newState, goalState);
        const node = { state: newState, actions: newActions, gCost, hCost, fCost: gCost + hCost };
        openList.push(node);
      }
    }

    return { success: false, plan: [], cost: Infinity, iterations };
  }

  /**
   * 把一次规划编译为下标化的"定长值数组"表示（快路径）。
   * 返回 null 表示存在不在状态键集合内的键，调用方回退慢路径。
   *
   * @returns {null | {
   *   keys: string[], idxOf: Map<string,number>, startVals: any[],
   *   goal: Array<{idx,op,value}>, actions: Array<{action, pre:Array, eff:Array, cost:number}>
   * }}
   */
  _compileFast(currentState, goalState, availableActions) {
    // 键并集：currentState 的键 + 所有 action/goal 引用到的键。
    // 缺失键初值为 undefined（与慢路径 state[key]===undefined 一致），从而无需因"新键"回退。
    const idxOf = new Map();
    const keys = [];
    const addKey = (k) => { if (!idxOf.has(k)) { idxOf.set(k, keys.length); keys.push(k); } };
    for (const k of this._stateKeyOrder) addKey(k);
    for (const [k] of this._goalEntries) addKey(k);
    for (const action of availableActions) {
      const pe = action.getPreconditionEntries();
      for (let i = 0; i < pe.length; i++) addKey(pe[i][0]);
      const ee = action.getEffectEntries();
      for (let i = 0; i < ee.length; i++) addKey(ee[i][0]);
    }

    const startVals = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) startVals[i] = currentState[keys[i]];

    const goal = [];
    for (const [k, cond] of this._goalEntries) {
      const idx = idxOf.get(k);
      if (typeof cond === 'object' && cond !== null) goal.push({ idx, op: cond.op, value: cond.value });
      else goal.push({ idx, op: 'eqRaw', value: cond });
    }

    const actions = [];
    for (const action of availableActions) {
      const preEntries = action.getPreconditionEntries();
      const pre = [];
      for (let i = 0; i < preEntries.length; i++) {
        const idx = idxOf.get(preEntries[i][0]);
        const cond = preEntries[i][1];
        if (typeof cond === 'object' && cond !== null) pre.push({ idx, op: cond.op, value: cond.value });
        else pre.push({ idx, op: 'eqRaw', value: cond });
      }
      const effEntries = action.getEffectEntries();
      const eff = [];
      for (let i = 0; i < effEntries.length; i++) {
        const e = effEntries[i][1];
        eff.push({ idx: idxOf.get(effEntries[i][0]), op: e.op, value: e.value });
      }
      // 快路径在编译期固化 cost：用本次规划的固定解析器（costFn 或 getPlanCost），
      // 故同一 action 在本次搜索全程 cost 不变，满足 A* step cost 稳定性。
      const cost = this._costOf(action);
      actions.push({ action, pre, eff, cost });
    }

    return { keys, idxOf, startVals, goal, actions };
  }

  /** 快路径 A*：状态为定长值数组，节点用 parent 链回溯（免每节点拷贝 actions 数组）。 */
  _planFast(c, availableActions) {
    const { startVals, goal, actions } = c;
    const openList = new MinHeap();
    const closedSet = new Set();
    let iterations = 0;

    const startNode = {
      vals: startVals, parent: null, action: null, depth: 0,
      gCost: 0, hCost: this._heuristicFast(startVals, goal),
      key: this._valsKey(startVals), // 每节点的 stateKey 生成一次后缓存，pop 时复用，避免重复拼接
    };
    startNode.fCost = startNode.gCost + startNode.hCost;
    openList.push(startNode);

    while (openList.size > 0 && iterations < this.maxIterations) {
      iterations++;
      const current = openList.pop();

      if (this._goalSatisfiedFast(current.vals, goal)) {
        return { success: true, plan: this._reconstructFast(current), cost: current.gCost, iterations };
      }

      if (closedSet.has(current.key)) continue;
      closedSet.add(current.key);

      const depth = current.depth + 1;
      if (depth > this.maxDepth) continue; // 子节点都会超深，整批跳过

      for (let ai = 0; ai < actions.length; ai++) {
        const a = actions[ai];
        if (!this._applicableFast(current.vals, a.pre)) continue;

        const repeat = this._repeatFast(current.vals, a.eff, goal);
        const newVals = this._applyFast(current.vals, a.eff, repeat);
        const newStateKey = this._valsKey(newVals);
        if (closedSet.has(newStateKey)) continue;

        const gCost = current.gCost + a.cost * repeat;
        const hCost = this._heuristicFast(newVals, goal);
        openList.push({
          vals: newVals, parent: current, action: a.action, depth,
          gCost, hCost, fCost: gCost + hCost, key: newStateKey,
        });
      }
    }

    return { success: false, plan: [], cost: Infinity, iterations };
  }

  _reconstructFast(node) {
    const out = [];
    let n = node;
    while (n && n.action) { out.push(n.action); n = n.parent; }
    out.reverse();
    return out;
  }

  _valsKey(vals) {
    let s = '';
    for (let i = 0; i < vals.length; i++) s += vals[i] + '|';
    return s;
  }

  _goalSatisfiedFast(vals, goal) {
    for (let i = 0; i < goal.length; i++) {
      const g = goal[i];
      if (!this._matchOp(vals[g.idx], g.op, g.value)) return false;
    }
    return true;
  }

  _applicableFast(vals, pre) {
    for (let i = 0; i < pre.length; i++) {
      const p = pre[i];
      if (!this._matchOp(vals[p.idx], p.op, p.value)) return false;
    }
    return true;
  }

  _heuristicFast(vals, goal) {
    let d = 0;
    for (let i = 0; i < goal.length; i++) {
      const g = goal[i];
      d += this._distOp(vals[g.idx], g.op, g.value);
    }
    return d;
  }

  _applyFast(vals, eff, repeat) {
    const nv = vals.slice();
    for (let i = 0; i < eff.length; i++) {
      const e = eff[i];
      const cur = nv[e.idx] ?? 0;
      switch (e.op) {
        case 'set': nv[e.idx] = e.value; break;
        case 'add': nv[e.idx] = (typeof cur === 'number' ? cur : 0) + e.value * repeat; break;
        case 'multiply': nv[e.idx] = (typeof cur === 'number' ? cur : 0) * Math.pow(e.value, repeat); break;
        case 'max': nv[e.idx] = Math.max(cur, e.value); break;
        case 'min': nv[e.idx] = Math.min(cur, e.value); break;
      }
    }
    return nv;
  }

  _repeatFast(vals, eff, goal) {
    let maxRepeat = 1;
    for (let gi = 0; gi < goal.length; gi++) {
      const g = goal[gi];
      if (g.op === 'eqRaw') continue;
      // 找到作用于该目标键的 add 型效果
      let effVal = null;
      for (let ei = 0; ei < eff.length; ei++) {
        if (eff[ei].idx === g.idx && eff[ei].op === 'add' && typeof eff[ei].value === 'number' && eff[ei].value !== 0) {
          effVal = eff[ei].value; break;
        }
      }
      if (effVal === null) continue;
      const current = typeof vals[g.idx] === 'number' ? vals[g.idx] : 0;
      const op = g.op, value = g.value;
      let needed = 0;
      if ((op === 'gte' || op === 'gt') && effVal > 0) {
        const target = op === 'gt' ? value + Number.EPSILON : value;
        if (current < target) needed = Math.ceil((target - current) / effVal);
      } else if ((op === 'lte' || op === 'lt') && effVal < 0) {
        const target = op === 'lt' ? value - Number.EPSILON : value;
        if (current > target) needed = Math.ceil((current - target) / -effVal);
      }
      if (needed > maxRepeat) maxRepeat = needed;
    }
    return maxRepeat;
  }

  /** 下标化条件匹配，语义与 _matchGoalCondition 一致（eqRaw 对应非对象条件的严格相等） */
  _matchOp(actual, op, value) {
    if (op === 'eqRaw') return actual === value;
    if (actual == null) actual = 0;
    switch (op) {
      case 'lt': return actual < value;
      case 'lte': return actual <= value;
      case 'gt': return actual > value;
      case 'gte': return actual >= value;
      case 'eq': return actual === value;
      case 'neq': return actual !== value;
      case 'true': return !!actual;
      case 'false': return !actual;
      default: return actual === value;
    }
  }

  /** 下标化距离估算，语义与 _conditionDistance 一致 */
  _distOp(actual, op, value) {
    if (op === 'eqRaw') return actual === value ? 0 : 1;
    if (actual == null) actual = 0;
    switch (op) {
      case 'gte': return actual >= value ? 0 : Math.ceil((value - actual) / Math.max(1, value * 0.1));
      case 'gt': return actual > value ? 0 : Math.ceil((value + 1 - actual) / Math.max(1, value * 0.1));
      case 'lte': return actual <= value ? 0 : Math.ceil((actual - value) / Math.max(1, value * 0.1));
      case 'lt': return actual < value ? 0 : Math.ceil((actual - value + 1) / Math.max(1, value * 0.1));
      case 'eq': return actual === value ? 0 : 1;
      case 'neq': return actual !== value ? 0 : 1;
      case 'true': return actual ? 0 : 1;
      case 'false': return !actual ? 0 : 1;
      default: return actual === value ? 0 : 1;
    }
  }

  /**
   * 检查目标是否已满足
   */
  _goalSatisfied(state, goalState) {
    // 优先用本次规划预存的 goal entries（plan 内调用）；外部直接调用时回退 Object.entries。
    const entries = this._goalEntries && this._goalEntriesFor === goalState
      ? this._goalEntries : Object.entries(goalState);
    for (let i = 0; i < entries.length; i++) {
      if (!this._matchGoalCondition(state[entries[i][0]], entries[i][1])) {
        return false;
      }
    }
    return true;
  }

  /**
   * 启发式函数：估算当前状态到目标的距离
   */
  _heuristic(state, goalState) {
    const entries = this._goalEntries && this._goalEntriesFor === goalState
      ? this._goalEntries : Object.entries(goalState);
    let distance = 0;
    for (let i = 0; i < entries.length; i++) {
      distance += this._conditionDistance(state[entries[i][0]], entries[i][1]);
    }
    return distance;
  }

  /**
   * 检查 action 是否在当前状态下可用
   */
  _actionApplicable(state, action) {
    const entries = action.getPreconditionEntries(); // 预存数组，免 Object.entries
    for (let i = 0; i < entries.length; i++) {
      const actual = state[entries[i][0]];
      if (!this._matchPrecondition(actual, entries[i][1])) {
        return false;
      }
    }
    return true;
  }

  /**
   * 正向应用 action 的效果到状态
   * @param {number} [repeat=1] 该行为连续重复的次数（用于增量目标折叠）
   */
  _applyActionForward(state, action, repeat = 1) {
    const newState = { ...state };
    const entries = action.getEffectEntries(); // 预存数组，免 Object.entries
    for (let i = 0; i < entries.length; i++) {
      const key = entries[i][0];
      const effect = entries[i][1];
      const current = newState[key] ?? 0;
      switch (effect.op) {
        case 'set':
          newState[key] = effect.value;
          break;
        case 'add':
          newState[key] = (typeof current === 'number' ? current : 0) + effect.value * repeat;
          break;
        case 'multiply':
          newState[key] = (typeof current === 'number' ? current : 0) * Math.pow(effect.value, repeat);
          break;
        case 'max':
          newState[key] = Math.max(current, effect.value);
          break;
        case 'min':
          newState[key] = Math.min(current, effect.value);
          break;
      }
    }
    return newState;
  }

  /**
   * 计算某行为需重复多少次才能让其 add 型效果满足相关数值目标。
   *
   * 仅处理"add 型 effect 推进 gte/gt/lte/lt 数值目标"的情形（典型如修炼进度逐步累积）：
   * 这类增量目标若逐次展开会因步数巨大被 maxDepth 截断而规划失败，故一步折叠出所需次数。
   * 其余情形返回 1（普通单步行为，行为不影响相关目标时亦为 1）。
   *
   * @returns {number} 重复次数（>=1）
   */
  _repeatToReachGoal(state, action, goalState) {
    const effects = action.getEffects();
    let maxRepeat = 1;

    const entries = this._goalEntries && this._goalEntriesFor === goalState
      ? this._goalEntries : Object.entries(goalState);
    for (let i = 0; i < entries.length; i++) {
      const key = entries[i][0];
      const condition = entries[i][1];
      if (typeof condition !== 'object' || condition === null) continue;
      const effect = effects[key];
      if (!effect || effect.op !== 'add' || typeof effect.value !== 'number' || effect.value === 0) continue;

      const current = typeof state[key] === 'number' ? state[key] : 0;
      const { op, value } = condition;
      let needed = 0;

      if ((op === 'gte' || op === 'gt') && effect.value > 0) {
        const target = op === 'gt' ? value + Number.EPSILON : value;
        if (current < target) needed = Math.ceil((target - current) / effect.value);
      } else if ((op === 'lte' || op === 'lt') && effect.value < 0) {
        const target = op === 'lt' ? value - Number.EPSILON : value;
        if (current > target) needed = Math.ceil((current - target) / -effect.value);
      }

      if (needed > maxRepeat) maxRepeat = needed;
    }

    return maxRepeat;
  }

  _matchGoalCondition(actual, condition) {
    if (typeof condition !== 'object' || condition === null) {
      return actual === condition;
    }
    const { op, value } = condition;
    if (actual == null) actual = 0;
    switch (op) {
      case 'lt': return actual < value;
      case 'lte': return actual <= value;
      case 'gt': return actual > value;
      case 'gte': return actual >= value;
      case 'eq': return actual === value;
      case 'neq': return actual !== value;
      case 'true': return !!actual;
      case 'false': return !actual;
      default: return actual === value;
    }
  }

  _matchPrecondition(actual, condition) {
    return this._matchGoalCondition(actual, condition);
  }

  /**
   * 单个条件的距离估算
   */
  _conditionDistance(actual, condition) {
    if (typeof condition !== 'object' || condition === null) {
      return actual === condition ? 0 : 1;
    }
    const { op, value } = condition;
    if (actual == null) actual = 0;

    switch (op) {
      case 'gte':
        return actual >= value ? 0 : Math.ceil((value - actual) / Math.max(1, value * 0.1));
      case 'gt':
        return actual > value ? 0 : Math.ceil((value + 1 - actual) / Math.max(1, value * 0.1));
      case 'lte':
        return actual <= value ? 0 : Math.ceil((actual - value) / Math.max(1, value * 0.1));
      case 'lt':
        return actual < value ? 0 : Math.ceil((actual - value + 1) / Math.max(1, value * 0.1));
      case 'eq':
        return actual === value ? 0 : 1;
      case 'neq':
        return actual !== value ? 0 : 1;
      case 'true':
        return actual ? 0 : 1;
      case 'false':
        return !actual ? 0 : 1;
      default:
        return actual === value ? 0 : 1;
    }
  }

  /**
   * 生成状态的唯一键（用于去重）。
   *
   * 性能关键路径：本次规划内键集合不变，复用 plan() 预排序的 _stateKeyOrder，
   * 免去每个搜索节点重复 Object.keys().sort()（原占总耗时 ~24%）。
   * 仅当行为引入了新键（键数不一致）时回退到全量排序，保证正确性。
   */
  _stateKey(state) {
    const order = this._stateKeyOrder;
    if (order && Object.keys(state).length === order.length) {
      // 键顺序在本次规划内固定，无需把键名写进 key；仅按固定顺序拼接值即可唯一标识状态。
      let s = '';
      for (let i = 0; i < order.length; i++) {
        s += state[order[i]] + '|';
      }
      return s;
    }
    const keys = Object.keys(state).sort();
    return keys.map(k => `${k}:${state[k]}`).join('|');
  }
}

/**
 * 最小堆 - 用于 A* 搜索的优先队列
 */
class MinHeap {
  constructor() {
    this._data = [];
  }

  get size() {
    return this._data.length;
  }

  push(node) {
    this._data.push(node);
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    if (this._data.length === 0) return null;
    const top = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].fCost <= this._data[i].fCost) break;
      [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this._data[left].fCost < this._data[smallest].fCost) smallest = left;
      if (right < n && this._data[right].fCost < this._data[smallest].fCost) smallest = right;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
      i = smallest;
    }
  }
}
