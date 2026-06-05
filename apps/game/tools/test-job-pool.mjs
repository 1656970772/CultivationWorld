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
