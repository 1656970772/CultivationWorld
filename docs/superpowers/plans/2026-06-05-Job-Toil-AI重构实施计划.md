# Job/Toil AI 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 最后更新：2026-06-05

**Goal:** Build the Job/Toil execution layer for complex NPC actions while preserving Utility, GOAP, SimpleAction execution, and Reaction priority.

**Architecture:** Utility / Intent still chooses goals, GOAP still plans high-level Action IDs, and Execution decides whether the current Action is a SimpleAction or a JobAction. JobSystem owns one active Job per entity and advances Toil steps through registered ToilExecutors; Job and Toil definitions are loaded from data files, not embedded in executor megafiles.

**Tech Stack:** Browser/Node ESM JavaScript, JSON data configs under `apps/game/data/`, existing `ActionPool` / `BehaviorSystem` / `WorldEngine`, Node `.mjs` verification scripts in `apps/game/tools/`.

---

## Sources

- Spec: `docs/systems/job-toil-ai-spec.md`
- ADR: `docs/decisions/adr-050-goap-job-toil-layered-ai.md`
- Current Action model: `apps/game/js/engine/abstract/action.js`
- Current execution loop: `apps/game/js/engine/abstract/behavior-system.js`
- Current dynamic event executors: `apps/game/js/engine/npc/actions/dynamic-event-actions.js`
- Current config loader: `apps/game/js/core/config-loader.js`
- Current NPC action list: `apps/game/js/engine/npc/npc-entity.js`

## Testing Policy

All tests in this plan must assert concrete behavior. Do not use fixed-baseline equivalence, saved-output matching, replay-output matching, or broad "same as before" checks as proof of correctness.

Acceptable tests:

- A JobAction is planned as an Action ID and no Toil ID appears in the GOAP plan.
- A Job starts, records `currentJobId`, advances `currentToilId`, and writes expected state only after success.
- A missing dynamic event causes `abort` or `failed` without writing `preparedForDynamicEvent`.
- A valid secret-realm preparation Job marks the event prepared and writes `lastPreparedDynamicEventId`.
- A Reaction interrupt pauses or aborts the current Job according to config and does not leave the NPC permanently busy.
- A long simulation reports actual Job counts, Toil counts, completion counts, failure reasons, and normal-action recovery.

Rejected tests:

- Comparing a saved opaque digest to a previous run.
- Passing because a whole output file is exactly the same as before.
- Passing because a single summary number did not change.
- Disabling monsters, attacks, dynamic goals, or normal NPC behavior to make a single scripted path pass.

## File Structure

Create:

- `apps/game/js/engine/abstract/job.js`  
  Defines `JobDefinition`, `JobInstance`, `JobStatus`, `JobResultStatus`, and job effect application helpers.
- `apps/game/js/engine/abstract/toil.js`  
  Defines `ToilDefinition`, `ToilResultStatus`, and `ToilExecutor`.
- `apps/game/js/engine/abstract/job-system.js`  
  Starts, advances, pauses, resumes, aborts, and completes one active Job for an entity.
- `apps/game/js/engine/pools/job-pool.js`  
  Loads Job configs and creates JobDefinitions.
- `apps/game/js/engine/pools/toil-pool.js`  
  Loads Toil configs and maps Toil type IDs to ToilExecutors.
- `apps/game/js/engine/npc/toils/core-toils.js`  
  Core Toils: resolve target, move, wait days, set state.
- `apps/game/js/engine/npc/toils/dynamic-event-toils.js`  
  Dynamic event Toils: bind event, validate phase, wait phase, mark prepared, mark participant.
- `apps/game/js/engine/npc/toils/economy-toils.js`  
  Economy Toils: check item, ensure item, check currency, buy, exchange, check/equip artifact.
- `apps/game/js/engine/npc/toils/social-toils.js`  
  Social Toils: select companion, request companion.
- `apps/game/js/engine/npc/toils/npc-toils.js`  
  Registers all NPC ToilExecutors into `ToilPool`.
- `apps/game/data/actions/npc-job-actions.json`
- `apps/game/data/actions/npc-action-sets.json`
- `apps/game/data/jobs/npc-dynamic-event-jobs.json`
- `apps/game/data/jobs/npc-economy-jobs.json`
- `apps/game/data/jobs/npc-social-jobs.json`
- `apps/game/data/toils/core-toils.json`
- `apps/game/data/toils/npc-dynamic-event-toils.json`
- `apps/game/data/toils/npc-economy-toils.json`
- `apps/game/data/toils/npc-social-toils.json`
- `apps/game/tools/test-job-pool.mjs`
- `apps/game/tools/test-toil-pool.mjs`
- `apps/game/tools/test-job-system.mjs`
- `apps/game/tools/test-job-action-planning.mjs`
- `apps/game/tools/test-dynamic-event-jobs.mjs`
- `apps/game/tools/test-job-interrupt-resume.mjs`

Modify:

- `apps/game/js/engine/abstract/action.js`
- `apps/game/js/engine/abstract/base-entity.js`
- `apps/game/js/engine/abstract/behavior-system.js`
- `apps/game/js/engine/abstract/bt/reactions.js`
- `apps/game/js/engine/pools/action-pool.js`
- `apps/game/js/core/config-loader.js`
- `apps/game/js/engine/world-engine.js`
- `apps/game/js/engine/npc/npc-entity.js`
- `apps/game/js/engine/npc/npc-actions.js`
- `apps/game/tools/verify-dynamic-goals.mjs`
- `docs/data/data-config-rules.md`
- `docs/architecture/file-structure.md`
- `docs/systems/job-toil-ai-spec.md`

---

### Task 1: Job and Toil Pools

**Files:**
- Create: `apps/game/js/engine/abstract/job.js`
- Create: `apps/game/js/engine/abstract/toil.js`
- Create: `apps/game/js/engine/pools/job-pool.js`
- Create: `apps/game/js/engine/pools/toil-pool.js`
- Create: `apps/game/tools/test-job-pool.mjs`
- Create: `apps/game/tools/test-toil-pool.mjs`

- [ ] **Step 1: Write failing JobPool tests**

Create `apps/game/tools/test-job-pool.mjs` with concrete assertions:

```js
#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { JobPool } = await imp('js/engine/pools/job-pool.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

console.log('1) JobPool loads valid job definitions');
JobPool.clear();
JobPool.loadFromConfig({
  jobs: [{
    id: 'job_npc_prepare_secret_realm',
    name: '秘境准备',
    category: 'dynamic_event',
    successEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
    interrupt: { reaction: 'pause', higherDynamicGoal: 'abort', sameDynamicGoal: 'keep' },
    toils: [
      { id: 'bind_event', type: 'toil_bind_dynamic_event' },
      { id: 'mark_prepared', type: 'toil_mark_dynamic_event_prepared' }
    ]
  }]
});

const def = JobPool.get('job_npc_prepare_secret_realm');
assert(def.id === 'job_npc_prepare_secret_realm', 'JobDefinition keeps id');
assert(def.name === '秘境准备', 'JobDefinition keeps Chinese name');
assert(def.toils.length === 2, 'JobDefinition keeps ordered toils');
assert(def.successEffects.preparedForDynamicEvent.value === true, 'JobDefinition keeps successEffects');

console.log('2) JobPool rejects invalid ids and missing toils');
let rejectedBadId = false;
try {
  JobPool.loadFromConfig({ jobs: [{ id: 'prepare_secret_realm', name: '坏 ID', toils: [{ id: 'x', type: 'toil_wait_days' }] }] });
} catch (err) {
  rejectedBadId = /job_/.test(String(err.message));
}
assert(rejectedBadId, 'JobPool rejects ids without job_ prefix');

let rejectedNoToils = false;
try {
  JobPool.loadFromConfig({ jobs: [{ id: 'job_empty', name: '空流程', toils: [] }] });
} catch (err) {
  rejectedNoToils = /toils/.test(String(err.message));
}
assert(rejectedNoToils, 'JobPool rejects jobs with no toils');

console.log('3) JobPool creates runtime instances with isolated context');
const first = JobPool.create('job_npc_prepare_secret_realm', { eventId: 'evt_a' });
const second = JobPool.create('job_npc_prepare_secret_realm', { eventId: 'evt_b' });
first.context.extra = 'only_first';
assert(first.id !== second.id, 'created JobInstances have distinct instance ids');
assert(first.context.eventId === 'evt_a', 'first instance keeps input eventId');
assert(second.context.eventId === 'evt_b', 'second instance keeps input eventId');
assert(second.context.extra == null, 'instance context is isolated');

if (failed > 0) {
  console.error(`\nJobPool tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJobPool tests passed');
```

- [ ] **Step 2: Run JobPool test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-job-pool.mjs
```

Expected: FAIL because `js/engine/pools/job-pool.js` does not exist.

- [ ] **Step 3: Write failing ToilPool tests**

Create `apps/game/tools/test-toil-pool.mjs`:

```js
#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { ToilExecutor, ToilResultStatus } = await imp('js/engine/abstract/toil.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

class InstantExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'instant_success',
      contextPatch: { ran: toil.id, entityId: entity.id },
    };
  }
}

console.log('1) ToilPool registers configs and executors separately');
ToilPool.clear();
ToilPool.loadFromConfig({
  toils: [{ id: 'toil_wait_days', name: '等待天数', executorId: 'toil_wait_days' }]
});
ToilPool.registerExecutor('toil_wait_days', new InstantExecutor());

const def = ToilPool.getDefinition('toil_wait_days');
const exec = ToilPool.getExecutor('toil_wait_days');
assert(def.id === 'toil_wait_days', 'Toil definition keeps id');
assert(exec instanceof InstantExecutor, 'Executor is registered by executorId');

console.log('2) ToilExecutor returns concrete result');
const result = exec.run({ id: 'npc_1' }, {}, { context: {} }, { id: 'wait', type: 'toil_wait_days' });
assert(result.status === ToilResultStatus.SUCCESS, 'Executor returns success status');
assert(result.contextPatch.entityId === 'npc_1', 'Executor can report concrete contextPatch');

console.log('3) ToilPool rejects invalid ids and missing executors');
let rejectedBadId = false;
try {
  ToilPool.loadFromConfig({ toils: [{ id: 'wait_days', name: '坏 ID' }] });
} catch (err) {
  rejectedBadId = /toil_/.test(String(err.message));
}
assert(rejectedBadId, 'ToilPool rejects ids without toil_ prefix');

assert(ToilPool.getExecutor('toil_missing') === null, 'Missing executor returns null');

if (failed > 0) {
  console.error(`\nToilPool tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nToilPool tests passed');
```

- [ ] **Step 4: Run ToilPool test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-toil-pool.mjs
```

Expected: FAIL because `js/engine/abstract/toil.js` and `js/engine/pools/toil-pool.js` do not exist.

- [ ] **Step 5: Implement `job.js` and `job-pool.js`**

Implement these APIs exactly:

```js
// apps/game/js/engine/abstract/job.js
export const JobStatus = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted',
});

export const JobResultStatus = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  REPLAN: 'replan',
  ABORT: 'abort',
});

let nextJobInstanceSeq = 1;

export class JobDefinition {
  constructor(config) {
    if (!config?.id || !config.id.startsWith('job_')) {
      throw new Error(`Job id must start with job_: ${config?.id}`);
    }
    if (!Array.isArray(config.toils) || config.toils.length === 0) {
      throw new Error(`Job ${config.id} must define non-empty toils`);
    }
    this.id = config.id;
    this.name = config.name || config.id;
    this.category = config.category || 'general';
    this.input = config.input || {};
    this.successEffects = config.successEffects || {};
    this.interrupt = config.interrupt || {};
    this.toils = config.toils.map((toil, index) => {
      if (!toil?.id) throw new Error(`Job ${config.id} toil at index ${index} missing id`);
      if (!toil?.type || !toil.type.startsWith('toil_')) {
        throw new Error(`Job ${config.id} toil ${toil.id} type must start with toil_`);
      }
      return { params: {}, ...toil };
    });
  }
}

export class JobInstance {
  constructor(definition, input = {}) {
    this.id = `${definition.id}#${nextJobInstanceSeq++}`;
    this.definition = definition;
    this.definitionId = definition.id;
    this.name = definition.name;
    this.status = JobStatus.RUNNING;
    this.currentToilIndex = 0;
    this.context = { ...(definition.input || {}), ...(input || {}) };
    this.lastResult = null;
  }

  get currentToil() {
    return this.definition.toils[this.currentToilIndex] || null;
  }
}
```

```js
// apps/game/js/engine/pools/job-pool.js
import { JobDefinition, JobInstance } from '../abstract/job.js';

class JobPoolClass {
  constructor() {
    this._definitions = new Map();
  }

  loadFromConfig(config) {
    const jobs = Array.isArray(config) ? config : (config?.jobs || []);
    for (const job of jobs) this.register(job);
  }

  register(config) {
    const def = new JobDefinition(config);
    if (this._definitions.has(def.id)) {
      throw new Error(`Duplicate job definition: ${def.id}`);
    }
    this._definitions.set(def.id, def);
  }

  get(id) {
    return this._definitions.get(id) || null;
  }

  has(id) {
    return this._definitions.has(id);
  }

  create(id, input = {}) {
    const def = this.get(id);
    if (!def) throw new Error(`Job definition not found: ${id}`);
    return new JobInstance(def, input);
  }

  clear() {
    this._definitions.clear();
  }
}

export const JobPool = new JobPoolClass();
```

- [ ] **Step 6: Implement `toil.js` and `toil-pool.js`**

Implement these APIs exactly:

```js
// apps/game/js/engine/abstract/toil.js
export const ToilResultStatus = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  REPLAN: 'replan',
  ABORT: 'abort',
});

export class ToilDefinition {
  constructor(config) {
    if (!config?.id || !config.id.startsWith('toil_')) {
      throw new Error(`Toil id must start with toil_: ${config?.id}`);
    }
    this.id = config.id;
    this.name = config.name || config.id;
    this.executorId = config.executorId || config.id;
    this.category = config.category || 'general';
  }
}

export class ToilExecutor {
  run(_entity, _worldContext, _job, _toil) {
    throw new Error('ToilExecutor.run() must be overridden');
  }
}
```

```js
// apps/game/js/engine/pools/toil-pool.js
import { ToilDefinition, ToilExecutor } from '../abstract/toil.js';

class ToilPoolClass {
  constructor() {
    this._definitions = new Map();
    this._executors = new Map();
  }

  loadFromConfig(config) {
    const toils = Array.isArray(config) ? config : (config?.toils || []);
    for (const toil of toils) this.registerDefinition(toil);
  }

  registerDefinition(config) {
    const def = new ToilDefinition(config);
    if (this._definitions.has(def.id)) {
      throw new Error(`Duplicate toil definition: ${def.id}`);
    }
    this._definitions.set(def.id, def);
  }

  registerExecutor(id, executor) {
    if (!(executor instanceof ToilExecutor)) {
      throw new Error(`Toil executor must extend ToilExecutor: ${id}`);
    }
    this._executors.set(id, executor);
  }

  getDefinition(id) {
    return this._definitions.get(id) || null;
  }

  getExecutor(id) {
    const def = this.getDefinition(id);
    const executorId = def?.executorId || id;
    return this._executors.get(executorId) || null;
  }

  clear() {
    this._definitions.clear();
    this._executors.clear();
  }
}

export const ToilPool = new ToilPoolClass();
```

- [ ] **Step 7: Run pool tests**

Run:

```powershell
cd apps/game
node tools/test-job-pool.mjs
node tools/test-toil-pool.mjs
```

Expected: both scripts print `tests passed`.

- [ ] **Step 8: Commit Task 1**

Commit only this task’s files:

```powershell
git add apps/game/js/engine/abstract/job.js apps/game/js/engine/abstract/toil.js apps/game/js/engine/pools/job-pool.js apps/game/js/engine/pools/toil-pool.js apps/game/tools/test-job-pool.mjs apps/game/tools/test-toil-pool.mjs
git commit -m "feat: add job and toil pools"
```

---

### Task 2: JobSystem Runtime

**Files:**
- Create: `apps/game/js/engine/abstract/job-system.js`
- Create: `apps/game/tools/test-job-system.mjs`
- Modify: `apps/game/js/engine/abstract/job.js`

- [ ] **Step 1: Write failing JobSystem test**

Create `apps/game/tools/test-job-system.mjs`:

```js
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
  run(entity, worldContext, job, toil) {
    return {
      status: ToilResultStatus.SUCCESS,
      reason: `ran_${toil.id}`,
      contextPatch: { [toil.params.key]: toil.params.value },
      effects: toil.params.effectKey ? { [toil.params.effectKey]: { op: 'set', value: toil.params.effectValue } } : {},
    };
  }
}

class RunningThenSuccessExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    const key = `${toil.id}Count`;
    job.context[key] = (job.context[key] || 0) + 1;
    if (job.context[key] < 2) {
      return { status: ToilResultStatus.RUNNING, remaining: 1, reason: 'needs_more_time' };
    }
    return { status: ToilResultStatus.SUCCESS, reason: 'finished_after_second_tick' };
  }
}

JobPool.clear();
ToilPool.clear();
ToilPool.loadFromConfig({ toils: [
  { id: 'toil_patch_context', name: '写上下文' },
  { id: 'toil_running_once', name: '运行一次' }
] });
ToilPool.registerExecutor('toil_patch_context', new PatchExecutor());
ToilPool.registerExecutor('toil_running_once', new RunningThenSuccessExecutor());
JobPool.loadFromConfig({ jobs: [{
  id: 'job_test_runtime',
  name: '运行时测试',
  successEffects: { jobDone: { op: 'set', value: true } },
  toils: [
    { id: 'first', type: 'toil_patch_context', params: { key: 'firstDone', value: true } },
    { id: 'second', type: 'toil_running_once' },
    { id: 'third', type: 'toil_patch_context', params: { key: 'thirdDone', value: true, effectKey: 'thirdEffect', effectValue: 7 } }
  ]
}] });

const entity = { id: 'npc_job_test', state: new TestState({ jobDone: false, thirdEffect: 0 }) };
const system = new JobSystem();

console.log('1) JobSystem starts and exposes runtime state');
const started = system.start('job_test_runtime', { eventId: 'evt_job' });
assert(started.definitionId === 'job_test_runtime', 'start returns JobInstance');
assert(system.hasJob() === true, 'system has active job');
assert(system.snapshot().currentJobId === 'job_test_runtime', 'snapshot exposes currentJobId');
assert(system.snapshot().currentToilId === 'first', 'snapshot exposes currentToilId');

console.log('2) JobSystem advances toils without writing success effects too early');
let result = system.executeStep(entity, {});
assert(result.status === 'running', 'first toil success keeps job running because more toils remain');
assert(system.currentJob.context.firstDone === true, 'contextPatch is merged into job context');
assert(entity.state.get('jobDone') === false, 'successEffects are not applied before job completion');

console.log('3) running toil holds current index until success');
result = system.executeStep(entity, {});
assert(result.status === 'running', 'running toil returns running');
assert(system.snapshot().currentToilId === 'second', 'second toil remains current while running');
result = system.executeStep(entity, {});
assert(result.status === 'running', 'second toil success advances to third while job remains running');
assert(system.snapshot().currentToilId === 'third', 'third toil becomes current');

console.log('4) final toil completes job and writes effects');
result = system.executeStep(entity, {});
assert(result.status === 'success', 'final toil completes job');
assert(system.hasJob() === false, 'job is cleared after success');
assert(entity.state.get('jobDone') === true, 'job successEffects are applied');
assert(entity.state.get('thirdEffect') === 7, 'toil effects are applied');

console.log('5) pause and resume preserve current job');
system.start('job_test_runtime', { eventId: 'evt_pause' });
system.pause('reaction_attacked');
assert(system.snapshot().jobStatus === JobStatus.PAUSED, 'pause sets jobStatus paused');
system.resume('reaction_done');
assert(system.snapshot().jobStatus === JobStatus.RUNNING, 'resume sets jobStatus running');
system.abort('manual_abort');
assert(system.hasJob() === false, 'abort clears current job');

if (failed > 0) {
  console.error(`\nJobSystem tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJobSystem tests passed');
```

- [ ] **Step 2: Run JobSystem test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-job-system.mjs
```

Expected: FAIL because `job-system.js` does not exist.

- [ ] **Step 3: Implement JobSystem**

Implement `JobSystem` with these public methods:

```js
constructor()
start(jobId, input = {})
executeStep(entity, worldContext)
pause(reason)
resume(reason)
abort(reason)
complete(entity)
fail(reason)
hasJob()
snapshot()
```

Required behavior:

- `start()` uses `JobPool.create(jobId, input)`.
- `executeStep()` reads `currentJob.currentToil`.
- `executeStep()` gets the executor from `ToilPool.getExecutor(toil.type)`.
- Missing executor returns `{ status: 'failed', reason: 'missing_toil_executor' }` and clears the job.
- `contextPatch` is shallow-merged into `job.context`.
- Toil `effects` apply immediately to `entity.state`.
- Job `successEffects` apply only when all Toils finish.
- Supported effect ops are `set`, `add`, `min`, and `max`.
- `snapshot()` returns `currentJobId`, `currentJobInstanceId`, `currentToilId`, `currentToilIndex`, `jobStatus`, `jobRemaining`, and a shallow copy of `jobContext`.

- [ ] **Step 4: Run JobSystem test**

Run:

```powershell
cd apps/game
node tools/test-job-system.mjs
```

Expected: `JobSystem tests passed`.

- [ ] **Step 5: Commit Task 2**

```powershell
git add apps/game/js/engine/abstract/job-system.js apps/game/js/engine/abstract/job.js apps/game/tools/test-job-system.mjs
git commit -m "feat: add job runtime system"
```

---

### Task 3: Core and Dynamic Event Toils

**Files:**
- Create: `apps/game/js/engine/npc/toils/core-toils.js`
- Create: `apps/game/js/engine/npc/toils/dynamic-event-toils.js`
- Create: `apps/game/js/engine/npc/toils/npc-toils.js`
- Create: `apps/game/tools/test-dynamic-event-jobs.mjs`
- Modify: `apps/game/js/engine/npc/npc-actions.js`

- [ ] **Step 1: Write failing dynamic event Job test**

Create `apps/game/tools/test-dynamic-event-jobs.mjs` with these concrete cases:

```js
#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { JobSystem } = await imp('js/engine/abstract/job-system.js');
const { registerNPCToilExecutors } = await imp('js/engine/npc/toils/npc-toils.js');

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

function makeEntity(eventId) {
  return {
    id: 'npc_dynamic_job',
    state: new TestState({
      targetDynamicEventId: eventId,
      preparedForDynamicEvent: false,
      joinedDynamicEvent: false,
    }),
    spatial: { tileX: 1, tileY: 2, setDestination(x, y) { this.destination = { x, y }; } },
    hasSpatial: () => true,
  };
}

const event = {
  id: 'evt_secret',
  name: '青冥秘境',
  type: 'secret_realm',
  phase: 'announced',
  pos: { x: 12, y: 18 },
};
const prepared = [];
const participants = [];
const worldContext = {
  currentDay: 10,
  dynamicEventById: (id) => (id === event.id ? event : null),
  markDynamicEventPrepared: (eventId, npcId) => {
    prepared.push({ eventId, npcId });
    return true;
  },
  markDynamicEventParticipant: (eventId, npcId) => {
    participants.push({ eventId, npcId });
    return true;
  },
  resolveTarget: () => ({ x: 12, y: 18 }),
};

ToilPool.clear();
JobPool.clear();
registerNPCToilExecutors();
JobPool.loadFromConfig({ jobs: [{
  id: 'job_npc_prepare_dynamic_event',
  name: '筹备动态事件',
  successEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
  toils: [
    { id: 'bind_event', type: 'toil_bind_dynamic_event' },
    { id: 'validate_announced', type: 'toil_validate_dynamic_event_phase', params: { phases: ['announced'] } },
    { id: 'mark_prepared', type: 'toil_mark_dynamic_event_prepared' }
  ]
}, {
  id: 'job_npc_join_dynamic_event',
  name: '参与动态事件',
  successEffects: { joinedDynamicEvent: { op: 'set', value: true } },
  toils: [
    { id: 'bind_event', type: 'toil_bind_dynamic_event' },
    { id: 'move_to_event', type: 'toil_move_to_target', params: { targetResolver: 'dynamic_event_target' } },
    { id: 'wait_active', type: 'toil_wait_until_event_phase', params: { phases: ['active'] } },
    { id: 'mark_joined', type: 'toil_mark_dynamic_event_participant' }
  ]
}] });

console.log('1) prepare dynamic event job writes prepared only for valid event');
{
  const entity = makeEntity(event.id);
  const jobs = new JobSystem();
  jobs.start('job_npc_prepare_dynamic_event');
  let result = jobs.executeStep(entity, worldContext);
  assert(result.status === 'running', 'bind event advances job');
  result = jobs.executeStep(entity, worldContext);
  assert(result.status === 'running', 'phase validation advances job');
  result = jobs.executeStep(entity, worldContext);
  assert(result.status === 'success', 'mark prepared completes job');
  assert(prepared.some(p => p.eventId === event.id && p.npcId === entity.id), 'worldContext recorded prepared NPC');
  assert(entity.state.get('preparedForDynamicEvent') === true, 'successEffects write preparedForDynamicEvent');
  assert(entity.state.get('lastPreparedDynamicEventId') === event.id, 'toil writes lastPreparedDynamicEventId');
}

console.log('2) missing event aborts without prepared state');
{
  const entity = makeEntity('evt_missing');
  const jobs = new JobSystem();
  jobs.start('job_npc_prepare_dynamic_event');
  const result = jobs.executeStep(entity, worldContext);
  assert(result.status === 'abort', 'missing event aborts job');
  assert(entity.state.get('preparedForDynamicEvent') === false, 'missing event does not write preparedForDynamicEvent');
}

console.log('3) join dynamic event waits until active then marks participant');
{
  const entity = makeEntity(event.id);
  const jobs = new JobSystem();
  jobs.start('job_npc_join_dynamic_event');
  jobs.executeStep(entity, worldContext);
  jobs.executeStep(entity, worldContext);
  let result = jobs.executeStep(entity, worldContext);
  assert(result.status === 'running', 'announced event keeps wait toil running');
  event.phase = 'active';
  result = jobs.executeStep(entity, worldContext);
  assert(result.status === 'running', 'active event advances past wait');
  result = jobs.executeStep(entity, worldContext);
  assert(result.status === 'success', 'participant mark completes job');
  assert(participants.some(p => p.eventId === event.id && p.npcId === entity.id), 'worldContext recorded participant');
  assert(entity.state.get('joinedDynamicEvent') === true, 'successEffects write joinedDynamicEvent');
}

if (failed > 0) {
  console.error(`\nDynamic event job tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nDynamic event job tests passed');
```

- [ ] **Step 2: Run dynamic event Job test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-dynamic-event-jobs.mjs
```

Expected: FAIL because `npc/toils/npc-toils.js` does not exist.

- [ ] **Step 3: Implement core Toils**

Implement these executor classes in `core-toils.js`:

```js
NPCResolveTargetToilExecutor
NPCMoveToTargetToilExecutor
NPCWaitDaysToilExecutor
NPCSetStateToilExecutor
```

Required behavior:

- `toil_resolve_target` calls `worldContext.resolveTarget(entity, params.targetResolver || job.context.targetResolver || 'self')` and writes `job.context.target`.
- `toil_move_to_target` sets destination when entity is not at target and returns `running`; if already arrived or no spatial component, returns `success`.
- `toil_wait_days` stores remaining days in `job.context.waits[toil.id]`; returns `running` until the counter reaches zero.
- `toil_set_state` writes `params.key` and `params.value` to entity state and returns `success`.

- [ ] **Step 4: Implement dynamic event Toils**

Implement these executor classes in `dynamic-event-toils.js`:

```js
NPCBindDynamicEventToilExecutor
NPCValidateDynamicEventPhaseToilExecutor
NPCWaitUntilEventPhaseToilExecutor
NPCMarkDynamicEventPreparedToilExecutor
NPCMarkDynamicEventParticipantToilExecutor
```

Required behavior:

- `toil_bind_dynamic_event` reads `job.context.eventId` first, then `entity.state.get('targetDynamicEventId')`.
- If event cannot be resolved by `worldContext.dynamicEventById(eventId)`, return `{ status: 'abort', reason: 'dynamic_event_missing' }`.
- Binding writes `job.context.dynamicEventId`, `dynamicEventName`, `dynamicEventType`, and `dynamicEventPhase`.
- `toil_validate_dynamic_event_phase` returns `abort` when the event phase is not in `params.phases`.
- `toil_wait_until_event_phase` returns `running` while the phase is not in `params.phases`.
- `toil_mark_dynamic_event_prepared` calls `worldContext.markDynamicEventPrepared(eventId, entity.id)` and writes `lastPreparedDynamicEventId` only on success.
- `toil_mark_dynamic_event_participant` calls `worldContext.markDynamicEventParticipant(eventId, entity.id)` and writes `lastJoinedDynamicEventId` only on success.

- [ ] **Step 5: Register NPC Toils**

Implement `registerNPCToilExecutors()` in `npc-toils.js`:

```js
import { ToilPool } from '../../pools/toil-pool.js';
import {
  NPCResolveTargetToilExecutor,
  NPCMoveToTargetToilExecutor,
  NPCWaitDaysToilExecutor,
  NPCSetStateToilExecutor,
} from './core-toils.js';
import {
  NPCBindDynamicEventToilExecutor,
  NPCValidateDynamicEventPhaseToilExecutor,
  NPCWaitUntilEventPhaseToilExecutor,
  NPCMarkDynamicEventPreparedToilExecutor,
  NPCMarkDynamicEventParticipantToilExecutor,
} from './dynamic-event-toils.js';

export function registerNPCToilExecutors() {
  ToilPool.registerExecutor('toil_resolve_target', new NPCResolveTargetToilExecutor());
  ToilPool.registerExecutor('toil_move_to_target', new NPCMoveToTargetToilExecutor());
  ToilPool.registerExecutor('toil_wait_days', new NPCWaitDaysToilExecutor());
  ToilPool.registerExecutor('toil_set_state', new NPCSetStateToilExecutor());
  ToilPool.registerExecutor('toil_bind_dynamic_event', new NPCBindDynamicEventToilExecutor());
  ToilPool.registerExecutor('toil_validate_dynamic_event_phase', new NPCValidateDynamicEventPhaseToilExecutor());
  ToilPool.registerExecutor('toil_wait_until_event_phase', new NPCWaitUntilEventPhaseToilExecutor());
  ToilPool.registerExecutor('toil_mark_dynamic_event_prepared', new NPCMarkDynamicEventPreparedToilExecutor());
  ToilPool.registerExecutor('toil_mark_dynamic_event_participant', new NPCMarkDynamicEventParticipantToilExecutor());
}
```

Also export this function from `apps/game/js/engine/npc/npc-actions.js` so `world-engine.js` can import it from the existing NPC registration facade.

- [ ] **Step 6: Run dynamic event Job test**

Run:

```powershell
cd apps/game
node tools/test-dynamic-event-jobs.mjs
```

Expected: `Dynamic event job tests passed`.

- [ ] **Step 7: Commit Task 3**

```powershell
git add apps/game/js/engine/npc/toils apps/game/js/engine/npc/npc-actions.js apps/game/tools/test-dynamic-event-jobs.mjs
git commit -m "feat: add core and dynamic event toils"
```

---

### Task 4: Economy and Social Toils

**Files:**
- Create: `apps/game/js/engine/npc/toils/economy-toils.js`
- Create: `apps/game/js/engine/npc/toils/social-toils.js`
- Modify: `apps/game/js/engine/npc/toils/npc-toils.js`
- Create: `apps/game/tools/test-economy-toils.mjs`

- [ ] **Step 1: Write failing economy Toils test**

Create `apps/game/tools/test-economy-toils.mjs`:

```js
#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { JobSystem } = await imp('js/engine/abstract/job-system.js');
const { Inventory } = await imp('js/engine/abstract/inventory.js');
const { registerNPCToilExecutors } = await imp('js/engine/npc/toils/npc-toils.js');

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

function makeEntity() {
  const inventory = new Inventory();
  inventory.add('low_spirit_stone', 100);
  return {
    id: 'npc_economy_toil',
    inventory,
    state: new TestState({ equippedArtifactId: null, contribution: 50 }),
  };
}

ToilPool.clear();
JobPool.clear();
registerNPCToilExecutors();
JobPool.loadFromConfig({ jobs: [{
  id: 'job_npc_acquire_heal_item',
  name: '获取回血丹',
  successEffects: { hasHealItem: { op: 'set', value: true } },
  toils: [
    { id: 'ensure_heal', type: 'toil_ensure_item', params: { itemId: 'item_heal_pill', minAmount: 1, priceItemId: 'low_spirit_stone', priceAmount: 10 } }
  ]
}, {
  id: 'job_npc_acquire_artifact',
  name: '获取法器',
  successEffects: { hasEquippedArtifact: { op: 'set', value: true } },
  toils: [
    { id: 'ensure_artifact', type: 'toil_ensure_artifact', params: { itemId: 'item_artifact_low', minGrade: 1, priceItemId: 'low_spirit_stone', priceAmount: 30 } },
    { id: 'equip_artifact', type: 'toil_equip_artifact', params: { itemId: 'item_artifact_low' } }
  ]
}] });

console.log('1) ensure item buys missing heal pill with spirit stones');
{
  const entity = makeEntity();
  const jobs = new JobSystem();
  jobs.start('job_npc_acquire_heal_item');
  const result = jobs.executeStep(entity, {});
  assert(result.status === 'success', 'single ensure item toil completes job');
  assert(entity.inventory.getAmount('item_heal_pill') === 1, 'heal pill added to inventory');
  assert(entity.inventory.getAmount('low_spirit_stone') === 90, 'price removed from inventory');
  assert(entity.state.get('hasHealItem') === true, 'job successEffects write hasHealItem');
}

console.log('2) ensure item does not buy when already present');
{
  const entity = makeEntity();
  entity.inventory.add('item_heal_pill', 2);
  const jobs = new JobSystem();
  jobs.start('job_npc_acquire_heal_item');
  const result = jobs.executeStep(entity, {});
  assert(result.status === 'success', 'already-held item completes job');
  assert(entity.inventory.getAmount('item_heal_pill') === 2, 'existing item count unchanged');
  assert(entity.inventory.getAmount('low_spirit_stone') === 100, 'no currency spent when item exists');
}

console.log('3) acquire and equip artifact');
{
  const entity = makeEntity();
  const jobs = new JobSystem();
  jobs.start('job_npc_acquire_artifact');
  let result = jobs.executeStep(entity, {});
  assert(result.status === 'running', 'artifact acquisition advances to equip step');
  result = jobs.executeStep(entity, {});
  assert(result.status === 'success', 'equip artifact completes job');
  assert(entity.inventory.getAmount('item_artifact_low') === 1, 'artifact exists in inventory');
  assert(entity.state.get('equippedArtifactId') === 'item_artifact_low', 'artifact equipped');
  assert(entity.state.get('hasEquippedArtifact') === true, 'successEffects write hasEquippedArtifact');
}

if (failed > 0) {
  console.error(`\nEconomy toil tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nEconomy toil tests passed');
```

- [ ] **Step 2: Run economy Toils test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-economy-toils.mjs
```

Expected: FAIL because economy Toil executors are not registered.

- [ ] **Step 3: Implement economy Toils**

Implement these classes in `economy-toils.js`:

```js
NPCCheckInventoryItemToilExecutor
NPCEnsureItemToilExecutor
NPCCheckCurrencyToilExecutor
NPCBuyItemToilExecutor
NPCExchangeFactionItemToilExecutor
NPCEnsureArtifactToilExecutor
NPCCheckEquippedArtifactToilExecutor
NPCEquipArtifactToilExecutor
```

Required behavior for the first implementation:

- `toil_ensure_item` checks `entity.inventory.getAmount(params.itemId)`.
- If enough item exists, return `success` without spending currency.
- If missing and `params.priceItemId` / `params.priceAmount` are present, spend currency and add item.
- If currency is insufficient, return `{ status: 'failed', reason: 'insufficient_currency' }`.
- `toil_ensure_artifact` works like `toil_ensure_item` but defaults `itemId` to `item_artifact_low`.
- `toil_equip_artifact` writes `equippedArtifactId`.
- `toil_exchange_faction_item` may initially share the same inventory behavior as buy, but must return reason `faction_exchange_completed` on success.

- [ ] **Step 4: Implement social Toils**

Implement these classes in `social-toils.js`:

```js
NPCSelectCompanionToilExecutor
NPCRequestCompanionToilExecutor
```

Required behavior:

- `toil_select_companion` reads alive NPCs from `worldContext.entityRegistry.getByType('npc')`.
- It chooses the first alive NPC that is not the entity and optionally matches `params.factionId`.
- It writes `job.context.companionId`.
- If none exists, return `blocked` with reason `companion_not_found`.
- `toil_request_companion` writes `entity.state.set('lastCompanionId', companionId)` and returns `success` if `job.context.companionId` exists.

- [ ] **Step 5: Register economy and social Toils**

Add registrations in `npc-toils.js`:

```js
ToilPool.registerExecutor('toil_check_inventory_item', new NPCCheckInventoryItemToilExecutor());
ToilPool.registerExecutor('toil_ensure_item', new NPCEnsureItemToilExecutor());
ToilPool.registerExecutor('toil_check_currency', new NPCCheckCurrencyToilExecutor());
ToilPool.registerExecutor('toil_buy_item', new NPCBuyItemToilExecutor());
ToilPool.registerExecutor('toil_exchange_faction_item', new NPCExchangeFactionItemToilExecutor());
ToilPool.registerExecutor('toil_ensure_artifact', new NPCEnsureArtifactToilExecutor());
ToilPool.registerExecutor('toil_check_equipped_artifact', new NPCCheckEquippedArtifactToilExecutor());
ToilPool.registerExecutor('toil_equip_artifact', new NPCEquipArtifactToilExecutor());
ToilPool.registerExecutor('toil_select_companion', new NPCSelectCompanionToilExecutor());
ToilPool.registerExecutor('toil_request_companion', new NPCRequestCompanionToilExecutor());
```

- [ ] **Step 6: Run economy Toils test**

Run:

```powershell
cd apps/game
node tools/test-economy-toils.mjs
```

Expected: `Economy toil tests passed`.

- [ ] **Step 7: Commit Task 4**

```powershell
git add apps/game/js/engine/npc/toils/economy-toils.js apps/game/js/engine/npc/toils/social-toils.js apps/game/js/engine/npc/toils/npc-toils.js apps/game/tools/test-economy-toils.mjs
git commit -m "feat: add economy and social toils"
```

---

### Task 5: Data Config Split and Loading

**Files:**
- Create: `apps/game/data/actions/npc-job-actions.json`
- Create: `apps/game/data/actions/npc-action-sets.json`
- Create: `apps/game/data/jobs/npc-dynamic-event-jobs.json`
- Create: `apps/game/data/jobs/npc-economy-jobs.json`
- Create: `apps/game/data/jobs/npc-social-jobs.json`
- Create: `apps/game/data/toils/core-toils.json`
- Create: `apps/game/data/toils/npc-dynamic-event-toils.json`
- Create: `apps/game/data/toils/npc-economy-toils.json`
- Create: `apps/game/data/toils/npc-social-toils.json`
- Create: `apps/game/tools/test-job-config-load.mjs`
- Modify: `apps/game/js/core/config-loader.js`
- Modify: `apps/game/js/engine/world-engine.js`
- Modify: `apps/game/js/engine/npc/npc-entity.js`
- Modify: `apps/game/data/config/ai-config.json`
- Modify: `docs/data/data-config-rules.md`
- Modify: `docs/architecture/file-structure.md`

- [ ] **Step 1: Write failing config loading test**

Create `apps/game/tools/test-job-config-load.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

const npcJobActions = load('data/actions/npc-job-actions.json');
const actionSets = load('data/actions/npc-action-sets.json');
const dynamicJobs = load('data/jobs/npc-dynamic-event-jobs.json');
const economyJobs = load('data/jobs/npc-economy-jobs.json');
const socialJobs = load('data/jobs/npc-social-jobs.json');
const coreToils = load('data/toils/core-toils.json');
const dynamicToils = load('data/toils/npc-dynamic-event-toils.json');
const economyToils = load('data/toils/npc-economy-toils.json');
const socialToils = load('data/toils/npc-social-toils.json');
const aiConfig = load('data/config/ai-config.json');

console.log('1) job action config contains only JobActions');
for (const action of npcJobActions) {
  assert(action.id.startsWith('act_'), `${action.id} uses act_ prefix`);
  assert(action.executionKind === 'job', `${action.id} declares executionKind=job`);
  assert(action.jobId && action.jobId.startsWith('job_'), `${action.id} references job_ id`);
  assert(Object.keys(action.effects || {}).length === 0, `${action.id} has empty runtime effects`);
}

console.log('2) action set config includes defaults and job defaults separately');
assert(Array.isArray(actionSets.defaultNpcActionIds), 'defaultNpcActionIds is an array');
assert(Array.isArray(actionSets.defaultNpcJobActionIds), 'defaultNpcJobActionIds is an array');
assert(actionSets.defaultNpcJobActionIds.includes('act_npc_prepare_dynamic_event'), 'job action set includes prepare dynamic event');

console.log('3) job definitions reference registered toil ids');
const toilIds = new Set([
  ...coreToils.toils.map(t => t.id),
  ...dynamicToils.toils.map(t => t.id),
  ...economyToils.toils.map(t => t.id),
  ...socialToils.toils.map(t => t.id),
]);
const jobs = [...dynamicJobs.jobs, ...economyJobs.jobs, ...socialJobs.jobs];
for (const job of jobs) {
  assert(job.id.startsWith('job_'), `${job.id} uses job_ prefix`);
  assert(job.toils.length > 0, `${job.id} has non-empty toils`);
  for (const toil of job.toils) {
    assert(toilIds.has(toil.type), `${job.id}.${toil.id} references known toil type ${toil.type}`);
  }
}

console.log('4) jobs config defaults to disabled in ai-config');
assert(aiConfig.npc.jobs.enabled === false, 'npc.jobs.enabled defaults false');
assert(aiConfig.npc.jobs.maxActiveJobsPerNpc === 1, 'maxActiveJobsPerNpc is 1');

if (failed > 0) {
  console.error(`\nJob config load tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJob config load tests passed');
```

- [ ] **Step 2: Run config test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-job-config-load.mjs
```

Expected: FAIL because the new JSON files do not exist.

- [ ] **Step 3: Add JobAction config**

Create `apps/game/data/actions/npc-job-actions.json` with these actions:

```json
[
  {
    "id": "act_npc_prepare_dynamic_event",
    "name": "筹备动态事件",
    "description": "JobAction：由 GOAP 规划，Execution 启动 job_npc_prepare_dynamic_event。",
    "category": "npc_job",
    "executionKind": "job",
    "jobId": "job_npc_prepare_dynamic_event",
    "weight": 1,
    "valueScore": 8,
    "riskKey": null,
    "preconditions": { "alive": { "op": "true" } },
    "effects": {},
    "plannerEffects": { "preparedForDynamicEvent": { "op": "set", "value": true } }
  },
  {
    "id": "act_npc_join_dynamic_event",
    "name": "参与动态事件",
    "description": "JobAction：由 GOAP 规划，Execution 启动 job_npc_join_dynamic_event。",
    "category": "npc_job",
    "executionKind": "job",
    "jobId": "job_npc_join_dynamic_event",
    "weight": 3,
    "valueScore": 14,
    "riskKey": "plunder",
    "preconditions": { "alive": { "op": "true" } },
    "effects": {},
    "plannerEffects": { "joinedDynamicEvent": { "op": "set", "value": true } }
  },
  {
    "id": "act_npc_prepare_secret_realm",
    "name": "准备秘境",
    "category": "npc_job",
    "executionKind": "job",
    "jobId": "job_npc_prepare_secret_realm",
    "weight": 4,
    "valueScore": 14,
    "riskKey": "plunder",
    "preconditions": { "alive": { "op": "true" } },
    "effects": {},
    "plannerEffects": { "preparedForDynamicEvent": { "op": "set", "value": true } }
  },
  {
    "id": "act_npc_prepare_sect_tournament",
    "name": "筹备宗门大比",
    "category": "npc_job",
    "executionKind": "job",
    "jobId": "job_npc_prepare_sect_tournament",
    "weight": 3,
    "valueScore": 10,
    "riskKey": "pvp",
    "preconditions": { "alive": { "op": "true" } },
    "effects": {},
    "plannerEffects": { "preparedForDynamicEvent": { "op": "set", "value": true } }
  },
  {
    "id": "act_npc_acquire_heal_item",
    "name": "获取疗伤物资",
    "category": "npc_job",
    "executionKind": "job",
    "jobId": "job_npc_acquire_heal_item",
    "weight": 2,
    "valueScore": 8,
    "riskKey": null,
    "preconditions": { "alive": { "op": "true" } },
    "effects": {},
    "plannerEffects": { "hasHealItem": { "op": "set", "value": true } }
  },
  {
    "id": "act_npc_acquire_artifact",
    "name": "获取法器",
    "category": "npc_job",
    "executionKind": "job",
    "jobId": "job_npc_acquire_artifact",
    "weight": 3,
    "valueScore": 10,
    "riskKey": null,
    "preconditions": { "alive": { "op": "true" } },
    "effects": {},
    "plannerEffects": { "hasEquippedArtifact": { "op": "set", "value": true } }
  }
]
```

- [ ] **Step 4: Add action sets config**

Create `apps/game/data/actions/npc-action-sets.json`.

Move the current default list from `NPCEntity._initActions()` into `defaultNpcActionIds`. Add:

```json
{
  "_description": "NPC 默认行为集。defaultNpcActionIds 是 SimpleAction；defaultNpcJobActionIds 只在 ai-config.npc.jobs.enabled=true 时加入。",
  "defaultNpcActionIds": [
    "act_npc_cultivate",
    "act_npc_train_chamber",
    "act_npc_serve_faction",
    "act_npc_heal",
    "act_npc_seek_elixir",
    "act_npc_challenge",
    "act_npc_assist_faction",
    "act_npc_explore",
    "act_npc_accept_hunt_quest",
    "act_npc_accept_quest",
    "act_npc_do_quest",
    "act_npc_turn_in_quest",
    "act_npc_donate_materials",
    "act_npc_redeem_qi_pill",
    "act_npc_use_qi_pill",
    "act_npc_redeem_breakthrough_pill",
    "act_npc_use_breakthrough_pill",
    "act_npc_redeem_artifact",
    "act_npc_raid_treasure",
    "act_npc_seclude",
    "act_npc_take_disciple",
    "act_npc_seize_power",
    "act_npc_goto_opportunity",
    "act_npc_hunt_enemy",
    "act_npc_kill_enemy",
    "act_npc_assist_ally",
    "act_npc_visit_benefactor",
    "act_npc_teach_disciple",
    "act_npc_protect_disciple",
    "act_npc_visit_master",
    "act_npc_react_flee",
    "act_npc_react_retreat",
    "act_npc_react_heal",
    "act_npc_react_counter"
  ],
  "defaultNpcJobActionIds": [
    "act_npc_prepare_dynamic_event",
    "act_npc_join_dynamic_event",
    "act_npc_prepare_secret_realm",
    "act_npc_prepare_sect_tournament",
    "act_npc_acquire_heal_item",
    "act_npc_acquire_artifact"
  ]
}
```

- [ ] **Step 5: Add Toil config files**

Create `apps/game/data/toils/core-toils.json`:

```json
{
  "toils": [
    { "id": "toil_resolve_target", "name": "解析目标地点" },
    { "id": "toil_move_to_target", "name": "移动到目标地点" },
    { "id": "toil_wait_days", "name": "等待天数" },
    { "id": "toil_set_state", "name": "写入状态" }
  ]
}
```

Create `apps/game/data/toils/npc-dynamic-event-toils.json`:

```json
{
  "toils": [
    { "id": "toil_bind_dynamic_event", "name": "绑定动态事件" },
    { "id": "toil_validate_dynamic_event_phase", "name": "校验动态事件阶段" },
    { "id": "toil_wait_until_event_phase", "name": "等待动态事件阶段" },
    { "id": "toil_mark_dynamic_event_prepared", "name": "标记动态事件已准备" },
    { "id": "toil_mark_dynamic_event_participant", "name": "标记动态事件参与者" }
  ]
}
```

Create `apps/game/data/toils/npc-economy-toils.json`:

```json
{
  "toils": [
    { "id": "toil_check_inventory_item", "name": "检查背包物品" },
    { "id": "toil_ensure_item", "name": "确保物品数量" },
    { "id": "toil_check_currency", "name": "检查货币" },
    { "id": "toil_buy_item", "name": "购买物品" },
    { "id": "toil_exchange_faction_item", "name": "宗门兑换物品" },
    { "id": "toil_ensure_artifact", "name": "确保法器" },
    { "id": "toil_check_equipped_artifact", "name": "检查已装备法器" },
    { "id": "toil_equip_artifact", "name": "装备法器" }
  ]
}
```

Create `apps/game/data/toils/npc-social-toils.json`:

```json
{
  "toils": [
    { "id": "toil_select_companion", "name": "选择同行者" },
    { "id": "toil_request_companion", "name": "请求同行" }
  ]
}
```

- [ ] **Step 6: Add Job config files**

Create `apps/game/data/jobs/npc-dynamic-event-jobs.json` with:

```json
{
  "jobs": [
    {
      "id": "job_npc_prepare_dynamic_event",
      "name": "通用动态事件准备",
      "category": "dynamic_event",
      "successEffects": { "preparedForDynamicEvent": { "op": "set", "value": true } },
      "interrupt": { "reaction": "pause", "higherDynamicGoal": "abort", "sameDynamicGoal": "keep" },
      "toils": [
        { "id": "bind_event", "type": "toil_bind_dynamic_event" },
        { "id": "validate_announced", "type": "toil_validate_dynamic_event_phase", "params": { "phases": ["announced"] } },
        { "id": "mark_prepared", "type": "toil_mark_dynamic_event_prepared" }
      ]
    },
    {
      "id": "job_npc_prepare_secret_realm",
      "name": "秘境准备",
      "category": "dynamic_event",
      "successEffects": { "preparedForDynamicEvent": { "op": "set", "value": true } },
      "interrupt": { "reaction": "pause", "higherDynamicGoal": "abort", "sameDynamicGoal": "keep" },
      "toils": [
        { "id": "bind_event", "type": "toil_bind_dynamic_event" },
        { "id": "validate_announced", "type": "toil_validate_dynamic_event_phase", "params": { "phases": ["announced"] } },
        { "id": "ensure_heal_item", "type": "toil_ensure_item", "params": { "itemId": "item_heal_pill", "minAmount": 1, "priceItemId": "low_spirit_stone", "priceAmount": 10 } },
        { "id": "ensure_artifact", "type": "toil_ensure_artifact", "params": { "itemId": "item_artifact_low", "minGrade": 1, "priceItemId": "low_spirit_stone", "priceAmount": 30 } },
        { "id": "mark_prepared", "type": "toil_mark_dynamic_event_prepared" }
      ]
    },
    {
      "id": "job_npc_join_dynamic_event",
      "name": "参与动态事件",
      "category": "dynamic_event",
      "successEffects": { "joinedDynamicEvent": { "op": "set", "value": true } },
      "interrupt": { "reaction": "pause", "higherDynamicGoal": "abort", "sameDynamicGoal": "keep" },
      "toils": [
        { "id": "bind_event", "type": "toil_bind_dynamic_event" },
        { "id": "move_to_event", "type": "toil_move_to_target", "params": { "targetResolver": "dynamic_event_target" } },
        { "id": "wait_active", "type": "toil_wait_until_event_phase", "params": { "phases": ["active"] } },
        { "id": "mark_participant", "type": "toil_mark_dynamic_event_participant" }
      ]
    },
    {
      "id": "job_npc_prepare_sect_tournament",
      "name": "宗门大比准备",
      "category": "dynamic_event",
      "successEffects": { "preparedForDynamicEvent": { "op": "set", "value": true } },
      "interrupt": { "reaction": "pause", "higherDynamicGoal": "abort", "sameDynamicGoal": "keep" },
      "toils": [
        { "id": "bind_event", "type": "toil_bind_dynamic_event" },
        { "id": "ensure_artifact", "type": "toil_ensure_artifact", "params": { "itemId": "item_artifact_low", "minGrade": 1, "priceItemId": "low_spirit_stone", "priceAmount": 30 } },
        { "id": "mark_prepared", "type": "toil_mark_dynamic_event_prepared" }
      ]
    }
  ]
}
```

Create `apps/game/data/jobs/npc-economy-jobs.json`:

```json
{
  "jobs": [
    {
      "id": "job_npc_acquire_heal_item",
      "name": "获取回血丹",
      "category": "economy",
      "successEffects": { "hasHealItem": { "op": "set", "value": true } },
      "toils": [
        { "id": "ensure_heal", "type": "toil_ensure_item", "params": { "itemId": "item_heal_pill", "minAmount": 1, "priceItemId": "low_spirit_stone", "priceAmount": 10 } }
      ]
    },
    {
      "id": "job_npc_acquire_artifact",
      "name": "获取法器",
      "category": "economy",
      "successEffects": { "hasEquippedArtifact": { "op": "set", "value": true } },
      "toils": [
        { "id": "ensure_artifact", "type": "toil_ensure_artifact", "params": { "itemId": "item_artifact_low", "minGrade": 1, "priceItemId": "low_spirit_stone", "priceAmount": 30 } },
        { "id": "equip_artifact", "type": "toil_equip_artifact", "params": { "itemId": "item_artifact_low" } }
      ]
    }
  ]
}
```

Create `apps/game/data/jobs/npc-social-jobs.json`:

```json
{
  "jobs": [
    {
      "id": "job_npc_find_companion",
      "name": "寻找同行者",
      "category": "social",
      "successEffects": { "hasCompanionForDynamicEvent": { "op": "set", "value": true } },
      "toils": [
        { "id": "select_companion", "type": "toil_select_companion" },
        { "id": "request_companion", "type": "toil_request_companion" }
      ]
    }
  ]
}
```

- [ ] **Step 7: Wire config loader and world engine**

Modify `config-loader.js`:

- Add JSON loads for `npcJobActions`, `npcActionSets`, `dynamicEventJobs`, `economyJobs`, `socialJobs`, `coreToils`, `dynamicEventToils`, `economyToils`, `socialToils`.
- Return merged `jobs: { jobs: [...] }`.
- Return merged `toils: { toils: [...] }`.
- Return `npcActionSets`.

Modify `world-engine.js`:

- Import `JobPool`, `ToilPool`, and `registerNPCToilExecutors`.
- In `_registerSystems()`, call `registerNPCToilExecutors()`, `ToilPool.loadFromConfig(configs.toils)`, and `JobPool.loadFromConfig(configs.jobs)`.
- Load `configs.npcJobActions` into `ActionPool` after `configs.npcActions`.
- Add `npcActionSets` to `_entityConfig`.

Modify `ai-config.json`:

```json
"jobs": {
  "_comment": "Job/Toil 复杂行动编排层。默认关闭；开启后 NPC 默认行为集加入 npc-job-actions.json 中的 JobAction。",
  "enabled": false,
  "maxActiveJobsPerNpc": 1,
  "logToilEvents": true
}
```

- [ ] **Step 8: Use action sets in NPCEntity**

Modify `NPCEntity._initActions(config)`:

- If `config.actionIds` exists, keep current override behavior.
- Otherwise read `this._actionSets.defaultNpcActionIds`.
- If `this._aiConfig.jobs.enabled === true`, append `this._actionSets.defaultNpcJobActionIds`.
- Preserve reaction SimpleActions in default list.
- Set `this.state.set('jobsEnabled', this._aiConfig.jobs?.enabled === true)` for debug visibility.

- [ ] **Step 9: Run config loading test**

Run:

```powershell
cd apps/game
node tools/test-job-config-load.mjs
```

Expected: `Job config load tests passed`.

- [ ] **Step 10: Update docs**

Update:

- `docs/data/data-config-rules.md`: add `actions/npc-job-actions.json`, `actions/npc-action-sets.json`, `jobs/`, `toils/`, and `ai-config.npc.jobs`.
- `docs/architecture/file-structure.md`: add `apps/game/js/engine/npc/toils/`, `apps/game/data/jobs/`, and `apps/game/data/toils/`.

- [ ] **Step 11: Commit Task 5**

```powershell
git add apps/game/data/actions/npc-job-actions.json apps/game/data/actions/npc-action-sets.json apps/game/data/jobs apps/game/data/toils apps/game/js/core/config-loader.js apps/game/js/engine/world-engine.js apps/game/js/engine/npc/npc-entity.js apps/game/data/config/ai-config.json apps/game/tools/test-job-config-load.mjs docs/data/data-config-rules.md docs/architecture/file-structure.md
git commit -m "feat: load job and toil configs"
```

---

### Task 6: JobAction Planning and Execution Integration

**Files:**
- Modify: `apps/game/js/engine/abstract/action.js`
- Modify: `apps/game/js/engine/pools/action-pool.js`
- Modify: `apps/game/js/engine/abstract/base-entity.js`
- Modify: `apps/game/js/engine/abstract/behavior-system.js`
- Create: `apps/game/tools/test-job-action-planning.mjs`

- [ ] **Step 1: Write failing JobAction planning test**

Create `apps/game/tools/test-job-action-planning.mjs`:

```js
#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Action } = await imp('js/engine/abstract/action.js');
const { BehaviorSystem } = await imp('js/engine/abstract/behavior-system.js');
const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');
const { Need } = await imp('js/engine/abstract/need.js');
const { NeedSystem } = await imp('js/engine/abstract/need-system.js');
const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { ToilExecutor, ToilResultStatus } = await imp('js/engine/abstract/toil.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

class TestState {
  constructor(values = {}) { this._values = { ...values }; }
  get(key) { return this._values[key]; }
  set(key, value) { this._values[key] = value; }
  toGOAPState() { return { ...this._values }; }
}

class FinishExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    entity.state.set('toilRan', true);
    return { status: ToilResultStatus.SUCCESS, reason: 'finished' };
  }
}

JobPool.clear();
ToilPool.clear();
ToilPool.loadFromConfig({ toils: [{ id: 'toil_finish', name: '完成' }] });
ToilPool.registerExecutor('toil_finish', new FinishExecutor());
JobPool.loadFromConfig({ jobs: [{
  id: 'job_npc_prepare_dynamic_event',
  name: '筹备动态事件',
  successEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
  toils: [{ id: 'finish', type: 'toil_finish' }]
}] });

const action = new Action({
  id: 'act_npc_prepare_dynamic_event',
  name: '筹备动态事件',
  executionKind: 'job',
  jobId: 'job_npc_prepare_dynamic_event',
  preconditions: { alive: { op: 'true' } },
  effects: {},
  plannerEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
});
assert(action.executionKind === 'job', 'Action keeps executionKind=job');
assert(action.jobId === 'job_npc_prepare_dynamic_event', 'Action keeps jobId');

const need = new Need({
  id: 'need_dynamic_prepare',
  name: '动态事件准备',
  priority: 100,
  goalState: { preparedForDynamicEvent: { op: 'eq', value: true } },
});
const needSystem = new NeedSystem();
needSystem.addNeed(need);
need.lastValue = 100;

const bs = new BehaviorSystem(new GOAPPlanner({ maxDepth: 3, maxIterations: 50 }), [action], { jobsEnabled: true });
const plan = bs.plan(needSystem, { alive: true, preparedForDynamicEvent: false }, {});
assert(plan.length === 1, 'GOAP plan contains one high-level Action');
assert(plan[0].id === 'act_npc_prepare_dynamic_event', 'GOAP plan contains JobAction id');
assert(!bs.getLastPlanResult().actions.some(id => id.startsWith('toil_')), 'GOAP plan result does not contain Toil ids');

const entity = {
  id: 'npc_job_action',
  state: new TestState({ alive: true, preparedForDynamicEvent: false, toilRan: false }),
  inventory: { has: () => true, remove: () => {}, add: () => {} },
  buildGOAPState() { return this.state.toGOAPState(); },
};
const result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'JobAction success completes current plan step');
assert(entity.state.get('toilRan') === true, 'Job Toil actually ran');
assert(entity.state.get('preparedForDynamicEvent') === true, 'Job successEffects wrote prepared state');

if (failed > 0) {
  console.error(`\nJobAction planning tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJobAction planning tests passed');
```

- [ ] **Step 2: Run JobAction planning test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-job-action-planning.mjs
```

Expected: FAIL because `Action` does not expose `executionKind/jobId`, or `BehaviorSystem` does not start Jobs.

- [ ] **Step 3: Extend Action model**

Modify `ActionConfig` and constructor in `action.js`:

```js
 * @property {'simple'|'job'} [executionKind='simple']
 * @property {string|null} [jobId]
 * @property {Object} [jobInput]
```

Set:

```js
this.executionKind = config.executionKind || 'simple';
this.jobId = config.jobId || null;
this.jobInput = config.jobInput || {};
```

Add:

```js
isJobAction() {
  return this.executionKind === 'job' && !!this.jobId;
}
```

Include `executionKind`, `jobId`, and `jobInput` in `toJSON()`.

- [ ] **Step 4: Preserve JobAction fields in ActionPool**

`ActionPool.create()` already spreads `merged` into `new Action({ ...merged, executor })`. Confirm no field filtering removes `executionKind`, `jobId`, or `jobInput`. Add a small assertion in `test-job-action-planning.mjs` if needed:

```js
assert(ActionPool.create('act_npc_prepare_dynamic_event').jobId === 'job_npc_prepare_dynamic_event', 'ActionPool preserves jobId');
```

- [ ] **Step 5: Integrate JobSystem into BehaviorSystem**

Modify `BehaviorSystem` constructor:

```js
constructor(planner, availableActions = [], options = {}) {
  this.planner = planner;
  this.availableActions = availableActions;
  this.jobsEnabled = options.jobsEnabled === true;
  this.jobSystem = options.jobSystem || null;
}
```

Import `JobSystem` and lazily construct it only when Jobs are enabled:

```js
import { JobSystem } from './job-system.js';
```

In `executeStep()`, before `_startAction(entity, action, worldContext)` for the current action:

```js
if (action.isJobAction?.()) {
  return this._executeJobAction(entity, worldContext, action);
}
```

Implement `_executeJobAction()`:

```js
_executeJobAction(entity, worldContext, action) {
  if (!this.jobsEnabled) {
    return { status: 'replan', reason: 'jobs_disabled', actionId: action.id };
  }
  if (!this.jobSystem) this.jobSystem = new JobSystem();
  if (!this.jobSystem.hasJob()) {
    this.jobSystem.start(action.jobId, {
      actionId: action.id,
      ...(action.jobInput || {}),
      dynamicEventId: entity?.state?.get?.('targetDynamicEventId') || null,
    });
  }
  const result = this.jobSystem.executeStep(entity, worldContext);
  this._syncJobState(entity);
  if (result.status === 'success') {
    this.currentActionIndex++;
    this._resetLifecycle(entity);
    return {
      status: this.currentActionIndex >= this.currentPlan.length ? 'plan_complete' : 'step_done',
      result: { actionId: action.id, jobId: action.jobId, ...result },
      action: { id: action.id, name: action.name },
    };
  }
  if (result.status === 'replan' || result.status === 'failed' || result.status === 'abort') {
    this._resetLifecycle(entity);
    return { status: 'replan', reason: result.reason || result.status, actionId: action.id, jobId: action.jobId };
  }
  return {
    status: 'in_progress',
    phase: 'job',
    job: this.jobSystem.snapshot(),
    action: { id: action.id, name: action.name },
  };
}
```

Implement `_syncJobState(entity)` to write `currentJobId`, `currentToilId`, `jobStatus`, and `jobRemaining` from `jobSystem.snapshot()`.

- [ ] **Step 6: Pass jobsEnabled from BaseEntity**

Modify `BaseEntity.initBehaviorSystem(actions, plannerOptions = {}, behaviorOptions = {})`:

```js
this.behaviorSystem = new BehaviorSystem(planner, actions, behaviorOptions);
```

Modify callers:

- `FactionEntity` passes no behavior options.
- `NPCEntity` passes `{ jobsEnabled: this._aiConfig.jobs?.enabled === true }`.

- [ ] **Step 7: Run JobAction planning test**

Run:

```powershell
cd apps/game
node tools/test-job-action-planning.mjs
```

Expected: `JobAction planning tests passed`.

- [ ] **Step 8: Commit Task 6**

```powershell
git add apps/game/js/engine/abstract/action.js apps/game/js/engine/pools/action-pool.js apps/game/js/engine/abstract/base-entity.js apps/game/js/engine/abstract/behavior-system.js apps/game/js/engine/npc/npc-entity.js apps/game/tools/test-job-action-planning.mjs
git commit -m "feat: execute job actions through job system"
```

---

### Task 7: Reaction Interrupt Pause and Resume

**Files:**
- Modify: `apps/game/js/engine/abstract/behavior-system.js`
- Modify: `apps/game/js/engine/abstract/bt/reactions.js`
- Create: `apps/game/tools/test-job-interrupt-resume.mjs`

- [ ] **Step 1: Write failing interrupt/resume test**

Create `apps/game/tools/test-job-interrupt-resume.mjs`:

```js
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

class LongToilExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    job.context.count = (job.context.count || 0) + 1;
    if (job.context.count < 3) return { status: ToilResultStatus.RUNNING, remaining: 1, reason: 'long_toil_running' };
    return { status: ToilResultStatus.SUCCESS, reason: 'long_toil_done' };
  }
}

ToilPool.clear();
JobPool.clear();
ToilPool.loadFromConfig({ toils: [{ id: 'toil_long', name: '长步骤' }] });
ToilPool.registerExecutor('toil_long', new LongToilExecutor());
JobPool.loadFromConfig({ jobs: [{
  id: 'job_long_prepare',
  name: '长准备',
  interrupt: { reaction: 'pause' },
  successEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
  toils: [{ id: 'long', type: 'toil_long' }]
}] });

const action = new Action({
  id: 'act_long_prepare',
  name: '长准备',
  executionKind: 'job',
  jobId: 'job_long_prepare',
  preconditions: { alive: { op: 'true' } },
  plannerEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
  effects: {},
});
const bs = new BehaviorSystem(new GOAPPlanner(), [action], { jobsEnabled: true });
bs.currentPlan = [action];
bs.currentActionIndex = 0;
const entity = {
  id: 'npc_interrupt',
  state: new TestState({ alive: true, preparedForDynamicEvent: false }),
  inventory: { has: () => true, remove: () => {}, add: () => {} },
  buildGOAPState() { return { alive: true, preparedForDynamicEvent: false }; },
};

console.log('1) running JobAction can be paused by reaction');
let result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'job starts and is in progress');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'job status is running before interrupt');
bs.pauseCurrentJob('reaction_attacked');
assert(bs.jobSystem.snapshot().jobStatus === 'paused', 'pauseCurrentJob pauses active job');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'paused job does not advance as completed');
assert(bs.jobSystem.snapshot().jobContext.count === 1, 'paused job did not increment count');

console.log('2) paused JobAction resumes and completes');
bs.resumeCurrentJob('reaction_done');
assert(bs.jobSystem.snapshot().jobStatus === 'running', 'resumeCurrentJob resumes active job');
result = bs.executeStep(entity, {});
assert(result.status === 'in_progress', 'resumed job advances once');
result = bs.executeStep(entity, {});
assert(result.status === 'plan_complete', 'resumed job completes after required ticks');
assert(entity.state.get('preparedForDynamicEvent') === true, 'completed resumed job writes success effect');

if (failed > 0) {
  console.error(`\nJob interrupt tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJob interrupt tests passed');
```

- [ ] **Step 2: Run interrupt test and verify it fails**

Run:

```powershell
cd apps/game
node tools/test-job-interrupt-resume.mjs
```

Expected: FAIL because `pauseCurrentJob()` and `resumeCurrentJob()` do not exist.

- [ ] **Step 3: Add BehaviorSystem pause/resume APIs**

Implement:

```js
pauseCurrentJob(reason = 'pause') {
  if (!this.jobSystem?.hasJob?.()) return false;
  this.jobSystem.pause(reason);
  return true;
}

resumeCurrentJob(reason = 'resume') {
  if (!this.jobSystem?.hasJob?.()) return false;
  this.jobSystem.resume(reason);
  return true;
}

abortCurrentJob(reason = 'abort') {
  if (!this.jobSystem?.hasJob?.()) return false;
  this.jobSystem.abort(reason);
  return true;
}
```

Modify `_executeJobAction()`:

- If `jobSystem.snapshot().jobStatus === 'paused'`, return `in_progress` with phase `job_paused`.
- Do not advance Toil while paused.

- [ ] **Step 4: Hook Reaction pause**

Modify `ReactiveNode` and `EmotionReactionNode` in `reactions.js`:

- Before `clearPlan + setSingleActionPlan`, call `entity.behaviorSystem.pauseCurrentJob('reaction_attacked')` if present.
- Keep current Reaction behavior for SimpleAction plans unchanged.
- Do not abort by default; ADR-050 default is pause for Reaction.

- [ ] **Step 5: Run interrupt/resume test**

Run:

```powershell
cd apps/game
node tools/test-job-interrupt-resume.mjs
```

Expected: `Job interrupt tests passed`.

- [ ] **Step 6: Commit Task 7**

```powershell
git add apps/game/js/engine/abstract/behavior-system.js apps/game/js/engine/abstract/bt/reactions.js apps/game/tools/test-job-interrupt-resume.mjs
git commit -m "feat: pause jobs during reaction interrupts"
```

---

### Task 8: Dynamic Event Migration and Real Simulation Verification

**Files:**
- Modify: `apps/game/data/actions/npc-actions.json`
- Modify: `apps/game/data/actions/npc-job-actions.json`
- Modify: `apps/game/tools/test-dynamic-event-actions.mjs`
- Modify: `apps/game/tools/verify-dynamic-goals.mjs`
- Modify: `docs/systems/job-toil-ai-spec.md`
- Modify: `docs/systems/behavior-tree.md`

- [ ] **Step 1: Move dynamic event Actions out of SimpleAction config**

Remove these objects from `apps/game/data/actions/npc-actions.json`:

- `act_npc_prepare_dynamic_event`
- `act_npc_join_dynamic_event`

They already exist in `apps/game/data/actions/npc-job-actions.json`.

- [ ] **Step 2: Update dynamic event action test**

Modify `apps/game/tools/test-dynamic-event-actions.mjs`:

- Keep tests for old executor only if they explicitly construct legacy templates inside the test.
- Add a real JSON assertion:

```js
ActionPool.clear();
registerNPCExecutors();
ActionPool.loadFromArray(load('data/actions/npc-job-actions.json'));
const prepare = ActionPool.create('act_npc_prepare_dynamic_event');
const join = ActionPool.create('act_npc_join_dynamic_event');
assert(prepare.executionKind === 'job', '真实准备 action 是 JobAction');
assert(prepare.jobId === 'job_npc_prepare_dynamic_event', '真实准备 action 指向准备 Job');
assert(join.executionKind === 'job', '真实参与 action 是 JobAction');
assert(join.jobId === 'job_npc_join_dynamic_event', '真实参与 action 指向参与 Job');
assert(Object.keys(prepare.effects || {}).length === 0, '真实准备 action 运行期 effects 为空');
assert(prepare.getEffects().preparedForDynamicEvent?.value === true, '真实准备 action plannerEffects 推进 preparedForDynamicEvent');
```

- [ ] **Step 3: Run migration unit tests**

Run:

```powershell
cd apps/game
node tools/test-job-config-load.mjs
node tools/test-job-action-planning.mjs
node tools/test-dynamic-event-actions.mjs
node tools/test-dynamic-event-jobs.mjs
node tools/test-job-interrupt-resume.mjs
```

Expected: all scripts print passed messages. These tests assert concrete runtime behavior, not saved-output equivalence.

- [ ] **Step 4: Extend `verify-dynamic-goals.mjs` with Job metrics**

Add metrics:

```js
jobActions: {
  planned: 0,
  started: 0,
  completed: 0,
  failed: 0,
  aborted: 0,
  byJobId: {},
  byToilId: {},
  failureReasons: {},
}
```

Count from tick execution:

- `execution.phase === 'job'` or `execution.result?.jobId`
- `execution.job.currentJobId`
- `execution.job.currentToilId`
- `execution.result.status`
- `execution.reason`

Add assertions:

```js
assert(agg.jobActions.planned > 0, `JobAction 真实进入规划（${agg.jobActions.planned} 次）`);
assert(agg.jobActions.started > 0, `Job 真实启动（${agg.jobActions.started} 次）`);
assert(agg.jobActions.byJobId.job_npc_prepare_dynamic_event > 0 || agg.jobActions.byJobId.job_npc_prepare_secret_realm > 0, '动态事件准备 Job 真实执行');
assert(agg.jobActions.completed > 0, `至少有 Job 完成（${agg.jobActions.completed} 次）`);
assert(agg.normalActionAfterDynamic > 0, '动态 Job 后普通行为仍恢复发生');
```

Do not add any saved-output digest, replay-output match, full-output comparison, or fixed-baseline equality check.

- [ ] **Step 5: Run real behavior verification with features enabled**

Run a concrete long simulation with normal world systems enabled:

```powershell
cd apps/game
$env:DYNAMIC_EVENTS_ACTIVE = "1"
$env:DYNAMIC_GOALS_ACTIVE = "1"
$env:JOBS_ACTIVE = "1"
node tools/verify-dynamic-goals.mjs
```

Expected output must include:

- Dynamic actions planned and executed.
- JobAction counts.
- Job completion count greater than zero.
- At least one prepare or join Job.
- Normal behavior after dynamic activity.

This verification must not disable monsters, normal NPC decisions, relationship goals, or the Reaction layer to make the result pass.

- [ ] **Step 6: Update docs**

Update `docs/systems/job-toil-ai-spec.md`:

- Change “待实施” to note the implemented phase.
- Add implemented files.
- Add the real verification command and behavior metrics.

Update `docs/systems/behavior-tree.md`:

- State that the runtime now supports Job/Toil when `ai-config.npc.jobs.enabled=true`.
- Keep current four-layer text accurate for jobs disabled.

- [ ] **Step 7: Commit Task 8**

```powershell
git add apps/game/data/actions/npc-actions.json apps/game/data/actions/npc-job-actions.json apps/game/tools/test-dynamic-event-actions.mjs apps/game/tools/verify-dynamic-goals.mjs docs/systems/job-toil-ai-spec.md docs/systems/behavior-tree.md
git commit -m "feat: migrate dynamic event actions to jobs"
```

---

## Final Verification

Run all targeted unit scripts:

```powershell
cd apps/game
node tools/test-job-pool.mjs
node tools/test-toil-pool.mjs
node tools/test-job-system.mjs
node tools/test-job-config-load.mjs
node tools/test-economy-toils.mjs
node tools/test-job-action-planning.mjs
node tools/test-dynamic-event-actions.mjs
node tools/test-dynamic-event-jobs.mjs
node tools/test-job-interrupt-resume.mjs
node tools/test-dynamic-goals.mjs
node tools/test-interrupt-policy.mjs
```

Expected: all scripts print passed messages or zero failure count.

Run real behavior verification:

```powershell
cd apps/game
$env:DYNAMIC_EVENTS_ACTIVE = "1"
$env:DYNAMIC_GOALS_ACTIVE = "1"
$env:JOBS_ACTIVE = "1"
node tools/verify-dynamic-goals.mjs
```

Expected: output reports actual dynamic goal activity, Job starts, Job completions, Toil distribution, failure reasons, and normal behavior recovery. The run is valid only if it observes concrete behavior; it is not valid if it relies on fixed-baseline equivalence, exact saved-output matching, or disabled systems.

## Self-Review

Spec coverage:

- Action / Job / Toil split: Tasks 1, 5, 6.
- JobPool / ToilPool: Task 1.
- JobSystem runtime: Task 2.
- Initial Toil list: Tasks 3 and 4.
- Config split: Task 5.
- JobAction execution: Task 6.
- Reaction pause/resume: Task 7.
- Dynamic event migration and real verification: Task 8.
- Test policy against fixed-baseline equivalence: Testing Policy and Final Verification.

Placeholder scan:

- 计划内没有空白章节或未具体说明的测试要求。
- Every test section states concrete assertions and expected command results.

Type consistency:

- `executionKind`, `jobId`, `jobInput`, `JobPool.create()`, `ToilPool.getExecutor()`, `JobSystem.executeStep()`, `pauseCurrentJob()`, and `resumeCurrentJob()` use the same names across tasks.
