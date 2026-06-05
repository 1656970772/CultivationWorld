#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { BehaviorSystem } = await imp('js/engine/abstract/behavior-system.js');
const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');
const { Action } = await imp('js/engine/abstract/action.js');
const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { ToilExecutor, ToilResultStatus } = await imp('js/engine/abstract/toil.js');
const { ReactiveNode } = await imp('js/engine/abstract/bt/reactions.js');
const { BTStatus } = await imp('js/engine/abstract/bt/bt-node.js');
const { StimulusType } = await imp('js/engine/abstract/stimulus.js');

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

class StimulusQueueStub {
  constructor(stimuli = []) { this._stimuli = [...stimuli]; }
  has(type) { return this._stimuli.some(s => s.type === type); }
  pop(type) {
    const index = this._stimuli.findIndex(s => s.type === type);
    if (index < 0) return null;
    return this._stimuli.splice(index, 1)[0];
  }
}

class LongToilExecutor extends ToilExecutor {
  run(_entity, _worldContext, job, _toil) {
    job.context.count = (job.context.count || 0) + 1;
    if (job.context.count < 3) {
      return { status: ToilResultStatus.RUNNING, remaining: 1, reason: 'long_toil_running' };
    }
    return { status: ToilResultStatus.SUCCESS, reason: 'long_toil_done' };
  }
}

function resetPools() {
  ToilPool.clear();
  JobPool.clear();
  ToilPool.loadFromConfig({ toils: [{ id: 'toil_long', name: '长步骤' }] });
  ToilPool.registerExecutor('toil_long', new LongToilExecutor());
  JobPool.loadFromConfig({ jobs: [{
    id: 'job_long_prepare',
    name: '长准备',
    interrupt: { reaction: 'pause' },
    successEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
    toils: [{ id: 'long', type: 'toil_long' }],
  }] });
}

function createJobAction() {
  return new Action({
    id: 'act_long_prepare',
    name: '长准备',
    executionKind: 'job',
    jobId: 'job_long_prepare',
    preconditions: { alive: { op: 'true' } },
    plannerEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
    effects: {},
  });
}

function createReactionAction(id = 'act_react_retreat') {
  return new Action({
    id,
    name: '即时反应',
    preconditions: { alive: { op: 'true' } },
    effects: { reacted: { op: 'add', value: 1 } },
  });
}

function createSlowReactionAction(id = 'act_react_slow') {
  return new Action({
    id,
    name: '多日反应',
    duration: 2,
    preconditions: { alive: { op: 'true' } },
    effects: { reacted: { op: 'add', value: 1 } },
  });
}

function createReplanReactionAction(id = 'act_react_replan') {
  return new Action({
    id,
    name: '失败反应',
    preconditions: { canReact: { op: 'true' } },
    effects: { reacted: { op: 'add', value: 1 } },
  });
}

function createEntity(behaviorSystem, values = {}) {
  return {
    id: 'npc_interrupt',
    state: new TestState({
      alive: true,
      preparedForDynamicEvent: false,
      reacted: 0,
      hp: 100,
      maxHp: 100,
      ...values,
    }),
    inventory: { has: () => true, remove: () => {}, add: () => {} },
    behaviorSystem,
    buildGOAPState() { return this.state.toGOAPState(); },
    onPlanChosen() { this.planChosen = (this.planChosen || 0) + 1; },
  };
}

function createBehaviorSystem(actions) {
  return new BehaviorSystem(new GOAPPlanner(), actions, { jobsEnabled: true });
}

function attackedQueue() {
  return new StimulusQueueStub([{
    type: StimulusType.ATTACKED,
    sourceId: 'enemy_001',
    payload: { killerId: 'enemy_001' },
  }]);
}

function reactionWorldContext(actionId) {
  return {
    balanceConfig: {
      reaction: {
        enabled: true,
        fleeHpRatio: 0.2,
        healHpRatio: 0.5,
        actions: { retreat: actionId },
      },
    },
  };
}

console.log('1) running JobAction pause/resume keeps Toil progress stable');
resetPools();
const jobAction = createJobAction();
let bs = createBehaviorSystem([jobAction]);
bs.currentPlan = [jobAction];
let entity = createEntity(bs);
let result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'job starts and is in progress');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'job status is running before interrupt');
assert(bs.jobSystem.snapshot().jobContext.count === 1, 'first tick advances toil once');
assert(bs.pauseCurrentJob('reaction_attacked', entity) === true, 'pauseCurrentJob returns true for active job');
assert(bs.jobSystem.snapshot().jobStatus === 'paused', 'pauseCurrentJob pauses active job');
assert(entity.state.get('jobStatus') === 'paused', 'pauseCurrentJob syncs paused jobStatus');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'paused job stays in progress');
assert(result.phase === 'job_paused', 'paused job reports job_paused phase');
assert(bs.jobSystem.snapshot().jobContext.count === 1, 'paused job did not advance toil count');
assert(bs.resumeCurrentJob('reaction_done', entity) === true, 'resumeCurrentJob returns true for active job');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'resumeCurrentJob resumes active job');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'resumed job advances once');
assert(bs.jobSystem.snapshot().jobContext.count === 2, 'resumed job increments toil count');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'resumed job completes after required ticks');
assert(entity.state.get('preparedForDynamicEvent') === true, 'completed resumed job writes success effect');
assert(bs.pauseCurrentJob('no_job', entity) === false, 'pauseCurrentJob returns false without active job');
assert(bs.resumeCurrentJob('no_job', entity) === false, 'resumeCurrentJob returns false without active job');
assert(bs.abortCurrentJob('no_job', entity) === false, 'abortCurrentJob returns false without active job');

console.log('2) abortCurrentJob and clearPlan abort and clear active Job');
resetPools();
bs = createBehaviorSystem([jobAction]);
bs.currentPlan = [jobAction];
entity = createEntity(bs);
bs.executeStep(entity, {});
assert(bs.jobSystem.hasJob() === true, 'abortCurrentJob setup has active job');
assert(bs.abortCurrentJob('manual_abort', entity) === true, 'abortCurrentJob returns true for active job');
assert(bs.jobSystem.hasJob() === false, 'abortCurrentJob clears active job');
assert(entity.state.get('currentJobId') == null, 'abortCurrentJob syncs null currentJobId');
assert(entity.state.get('currentToilId') == null, 'abortCurrentJob syncs null currentToilId');
assert(entity.state.get('jobStatus') === 'idle', 'abortCurrentJob syncs idle jobStatus');
assert(entity.state.get('jobRemaining') === 0, 'abortCurrentJob syncs zero jobRemaining');
bs.currentPlan = [jobAction];
bs.currentActionIndex = 0;
bs.executeStep(entity, {});
assert(bs.jobSystem.hasJob() === true, 'clearPlan setup has active job');
bs.clearPlan();
assert(bs.jobSystem.hasJob() === false, 'clearPlan aborts and clears active job');
assert(entity.state.get('currentJobId') == null, 'clearPlan without entity syncs null currentJobId');
assert(entity.state.get('currentToilId') == null, 'clearPlan without entity syncs null currentToilId');
assert(entity.state.get('jobStatus') === 'idle', 'clearPlan without entity syncs idle jobStatus');
assert(entity.state.get('jobRemaining') === 0, 'clearPlan without entity syncs zero jobRemaining');

console.log('3) reaction-specific suspend/restore resumes original JobAction plan');
resetPools();
const reactionAction = createReactionAction();
bs = createBehaviorSystem([jobAction, reactionAction]);
bs.currentPlan = [jobAction];
entity = createEntity(bs);
bs.executeStep(entity, {});
assert(bs.suspendPlanForReaction('reaction_attacked', entity) === true, 'suspendPlanForReaction stores interrupted plan');
assert(bs.jobSystem.snapshot().jobStatus === 'paused', 'suspendPlanForReaction pauses active job');
assert(bs.currentPlan.length === 0, 'suspendPlanForReaction clears current plan without clearing job');
assert(bs.setSingleActionPlan(reactionAction.id, 'reaction_attacked_retreat') === true, 'reaction plan can be installed');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'reaction SimpleAction completes');
assert(entity.state.get('reacted') === 1, 'reaction SimpleAction effect is applied');
assert(bs.restoreSuspendedPlan('reaction_done', entity) === true, 'restoreSuspendedPlan restores interrupted plan');
assert(bs.currentPlan[bs.currentActionIndex]?.id === jobAction.id, 'restored plan points back to original JobAction');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'restoreSuspendedPlan resumes active job');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'restored job advances from old progress');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'restored job eventually completes');
assert(entity.state.get('preparedForDynamicEvent') === true, 'restored job writes success effect');

console.log('4) ReactiveNode pauses active Job instead of aborting it');
resetPools();
const retreatAction = createReactionAction('act_react_retreat');
bs = createBehaviorSystem([jobAction, retreatAction]);
bs.currentPlan = [jobAction];
entity = createEntity(bs);
entity.stimulusQueue = attackedQueue();
bs.executeStep(entity, {});
const reactiveNode = new ReactiveNode();
const blackboard = {};
const status = reactiveNode.tick(entity, blackboard, reactionWorldContext(retreatAction.id));
assert(status === BTStatus.RUNNING, 'ReactiveNode handles attacked stimulus');
assert(blackboard.reactedPath?.wasBusy === true, 'ReactiveNode records interrupted busy path');
assert(entity.state.get('reacted') === 1, 'ReactiveNode executes reaction action');
assert(bs.jobSystem.hasJob() === true, 'ReactiveNode keeps active job instead of aborting');
assert(blackboard.reactedPath?.interruptedMode === 'pause', 'ReactiveNode uses pause path for active Job');
assert(bs.hasPlan() === true, 'completed ReactiveNode reaction makes restored JobAction plan reachable on next planning check');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'completed ReactiveNode reaction resumes paused job at safe point');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'ReactiveNode-restored job continues');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'ReactiveNode-restored job completes');
assert(entity.state.get('preparedForDynamicEvent') === true, 'ReactiveNode-restored job applies success effects');

console.log('5) suspendPlanForReaction ignores ordinary SimpleAction plans');
resetPools();
const ordinaryAction = new Action({
  id: 'act_ordinary_work',
  name: '普通行为',
  duration: 2,
  preconditions: { alive: { op: 'true' } },
  effects: { ordinaryDone: { op: 'set', value: true } },
});
bs = createBehaviorSystem([ordinaryAction, retreatAction]);
bs.currentPlan = [ordinaryAction];
entity = createEntity(bs);
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'ordinary SimpleAction is in progress');
assert(bs.suspendPlanForReaction('reaction_attacked', entity) === false, 'suspendPlanForReaction returns false without active job');
assert(bs._suspendedPlanForReaction == null, 'ordinary SimpleAction plan is not stored as suspended reaction plan');
assert(bs.currentPlan[0]?.id === ordinaryAction.id, 'ordinary SimpleAction plan remains until normal reaction clear path');
entity.stimulusQueue = attackedQueue();
const ordinaryStatus = reactiveNode.tick(entity, {}, reactionWorldContext(retreatAction.id));
assert(ordinaryStatus === BTStatus.RUNNING, 'ReactiveNode still handles ordinary-plan interrupt');
assert(bs._suspendedPlanForReaction == null, 'ReactiveNode does not suspend ordinary SimpleAction plan');
assert(bs.hasPlan() === false, 'completed ordinary reaction does not auto-restore interrupted SimpleAction plan');
assert(bs.currentPlan[0]?.id === retreatAction.id, 'ordinary interrupt leaves only completed reaction plan');

console.log('6) setSingleActionPlan failure restores paused JobAction');
resetPools();
bs = createBehaviorSystem([jobAction]);
bs.currentPlan = [jobAction];
entity = createEntity(bs);
entity.stimulusQueue = attackedQueue();
bs.executeStep(entity, {});
const missingBlackboard = {};
const missingStatus = reactiveNode.tick(entity, missingBlackboard, reactionWorldContext('act_missing_reaction'));
assert(missingStatus === BTStatus.FAILURE, 'ReactiveNode returns failure when configured reaction action is missing');
assert(bs._suspendedPlanForReaction == null, 'missing reaction action does not leave suspended plan behind');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'missing reaction action resumes paused job');
assert(bs.currentPlan[bs.currentActionIndex]?.id === jobAction.id, 'missing reaction action restores original JobAction plan');

console.log('7) multi-tick reaction keeps Job paused until reaction completes');
resetPools();
const slowReaction = createSlowReactionAction();
bs = createBehaviorSystem([jobAction, slowReaction]);
bs.currentPlan = [jobAction];
entity = createEntity(bs);
entity.stimulusQueue = attackedQueue();
bs.executeStep(entity, {});
const slowBlackboard = {};
const slowStatus = reactiveNode.tick(entity, slowBlackboard, reactionWorldContext(slowReaction.id));
assert(slowStatus === BTStatus.RUNNING, 'ReactiveNode starts multi-tick reaction');
assert(slowBlackboard.execution?.status === 'in_progress', 'first multi-tick reaction tick is in_progress');
assert(bs.jobSystem.snapshot().jobStatus === 'paused', 'in-progress reaction keeps original job paused');
assert(bs.currentPlan[bs.currentActionIndex]?.id === slowReaction.id, 'in-progress reaction plan remains active');
assert(bs.hasPlan() === true, 'in-progress reaction remains the active plan');
assert(bs.currentPlan[bs.currentActionIndex]?.id === slowReaction.id, 'hasPlan does not restore while reaction is in progress');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'second multi-tick reaction tick completes reaction');
assert(bs.hasPlan() === true, 'completed multi-tick reaction restores original JobAction plan');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'completed multi-tick reaction resumes original job');
assert(bs.currentPlan[bs.currentActionIndex]?.id === jobAction.id, 'completed multi-tick reaction restores JobAction as current step');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'multi-tick restored job continues from old progress');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'multi-tick restored job completes');

console.log('8) failed reaction execution restores original JobAction');
resetPools();
const replanReaction = createReplanReactionAction();
bs = createBehaviorSystem([jobAction, replanReaction]);
bs.currentPlan = [jobAction];
entity = createEntity(bs, { canReact: false });
entity.stimulusQueue = attackedQueue();
bs.executeStep(entity, {});
const replanBlackboard = {};
const replanStatus = reactiveNode.tick(entity, replanBlackboard, reactionWorldContext(replanReaction.id));
assert(replanStatus === BTStatus.RUNNING, 'ReactiveNode consumes stimulus when reaction action requests replan');
assert(replanBlackboard.execution?.status === 'replan', 'blackboard records reaction replan result');
assert(bs._suspendedPlanForReaction == null, 'reaction replan does not leave suspended plan behind');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'reaction replan resumes original job');
assert(bs.currentPlan[bs.currentActionIndex]?.id === jobAction.id, 'reaction replan restores original JobAction plan');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'replan-restored job continues from old progress');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'replan-restored job completes');

if (failed > 0) {
  console.error(`\nJob interrupt tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJob interrupt tests passed');
