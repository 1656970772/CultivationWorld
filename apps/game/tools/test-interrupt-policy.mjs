#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Goal, GoalSource } = await imp('js/engine/abstract/goal.js');
const { InterruptPolicy, InterruptDecision } = await imp('js/engine/npc/interrupt-policy.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

function makeGoal(kind, score, extra = {}) {
  const g = new Goal({
    id: `goal_${kind}`,
    source: GoalSource.DYNAMIC,
    sourceId: kind,
    goalState: {},
    priority: score,
    urgency: score,
    tag: kind
  });
  g.dynamic = {
    kind,
    eventId: `evt_${kind}`,
    eventValue: extra.eventValue ?? 800,
    daysUntilStart: extra.daysUntilStart ?? 5,
    interrupt: extra.interrupt || {},
    riskKey: extra.riskKey || null
  };
  return g;
}

const busyNearBreakthrough = {
  behaviorSystem: {
    isBusy: () => true,
    getLastPlanResult: () => ({ needId: 'need_npc_cultivation', actions: ['act_npc_job_cultivate'] })
  },
  state: { get: (key) => ({ totalProgress: 0.96, injuryLevel: 0 }[key] ?? null) },
  staticData: { personality: { caution: 70, courage: 40, loyalty: 50 } }
};

const immediate = InterruptPolicy.decide(busyNearBreakthrough, makeGoal('immediate', 90), { currentDay: 1 });
assert(immediate.decision === InterruptDecision.INTERRUPT_NOW, 'immediate 高分目标立即打断');
assert(immediate.goalId === 'immediate', '返回 goalId 使用 sourceId');

const lowImmediate = InterruptPolicy.decide(
  busyNearBreakthrough,
  makeGoal('immediate', 10, { eventValue: 0 }),
  { currentDay: 1 }
);
assert(lowImmediate.decision !== InterruptDecision.INTERRUPT_NOW, '低分 immediate 不会无条件立即打断');

const prep = InterruptPolicy.decide(
  busyNearBreakthrough,
  makeGoal('preparation', 68, { daysUntilStart: 90, interrupt: { minDecision: 'after_step' } }),
  { currentDay: 1 }
);
assert(prep.decision === InterruptDecision.AFTER_STEP, '临近突破时准备目标降为 after_step');

const lowPrep = InterruptPolicy.decide(
  busyNearBreakthrough,
  makeGoal('preparation', 5, { eventValue: 0 }),
  { currentDay: 1 }
);
assert(lowPrep.decision === InterruptDecision.IGNORE, '低分准备目标不会因临近突破被抬高到 after_step');

const low = InterruptPolicy.decide(
  busyNearBreakthrough,
  makeGoal('window', 35, { eventValue: 200, daysUntilStart: 20 }),
  { currentDay: 1 }
);
assert(low.decision === InterruptDecision.IGNORE, '低分低价值目标忽略');

const raised = InterruptPolicy.decide(
  busyNearBreakthrough,
  makeGoal('window', 1, { eventValue: 0, interrupt: { minDecision: 'after_step' } }),
  { currentDay: 1 }
);
assert(raised.decision === InterruptDecision.AFTER_STEP, 'minDecision 即使从 ignore 也会抬升决策');

const cautiousEntity = {
  behaviorSystem: {
    isBusy: () => false,
    getLastPlanResult: () => null
  },
  state: { get: () => null },
  staticData: { personality: { caution: 90, courage: 50, loyalty: 50 } }
};
const safeWindow = InterruptPolicy.decide(cautiousEntity, makeGoal('window', 50, { eventValue: 0 }), { currentDay: 1 });
const riskyWindow = InterruptPolicy.decide(
  cautiousEntity,
  makeGoal('window', 50, { eventValue: 0, riskKey: 'plunder' }),
  { currentDay: 1 }
);
assert(riskyWindow.score < safeWindow.score, '谨慎性格只在 riskKey 存在时降低风险目标分数');

const staleLastPlan = {
  behaviorSystem: {
    hasPlan: () => false,
    isBusy: () => false,
    getLastPlanResult: () => ({
      goalSource: GoalSource.DYNAMIC,
      dynamicEventId: 'evt_immediate',
      needId: 'immediate'
    })
  },
  state: { get: () => null },
  staticData: { personality: { caution: 50, courage: 70, loyalty: 50 } }
};
const staleDecision = InterruptPolicy.decide(
  staleLastPlan,
  makeGoal('immediate', 90),
  { currentDay: 2 }
);
assert(staleDecision.decision === InterruptDecision.INTERRUPT_NOW, '旧 lastPlanResult 不会在无当前计划时压掉新打断');

{
  const calls = [];
  const highRawKeep = makeGoal('preparation', 50, { eventValue: 0 });
  const lowRawUrgent = makeGoal('urgent_window', 10, {
    eventValue: 0,
    interrupt: { minDecision: 'interrupt_now' }
  });
  const fakeNpc = {
    _dynamicGoalConfig: { enabled: true },
    behaviorSystem: {
      hasPlan: () => false,
      isBusy: () => false,
      getLastPlanResult: () => null
    },
    state: { get: () => null },
    staticData: { personality: { caution: 50, courage: 50, loyalty: 50 } },
    collectDynamicGoals: () => [highRawKeep, lowRawUrgent],
    _selectDynamicInterrupt: NPCEntity.prototype._selectDynamicInterrupt,
    requestReplan: (reason) => calls.push(reason),
    eventAwareness: { ignore: () => {} }
  };
  NPCEntity.prototype._checkDynamicGoalInterrupts.call(fakeNpc, {
    currentDay: 3,
    dynamicGoalConfig: { enabled: true }
  });
  assert(fakeNpc._lastDynamicInterrupt?.goalId === 'urgent_window', '动态打断选择按策略决策而非裸 goal score');
  assert(calls[0] === 'dynamic:urgent_window', '低裸分但 minDecision=interrupt_now 的目标可触发重规划');
}

{
  const deferred = makeGoal('preparation', 70, {
    eventValue: 0,
    interrupt: { minDecision: 'after_step' }
  });
  let goals = [deferred];
  const fakeNpc = {
    _dynamicGoalConfig: { enabled: true },
    _deferredReplanRequested: false,
    behaviorSystem: {
      hasPlan: () => false,
      isBusy: () => false,
      getLastPlanResult: () => null
    },
    state: { get: () => null },
    staticData: { personality: { caution: 50, courage: 50, loyalty: 50 } },
    collectDynamicGoals: () => goals,
    _selectDynamicInterrupt: NPCEntity.prototype._selectDynamicInterrupt,
    requestReplan: () => {},
    eventAwareness: { ignore: () => {} }
  };
  NPCEntity.prototype._checkDynamicGoalInterrupts.call(fakeNpc, {
    currentDay: 4,
    dynamicGoalConfig: { enabled: true }
  });
  assert(fakeNpc._deferredReplanRequested?.eventId === 'evt_preparation', 'after_step 延期请求记录目标身份');
  goals = [];
  NPCEntity.prototype._checkDynamicGoalInterrupts.call(fakeNpc, {
    currentDay: 5,
    dynamicGoalConfig: { enabled: true }
  });
  assert(!fakeNpc._deferredReplanRequested, '动态目标消失时清理 stale after_step 延期请求');
}

if (failed === 0) {
  console.log('打断策略单测全部通过');
  process.exit(0);
}
console.error(`打断策略单测失败：${failed} 项`);
process.exit(1);
