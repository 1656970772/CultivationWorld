/**
 * PlannerNode - GOBT 的规划节点（论文 GOBT 的 planner node，ADR-018）。
 *
 * 这是 BT 骨架与 GOAP/Utility 的接缝：BT 负责"何时反应/何时进入规划"，进入本节点后：
 *   1. 选目标（Utility）：合并需求目标 + 额外目标（执念等），按 score 选最高（在 BehaviorSystem.plan 内完成）。
 *   2. 规划（GOAP）：对选中目标用 A* 生成行为链。
 *   3. 执行：按行为生命周期推进一步（traveling→executing→结算）。
 *   4. 执行期实时重选（论文核心，可选）：每步完成后，若开启 realtimeReselect，
 *      用 utility(costFn) 重新评估"下一步动作"，可在不换目标的情况下切换具体动作
 *      （论文的 rocket/gun 例子）。默认关闭。
 *
 * 返回值语义：
 *   - 有计划且推进中 → RUNNING
 *   - 计划完成/执行结算 → SUCCESS
 *   - 无目标可规划/规划失败且无回退 → FAILURE
 *
 * PlannerNode 不直接持有规划状态，全部委托 entity.behaviorSystem，
 * 因此可被 BTLoader 多次构建而不重复状态。
 */
import { BTNode, BTStatus } from './bt-node.js';

export class PlannerNode extends BTNode {
  /**
   * @param {Object} [config]
   * @param {boolean} [config.realtimeReselect=false] 是否在执行期按 utility 实时重选下一步动作
   */
  constructor(config = {}) {
    super(config);
    this.realtimeReselect = config.realtimeReselect === true;
  }

  tick(entity, blackboard, worldContext) {
    const bs = entity.behaviorSystem;
    if (!bs) return BTStatus.FAILURE;

    // 大事件立即重决策（四层 AI 架构 Utility 层，ADR-048）：秘境/拍卖/大比/遇仇人等事件
    // 经 entity.requestReplan() 置标记后，即便当前正执行计划（isBusy）也立即打断、重选目标+重规划。
    // 仅在未被反应层抢占时生效（反应层在更高优先分支，命中即不会走到本节点）。
    const replanNow = typeof entity.consumeReplanRequest === 'function' && entity.consumeReplanRequest();
    if (replanNow) {
      bs.clearPlan();
    }

    // 已有计划或正在执行多 tick 行为：直接推进，不重新规划。
    // 空闲时，若实体提供了决策门控（如 NPC 决策周期），需门控允许才重新规划，
    // 否则静候（返回 RUNNING，不规划也不执行），等价旧 _decisionCooldown 时序。
    if (!bs.hasPlan() && !bs.isBusy()) {
      // 大事件触发的重决策跳过决策门控（开局错相），保证"立即"重决策语义。
      const gate = replanNow || (typeof entity.canStartNewDecision === 'function'
        ? entity.canStartNewDecision(worldContext)
        : true);
      if (!gate) {
        if (entity._tickLog) entity._tickLog.plan = bs.getLastPlanResult();
        return BTStatus.RUNNING;
      }
      this._doPlan(entity, worldContext);
    }

    if (blackboard) {
      blackboard.selectedGoal = bs.getLastPlanResult() || null;
      if (entity._tickLog) entity._tickLog.plan = bs.getLastPlanResult();
    }

    if (!bs.hasPlan()) {
      return BTStatus.FAILURE;
    }

    const result = this._execute(entity, worldContext);
    if (blackboard) {
      blackboard.execution = result;
    }

    if (!result) return BTStatus.FAILURE;
    if (result.status === 'in_progress') return BTStatus.RUNNING;
    if (result.status === 'idle' || result.status === 'plan_complete' || result.status === 'step_done') {
      return BTStatus.SUCCESS;
    }
    return BTStatus.RUNNING;
  }

  /**
   * 规划：选目标(Utility) + GOAP 规划。
   * 若实体提供 selectIntent（NPC 委托 IntentService，ADR-048），则用之（意图层服务化）；
   * 否则就地装配规划输入并调用 BehaviorSystem.plan（势力等沿用，保持抽象层与 npc 层解耦）。
   */
  _doPlan(entity, worldContext) {
    const bs = entity.behaviorSystem;
    if (typeof entity.selectIntent === 'function') {
      entity.selectIntent(worldContext);
      return;
    }
    const goapState = typeof entity.buildGOAPState === 'function'
      ? entity.buildGOAPState(worldContext)
      : entity.state.toGOAPState();
    const costFn = typeof entity.buildDecisionCostFn === 'function'
      ? entity.buildDecisionCostFn(worldContext)
      : null;
    const extraGoals = typeof entity.collectExtraGoals === 'function'
      ? entity.collectExtraGoals(worldContext)
      : [];
    // 目标调制统一入口（ADR-018/020）：情绪调制(modulateGoal) + 考量因素挂载
    // (decorateGoalConsiderations，含 TimeValue/风险/执念乘子)。两者都对每个候选 Goal
    // 各调用一次，缺省实现为空操作。
    const hasModulate = typeof entity.modulateGoal === 'function';
    const hasDecorate = typeof entity.decorateGoalConsiderations === 'function';
    const goalModulator = (hasModulate || hasDecorate)
      ? (goal) => {
          if (hasModulate) entity.modulateGoal(goal);
          if (hasDecorate) entity.decorateGoalConsiderations(goal, worldContext);
        }
      : null;
    bs.plan(entity.needSystem, goapState, worldContext, costFn, extraGoals, goalModulator);
    if (typeof entity.onPlanChosen === 'function') {
      entity.onPlanChosen();
    }
  }

  /** 执行一步，并处理 replan 与执行期实时重选。 */
  _execute(entity, worldContext) {
    const bs = entity.behaviorSystem;

    // 论文式执行期实时重选：在尚未进入某行为的多 tick 生命周期时，
    // 用 costFn 重新挑选当前步要执行的动作（同目标下换更优动作）。
    if (this.realtimeReselect && !bs.isBusy() && typeof entity.buildDecisionCostFn === 'function') {
      const costFn = entity.buildDecisionCostFn(worldContext);
      if (costFn && typeof bs.reselectCurrentAction === 'function') {
        const goapState = typeof entity.buildGOAPState === 'function'
          ? entity.buildGOAPState(worldContext)
          : entity.state.toGOAPState();
        bs.reselectCurrentAction(goapState, worldContext, costFn);
      }
    }

    const result = bs.executeStep(entity, worldContext);

    if (result?.status === 'replan') {
      bs.clearPlan();
      this._doPlan(entity, worldContext);
      if (bs.hasPlan()) {
        return bs.executeStep(entity, worldContext);
      }
      return { status: 'idle' };
    }
    return result || { status: 'idle' };
  }

  toJSON() {
    return { ...super.toJSON(), realtimeReselect: this.realtimeReselect };
  }
}
