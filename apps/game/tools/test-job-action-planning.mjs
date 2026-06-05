#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Action } = await imp('js/engine/abstract/action.js');
const { BehaviorSystem } = await imp('js/engine/abstract/behavior-system.js');
const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');
const { Goal, GoalSource } = await imp('js/engine/abstract/goal.js');
const { Need, NeedEvaluator } = await imp('js/engine/abstract/need.js');
const { NeedSystem } = await imp('js/engine/abstract/need-system.js');
const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { ActionPool } = await imp('js/engine/pools/action-pool.js');
const { ToilExecutor, ToilResultStatus } = await imp('js/engine/abstract/toil.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

class TestState {
  constructor(values = {}) { this._values = { ...values }; }
  get(key) { return this._values[key]; }
  set(key, value) { this._values[key] = value; }
  toGOAPState() { return { ...this._values }; }
}

class StaticNeedEvaluator extends NeedEvaluator {
  calculate(entityState, _worldContext, need) {
    const prepared = entityState.get('preparedForDynamicEvent') === true;
    return {
      priority: prepared ? 0 : 100,
      urgency: prepared ? 0 : 100,
      goalState: need.goalStateTemplate,
      satisfied: prepared,
    };
  }
}

class FinishExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    entity.state.set('toilRan', true);
    entity.state.set('lastToilId', toil.id);
    entity.state.set('jobInputEventId', job.context.dynamicEventId);
    return { status: ToilResultStatus.SUCCESS, reason: 'finished' };
  }
}

class RunningExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    const key = `${job.definitionId}:${toil.id}:ticks`;
    const ticks = (job.context[key] || 0) + 1;
    job.context[key] = ticks;
    entity.state.set('lastRunningJobId', job.definitionId);
    entity.state.set('lastRunningToilId', toil.id);
    return { status: ToilResultStatus.RUNNING, remaining: 2, reason: 'still_running' };
  }
}

class BlockedExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    entity.state.set('lastBlockedJobId', job.definitionId);
    entity.state.set('lastBlockedToilId', toil.id);
    return { status: ToilResultStatus.BLOCKED, remaining: 1, reason: 'blocked_for_test' };
  }
}

class FailedExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    entity.state.set('lastFailedJobId', job.definitionId);
    entity.state.set('lastFailedToilId', toil.id);
    return { status: ToilResultStatus.FAILED, reason: 'failed_for_test' };
  }
}

class ReplanExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    entity.state.set('lastReplanJobId', job.definitionId);
    entity.state.set('lastReplanToilId', toil.id);
    return { status: ToilResultStatus.REPLAN, reason: 'replan_for_test' };
  }
}

class AbortExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    entity.state.set('lastAbortJobId', job.definitionId);
    entity.state.set('lastAbortToilId', toil.id);
    return { status: ToilResultStatus.ABORT, reason: 'abort_for_test' };
  }
}

function createNeedSystem() {
  const need = new Need({
    id: 'need_dynamic_prepare',
    name: '动态事件准备',
    evaluator: new StaticNeedEvaluator(),
    basePriority: 100,
    goalState: { preparedForDynamicEvent: { op: 'eq', value: true } },
  });
  const needSystem = new NeedSystem();
  needSystem.addNeed(need);
  needSystem.evaluate(new TestState({ preparedForDynamicEvent: false }), {});
  return needSystem;
}

function createEntity(values = {}) {
  return {
    id: 'npc_job_action',
    state: new TestState({
      alive: true,
      preparedForDynamicEvent: false,
      toilRan: false,
      targetDynamicEventId: 'evt_secret_001',
      ...values,
    }),
    inventory: { has: () => true, remove: () => {}, add: () => {} },
    buildGOAPState() { return this.state.toGOAPState(); },
  };
}

console.log('1) Action 保留 JobAction 字段');
const action = new Action({
  id: 'act_npc_prepare_dynamic_event',
  name: '筹备动态事件',
  executionKind: 'job',
  jobId: 'job_npc_prepare_dynamic_event',
  jobInput: { source: 'dynamic_goal' },
  preconditions: { alive: { op: 'true' } },
  effects: {},
  plannerEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
});
assert(action.executionKind === 'job', 'Action keeps executionKind=job');
assert(action.jobId === 'job_npc_prepare_dynamic_event', 'Action keeps jobId');
assert(action.jobInput?.source === 'dynamic_goal', 'Action keeps jobInput');
assert(action.isJobAction?.() === true, 'Action.isJobAction() returns true');
const json = action.toJSON();
assert(json.executionKind === 'job', 'Action.toJSON includes executionKind');
assert(json.jobId === 'job_npc_prepare_dynamic_event', 'Action.toJSON includes jobId');
assert(json.jobInput?.source === 'dynamic_goal', 'Action.toJSON includes jobInput');

console.log('2) ActionPool.create 保留 JobAction 字段');
ActionPool.clear();
ActionPool.registerTemplate({
  id: 'act_pool_job_action',
  name: '池化 JobAction',
  executionKind: 'job',
  jobId: 'job_npc_prepare_dynamic_event',
  jobInput: { fromPool: true },
  preconditions: { alive: { op: 'true' } },
  effects: {},
  plannerEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
});
const pooled = ActionPool.create('act_pool_job_action');
assert(pooled.executionKind === 'job', 'ActionPool preserves executionKind');
assert(pooled.jobId === 'job_npc_prepare_dynamic_event', 'ActionPool preserves jobId');
assert(pooled.jobInput?.fromPool === true, 'ActionPool preserves jobInput');

console.log('3) GOAP plan 只包含高层 Action，不包含 Toil id');
const needSystem = createNeedSystem();
const planningSystem = new BehaviorSystem(new GOAPPlanner({ maxDepth: 3, maxIterations: 50 }), [action], { jobsEnabled: true });
const plan = planningSystem.plan(needSystem, { alive: true, preparedForDynamicEvent: false }, {});
assert(plan.length === 1, 'GOAP plan contains one high-level Action');
assert(plan[0].id === 'act_npc_prepare_dynamic_event', 'GOAP plan contains JobAction id');
assert(!planningSystem.getLastPlanResult().actions.some(id => id.startsWith('toil_')), 'GOAP plan result does not contain Toil ids');

console.log('4) jobsEnabled=true 时 JobAction 启动 JobSystem 并运行 Toil');
JobPool.clear();
ToilPool.clear();
ToilPool.loadFromConfig({ toils: [{ id: 'toil_finish', name: '完成' }] });
ToilPool.registerExecutor('toil_finish', new FinishExecutor());
JobPool.loadFromConfig({ jobs: [{
  id: 'job_npc_prepare_dynamic_event',
  name: '筹备动态事件',
  successEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
  toils: [{ id: 'finish', type: 'toil_finish' }],
}] });

const enabledSystem = new BehaviorSystem(new GOAPPlanner({ maxDepth: 3, maxIterations: 50 }), [action], { jobsEnabled: true });
enabledSystem.plan(createNeedSystem(), { alive: true, preparedForDynamicEvent: false }, {});
const enabledEntity = createEntity();
const enabledResult = enabledSystem.executeStep(enabledEntity, {});
assert(enabledResult.status === 'plan_complete', 'JobAction success completes current plan step');
assert(enabledResult.result?.jobId === 'job_npc_prepare_dynamic_event', 'JobAction result reports jobId');
assert(enabledResult.result?.jobInstanceId?.startsWith('job_npc_prepare_dynamic_event#'), 'JobAction success result reports jobInstanceId');
assert(enabledResult.result?.status === 'success', 'JobAction success result preserves real job status');
assert(enabledEntity.state.get('toilRan') === true, 'Job Toil actually ran');
assert(enabledEntity.state.get('lastToilId') === 'finish', 'Concrete Toil id ran');
assert(enabledEntity.state.get('jobInputEventId') === 'evt_secret_001', 'Job input includes targetDynamicEventId');
assert(enabledEntity.state.get('preparedForDynamicEvent') === true, 'Job successEffects wrote prepared state');
assert(enabledSystem.currentActionIndex === 1, 'JobAction advanced plan step');

console.log('5) jobsEnabled=false 时 JobAction replan 且不运行 Toil');
const disabledSystem = new BehaviorSystem(new GOAPPlanner({ maxDepth: 3, maxIterations: 50 }), [action], { jobsEnabled: false });
disabledSystem.plan(createNeedSystem(), { alive: true, preparedForDynamicEvent: false }, {});
const disabledEntity = createEntity();
const disabledResult = disabledSystem.executeStep(disabledEntity, {});
assert(disabledResult.status === 'replan', 'disabled JobAction returns replan');
assert(disabledResult.reason === 'jobs_disabled', 'disabled JobAction reports jobs_disabled');
assert(disabledEntity.state.get('toilRan') === false, 'disabled JobAction does not run Toil');
assert(disabledEntity.state.get('preparedForDynamicEvent') === false, 'disabled JobAction does not write successEffects');
assert(disabledEntity.state.get('currentJobId') == null, 'disabled JobAction clears currentJobId');
assert(disabledEntity.state.get('currentToilId') == null, 'disabled JobAction clears currentToilId');
assert(disabledEntity.state.get('jobStatus') === 'idle', 'disabled JobAction syncs idle jobStatus');
assert(disabledEntity.state.get('jobRemaining') === 0, 'disabled JobAction syncs zero jobRemaining');

console.log('6) running/blocked JobAction 保持 busy 且同步运行中 state');
ToilPool.clear();
JobPool.clear();
ToilPool.loadFromConfig({ toils: [
  { id: 'toil_running', name: '运行中' },
  { id: 'toil_blocked', name: '阻塞中' },
] });
ToilPool.registerExecutor('toil_running', new RunningExecutor());
ToilPool.registerExecutor('toil_blocked', new BlockedExecutor());
JobPool.loadFromConfig({ jobs: [
  { id: 'job_running_action', name: '运行 Job', toils: [{ id: 'running_step', type: 'toil_running' }] },
  { id: 'job_blocked_action', name: '阻塞 Job', toils: [{ id: 'blocked_step', type: 'toil_blocked' }] },
] });
const runningAction = new Action({
  id: 'act_running_action',
  name: '运行 Action',
  executionKind: 'job',
  jobId: 'job_running_action',
  preconditions: { alive: { op: 'true' } },
  effects: {},
  plannerEffects: { runningGoal: { op: 'set', value: true } },
});
const blockedAction = new Action({
  id: 'act_blocked_action',
  name: '阻塞 Action',
  executionKind: 'job',
  jobId: 'job_blocked_action',
  preconditions: { alive: { op: 'true' } },
  effects: {},
  plannerEffects: { blockedGoal: { op: 'set', value: true } },
});
const runningSystem = new BehaviorSystem(new GOAPPlanner(), [runningAction], { jobsEnabled: true });
runningSystem.currentPlan = [runningAction];
const runningEntity = createEntity();
const runningResult = runningSystem.executeStep(runningEntity, {});
assert(runningResult.status === 'in_progress', 'running JobAction returns in_progress');
assert(runningResult.job?.currentJobId === 'job_running_action', 'running result reports current job');
assert(runningEntity.state.get('currentJobId') === 'job_running_action', 'running JobAction syncs currentJobId');
assert(runningEntity.state.get('currentToilId') === 'running_step', 'running JobAction syncs currentToilId');
assert(runningEntity.state.get('jobStatus') === 'running', 'running JobAction syncs running jobStatus');
assert(runningEntity.state.get('jobRemaining') === 2, 'running JobAction syncs remaining');
assert(runningSystem.isBusy() === true, 'running JobAction makes BehaviorSystem busy');
const runningResult2 = runningSystem.executeStep(runningEntity, {});
assert(runningResult2.job?.currentJobId === 'job_running_action', 'running JobAction keeps same job across ticks');
assert(runningEntity.state.get('lastRunningJobId') === 'job_running_action', 'running second tick still runs same job');

const blockedSystem = new BehaviorSystem(new GOAPPlanner(), [blockedAction], { jobsEnabled: true });
blockedSystem.currentPlan = [blockedAction];
const blockedEntity = createEntity();
const blockedResult = blockedSystem.executeStep(blockedEntity, {});
assert(blockedResult.status === 'in_progress', 'blocked JobAction returns in_progress');
assert(blockedResult.job?.currentJobId === 'job_blocked_action', 'blocked result reports current job');
assert(blockedEntity.state.get('currentJobId') === 'job_blocked_action', 'blocked JobAction syncs currentJobId');
assert(blockedEntity.state.get('currentToilId') === 'blocked_step', 'blocked JobAction syncs currentToilId');
assert(blockedEntity.state.get('jobStatus') === 'running', 'blocked JobAction keeps job running');
assert(blockedEntity.state.get('jobRemaining') === 1, 'blocked JobAction syncs blocked remaining');
assert(blockedSystem.isBusy() === true, 'blocked JobAction makes BehaviorSystem busy');

console.log('7) 不同 JobAction 切换不会复用旧 Job');
ToilPool.clear();
JobPool.clear();
ToilPool.loadFromConfig({ toils: [{ id: 'toil_running', name: '运行中' }] });
ToilPool.registerExecutor('toil_running', new RunningExecutor());
JobPool.loadFromConfig({ jobs: [
  { id: 'job_a', name: 'Job A', toils: [{ id: 'job_a_step', type: 'toil_running' }] },
  { id: 'job_b', name: 'Job B', toils: [{ id: 'job_b_step', type: 'toil_running' }] },
] });
const actionA = new Action({
  id: 'act_a',
  name: 'Action A',
  executionKind: 'job',
  jobId: 'job_a',
  preconditions: { alive: { op: 'true' } },
  effects: {},
  plannerEffects: { aDone: { op: 'set', value: true } },
});
const actionB = new Action({
  id: 'act_b',
  name: 'Action B',
  executionKind: 'job',
  jobId: 'job_b',
  preconditions: { alive: { op: 'true' } },
  effects: {},
  plannerEffects: { bDone: { op: 'set', value: true } },
});
const switchSystem = new BehaviorSystem(new GOAPPlanner(), [actionA, actionB], { jobsEnabled: true });
const switchEntity = createEntity();
switchSystem.currentPlan = [actionA];
const firstSwitch = switchSystem.executeStep(switchEntity, {});
assert(firstSwitch.job?.currentJobId === 'job_a', 'first action starts job_a');
switchSystem.currentPlan = [actionB];
switchSystem.currentActionIndex = 0;
const secondSwitch = switchSystem.executeStep(switchEntity, {});
assert(secondSwitch.job?.currentJobId === 'job_b', 'second action starts job_b instead of reusing job_a');
assert(secondSwitch.job?.currentToilId === 'job_b_step', 'second action runs job_b toil');
assert(switchEntity.state.get('lastRunningJobId') === 'job_b', 'entity records job_b execution after switch');
assert(switchEntity.state.get('currentJobId') === 'job_b', 'state syncs switched job_b');

console.log('8) clearPlan 清理 active Job 和 state，后续 JobAction 不复用旧 Job');
const clearSystem = new BehaviorSystem(new GOAPPlanner(), [actionA, actionB], { jobsEnabled: true });
const clearEntity = createEntity();
clearSystem.currentPlan = [actionA];
clearSystem.executeStep(clearEntity, {});
assert(clearEntity.state.get('currentJobId') === 'job_a', 'clearPlan setup has active job_a');
clearSystem.clearPlan(clearEntity);
assert(clearSystem.isBusy() === false, 'clearPlan clears busy state');
assert(clearEntity.state.get('currentJobId') == null, 'clearPlan clears currentJobId');
assert(clearEntity.state.get('currentToilId') == null, 'clearPlan clears currentToilId');
assert(clearEntity.state.get('jobStatus') === 'idle', 'clearPlan syncs idle jobStatus');
assert(clearEntity.state.get('jobRemaining') === 0, 'clearPlan syncs zero jobRemaining');
clearSystem.currentPlan = [actionB];
clearSystem.currentActionIndex = 0;
const afterClear = clearSystem.executeStep(clearEntity, {});
assert(afterClear.job?.currentJobId === 'job_b', 'after clearPlan starts new job_b');
assert(afterClear.job?.currentToilId === 'job_b_step', 'after clearPlan runs job_b toil');

console.log('9) success/failed/replan/abort 后清理 Job state');
ToilPool.clear();
JobPool.clear();
ToilPool.loadFromConfig({ toils: [
  { id: 'toil_finish', name: '完成' },
  { id: 'toil_failed', name: '失败' },
  { id: 'toil_replan', name: '重规划' },
  { id: 'toil_abort', name: '中止' },
] });
ToilPool.registerExecutor('toil_finish', new FinishExecutor());
ToilPool.registerExecutor('toil_failed', new FailedExecutor());
ToilPool.registerExecutor('toil_replan', new ReplanExecutor());
ToilPool.registerExecutor('toil_abort', new AbortExecutor());
JobPool.loadFromConfig({ jobs: [
  { id: 'job_success_cleanup', name: '成功清理', toils: [{ id: 'finish_cleanup', type: 'toil_finish' }] },
  { id: 'job_failed_cleanup', name: '失败清理', toils: [{ id: 'failed_cleanup', type: 'toil_failed' }] },
  { id: 'job_replan_cleanup', name: '重规划清理', toils: [{ id: 'replan_cleanup', type: 'toil_replan' }] },
  { id: 'job_abort_cleanup', name: '中止清理', toils: [{ id: 'abort_cleanup', type: 'toil_abort' }] },
] });
function assertTerminalCleanup(jobId, actionId, expectedReason, expectedJobStatus) {
  const terminalAction = new Action({
    id: actionId,
    name: actionId,
    executionKind: 'job',
    jobId,
    preconditions: { alive: { op: 'true' } },
    effects: {},
    plannerEffects: { terminalDone: { op: 'set', value: true } },
  });
  const system = new BehaviorSystem(new GOAPPlanner(), [terminalAction], { jobsEnabled: true });
  const entity = createEntity();
  system.currentPlan = [terminalAction];
  const result = system.executeStep(entity, {});
  assert(result.status === (expectedReason === 'job_completed' ? 'plan_complete' : 'replan'), `${jobId} returns terminal status`);
  assert(result.result?.actionId === actionId, `${jobId} terminal result reports actionId`);
  assert(result.result?.jobId === jobId, `${jobId} terminal result reports jobId`);
  assert(result.result?.jobInstanceId?.startsWith(`${jobId}#`), `${jobId} terminal result reports jobInstanceId`);
  assert(result.result?.status === expectedJobStatus, `${jobId} terminal result preserves real job status`);
  assert((result.result?.reason || result.reason) === expectedReason, `${jobId} reports terminal reason`);
  assert(system.isBusy() === false, `${jobId} leaves BehaviorSystem not busy`);
  assert(entity.state.get('currentJobId') == null, `${jobId} clears currentJobId`);
  assert(entity.state.get('currentToilId') == null, `${jobId} clears currentToilId`);
  assert(entity.state.get('jobStatus') === 'idle', `${jobId} syncs idle jobStatus`);
  assert(entity.state.get('jobRemaining') === 0, `${jobId} syncs zero jobRemaining`);
}
assertTerminalCleanup('job_success_cleanup', 'act_success_cleanup', 'job_completed', 'success');
assertTerminalCleanup('job_failed_cleanup', 'act_failed_cleanup', 'failed_for_test', 'failed');
assertTerminalCleanup('job_replan_cleanup', 'act_replan_cleanup', 'replan_for_test', 'replan');
assertTerminalCleanup('job_abort_cleanup', 'act_abort_cleanup', 'abort_for_test', 'abort');

console.log('10) 动态事件类型前置防止准备目标串到错误 JobAction');
const prepareGeneric = new Action({
  id: 'act_npc_prepare_dynamic_event',
  name: '通用准备',
  executionKind: 'job',
  jobId: 'job_npc_prepare_dynamic_event',
  preconditions: {
    alive: { op: 'true' },
    dynamicEventUsesGenericPreparation: { op: 'true' },
  },
  effects: {},
  plannerEffects: { preparedForGenericDynamicEvent: { op: 'set', value: true } },
});
const prepareSecret = new Action({
  id: 'act_npc_prepare_secret_realm',
  name: '秘境准备',
  executionKind: 'job',
  jobId: 'job_npc_prepare_secret_realm',
  preconditions: {
    alive: { op: 'true' },
    dynamicEventIsSecretRealm: { op: 'true' },
  },
  effects: {},
  plannerEffects: { preparedForSecretRealm: { op: 'set', value: true } },
});
const prepareTournament = new Action({
  id: 'act_npc_prepare_sect_tournament',
  name: '大比准备',
  executionKind: 'job',
  jobId: 'job_npc_prepare_sect_tournament',
  preconditions: {
    alive: { op: 'true' },
    dynamicEventIsSectTournament: { op: 'true' },
  },
  effects: {},
  plannerEffects: { preparedForSectTournament: { op: 'set', value: true } },
});
const dynamicPlanningSystem = new BehaviorSystem(
  new GOAPPlanner({ maxDepth: 3, maxIterations: 50 }),
  [prepareGeneric, prepareSecret, prepareTournament],
  { jobsEnabled: true },
);
const secretState = dynamicPlanningSystem._stateForGoal(
  { alive: true, preparedForSecretRealm: false },
  { source: 'dynamic', dynamic: { eventId: 'evt_secret', eventType: 'secret_realm' } },
);
const secretPlan = dynamicPlanningSystem.planner.plan(
  secretState,
  { preparedForSecretRealm: { op: 'eq', value: true } },
  [prepareGeneric, prepareSecret, prepareTournament],
);
assert(secretPlan.success === true, 'secret realm preparation can be planned');
assert(
  secretPlan.plan.map(a => a.id).join(',') === 'act_npc_prepare_secret_realm',
  'secret realm preparation only uses secret realm JobAction',
);
const tournamentState = dynamicPlanningSystem._stateForGoal(
  { alive: true, preparedForSectTournament: false },
  { source: 'dynamic', dynamic: { eventId: 'evt_tournament', eventType: 'sect_tournament' } },
);
const tournamentPlan = dynamicPlanningSystem.planner.plan(
  tournamentState,
  { preparedForSectTournament: { op: 'eq', value: true } },
  [prepareGeneric, prepareSecret, prepareTournament],
);
assert(tournamentPlan.success === true, 'sect tournament preparation can be planned');
assert(
  tournamentPlan.plan.map(a => a.id).join(',') === 'act_npc_prepare_sect_tournament',
  'sect tournament preparation only uses tournament JobAction',
);

console.log('11) 动态事件类型前置在执行期继续生效');
ToilPool.clear();
JobPool.clear();
ToilPool.loadFromConfig({ toils: [{ id: 'toil_finish', name: '完成' }] });
ToilPool.registerExecutor('toil_finish', new FinishExecutor());
JobPool.loadFromConfig({ jobs: [{
  id: 'job_npc_prepare_secret_realm',
  name: '秘境准备',
  successEffects: { preparedForSecretRealm: { op: 'set', value: true } },
  toils: [{ id: 'finish_secret_prepare', type: 'toil_finish' }],
}] });
const secretExecutionSystem = new BehaviorSystem(
  new GOAPPlanner({ maxDepth: 3, maxIterations: 50 }),
  [prepareGeneric, prepareSecret, prepareTournament],
  { jobsEnabled: true },
);
const secretExecutionGoal = new Goal({
  id: 'goal_dynamic_prepare_secret_realm_evt_secret_exec',
  name: '筹备秘境',
  source: GoalSource.DYNAMIC,
  sourceId: 'prepare_secret_realm',
  goalState: { preparedForSecretRealm: { op: 'eq', value: true } },
  priority: 100,
  urgency: 50,
});
secretExecutionGoal.dynamic = { eventId: 'evt_secret_exec', eventType: 'secret_realm' };
const secretExecutionPlan = secretExecutionSystem.plan(
  new NeedSystem(),
  { alive: true, preparedForSecretRealm: false },
  {},
  null,
  [secretExecutionGoal],
);
assert(secretExecutionPlan.map(a => a.id).join(',') === 'act_npc_prepare_secret_realm', 'dynamic secret goal plans secret preparation JobAction');
const secretExecutionEntity = createEntity({
  targetDynamicEventId: 'evt_secret_exec',
  targetDynamicEventType: 'secret_realm',
  preparedForSecretRealm: false,
});
const secretExecutionResult = secretExecutionSystem.executeStep(secretExecutionEntity, {});
assert(secretExecutionResult.status === 'plan_complete', 'typed dynamic preparation JobAction executes instead of replanning');
assert(secretExecutionResult.result?.jobId === 'job_npc_prepare_secret_realm', 'typed dynamic preparation starts secret realm Job');
assert(secretExecutionEntity.state.get('preparedForSecretRealm') === true, 'typed dynamic preparation writes secret prepared state');

if (failed > 0) {
  console.error(`\nJobAction planning tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJobAction planning tests passed');
