#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

const npcJobActions = load('data/actions/npc-job-actions.json');
const npcActions = load('data/actions/npc-actions.json');
const actionSets = load('data/actions/npc-action-sets.json');
const dynamicJobs = load('data/jobs/npc-dynamic-event-jobs.json');
const economyJobs = load('data/jobs/npc-economy-jobs.json');
const socialJobs = load('data/jobs/npc-social-jobs.json');
const coreToils = load('data/toils/core-toils.json');
const dynamicToils = load('data/toils/npc-dynamic-event-toils.json');
const economyToils = load('data/toils/npc-economy-toils.json');
const socialToils = load('data/toils/npc-social-toils.json');
const aiConfig = load('data/config/ai-config.json');
const itemDefs = ['currency', 'material', 'pill', 'artifact', 'talisman', 'technique']
  .flatMap(category => load(`data/items/${category}.json`).items || []);

console.log('1) job action config contains only JobActions');
for (const action of npcJobActions) {
  assert(action.id.startsWith('act_'), `${action.id} uses act_ prefix`);
  assert(action.executionKind === 'job', `${action.id} declares executionKind=job`);
  assert(action.jobId && action.jobId.startsWith('job_'), `${action.id} references job_ id`);
  assert(Object.keys(action.effects || {}).length === 0, `${action.id} has empty runtime effects`);
  assert(action.plannerEffects && Object.keys(action.plannerEffects).length > 0, `${action.id} declares plannerEffects`);
}

const actionById = new Map(npcJobActions.map(action => [action.id, action]));
assert(
  actionById.get('act_npc_prepare_dynamic_event')?.preconditions?.dynamicEventUsesGenericPreparation?.op === 'true',
  'generic dynamic event prepare action is gated to generic dynamic events',
);
assert(
  actionById.get('act_npc_prepare_secret_realm')?.preconditions?.dynamicEventIsSecretRealm?.op === 'true',
  'secret realm prepare action is gated to secret_realm events',
);
assert(
  actionById.get('act_npc_prepare_sect_tournament')?.preconditions?.dynamicEventIsSectTournament?.op === 'true',
  'sect tournament prepare action is gated to sect_tournament events',
);

console.log('2) action set config includes defaults and job defaults separately');
assert(Array.isArray(actionSets.defaultNpcActionIds), 'defaultNpcActionIds is an array');
assert(Array.isArray(actionSets.defaultNpcJobActionIds), 'defaultNpcJobActionIds is an array');
assert(actionSets.defaultNpcJobActionIds.includes('act_npc_prepare_dynamic_event'), 'job action set includes prepare dynamic event');
assert(actionSets.defaultNpcJobActionIds.includes('act_npc_prepare_dynamic_event'), 'defaultNpcJobActionIds includes prepare dynamic event JobAction');
assert(actionSets.defaultNpcJobActionIds.includes('act_npc_join_dynamic_event'), 'defaultNpcJobActionIds includes join dynamic event JobAction');

const jobActionIds = new Set(npcJobActions.map(action => action.id));
const simpleActionIds = new Set(npcActions.map(action => action.id));
for (const actionId of jobActionIds) {
  assert(!simpleActionIds.has(actionId), `${actionId} exists only in npc-job-actions.json, not npc-actions.json`);
  assert(!actionSets.defaultNpcActionIds.includes(actionId), `defaultNpcActionIds excludes JobAction ${actionId}`);
}
for (const actionId of actionSets.defaultNpcJobActionIds) {
  assert(jobActionIds.has(actionId), `${actionId} exists in npc-job-actions.json`);
}

console.log('3) job definitions reference registered toil ids');
const toilIds = new Set([
  ...coreToils.toils.map(t => t.id),
  ...dynamicToils.toils.map(t => t.id),
  ...economyToils.toils.map(t => t.id),
  ...socialToils.toils.map(t => t.id),
]);
const jobs = [...dynamicJobs.jobs, ...economyJobs.jobs, ...socialJobs.jobs];
const itemIds = new Set(itemDefs.map(item => item.id));
const itemRefKeys = new Set(['itemId', 'priceItemId', 'currencyItemId']);

function collectItemRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectItemRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;
  for (const [key, child] of Object.entries(value)) {
    if (itemRefKeys.has(key) && typeof child === 'string') refs.push(child);
    collectItemRefs(child, refs);
  }
  return refs;
}

for (const job of jobs) {
  assert(job.id.startsWith('job_'), `${job.id} uses job_ prefix`);
  assert(job.toils.length > 0, `${job.id} has non-empty toils`);
  for (const toil of job.toils) {
    assert(toilIds.has(toil.type), `${job.id}.${toil.id} references known toil type ${toil.type}`);
  }
  for (const itemId of collectItemRefs(job)) {
    assert(itemIds.has(itemId), `${job.id} references existing item ${itemId}`);
  }
}

console.log('4) jobs config defaults to disabled in ai-config');
assert(aiConfig.npc.jobs.enabled === false, 'npc.jobs.enabled defaults false');
assert(aiConfig.npc.jobs.maxActiveJobsPerNpc === 1, 'maxActiveJobsPerNpc is 1');
assert(aiConfig.npc.jobs.logToilEvents === true, 'logToilEvents defaults true');

console.log('5) config-loader loads split configs and merges jobs/toils');
globalThis.fetch = async (path) => {
  try {
    const data = readFileSync(resolve(GAME_ROOT, path), 'utf-8');
    return {
      ok: true,
      status: 200,
      async json() { return JSON.parse(data); },
    };
  } catch (_err) {
    return {
      ok: false,
      status: 404,
      async json() { throw new Error(`missing mock fetch path: ${path}`); },
    };
  }
};
const { loadGameConfigs } = await imp('js/core/config-loader.js');
const configs = await loadGameConfigs();
assert(configs.npcJobActions.some(action => action.id === 'act_npc_acquire_artifact'), 'loadGameConfigs returns npcJobActions from npc-job-actions.json');
assert(configs.npcActionSets.defaultNpcJobActionIds.includes('act_npc_acquire_artifact'), 'loadGameConfigs returns npcActionSets from npc-action-sets.json');
assert(configs.jobs.jobs.some(job => job.id === 'job_npc_prepare_dynamic_event'), 'loadGameConfigs merges dynamic event jobs');
assert(configs.jobs.jobs.some(job => job.id === 'job_npc_acquire_artifact'), 'loadGameConfigs merges economy jobs');
assert(configs.jobs.jobs.some(job => job.id === 'job_npc_find_companion'), 'loadGameConfigs merges social jobs');
assert(configs.toils.toils.some(toil => toil.id === 'toil_ensure_item'), 'loadGameConfigs merges economy toils');
assert(configs.toils.toils.some(toil => toil.id === 'toil_mark_dynamic_event_prepared'), 'loadGameConfigs merges dynamic event toils');

console.log('6) WorldEngine can initialize Job/Toil configs twice in one process');
const { WorldEngine } = await imp('js/engine/world-engine.js');
const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');

const firstEngine = new WorldEngine();
firstEngine.init(configs);
assert(JobPool.has('job_npc_prepare_dynamic_event'), 'first WorldEngine init registers dynamic event job');
assert(ToilPool.getDefinition('toil_resolve_target'), 'first WorldEngine init registers resolve-target toil');
assert(ToilPool.getExecutor('toil_resolve_target'), 'first WorldEngine init registers resolve-target executor');

let repeatedInitError = null;
try {
  const secondEngine = new WorldEngine();
  secondEngine.init(configs);
} catch (err) {
  repeatedInitError = err;
}

assert(!repeatedInitError, `second WorldEngine init does not fail: ${repeatedInitError?.message || 'ok'}`);
assert(JobPool.has('job_npc_prepare_dynamic_event'), 'second WorldEngine init keeps dynamic event job registered');
assert(ToilPool.getDefinition('toil_resolve_target'), 'second WorldEngine init keeps resolve-target toil registered');
assert(ToilPool.getExecutor('toil_resolve_target'), 'second WorldEngine init keeps resolve-target executor registered');

if (failed > 0) {
  console.error(`\nJob config load tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJob config load tests passed');
