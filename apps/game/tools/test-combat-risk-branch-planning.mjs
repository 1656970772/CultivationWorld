#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Action } = await imp('js/engine/abstract/action.js');
const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

function actionList() {
  return load('data/actions/npc-job-actions.json').map((config) => new Action(config));
}

function planIds(currentState, goalState) {
  const planner = new GOAPPlanner({ maxDepth: 4, maxIterations: 200 });
  const result = planner.plan(currentState, goalState, actionList());
  return { result, ids: result.plan.map((action) => action.id) };
}

console.log('1) needsCombatRecovery=true 规划撤退疗伤');
let plan = planIds(
  { alive: true, needsCombatRecovery: true, shouldRetreat: true, injuryLevel: 2 },
  { needsCombatRecovery: { op: 'false' }, shouldRetreat: { op: 'false' } },
);
assert(plan.result.success === true, 'needsCombatRecovery has a GOAP plan');
assert(plan.ids.includes('act_npc_retreat_and_heal'), 'needsCombatRecovery plans act_npc_retreat_and_heal');

console.log('2) needsCombatSupply=true 规划战斗补给');
plan = planIds(
  { alive: true, needsCombatSupply: true, combatReady: false },
  { needsCombatSupply: { op: 'false' }, combatReady: { op: 'true' } },
);
assert(plan.result.success === true, 'needsCombatSupply has a GOAP plan');
assert(
  plan.ids.includes('act_npc_acquire_heal_item') || plan.ids.includes('act_npc_prepare_combat'),
  'needsCombatSupply plans acquire heal item or prepare combat',
);

console.log('3) needsCompanion=true 规划请求斩妖同伴');
plan = planIds(
  { alive: true, needsCompanion: true, huntCompanionRequested: false, hasHuntCompanion: false },
  { hasHuntCompanion: { op: 'true' } },
);
assert(plan.result.success === true, 'needsCompanion has a GOAP plan');
assert(plan.ids.includes('act_npc_request_hunt_companion'), 'needsCompanion plans act_npc_request_hunt_companion');

if (failed > 0) {
  console.error(`\nCombat risk branch planning tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nCombat risk branch planning tests passed');
