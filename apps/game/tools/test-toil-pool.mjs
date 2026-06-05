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

ToilPool.registerExecutor('toil_executor_only', new InstantExecutor());
assert(ToilPool.getExecutor('toil_executor_only') === null, 'Executor without definition returns null');

if (failed > 0) {
  console.error(`\nToilPool tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nToilPool tests passed');
