#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));

const allowedRanks = new Set([
  'mortal',
  'qi_refining',
  'foundation_building',
  'golden_core',
  'nascent_soul',
  'spirit_transformation',
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
const combat = load('data/balance/combat.json');
const movement = load('data/balance/movement.json');

console.log('1) ranks.json only contains cultivation rank ids');
ok(ranks.length === allowedRanks.size, 'rank count is exactly 6');
ok(ranks.every((rank) => allowedRanks.has(rank.id)), 'every rank id is an allowed cultivation rank');
ok(!ranks.some((rank) => removedRanks.has(rank.id)), 'removed title ids are absent from ranks.json');
ok(ranks.every((rank) => rank.lifespan && typeof rank.lifespan.baseYears === 'number'), 'each rank keeps lifespan data');
ok(ranks.filter((rank) => rank.category === 'cultivation').length === 5, 'five cultivation ranks remain above mortal');

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

if (failures > 0) {
  console.error(`\nRank cleanup tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nRank cleanup tests passed');
