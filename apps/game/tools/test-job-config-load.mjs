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
const questJobs = load('data/jobs/npc-quest-jobs.json');
const combatJobs = load('data/jobs/npc-combat-jobs.json');
const cultivationJobs = load('data/jobs/npc-cultivation-jobs.json');
const coreToils = load('data/toils/core-toils.json');
const dynamicToils = load('data/toils/npc-dynamic-event-toils.json');
const economyToils = load('data/toils/npc-economy-toils.json');
const socialToils = load('data/toils/npc-social-toils.json');
const questToils = load('data/toils/npc-quest-toils.json');
const combatToils = load('data/toils/npc-combat-toils.json');
const cultivationToils = load('data/toils/npc-cultivation-toils.json');
const aiConfig = load('data/config/ai-config.json');
const dynamicEventsConfig = load('data/world/dynamic-events.json');
const dynamicGoalsConfig = load('data/goals/dynamic-goals.json');
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
  ...questToils.toils.map(t => t.id),
  ...combatToils.toils.map(t => t.id),
  ...cultivationToils.toils.map(t => t.id),
]);
const jobs = [
  ...dynamicJobs.jobs,
  ...economyJobs.jobs,
  ...socialJobs.jobs,
  ...questJobs.jobs,
  ...combatJobs.jobs,
  ...cultivationJobs.jobs,
];
const jobIds = new Set(jobs.map(job => job.id));
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
for (const action of npcJobActions) {
  assert(jobIds.has(action.jobId), `${action.id} references defined job ${action.jobId}`);
}

console.log('4) Job/Toil dynamic chain defaults enabled after formal launch');
assert(aiConfig.npc.jobs.enabled === true, 'npc.jobs.enabled defaults true after formal launch');
assert(dynamicEventsConfig.enabled === true, 'dynamic-events.enabled defaults true after formal launch');
assert(dynamicGoalsConfig.enabled === true, 'dynamic-goals.enabled defaults true after formal launch');
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
assert(configs.jobs.jobs.some(job => job.id === 'job_npc_accept_quest'), 'loadGameConfigs merges quest jobs');
assert(configs.jobs.jobs.some(job => job.id === 'job_npc_prepare_combat'), 'loadGameConfigs merges combat jobs');
assert(configs.jobs.jobs.some(job => job.id === 'job_npc_cultivate'), 'loadGameConfigs merges cultivation jobs');
assert(configs.toils.toils.some(toil => toil.id === 'toil_ensure_item'), 'loadGameConfigs merges economy toils');
assert(configs.toils.toils.some(toil => toil.id === 'toil_mark_dynamic_event_prepared'), 'loadGameConfigs merges dynamic event toils');
assert(configs.toils.toils.some(toil => toil.id === 'toil_accept_quest'), 'loadGameConfigs merges quest toils');
assert(configs.toils.toils.some(toil => toil.id === 'toil_assess_combat_risk'), 'loadGameConfigs merges combat toils');
assert(configs.toils.toils.some(toil => toil.id === 'toil_cultivate'), 'loadGameConfigs merges cultivation toils');
assert(configs.relationshipPlatform?.schemas?.ledgers?.layers?.individual, 'loadGameConfigs loads relationship ledger schema');
assert(configs.relationshipPlatform?.dictionaries?.marks?.marks?.some(mark => mark.id === 'wantedOrder'), 'loadGameConfigs loads relationship mark dictionary');
assert(configs.relationshipPlatform?.impactRules?.some(file => file.rules?.some(rule => rule.id === 'combat_kill_public_wanted_order')), 'loadGameConfigs loads relationship impact rules');
assert(configs.relationshipPlatform?.signalRules?.some(file => file.rules?.some(rule => rule.id === 'wanted_hunt_signal')), 'loadGameConfigs loads relationship signal rules');
assert(configs.economicTransactionConfig?.scenarios?.quest_contract, 'loadGameConfigs loads economic transaction scenarios');
assert(configs.economicTransactionConfig?.auction?.defaultLots?.some(lot => lot.itemId === 'item_breakthrough_pill'), 'loadGameConfigs loads abstract auction defaults');

console.log('6) WorldEngine can initialize Job/Toil configs twice in one process');
const { WorldEngine } = await imp('js/engine/world-engine.js');
const { RelationshipSystem } = await imp('js/engine/world/relationship-system.js');
const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');

const relationshipSystem = new RelationshipSystem({
  enabled: true,
  platform: configs.relationshipPlatform,
});
relationshipSystem.addMark({
  layer: 'faction',
  factionId: 'sect_001',
  subjectId: 'npc_config_target',
  type: 'wantedOrder',
  weight: 55,
  day: 1,
});
assert(
  relationshipSystem.getSignals({
    actor: { id: 'npc_config_hunter', factionId: 'sect_001' },
    target: { id: 'npc_config_target' },
    contextType: 'action',
    actionId: 'act_npc_job_hunt_enemy',
  }).gates.canTriggerWantedHunt === true,
  'loaded relationshipPlatform can construct working RelationshipSystem',
);

const firstEngine = new WorldEngine();
firstEngine.init(configs);
assert(JobPool.has('job_npc_prepare_dynamic_event'), 'first WorldEngine init registers dynamic event job');
assert(ToilPool.getDefinition('toil_resolve_target'), 'first WorldEngine init registers resolve-target toil');
assert(ToilPool.getExecutor('toil_resolve_target'), 'first WorldEngine init registers resolve-target executor');
firstEngine.relationshipSystem.addMark({
  layer: 'faction',
  factionId: 'sect_001',
  subjectId: 'npc_engine_target',
  type: 'wantedOrder',
  weight: 60,
  day: 1,
});
assert(
  firstEngine.relationshipSystem.getSignals({
    actor: { id: 'npc_engine_hunter', factionId: 'sect_001' },
    target: { id: 'npc_engine_target' },
    contextType: 'action',
    actionId: 'act_npc_job_hunt_enemy',
  }).gates.canTriggerWantedHunt === true,
  'WorldEngine injects relationshipPlatform into RelationshipSystem',
);
const firstNpc = firstEngine.entityRegistry.getAliveByType('npc')[0];
const enabledActionIds = new Set(firstNpc.behaviorSystem.availableActions.map(action => action.id));
assert(firstNpc.state.get('jobsEnabled') === true, 'default NPC state records jobsEnabled=true');
assert(enabledActionIds.has('act_npc_prepare_secret_realm'), 'default NPC action set includes dynamic JobAction when jobs enabled');
assert(enabledActionIds.has('act_npc_acquire_artifact'), 'default NPC action set includes economy JobAction when jobs enabled');
assert(enabledActionIds.has('act_npc_prepare_combat'), 'default NPC action set includes combat preparation JobAction when jobs enabled');
assert(enabledActionIds.has('act_npc_retreat_and_heal'), 'default NPC action set includes combat recovery JobAction when jobs enabled');
assert(enabledActionIds.has('act_npc_request_hunt_companion'), 'default NPC action set includes hunt companion JobAction when jobs enabled');
assert(firstNpc.needSystem.getNeed('need_npc_combat_recovery'), 'default NPC installs combat recovery need');
assert(firstNpc.needSystem.getNeed('need_npc_combat_supply'), 'default NPC installs combat supply need');
assert(firstNpc.needSystem.getNeed('need_npc_hunt_companion'), 'default NPC installs hunt companion need');
const firstContext = firstEngine.tickManager._contextBuilder.build();
assert(firstContext.economicSystem === firstEngine.economicSystem, 'worldContext exposes EconomicSystem instance');
assert(typeof firstContext.settleTransaction === 'function', 'worldContext exposes settleTransaction economic port');
assert(typeof firstContext.openEscrow === 'function', 'worldContext exposes openEscrow economic port');
assert(typeof firstContext.economicSignalsFor === 'function', 'worldContext exposes economicSignalsFor port');
assert(Array.isArray(firstEngine.getWorldSnapshot().economic?.ledger?.records), 'WorldEngine snapshot exposes economic ledger state');

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

console.log('7) jobs.enabled=false remains a runtime rollback switch');
const disabledConfigs = JSON.parse(JSON.stringify(configs));
disabledConfigs.aiConfig.npc.jobs.enabled = false;
const disabledEngine = new WorldEngine();
disabledEngine.init(disabledConfigs);
const disabledNpc = disabledEngine.entityRegistry.getAliveByType('npc')[0];
const disabledActionIds = new Set(disabledNpc.behaviorSystem.availableActions.map(action => action.id));
assert(disabledNpc.state.get('jobsEnabled') === false, 'disabled NPC state records jobsEnabled=false');
assert(!disabledActionIds.has('act_npc_prepare_secret_realm'), 'disabled NPC action set excludes dynamic JobAction');
assert(!disabledActionIds.has('act_npc_acquire_artifact'), 'disabled NPC action set excludes economy JobAction');
assert(!disabledActionIds.has('act_npc_job_cultivate'), 'disabled NPC action set excludes migrated cultivation JobAction');
assert(disabledActionIds.has('act_npc_serve_faction'), 'disabled NPC action set keeps non-migrated SimpleAction behavior');

if (failed > 0) {
  console.error(`\nJob config load tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nJob config load tests passed');
