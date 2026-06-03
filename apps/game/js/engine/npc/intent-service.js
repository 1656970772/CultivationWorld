/**
 * IntentService —— 意图层（Utility 选目标）服务化封装（四层 AI 架构 Utility 层，ADR-048）。
 *
 * 把原先散落在 PlannerNode._doPlan 里的「装配规划输入」逻辑（构建 GOAP 状态 / costFn /
 * 收集额外目标 / 组装目标调制回调）抽成独立、可测试、纯函数式的服务，使「选目标」与
 * 「BT 编排」「GOAP 规划」三者职责清晰分离（开闭/单一职责）。
 *
 * 设计为纯函数式（不写世界状态，只读实体快照 + worldContext，产出规划输入），这是未来把
 * 意图层切到 Worker 并行的前提。本轮 selectGoalBatch 接口先就位，内部仍串行（安全优先，
 * 不引入跨线程状态序列化/确定性风险）；待确定性快照方案成熟再换并行后端。
 *
 * buildPlanInputs 产出规划四元组（goapState/costFn/extraGoals/goalModulator）；
 * 实际目标合并/排序/规划仍由 BehaviorSystem.plan 完成（单一真相源，避免重复实现）。
 */

export const IntentService = {
  /**
   * 装配一次规划所需的输入（不执行规划，纯函数式）。
   * @param {Object} entity 决策主体（NPC/势力）
   * @param {Object} worldContext
   * @returns {{ goapState:Object, costFn:(Function|null), extraGoals:Array, goalModulator:(Function|null) }}
   */
  buildPlanInputs(entity, worldContext) {
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
    // (decorateGoalConsiderations，含 TimeValue/风险/执念乘子)。缺省实现为空操作。
    const hasModulate = typeof entity.modulateGoal === 'function';
    const hasDecorate = typeof entity.decorateGoalConsiderations === 'function';
    const goalModulator = (hasModulate || hasDecorate)
      ? (goal) => {
          if (hasModulate) entity.modulateGoal(goal);
          if (hasDecorate) entity.decorateGoalConsiderations(goal, worldContext);
        }
      : null;

    return { goapState, costFn, extraGoals, goalModulator };
  },

  /**
   * 选目标并生成计划（意图层 + 规划层接缝）。委托 BehaviorSystem.plan 完成
   * 目标合并/排序/GOAP 规划（单一真相源），并回写 onPlanChosen 钩子。
   * @param {Object} entity
   * @param {Object} worldContext
   * @returns {{ plan: Array, planResult: (Object|null) }}
   */
  selectGoal(entity, worldContext) {
    const bs = entity.behaviorSystem;
    if (!bs) return { plan: [], planResult: null };
    const { goapState, costFn, extraGoals, goalModulator } = this.buildPlanInputs(entity, worldContext);
    const plan = bs.plan(entity.needSystem, goapState, worldContext, costFn, extraGoals, goalModulator);
    if (typeof entity.onPlanChosen === 'function') {
      entity.onPlanChosen();
    }
    return { plan, planResult: bs.getLastPlanResult() };
  },

  /**
   * 批量选目标（并行预留接口，ADR-048）。本轮内部串行：逐个 entity 调用 selectGoal。
   * 之所以不立刻上 Worker：意图选择虽设计为只读，但 selectGoal 内部经 BehaviorSystem.plan
   * 会写入实体的 currentPlan（执行层状态），跨线程需先做确定性状态快照/合并方案，属于后续工作。
   * 保留此入口使调用方先按"批量"组织代码，将来切并行后端时调用方零改动。
   * @param {Object[]} entities
   * @param {Object} worldContext
   * @returns {Map<string, {plan:Array, planResult:(Object|null)}>} entityId → 结果
   */
  selectGoalBatch(entities, worldContext) {
    const out = new Map();
    for (const entity of entities) {
      out.set(entity.id, this.selectGoal(entity, worldContext));
    }
    return out;
  },
};
