/**
 * BehaviorSystem - 实体的行为执行器
 *
 * 管理行为链的规划与执行，支持中断、重新规划。
 * 每个 Tick 执行行为链的下一步。
 */
import { GOAPPlanner } from './goap-planner.js';

export class BehaviorSystem {
  /**
   * @param {GOAPPlanner} planner
   * @param {import('./action.js').Action[]} availableActions
   */
  constructor(planner, availableActions = []) {
    this.planner = planner;
    this.availableActions = availableActions;
    this.currentPlan = [];
    this.currentActionIndex = 0;
    this.currentNeedId = null;
    this._lastPlanResult = null;

    /**
     * 当前行为的执行生命周期（行为耗时层）。
     * phase: 'idle' | 'traveling' | 'executing'
     */
    this._lifecycle = { phase: 'idle', actionId: null, remaining: 0, traveled: false };
  }

  /**
   * 注册可用行为
   */
  addAction(action) {
    if (!this.availableActions.find(a => a.id === action.id)) {
      this.availableActions.push(action);
    }
  }

  removeAction(actionId) {
    this.availableActions = this.availableActions.filter(a => a.id !== actionId);
  }

  /**
   * 根据最高优先需求/目标，通过 GOAP 规划生成行为链（GOBT 选目标 + 规划层，ADR-018）。
   *
   * 目标来源统一为 Goal：NeedSystem 产出的 Goal 与可选的 extraGoals（如执念，ADR-019）
   * 合并后按 score 降序、urgency 次级排序，依次尝试 GOAP 规划，命中即停。
   *
   * @param {import('./need-system.js').NeedSystem} needSystem
   * @param {Object} currentGOAPState 当前状态的扁平键值表示
   * @param {Object} worldContext
   * @param {?(action: import('./action.js').Action) => number} [costFn]
   *   可选 step cost 函数，透传给规划器（价值-风险决策用，见 ADR-017）。本次规划内须对同一 action 恒定。
   * @param {import('./goal.js').Goal[]} [extraGoals]
   *   额外目标来源（执念等），与需求目标合并参与选择。
   * @param {?(goal: import('./goal.js').Goal) => void} [goalModulator]
   *   目标调制回调（情绪等，ADR-019），对合并后每个 Goal 叠加 modulator 后再排序。
   * @returns {import('./action.js').Action[]} 规划出的行为链
   */
  plan(needSystem, currentGOAPState, worldContext, costFn = null, extraGoals = [], goalModulator = null) {
    const goals = this._collectGoals(needSystem, extraGoals, goalModulator);
    if (goals.length === 0) {
      this.currentPlan = [];
      this.currentActionIndex = 0;
      this.currentNeedId = null;
      return [];
    }

    for (const goal of goals) {
      const result = this.planner.plan(
        currentGOAPState,
        goal.goalState,
        this.availableActions,
        costFn
      );

      if (result.success && result.plan.length > 0) {
        this.currentPlan = result.plan;
        this.currentActionIndex = 0;
        this.currentNeedId = goal.sourceId;
        this._lastPlanResult = {
          needId: goal.sourceId,
          needName: goal.name,
          needPriority: goal.priority,
          goalSource: goal.source,
          planLength: result.plan.length,
          planCost: result.cost,
          iterations: result.iterations,
          actions: result.plan.map(a => a.id),
        };
        return result.plan;
      }

      // GOAP 失败，立即尝试该目标的贪心回退（保证高优先级目标优先获得行为）
      const fallback = this._tryGreedyFallback(goal, currentGOAPState, worldContext, costFn);
      if (fallback) return [fallback];
    }

    this.currentPlan = [];
    this.currentActionIndex = 0;
    this.currentNeedId = null;
    this._lastPlanResult = {
      needId: goals[0]?.sourceId,
      needName: goals[0]?.name,
      planLength: 0,
      planCost: 0,
      iterations: 0,
      actions: [],
      failed: true,
    };
    return [];
  }

  /**
   * 汇总并排序候选目标。需求目标 + 额外目标（执念等）按 score 降序、urgency 次级排序。
   * 无 extraGoals 时，顺序与 needSystem.getTopGoals/getTopNeeds 一致（行为零漂移）。
   * @returns {import('./goal.js').Goal[]}
   */
  _collectGoals(needSystem, extraGoals = [], goalModulator = null) {
    const needGoals = needSystem.getTopGoals(3);
    const hasExtra = extraGoals && extraGoals.length > 0;

    // 无额外目标且无情绪调制：保持原顺序（与重构前 getTopNeeds 一致，行为零漂移）。
    if (!hasExtra && !goalModulator) return needGoals;

    // 合并顺序 [需求, 执念]：稳定排序下，同分时需求优先于执念。
    // 这保证执念虽强（通常 intensity 更高，会真正压过普通需求），但在与紧急生存/疗伤
    // 等同分需求并列时让位——生存是底线，避免执念导致 NPC 无视寿元/重伤而大量陨落。
    const merged = hasExtra ? [...needGoals, ...extraGoals] : [...needGoals];

    // 情绪调制（ADR-019）：对每个 Goal 叠加 modulator，再按调制后的 score 排序。
    if (goalModulator) {
      for (const g of merged) goalModulator(g);
    }

    merged.sort((a, b) => {
      const sa = a.score();
      const sb = b.score();
      if (sb !== sa) return sb - sa;
      return b.urgencyScore() - a.urgencyScore();
    });
    return merged.slice(0, 3);
  }

  /**
   * 贪心回退：为指定目标找一个能推进目标状态的可执行行为。
   * 排序代价与规划器一致：有 costFn 用 costFn（价值-风险），否则按 weight（向后兼容）。
   * @param {import('./goal.js').Goal} goal
   */
  _tryGreedyFallback(goal, currentGOAPState, worldContext, costFn = null) {
    const goalState = goal.goalState;
    if (!goalState) return null;

    const candidates = [];
    for (const action of this.availableActions) {
      for (const [goalKey, goalCondition] of Object.entries(goalState)) {
        if (typeof goalCondition === 'object' && goalCondition !== null
            && action.contributesToGoal(goalKey, goalCondition)) {
          candidates.push(action);
          break;
        }
      }
    }
    if (candidates.length === 0) return null;

    const executable = candidates.filter(a =>
      a.checkPreconditions(currentGOAPState, worldContext)
    );
    if (executable.length === 0) return null;

    const costOf = costFn
      ? (a) => costFn(a)
      : (a) => a.weight;
    executable.sort((a, b) => costOf(a) - costOf(b));
    const chosen = executable[0];
    this.currentPlan = [chosen];
    this.currentActionIndex = 0;
    this.currentNeedId = goal.sourceId;
    this._lastPlanResult = {
      needId: goal.sourceId,
      needName: goal.name,
      needPriority: goal.priority,
      goalSource: goal.source,
      planLength: 1,
      planCost: costOf(chosen),
      iterations: 0,
      actions: [chosen.id],
      fallback: true,
    };
    return chosen;
  }

  /**
   * 执行行为链的下一步（行为耗时层）。
   *
   * 每个 action 经历三阶段，跨多个 tick 完成：
   *   TRAVELING（若 requiresTravel）→ EXECUTING（duration 天）→ DONE（结算 effects/items）
   * 在 TRAVELING / EXECUTING 阶段返回进行中状态，不推进 currentActionIndex；
   * 实体此时处于 busy，不会重新规划（见 BaseEntity._planBehavior）。
   *
   * @param {import('./base-entity.js').BaseEntity} entity
   * @param {Object} worldContext
   * @returns {{ status: string, result?: Object, action?: Object } | null}
   */
  executeStep(entity, worldContext) {
    if (this.currentActionIndex >= this.currentPlan.length) {
      this._setEntityActionStatus(entity, 'idle', 0);
      return { status: 'plan_complete' };
    }

    const action = this.currentPlan[this.currentActionIndex];
    const stateSnapshot = typeof entity.buildGOAPState === 'function'
      ? entity.buildGOAPState(worldContext)
      : entity.state.toGOAPState();

    // 仅在行为尚未启动时检查前置条件（启动后跨 tick 不再因临时状态变化中断移动）
    const lifecycleActive = this._lifecycle.phase !== 'idle' && this._lifecycle.actionId === action.id;
    if (!lifecycleActive) {
      if (!action.canExecute(stateSnapshot, worldContext, entity.inventory)) {
        this._resetLifecycle(entity);
        return {
          status: 'replan',
          reason: `Action ${action.id} preconditions no longer met`,
          actionId: action.id,
        };
      }
      this._startAction(entity, action, worldContext);
    }

    // 阶段一：移动中
    if (this._lifecycle.phase === 'traveling') {
      const sp = entity.spatial;
      const arrived = !sp || !sp.destination; // MovementSystem 到达后会清空 destination
      if (!arrived) {
        this._setEntityActionStatus(entity, 'traveling', this._lifecycle.remaining);
        return {
          status: 'in_progress',
          phase: 'traveling',
          action: { id: action.id, name: action.name },
        };
      }
      // 到达，转入执行阶段
      this._lifecycle.phase = 'executing';
    }

    // 阶段二：执行中（duration 天）
    if (this._lifecycle.phase === 'executing') {
      if (this._lifecycle.remaining > 1) {
        this._lifecycle.remaining--;
        this._setEntityActionStatus(entity, 'executing', this._lifecycle.remaining);
        return {
          status: 'in_progress',
          phase: 'executing',
          remaining: this._lifecycle.remaining,
          action: { id: action.id, name: action.name },
        };
      }
    }

    // 阶段三：结算
    const result = action.execute(entity, worldContext);
    this.currentActionIndex++;
    this._resetLifecycle(entity);

    return {
      status: this.currentActionIndex >= this.currentPlan.length ? 'plan_complete' : 'step_done',
      result,
      action: { id: action.id, name: action.name },
    };
  }

  /**
   * 启动一个 action 的生命周期：设置移动目标（如需）与剩余耗时。
   */
  _startAction(entity, action, worldContext) {
    this._lifecycle = {
      phase: 'executing',
      actionId: action.id,
      remaining: action.duration || 1,
      traveled: false,
    };

    if (action.requiresTravel && entity.hasSpatial && entity.hasSpatial()
        && typeof worldContext.resolveTarget === 'function') {
      const target = worldContext.resolveTarget(entity, action.targetResolver);
      if (target && (target.x !== entity.spatial.tileX || target.y !== entity.spatial.tileY)) {
        entity.spatial.setDestination(target.x, target.y);
        this._lifecycle.phase = 'traveling';
        this._setEntityActionStatus(entity, 'traveling', this._lifecycle.remaining);
        return;
      }
    }
    this._setEntityActionStatus(entity, 'executing', this._lifecycle.remaining);
  }

  /**
   * 执行期实时重选当前步动作（论文 GOBT 核心，ADR-018）。
   *
   * 在当前步行为尚未进入生命周期（未 traveling/executing）时，从"能推进当前目标、
   * 且前置满足"的可执行行为中按 costFn 选最优，替换当前步。实现论文 rocket/gun 例子：
   * 同一目标下，随状态变化实时换用更优的具体动作，而非固守规划期的选择。
   *
   * 仅替换当前步（currentActionIndex 处），不重排后续；若找不到更优候选则保持不变。
   * 为避免计划"长度漂移"，仅当 currentPlan 长度为 1（贪心/单步）或当前步为计划首步时生效。
   *
   * @param {Object} currentGOAPState
   * @param {Object} worldContext
   * @param {(action: import('./action.js').Action) => number} costFn
   * @returns {boolean} 是否发生了替换
   */
  reselectCurrentAction(currentGOAPState, worldContext, costFn) {
    if (!this.hasPlan() || !costFn) return false;
    const idx = this.currentActionIndex;
    const current = this.currentPlan[idx];
    if (!current) return false;

    // 找出与当前步"目标贡献等价"的候选：贡献于当前步所推进的同一目标键。
    const goalKeys = Object.keys(current.effects || {});
    if (goalKeys.length === 0) return false;

    const candidates = [];
    for (const action of this.availableActions) {
      if (!action.checkPreconditions(currentGOAPState, worldContext)) continue;
      // 候选须在当前步推进的某个 effect 键上有同向贡献
      const overlaps = goalKeys.some(k => action.effects && Object.prototype.hasOwnProperty.call(action.effects, k));
      if (overlaps) candidates.push(action);
    }
    if (candidates.length <= 1) return false;

    candidates.sort((a, b) => costFn(a) - costFn(b));
    const best = candidates[0];
    if (best.id === current.id) return false;

    this.currentPlan = [...this.currentPlan];
    this.currentPlan[idx] = best;
    if (this._lastPlanResult) {
      this._lastPlanResult.reselected = { from: current.id, to: best.id };
      this._lastPlanResult.actions = this.currentPlan.map(a => a.id);
    }
    return true;
  }

  /** 是否正处于某个 action 的多 tick 执行中（busy） */
  isBusy() {
    return this._lifecycle.phase !== 'idle';
  }

  _resetLifecycle(entity) {
    this._lifecycle = { phase: 'idle', actionId: null, remaining: 0, traveled: false };
    this._setEntityActionStatus(entity, 'idle', 0);
  }

  _setEntityActionStatus(entity, status, remaining) {
    if (entity?.state?.set) {
      entity.state.set('actionStatus', status);
      entity.state.set('actionRemaining', remaining);
    }
  }

  /**
   * 强制设置为单一行为计划（用于决策周期内的"原地行为"等场景）。
   * @param {string} actionId 可用行为的 id
   * @param {string} [needId] 关联需求 id（仅用于调试展示）
   * @returns {boolean} 是否设置成功（找到该可用行为）
   */
  setSingleActionPlan(actionId, needId = null) {
    const action = this.availableActions.find(a => a.id === actionId);
    if (!action) return false;
    this.currentPlan = [action];
    this.currentActionIndex = 0;
    this.currentNeedId = needId;
    this._lastPlanResult = {
      needId,
      needName: needId,
      planLength: 1,
      planCost: action.weight,
      iterations: 0,
      actions: [action.id],
      forced: true,
    };
    return true;
  }

  /**
   * 是否有正在执行的计划
   */
  hasPlan() {
    return this.currentPlan.length > 0 && this.currentActionIndex < this.currentPlan.length;
  }

  /**
   * 清除当前计划
   */
  clearPlan() {
    this.currentPlan = [];
    this.currentActionIndex = 0;
    this.currentNeedId = null;
    this._lifecycle = { phase: 'idle', actionId: null, remaining: 0, traveled: false };
  }

  /**
   * 获取上次规划的调试信息
   */
  getLastPlanResult() {
    return this._lastPlanResult;
  }

  /**
   * 获取当前计划的剩余步骤
   */
  getRemainingActions() {
    return this.currentPlan.slice(this.currentActionIndex);
  }

  toJSON() {
    return {
      currentNeedId: this.currentNeedId,
      planLength: this.currentPlan.length,
      currentStep: this.currentActionIndex,
      remainingActions: this.getRemainingActions().map(a => a.id),
      availableActionCount: this.availableActions.length,
    };
  }
}
