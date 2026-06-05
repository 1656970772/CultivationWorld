#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { ToilExecutor, ToilResultStatus } = await imp('js/engine/abstract/toil.js');
const { JobSystem } = await imp('js/engine/abstract/job-system.js');
const { JobStatus } = await imp('js/engine/abstract/job.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

class TestState {
  constructor(values = {}) { this._values = { ...values }; }
  get(key) { return this._values[key]; }
  set(key, value) { this._values[key] = value; }
}

class PatchExecutor extends ToilExecutor {
  run(_entity, _worldContext, _job, toil) {
    return {
      status: ToilResultStatus.SUCCESS,
      reason: `ran_${toil.id}`,
      contextPatch: { [toil.params.key]: toil.params.value },
      effects: toil.params.effects || {},
    };
  }
}

class RunningThenSuccessExecutor extends ToilExecutor {
  run(_entity, _worldContext, job, toil) {
    const key = `${toil.id}Count`;
    job.context[key] = (job.context[key] || 0) + 1;
    if (job.context[key] < 2) {
      return { status: ToilResultStatus.RUNNING, remaining: 1, reason: 'needs_more_time' };
    }
    return { status: ToilResultStatus.SUCCESS, reason: 'finished_after_second_tick' };
  }
}

class ReplanExecutor extends ToilExecutor {
  run() {
    return { status: ToilResultStatus.REPLAN, remaining: 3, reason: 'target_changed' };
  }
}

JobPool.clear();
ToilPool.clear();
ToilPool.loadFromConfig({ toils: [
  { id: 'toil_patch_context', name: '写上下文' },
  { id: 'toil_running_once', name: '运行一次' },
  { id: 'toil_missing_executor', name: '缺失执行器' },
  { id: 'toil_replan_once', name: '请求重规划' }
] });
ToilPool.registerExecutor('toil_patch_context', new PatchExecutor());
ToilPool.registerExecutor('toil_running_once', new RunningThenSuccessExecutor());
ToilPool.registerExecutor('toil_replan_once', new ReplanExecutor());
JobPool.loadFromConfig({ jobs: [
  {
    id: 'job_test_runtime',
    name: '运行时测试',
    input: { fromDefinition: true },
    successEffects: {
      jobDone: { op: 'set', value: true },
      score: { op: 'add', value: 5 },
      minValue: { op: 'min', value: 10 },
      maxValue: { op: 'max', value: 8 },
    },
    toils: [
      { id: 'first', type: 'toil_patch_context', params: { key: 'firstDone', value: true } },
      { id: 'second', type: 'toil_running_once' },
      {
        id: 'third',
        type: 'toil_patch_context',
        params: {
          key: 'thirdDone',
          value: true,
          effects: {
            thirdEffect: { op: 'set', value: 7 },
            score: { op: 'add', value: 3 },
          },
        },
      }
    ],
  },
  {
    id: 'job_test_missing_executor',
    name: '缺失执行器测试',
    toils: [{ id: 'missing', type: 'toil_missing_executor' }],
  },
  {
    id: 'job_test_replan',
    name: '重规划测试',
    toils: [{ id: 'replan', type: 'toil_replan_once' }],
  },
] });

const entity = {
  id: 'npc_job_test',
  state: new TestState({ jobDone: false, thirdEffect: 0, score: 2, minValue: 20, maxValue: 3 }),
};
const system = new JobSystem();

console.log('1) JobSystem starts and exposes runtime state');
const started = system.start('job_test_runtime', { eventId: 'evt_job' });
assert(started.definitionId === 'job_test_runtime', 'start returns JobInstance');
assert(system.hasJob() === true, 'system has active job');
const startSnapshot = system.snapshot();
assert(startSnapshot.currentJobId === 'job_test_runtime', 'snapshot exposes currentJobId');
assert(startSnapshot.currentJobInstanceId === started.id, 'snapshot exposes currentJobInstanceId');
assert(startSnapshot.currentToilId === 'first', 'snapshot exposes currentToilId');
assert(startSnapshot.currentToilIndex === 0, 'snapshot exposes currentToilIndex');
assert(startSnapshot.jobStatus === JobStatus.RUNNING, 'snapshot exposes jobStatus');
assert(startSnapshot.jobRemaining === 0, 'snapshot exposes default jobRemaining');
assert(startSnapshot.jobContext.eventId === 'evt_job', 'snapshot exposes jobContext input');
startSnapshot.jobContext.eventId = 'changed_outside';
assert(system.snapshot().jobContext.eventId === 'evt_job', 'snapshot returns a shallow context copy');

console.log('2) JobSystem advances toils without writing success effects too early');
let result = system.executeStep(entity, {});
assert(result.status === 'running', 'first toil success keeps job running because more toils remain');
assert(system.snapshot().currentToilId === 'second', 'first toil advances to next toil');
assert(system.snapshot().jobContext.firstDone === true, 'contextPatch is merged into job context');
assert(entity.state.get('jobDone') === false, 'successEffects are not applied before job completion');
assert(entity.state.get('score') === 2, 'job add effect waits until job completion');

console.log('3) running toil holds current index until success');
result = system.executeStep(entity, {});
assert(result.status === 'running', 'running toil returns running');
assert(system.snapshot().currentToilId === 'second', 'second toil remains current while running');
assert(system.snapshot().currentToilIndex === 1, 'currentToilIndex does not advance while running');
assert(system.snapshot().jobRemaining === 1, 'running toil remaining is tracked');
result = system.executeStep(entity, {});
assert(result.status === 'running', 'second toil success advances to third while job remains running');
assert(system.snapshot().currentToilId === 'third', 'third toil becomes current');
assert(system.snapshot().currentToilIndex === 2, 'currentToilIndex advances after success');

console.log('4) final toil completes job and writes effects');
result = system.executeStep(entity, {});
assert(result.status === 'success', 'final toil completes job');
assert(system.hasJob() === false, 'job is cleared after success');
assert(entity.state.get('jobDone') === true, 'job set successEffect is applied');
assert(entity.state.get('thirdEffect') === 7, 'toil set effect is applied');
assert(entity.state.get('score') === 10, 'toil and job add effects are applied in order');
assert(entity.state.get('minValue') === 10, 'job min effect is applied');
assert(entity.state.get('maxValue') === 8, 'job max effect is applied');

console.log('5) pause, resume, and abort update runtime state');
system.start('job_test_runtime', { eventId: 'evt_pause' });
system.pause('reaction_attacked');
assert(system.snapshot().jobStatus === JobStatus.PAUSED, 'pause sets jobStatus paused');
result = system.executeStep(entity, {});
assert(result.status === 'running' && result.reason === 'job_paused', 'paused job does not execute current toil');
assert(system.snapshot().currentToilId === 'first', 'paused job keeps current toil');
system.resume('reaction_done');
assert(system.snapshot().jobStatus === JobStatus.RUNNING, 'resume sets jobStatus running');
system.abort('manual_abort');
assert(system.hasJob() === false, 'abort clears current job');

console.log('6) missing toil executor fails and clears job');
system.start('job_test_missing_executor');
result = system.executeStep(entity, {});
assert(result.status === 'failed', 'missing executor fails job');
assert(result.reason === 'missing_toil_executor', 'missing executor reports concrete reason');
assert(system.hasJob() === false, 'missing executor clears current job');

console.log('7) replan marks saved job terminal and clears runtime state');
const savedReplanJob = system.start('job_test_replan');
result = system.executeStep(entity, {});
assert(result.status === 'replan', 'replan result is returned');
assert(savedReplanJob.status === JobStatus.ABORTED, 'saved replan job is marked aborted');
assert(savedReplanJob.lastResult?.status === 'replan', 'saved replan job records final result');
assert(system.hasJob() === false, 'replan clears current job');
assert(system.snapshot().jobRemaining === 0, 'replan resets jobRemaining');

if (failed > 0) {
  console.error(`\nJobSystem tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJobSystem tests passed');
