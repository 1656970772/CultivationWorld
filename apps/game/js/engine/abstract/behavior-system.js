/**
 * BehaviorSystem - 实体的行为执行器
 *
 * 管理行为链的规划与执行，支持中断、重新规划。
 * 每个 Tick 执行行为链的下一步。
 */
import { GOAPPlanner } from './goap-planner.js';
import { GoalSource } from './goal.js';
import { JobSystem } from './job-system.js';

export class BehaviorSystem {
  /**
   * @param {GOAPPlanner} planner
   * @param {import('./action.js').Action[]} availableActions
   * @param {Object} [options]
   */
  constructor(planner, availableActions = [], options = {}) {
    this.planner = planner;
    this.availableActions = availableActions;
    this.jobsEnabled = options.jobsEnabled === true;
    this.jobSystem = options.jobSystem || null;
    this.currentPlan = [];
    this.currentActionIndex = 0;
    this.currentNeedId = null;
    this._lastPlanResult = null;
    this._suspendedPlanForReaction = null;
    this._activeJobEntity = null;

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
      this._lastPlanResult = {
        needId: null,
        needName: null,
        goalSource: null,
        planLength: 0,
        planCost: 0,
        iterations: 0,
        actions: [],
        failed: true,
        reason: 'no_goals',
      };
      return [];
    }

    for (const goal of goals) {
      const goalGOAPState = this._stateForGoal(currentGOAPState, goal);
      // 选行策略=greedy（ADR-047）：修炼这类"重复累积、应换着做"的目标跳过 A* 折叠，
      // 直接在可执行行为间按推进性价比加权随机选一步——避免 A* 因游历单步推进量大而恒偏游历、
      // 行为一边倒。做完即重评估、下步再随机分化（闭关/游历/做任务交替）。
      if (goal.selectStrategy === 'greedy') {
        const greedy = this._tryGreedyFallback(goal, goalGOAPState, worldContext, costFn);
        if (greedy) return [greedy];
        continue;
      }

      const result = this.planner.plan(
        goalGOAPState,
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
          dynamicEventId: goal.dynamic?.eventId,
          dynamicEventType: goal.dynamic?.eventType,
          planLength: result.plan.length,
          planCost: result.cost,
          iterations: result.iterations,
          actions: result.plan.map(a => a.id),
        };
        return result.plan;
      }

      // GOAP 失败，立即尝试该目标的贪心回退（保证高优先级目标优先获得行为）
      const fallback = this._tryGreedyFallback(goal, goalGOAPState, worldContext, costFn);
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
   * 无 extraGoals 时，顺序沿用 needSystem.getTopGoals/getTopNeeds。
   * @returns {import('./goal.js').Goal[]}
   */
  _collectGoals(needSystem, extraGoals = [], goalModulator = null) {
    const needGoals = needSystem.getTopGoals(3);
    const hasExtra = extraGoals && extraGoals.length > 0;

    // 无额外目标且无情绪调制：保持 getTopNeeds 原顺序。
    if (!hasExtra && !goalModulator) return needGoals;

    // 合并顺序 [需求, 执念]：稳定排序下，同分时需求优先于执念。
    // 这保证执念虽强（通常 intensity 更高，会真正压过普通需求），但在与紧急生存/疗伤
    // 等同分需求并列时让位——生存是底线，避免执念导致 NPC 无视寿元/重伤而大量陨落。
    const merged = hasExtra ? [...needGoals, ...extraGoals] : [...needGoals];

    // 情绪调制（ADR-019）：对每个 Goal 叠加 modulator，再按调制后的 score 排序。
    if (goalModulator) {
      for (const g of merged) goalModulator(g);
    }

    const byScore = (a, b) => {
      const sa = a.score();
      const sb = b.score();
      if (sb !== sa) return sb - sa;
      return b.urgencyScore() - a.urgencyScore();
    };

    merged.sort(byScore);
    const top = merged.slice(0, 3);
    const hasDynamicExtra = extraGoals.some(g => g?.source === GoalSource.DYNAMIC);
    if (hasDynamicExtra && needGoals.length > 0 && top.length > 0) {
      const included = new Set(top);
      for (const needGoal of needGoals) {
        if (!included.has(needGoal)) {
          top.push(needGoal);
        }
      }
    }
    return top;
  }

  _stateForGoal(currentGOAPState, goal) {
    if (goal?.source !== GoalSource.DYNAMIC || !goal.dynamic?.eventId) {
      return currentGOAPState;
    }
    const eventType = goal.dynamic.eventType || null;
    return {
      ...(currentGOAPState || {}),
      targetDynamicEventId: goal.dynamic.eventId,
      targetDynamicEventType: eventType,
      dynamicEventIsSecretRealm: eventType === 'secret_realm',
      dynamicEventIsSectTournament: eventType === 'sect_tournament',
      dynamicEventIsRelationshipDeath: eventType === 'relationship_death',
      dynamicEventIsFallenMaster: eventType === 'fallen_master',
      dynamicEventUsesGenericPreparation: eventType !== 'secret_realm' && eventType !== 'sect_tournament',
    };
  }

  /**
   * 贪心回退：为指定目标找一个能推进目标状态的可执行行为。
   *
   * 选择口径（2026-06-03 修正，破解「修士只闭关不游历」）：
   *   过去这里"只挑 cost 最便宜的单个行为"，导致当 GOAP 完整规划失败（修炼这类需 repeat
   *   上百次微增量行为的目标，在真实多行为状态空间下 A* 搜不到解）退化到兜底时，闭关(weight≈1)
   *   恒比游历(weight≈3)便宜 → 永远闭关、insight 恒 0、撞 cultivationCap 后卡死不突破。
   *   实际 NPC 每步行为结束即重规划（做一步→重评估），本不需要一次规划到目标完成，"缺啥补啥、
   *   换着做"才真实。故改为：在「能推进同一目标的多个可执行行为」间，按各自【对目标的推进性价比】
   *   （单步推进量 ÷ cost）加权随机选取——闭关/游历/做任务等都有机会被选中，撞 cap 后闭关不可
   *   执行则自然转游历。随机走 worldContext.rng，确定性可复现（ADR-038）。
   *   单候选时直接返回（行为与旧逻辑一致）。
   * @param {import('./goal.js').Goal} goal
   */
  _tryGreedyFallback(goal, currentGOAPState, worldContext, costFn = null) {
    const goalState = goal.goalState;
    if (!goalState) return null;

    // 记录每个候选行为能推进的目标条目（用于算推进性价比）。
    const candidates = [];
    for (const action of this.availableActions) {
      const contribEntries = [];
      for (const [goalKey, goalCondition] of Object.entries(goalState)) {
        if (typeof goalCondition === 'object' && goalCondition !== null
            && action.contributesToGoal(goalKey, goalCondition)) {
          contribEntries.push([goalKey, goalCondition]);
        }
      }
      if (contribEntries.length > 0) candidates.push({ action, contribEntries });
    }
    if (candidates.length === 0) return null;

    const executable = candidates.filter(c =>
      c.action.checkPreconditions(currentGOAPState, worldContext)
    );
    if (executable.length === 0) return null;

    const costOf = costFn
      ? (a) => costFn(a)
      : (a) => a.weight;

    let chosen;
    if (executable.length === 1) {
      chosen = executable[0].action;
    } else {
      chosen = this._pickByProgressValue(executable, costOf, worldContext) || executable[0].action;
    }
    this.currentPlan = [chosen];
    this.currentActionIndex = 0;
    this.currentNeedId = goal.sourceId;
    this._lastPlanResult = {
      needId: goal.sourceId,
      needName: goal.name,
      needPriority: goal.priority,
      goalSource: goal.source,
      dynamicEventId: goal.dynamic?.eventId,
      dynamicEventType: goal.dynamic?.eventType,
      planLength: 1,
      planCost: costOf(chosen),
      iterations: 0,
      actions: [chosen.id],
      fallback: true,
    };
    return chosen;
  }

  /**
   * 在多个「能推进同一目标」的可执行候选间，按【对目标的推进性价比】加权随机选取。
   *
   * 权重 = Σ(该行为对各贡献目标键的单步推进量) ÷ max(cost, ε)。推进量越大、代价越低，被选概率越高；
   * 但低性价比行为仍有非零概率被选，从而「换着做」（闭关/游历/做任务交替），符合修士行为的真实分化。
   * 随机走 worldContext.rng（确定性，ADR-038）；取不到 rng 时回退选性价比最高者（确定性）。
   *
   * @param {{ action: import('./action.js').Action, contribEntries: Array<[string, Object]> }[]} executable
   * @param {(action: import('./action.js').Action) => number} costOf
   * @param {Object} worldContext
   * @returns {import('./action.js').Action|null}
   */
  _pickByProgressValue(executable, costOf, worldContext) {
    const scored = [];
    let totalWeight = 0;
    for (const { action, contribEntries } of executable) {
      const effects = action.getEffects();
      let progress = 0;
      for (const [goalKey] of contribEntries) {
        const eff = effects[goalKey];
        if (eff && eff.op === 'add' && typeof eff.value === 'number') {
          progress += Math.abs(eff.value);
        } else {
          // set 型/布尔型贡献：给一个基准推进量，使其也能参与（不被数值型完全压制）。
          progress += 0.001;
        }
      }
      const cost = Math.max(costOf(action) || 0, 1e-6);
      // 软化权重（ADR-047 修炼选行均衡）：纯性价比(progress/cost)会因游历单步推进量大而恒压制闭关，
      // 行为一边倒。改为「均等基底 1 + 轻微性价比倾斜」：各可行行为基本等概率被选（真正换着做），
      // 性价比只做次级微调（开方压缩量纲差距），既不一边倒、又略偏高效行为。
      const valueRatio = progress / cost;
      const weight = 1 + Math.sqrt(valueRatio);
      scored.push({ action, weight });
      totalWeight += weight;
    }
    if (totalWeight <= 0) return null;

    const rng = worldContext?.rng || null;
    if (!rng || typeof rng.next !== 'function') {
      // 无确定性随机源：回退取性价比最高者（确定性、可复现）。
      scored.sort((a, b) => b.weight - a.weight);
      return scored[0].action;
    }

    let roll = rng.next() * totalWeight;
    for (const s of scored) {
      roll -= s.weight;
      if (roll <= 0) return s.action;
    }
    return scored[scored.length - 1].action;
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
    const stateSnapshotRaw = typeof entity.buildGOAPState === 'function'
      ? entity.buildGOAPState(worldContext)
      : entity.state.toGOAPState();
    const stateSnapshot = this._stateForCurrentPlan(stateSnapshotRaw);

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
      if (action.isJobAction?.()) {
        return this._executeJobAction(entity, worldContext, action);
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

  _executeJobAction(entity, worldContext, action) {
    if (entity) this._activeJobEntity = entity;
    if (!this.jobsEnabled) {
      this._clearActiveJob('jobs_disabled', entity);
      return { status: 'replan', reason: 'jobs_disabled', actionId: action.id };
    }
    if (!this.jobSystem) this.jobSystem = new JobSystem();
    if (this.jobSystem.hasJob() && !this._activeJobMatchesAction(action)) {
      this.jobSystem.abort('job_action_mismatch');
      this._syncJobState(entity);
    }
    if (!this.jobSystem.hasJob()) {
      this.jobSystem.start(action.jobId, {
        actionId: action.id,
        ...(action.jobInput || {}),
        dynamicEventId: entity?.state?.get?.('targetDynamicEventId') || null,
      });
    }

    const snapshotBeforeStep = this.jobSystem.snapshot();
    if (snapshotBeforeStep.jobStatus === 'paused') {
      this._syncJobState(entity);
      return {
        status: 'in_progress',
        phase: 'job_paused',
        job: snapshotBeforeStep,
        action: { id: action.id, name: action.name },
      };
    }

    const result = this.jobSystem.executeStep(entity, worldContext);
    const jobInstanceId = snapshotBeforeStep.currentJobInstanceId || null;
    this._syncJobState(entity);

    if (result.status === 'success') {
      this.currentActionIndex++;
      this._resetLifecycle(entity);
      return {
        status: this.currentActionIndex >= this.currentPlan.length ? 'plan_complete' : 'step_done',
        result: { actionId: action.id, jobId: action.jobId, jobInstanceId, ...result },
        action: { id: action.id, name: action.name },
      };
    }

    if (result.status === 'replan' || result.status === 'failed' || result.status === 'abort') {
      this._resetLifecycle(entity);
      return {
        status: 'replan',
        reason: result.reason || result.status,
        actionId: action.id,
        jobId: action.jobId,
        result: {
          ...result,
          actionId: action.id,
          jobId: action.jobId,
          jobInstanceId,
          status: result.status,
          reason: result.reason || result.status,
        },
      };
    }

    return {
      status: 'in_progress',
      phase: 'job',
      job: this.jobSystem.snapshot(),
      action: { id: action.id, name: action.name },
    };
  }

  _stateForCurrentPlan(currentGOAPState) {
    const result = this._lastPlanResult;
    if (result?.goalSource !== GoalSource.DYNAMIC || !result.dynamicEventId) {
      return currentGOAPState;
    }
    return this._stateForGoal(currentGOAPState, {
      source: GoalSource.DYNAMIC,
      dynamic: {
        eventId: result.dynamicEventId,
        eventType: result.dynamicEventType || null,
      },
    });
  }

  _syncJobState(entity) {
    const target = entity || this._activeJobEntity;
    if (!target?.state?.set) return;
    const snapshot = this.jobSystem?.snapshot?.() || {
      currentJobId: null,
      currentToilId: null,
      jobStatus: 'idle',
      jobRemaining: 0,
    };
    target.state.set('currentJobId', snapshot.currentJobId);
    target.state.set('currentToilId', snapshot.currentToilId);
    target.state.set('jobStatus', snapshot.jobStatus);
    target.state.set('jobRemaining', snapshot.jobRemaining);
  }

  _activeJobMatchesAction(action) {
    if (!this.jobSystem?.hasJob?.()) return false;
    const snapshot = this.jobSystem.snapshot();
    return snapshot.currentJobId === action.jobId
      && snapshot.jobContext?.actionId === action.id;
  }

  _clearActiveJob(reason = 'clear', entity = null) {
    if (this.jobSystem?.hasJob?.()) {
      this.jobSystem.abort(reason);
    }
    this._syncJobState(entity);
    this._activeJobEntity = null;
  }

  pauseCurrentJob(reason = 'pause', entity = null) {
    if (!this.jobSystem?.hasJob?.()) return false;
    if (entity) this._activeJobEntity = entity;
    this.jobSystem.pause(reason);
    this._syncJobState(entity);
    return true;
  }

  resumeCurrentJob(reason = 'resume', entity = null) {
    if (!this.jobSystem?.hasJob?.()) return false;
    if (entity) this._activeJobEntity = entity;
    this.jobSystem.resume(reason);
    this._syncJobState(entity);
    return true;
  }

  abortCurrentJob(reason = 'abort', entity = null) {
    if (!this.jobSystem?.hasJob?.()) return false;
    if (entity) this._activeJobEntity = entity;
    this.jobSystem.abort(reason);
    this._syncJobState(entity);
    this._activeJobEntity = null;
    return true;
  }

  suspendPlanForReaction(reason = 'reaction', entity = null) {
    if (this._suspendedPlanForReaction) return false;
    if (!this.jobSystem?.hasJob?.()) return false;
    const hasPlan = this.currentPlan.length > 0 && this.currentActionIndex < this.currentPlan.length;
    if (!hasPlan) return false;
    const paused = this.pauseCurrentJob(reason, entity);
    if (!paused) return false;

    this._suspendedPlanForReaction = {
      currentPlan: [...this.currentPlan],
      currentActionIndex: this.currentActionIndex,
      currentNeedId: this.currentNeedId,
      lastPlanResult: this._lastPlanResult ? { ...this._lastPlanResult } : this._lastPlanResult,
      entity,
    };
    this.currentPlan = [];
    this.currentActionIndex = 0;
    this.currentNeedId = null;
    this._lastPlanResult = null;
    this._resetLifecycle(entity);
    return true;
  }

  restoreSuspendedPlan(reason = 'reaction_done', entity = null) {
    if (!this._suspendedPlanForReaction) return false;
    const suspended = this._suspendedPlanForReaction;
    this.currentPlan = [...suspended.currentPlan];
    this.currentActionIndex = suspended.currentActionIndex;
    this.currentNeedId = suspended.currentNeedId;
    this._lastPlanResult = suspended.lastPlanResult;
    this._suspendedPlanForReaction = null;
    this.resumeCurrentJob(reason, entity || suspended.entity || null);
    return true;
  }

  _restoreSuspendedPlanIfReactionComplete() {
    if (!this._suspendedPlanForReaction) return false;
    if (this.currentPlan.length === 0) return false;
    if (this.currentActionIndex < this.currentPlan.length) return false;
    return this.restoreSuspendedPlan('reaction_auto_restore');
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
    return this._lifecycle.phase !== 'idle' || this.jobSystem?.hasJob?.() === true;
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
    this._restoreSuspendedPlanIfReactionComplete();
    return this.currentPlan.length > 0 && this.currentActionIndex < this.currentPlan.length;
  }

  /**
   * 清除当前计划
   */
  clearPlan(entity = null) {
    this.currentPlan = [];
    this.currentActionIndex = 0;
    this.currentNeedId = null;
    this._suspendedPlanForReaction = null;
    this._lifecycle = { phase: 'idle', actionId: null, remaining: 0, traveled: false };
    this._clearActiveJob('clear_plan', entity);
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
