#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

const combatEncounterUrl = pathToFileURL(resolve(GAME_ROOT, 'js/engine/combat/combat-encounter.js')).href;
const { resolveCombatEncounter } = await import(combatEncounterUrl);

function assertUnifiedEncounter(result, scene) {
  assert(result?.scene === scene, `${scene} records scene`);
  for (const key of ['hit', 'damage', 'winChance', 'injuryGain', 'retreatSuggested', 'deathInfo', 'experienceContext']) {
    assert(Object.prototype.hasOwnProperty.call(result, key), `${scene} exposes unified field ${key}`);
  }
  assert(typeof result.damage === 'number' && result.damage >= 0, `${scene} returns numeric damage`);
  assert(typeof result.injuryGain === 'number' && result.injuryGain >= 0, `${scene} returns numeric injuryGain`);
  assert(typeof result.retreatSuggested === 'boolean', `${scene} returns boolean retreatSuggested`);
  assert(result.experienceContext?.sourceKind === scene, `${scene} exposes scene sourceKind`);
}

const attacker = { id: 'monster_g1', name: 'Green Wolf' };
const defender = {
  id: 'npc_qi',
  name: 'Lu Qing',
  state: {
    get: (key) => ({ hp: 120, maxHp: 120 }[key]),
    set() {},
  },
};
const fixedRandom = () => 0.5;

const ambush = resolveCombatEncounter({
  attacker,
  defender,
  scene: 'monster_ambush',
  power: 100,
  defense: 0.2,
  random: fixedRandom,
  worldContext: { balanceConfig: { monsterSpawn: { combat: { damageMultiplier: 0.75 } } } },
});
assert(ambush.damage === 60, 'monster_ambush applies balanceConfig monsterSpawn damageMultiplier at mid roll');
assert(ambush.scene === 'monster_ambush', 'result records monster_ambush scene');
assert(ambush.experienceContext?.sourceKind === 'monster_ambush', 'result exposes ambush experience context');

const ambushFromWorld = resolveCombatEncounter({
  attacker,
  defender,
  scene: 'monster_ambush',
  power: 100,
  defense: 0.2,
  random: fixedRandom,
  worldContext: { monsterSpawn: { combat: { damageMultiplier: 0.5 } } },
});
assert(ambushFromWorld.damage === 40, 'monster_ambush reads fallback worldContext.monsterSpawn damageMultiplier');

const ambushDefault = resolveCombatEncounter({
  attacker,
  defender,
  scene: 'monster_ambush',
  power: 100,
  defense: 0.2,
  random: fixedRandom,
  worldContext: {},
});
assert(ambushDefault.damage === 80, 'monster_ambush defaults damageMultiplier to 1');

const hunt = resolveCombatEncounter({
  attacker: defender,
  defender: attacker,
  scene: 'monster_hunt_quest',
  power: 40,
  defenderPower: 120,
  defense: 0,
  random: fixedRandom,
  worldContext: { balanceConfig: { monsterSpawn: { combat: { damageMultiplier: 0.75 } } } },
});
assert(hunt.scene === 'monster_hunt_quest', 'monster hunt uses unified service scene');
assert(hunt.winChance === 0.25, 'monster_hunt_quest computes winChance from attacker and defender power');

const monsterCounter = resolveCombatEncounter({
  attacker: defender,
  defender: attacker,
  scene: 'monster_counter',
  power: 36,
  random: fixedRandom,
  randomBonus: 10,
  worldContext: {},
});
assertUnifiedEncounter(monsterCounter, 'monster_counter');
assert(monsterCounter.damage === 41, 'monster_counter computes counter damage through unified encounter');

const pvp = resolveCombatEncounter({
  attacker: defender,
  defender: attacker,
  scene: 'pvp',
  power: 90,
  defenderPower: 30,
  defense: 0.1,
  random: fixedRandom,
  worldContext: { balanceConfig: { combat: { encounterScenes: { pvp: { damageMultiplier: 0.5 } } } } },
});
assertUnifiedEncounter(pvp, 'pvp');
assert(pvp.winChance === 0.75, 'pvp computes winChance through unified encounter');
assert(pvp.damage === 40.5, 'pvp computes damage through unified encounter');

const questRisk = resolveCombatEncounter({
  attacker: null,
  defender,
  scene: 'quest_risk',
  maxHp: 120,
  dmgRatioMin: 0.3,
  dmgRatioMax: 0.6,
  random: fixedRandom,
  worldContext: {},
});
assertUnifiedEncounter(questRisk, 'quest_risk');
assert(Math.abs(questRisk.damage - 54) < 1e-9, 'quest_risk computes hp risk damage through unified encounter');

const monsterSpawn = JSON.parse(readFileSync(resolve(GAME_ROOT, 'data/balance/monster-spawn.json'), 'utf-8'));
assert(monsterSpawn.combat?.damageMultiplier === 0.75, 'monster-spawn combat has default damageMultiplier');
for (const tier of ['tier1', 'tier2', 'tier3']) {
  assert(monsterSpawn.behaviorByTier?.[tier]?.damageMultiplier === 0.75, `${tier} carries damageMultiplier override`);
}

const monsterEntitySource = readFileSync(resolve(GAME_ROOT, 'js/engine/monster/monster-entity.js'), 'utf-8');
assert(monsterEntitySource.includes("from '../combat/combat-encounter.js'"), 'MonsterEntity imports resolveCombatEncounter');
assert(monsterEntitySource.includes("scene: 'monster_ambush'"), 'MonsterEntity routes ambush attacks through unified scene');

const monsterResourcesSource = readFileSync(resolve(GAME_ROOT, 'js/engine/monster/monster-resources.js'), 'utf-8');
assert(monsterResourcesSource.includes("from '../combat/combat-encounter.js'"), 'monster resources import resolveCombatEncounter');
assert(monsterResourcesSource.includes("scene: 'monster_hunt_quest'"), 'settleMonsterHunt routes hunt quest through unified scene');

const monsterVsNpcSource = readFileSync(resolve(GAME_ROOT, 'tools/monster-vs-npc.mjs'), 'utf-8');
assert(monsterVsNpcSource.includes('resolveCombatEncounter'), 'monster-vs-npc uses unified combat encounter service');
assert(monsterVsNpcSource.includes('damageMultiplier'), 'monster-vs-npc outputs damageMultiplier');

const monsterVsNpcRun = spawnSync(process.execPath, [resolve(GAME_ROOT, 'tools/monster-vs-npc.mjs')], {
  cwd: GAME_ROOT,
  encoding: 'utf-8',
});
assert(monsterVsNpcRun.status === 0, 'monster-vs-npc runs successfully');
assert(monsterVsNpcRun.stdout.includes('scene=monster_ambush damageMultiplier=0.75'), 'monster-vs-npc prints ambush damageMultiplier');
assert(!monsterVsNpcRun.stdout.includes('maxHp=30'), 'monster-vs-npc interpretation uses current mortal maxHp');

if (failed > 0) {
  console.error(`\nCombat encounter tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nCombat encounter tests passed');
