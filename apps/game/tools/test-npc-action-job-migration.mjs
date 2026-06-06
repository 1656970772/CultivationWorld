#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

const migrated = [
  'act_npc_cultivate',
  'act_npc_train_chamber',
  'act_npc_heal',
  'act_npc_explore',
  'act_npc_accept_hunt_quest',
  'act_npc_accept_quest',
  'act_npc_do_quest',
  'act_npc_turn_in_quest',
  'act_npc_redeem_qi_pill',
  'act_npc_use_qi_pill',
  'act_npc_hunt_enemy',
  'act_npc_kill_enemy',
  'act_npc_teach_disciple',
  'act_npc_visit_master'
];

const replacement = new Map([
  ['act_npc_cultivate', 'act_npc_job_cultivate'],
  ['act_npc_train_chamber', 'act_npc_job_train_chamber'],
  ['act_npc_heal', 'act_npc_job_heal'],
  ['act_npc_explore', 'act_npc_job_explore'],
  ['act_npc_accept_hunt_quest', 'act_npc_accept_monster_hunt_job'],
  ['act_npc_accept_quest', 'act_npc_accept_quest_job'],
  ['act_npc_do_quest', 'act_npc_execute_quest_job'],
  ['act_npc_turn_in_quest', 'act_npc_turn_in_quest_job'],
  ['act_npc_redeem_qi_pill', 'act_npc_job_redeem_qi_pill'],
  ['act_npc_use_qi_pill', 'act_npc_job_use_qi_pill'],
  ['act_npc_hunt_enemy', 'act_npc_job_hunt_enemy'],
  ['act_npc_kill_enemy', 'act_npc_job_kill_enemy'],
  ['act_npc_teach_disciple', 'act_npc_job_teach_disciple'],
  ['act_npc_visit_master', 'act_npc_job_visit_master']
]);

const npcActions = load('data/actions/npc-actions.json');
const npcJobActions = load('data/actions/npc-job-actions.json');
const actionSets = load('data/actions/npc-action-sets.json');
const npcDefaultBt = load('data/behavior-trees/npc-default.json');
const { NPC_DEFAULT_BT } = await imp('js/engine/abstract/bt/index.js');
const npcActionsFacade = readFileSync(resolve(GAME_ROOT, 'js/engine/npc/npc-actions.js'), 'utf-8');
const simpleIds = new Set(npcActions.map(a => a.id));
const jobIds = new Set(npcJobActions.map(a => a.id));

function collectActionIds(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectActionIds(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (typeof node.actionId === 'string') out.push(node.actionId);
  for (const value of Object.values(node)) collectActionIds(value, out);
  return out;
}

for (const oldId of migrated) {
  assert(!simpleIds.has(oldId), `${oldId} removed from npc-actions.json`);
  assert(!actionSets.defaultNpcActionIds.includes(oldId), `${oldId} removed from defaultNpcActionIds`);
  const newId = replacement.get(oldId);
  assert(jobIds.has(newId), `${newId} exists in npc-job-actions.json`);
  assert(actionSets.defaultNpcJobActionIds.includes(newId), `${newId} appears in defaultNpcJobActionIds`);
}

for (const action of npcJobActions) {
  assert(action.executionKind === 'job', `${action.id} is executionKind=job`);
  assert(action.jobId?.startsWith('job_'), `${action.id} references a job_ id`);
}

const behaviorTreeActionIds = [
  ...collectActionIds(npcDefaultBt.root),
  ...collectActionIds(NPC_DEFAULT_BT),
];
for (const oldId of migrated) {
  assert(!behaviorTreeActionIds.includes(oldId), `${oldId} removed from default BT actionId entries`);
}
assert(
  behaviorTreeActionIds.includes(replacement.get('act_npc_cultivate')),
  'default BT suppress-inner-demon uses migrated cultivation JobAction',
);

for (const oldExecutorName of [
  'NPCAcceptQuestExecutor',
  'NPCDoQuestExecutor',
  'NPCTurnInQuestExecutor',
  'NPCCultivateExecutor',
  'NPCExploreExecutor',
  'NPCHuntEnemyExecutor',
  'NPCKillEnemyExecutor',
  'NPCTeachDiscipleExecutor',
  'NPCVisitMasterExecutor',
]) {
  assert(!npcActionsFacade.includes(oldExecutorName), `npc-actions.js no longer exposes migrated ${oldExecutorName}`);
}

if (failed > 0) {
  console.error(`\nNPC Action migration guard failed: ${failed}`);
  process.exit(1);
}
console.log('\nNPC Action migration guard passed');
