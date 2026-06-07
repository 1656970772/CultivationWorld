#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));

const EXPECTED_REALMS = [
  { id: 'mortal', name: '凡人', threshold: 0, baseYears: 80, varianceYears: 20 },
  { id: 'qi_refining', name: '炼气', threshold: 50, baseYears: 125, varianceYears: 25 },
  { id: 'foundation_building', name: '筑基', threshold: 500, baseYears: 320, varianceYears: 60 },
  { id: 'golden_core', name: '金丹', threshold: 5000, baseYears: 750, varianceYears: 150 },
  { id: 'nascent_soul', name: '元婴', threshold: 50000, baseYears: 1500, varianceYears: 300 },
  { id: 'spirit_transformation', name: '化神', threshold: 500000, baseYears: 2200, varianceYears: 300 },
  { id: 'void_refining', name: '炼虚', threshold: 1000000, baseYears: 2850, varianceYears: 350 },
  { id: 'body_integration', name: '合体', threshold: 2000000, baseYears: 3400, varianceYears: 400 },
  { id: 'mahayana', name: '大乘', threshold: 4000000, baseYears: 3900, varianceYears: 400 },
  { id: 'tribulation', name: '渡劫', threshold: 8000000, baseYears: 4350, varianceYears: 350 },
  { id: 'earth_immortal', name: '地仙', threshold: 16000000, baseYears: 4650, varianceYears: 250 },
  { id: 'heaven_immortal', name: '天仙', threshold: 32000000, baseYears: 4850, varianceYears: 149 },
];
const allowedRanks = new Set(EXPECTED_REALMS.map((realm) => realm.id));
const bannedRuntimeRanks = new Set([
  ['great_luo', 'heaven', 'immortal'].join('_'),
  ['dao', 'ancestor'].join('_'),
]);
const removedRanks = new Set([
  'disciple',
  'outer_disciple',
  'core_disciple',
  'elder',
  'leader',
  'advisor',
  'general',
  'officer',
  'commander',
  'grandmaster',
  'martial_saint',
]);
const removedFactionIds = new Set(['sect_011', 'sect_012']);

let failures = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failures++;
}

const ranks = load('data/definitions/ranks.json');
const npcs = load('data/entities/npcs.json');
const factions = load('data/entities/factions.json');
const techniques = load('data/definitions/techniques.json');
const weapons = load('data/definitions/weapons.json');
const combat = load('data/balance/combat.json');
const movement = load('data/balance/movement.json');
const modifiers = load('data/world/modifiers.json');
const activeRuntimeFiles = [
  'data/definitions/ranks.json',
  'data/definitions/combat-base-table.json',
  'data/definitions/cultivator-combat.json',
  'data/definitions/monster-combat.json',
  'data/balance/combat.json',
  'data/balance/cultivation.json',
  'data/balance/risk.json',
  'data/balance/movement.json',
  'data/quests/quest-templates.json',
  'js/engine/world/services/population-service.js',
  'tools/trace-genius.mjs',
];

console.log('1) ranks.json only contains cultivation rank ids');
const rankIds = ranks.map((rank) => rank.id);
ok(ranks.length === EXPECTED_REALMS.length, 'rank count is exactly 12');
ok(ranks.every((rank) => allowedRanks.has(rank.id)), 'every rank id is an allowed twelve-realm runtime rank');
ok(!rankIds.some((id) => bannedRuntimeRanks.has(id)), 'old high runtime ranks are absent from ranks.json');
ok(!ranks.some((rank) => removedRanks.has(rank.id)), 'removed title ids are absent from ranks.json');
ok(ranks.every((rank) => rank.lifespan && typeof rank.lifespan.baseYears === 'number'), 'each rank keeps lifespan data');
ok(ranks.filter((rank) => rank.category === 'cultivation').length === 11, 'eleven cultivation ranks remain above mortal');
EXPECTED_REALMS.forEach((realm, index) => {
  const rank = ranks[index];
  const expectedOrder = index * 20;
  const expectedMaxLifespan = realm.baseYears + realm.varianceYears;
  ok(rank?.id === realm.id, `rank index ${index} is ${realm.id}`);
  ok(rank?.name === realm.name, `${realm.id} name is ${realm.name}`);
  ok(rank?.category === (index === 0 ? 'mortal' : 'cultivation'), `${realm.id} category is correct`);
  ok(rank?.order === expectedOrder, `${realm.id} order is ${expectedOrder}`);
  ok(rank?.successionScore === expectedOrder, `${realm.id} successionScore is ${expectedOrder}`);
  ok(rank?.cultivationRequired === realm.threshold, `${realm.id} cultivationRequired is ${realm.threshold}`);
  ok(rank?.qiRequired === realm.threshold, `${realm.id} qiRequired is ${realm.threshold}`);
  ok(rank?.lifespan?.baseYears === realm.baseYears, `${realm.id} lifespan.baseYears is ${realm.baseYears}`);
  ok(rank?.lifespan?.varianceYears === realm.varianceYears, `${realm.id} lifespan.varianceYears is ${realm.varianceYears}`);
  ok(
    (rank?.lifespan?.baseYears ?? 0) + (rank?.lifespan?.varianceYears ?? 0) === expectedMaxLifespan,
    `${realm.id} max lifespan is ${expectedMaxLifespan}`
  );
});

console.log('2) npcs.json never uses title ids as rankId');
const invalidNpcRanks = npcs
  .filter((npc) => !allowedRanks.has(npc.rankId))
  .map((npc) => `${npc.id}:${npc.name}:${npc.rankId}`);
ok(invalidNpcRanks.length === 0, `invalid npc rank ids: ${invalidNpcRanks.join(', ') || 'none'}`);

console.log('3) initial runtime world has no mortal kingdom factions or members');
ok(!factions.some((faction) => faction.type === 'mortal_kingdom'), 'no faction has type=mortal_kingdom');
ok(!factions.some((faction) => removedFactionIds.has(faction.id)), 'removed faction ids are absent');
ok(!npcs.some((npc) => removedFactionIds.has(npc.factionId)), 'removed faction ids are absent from NPC factionId');
for (const faction of factions) {
  const relationIds = Object.keys(faction.relations || {});
  ok(!relationIds.some((id) => removedFactionIds.has(id)), `${faction.id} relations do not reference removed kingdoms`);
}

console.log('4) rank keyed balance maps do not keep title ids');
const baseHp = combat.npcHp?.baseHp || {};
const baseDef = combat.npcCombat?.baseDef || {};
const npcSpeed = movement.npcSpeedByRank || {};
ok(!Object.keys(baseHp).some((id) => removedRanks.has(id)), 'combat.npcHp.baseHp has no title rank keys');
ok(!Object.keys(baseDef).some((id) => removedRanks.has(id)), 'combat.npcCombat.baseDef has no title rank keys');
ok(!Object.keys(npcSpeed).some((id) => removedRanks.has(id)), 'movement.npcSpeedByRank has no title rank keys');
ok(!modifiers.some((modifier) => Object.hasOwn(modifier.effects || {}, 'mortal_stability')), 'world modifiers have no mortal_stability effect');
ok(!techniques.some((technique) => (technique.factionAffinities || []).includes('mortal_kingdom')), 'techniques have no mortal_kingdom affinity');
ok(!weapons.some((weapon) => removedFactionIds.has(weapon.school)), 'weapons do not reference removed kingdom schools');

console.log('5) active runtime files do not keep old high runtime rank keys');
for (const file of activeRuntimeFiles) {
  const source = readFileSync(resolve(GAME_ROOT, file), 'utf-8');
  for (const bannedRank of bannedRuntimeRanks) {
    ok(!source.includes(bannedRank), `${file} has no old runtime key ${bannedRank}`);
  }
}

if (failures > 0) {
  console.error(`\nRank cleanup tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nRank cleanup tests passed');
