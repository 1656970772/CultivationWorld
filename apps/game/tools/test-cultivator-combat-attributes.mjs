#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));

const combatBaseTable = load('data/definitions/combat-base-table.json');
const cultivatorCombat = load('data/definitions/cultivator-combat.json');

const {
  RANK_STAGE_MULTIPLIERS,
  normalizeRankStage,
  calculateCultivatorCombatAttributes,
  readEffectiveCombatAttribute,
  calculateNumericArmorDamage,
} = await import(new URL('../js/engine/npc/cultivator-combat-attributes.js', import.meta.url).href);

const tables = { combatBaseTable, cultivatorCombat };
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('  FAIL:', message);
    failures++;
  } else {
    console.log('  OK:', message);
  }
}

function assertEqual(actual, expected, message) {
  assert(Object.is(actual, expected), `${message} (expected ${expected}, got ${actual})`);
}

console.log('1) loads combat definition tables');
assertEqual(combatBaseTable.stageMultipliers.perfection, 2, 'combat-base-table defines perfection multiplier');
assertEqual(cultivatorCombat.ranks.qi_refining.hp, 220, 'cultivator-combat defines qi_refining hp');

console.log('2) normalizes rank stages');
assertEqual(RANK_STAGE_MULTIPLIERS.perfection, 2, 'perfection multiplier is 2');
assertEqual(normalizeRankStage('late', 'qi_refining'), 'late', 'late stage is valid');
assertEqual(normalizeRankStage('bad', 'qi_refining'), 'early', 'bad qi_refining stage falls back to early');
assertEqual(normalizeRankStage('late', 'mortal'), null, 'mortal stage normalizes to null');

console.log('3) calculates qi_refining late combat attributes');
const qiRefiningLate = calculateCultivatorCombatAttributes({
  rankId: 'qi_refining',
  rankStage: 'late',
  tables,
});
assertEqual(qiRefiningLate.maxHp, Math.round(220 * 1.45), 'qi_refining late maxHp scales by stage');
assertEqual(qiRefiningLate.hp, qiRefiningLate.maxHp, 'qi_refining late hp equals maxHp');
assertEqual(qiRefiningLate.maxYuan, Math.round(150 * 1.45), 'qi_refining late maxYuan scales by stage');
assertEqual(qiRefiningLate.yuan, qiRefiningLate.maxYuan, 'qi_refining late yuan equals maxYuan');
assertEqual(qiRefiningLate.attack, Math.round(48 * 1.45), 'qi_refining late attack scales by stage');
assertEqual(qiRefiningLate.soul, Math.round(32 * 1.45), 'qi_refining late soul scales by stage');

console.log('4) calculates mortal attributes without stage multiplier');
const mortal = calculateCultivatorCombatAttributes({ rankId: 'mortal', rankStage: 'perfection', tables });
assertEqual(mortal.rankStage, null, 'mortal calculated rankStage is null');
assertEqual(mortal.maxYuan, 0, 'mortal maxYuan is 0');
assertEqual(mortal.attack, 16, 'mortal attack ignores rank stage multiplier');

console.log('5) reads effective combat attributes');
const effectiveEntity = {
  attributes: {
    getEffective: (key) => (key === 'attack' ? 42 : undefined),
  },
  state: {
    get: () => 7,
  },
};
assertEqual(readEffectiveCombatAttribute(effectiveEntity, 'attack', 1), 42, 'attributes.getEffective finite number has priority');

const stateEntity = {
  state: {
    get: (key) => (key === 'defense' ? 11 : undefined),
  },
};
assertEqual(readEffectiveCombatAttribute(stateEntity, 'defense', 1), 11, 'state.get is used when attributes are absent');
assertEqual(readEffectiveCombatAttribute(null, 'speed', 9), 9, 'fallback is used when entity is absent');

console.log('6) calculates numeric armor damage');
assertEqual(calculateNumericArmorDamage({
  attack: 100,
  defense: 100,
  skillMultiplier: 1,
  sceneMultiplier: 1,
  randomMultiplier: 1,
}), 50, 'equal attack and defense halves damage');
assertEqual(calculateNumericArmorDamage({ attack: 100, defense: 0, skillMultiplier: 2 }), 200, 'zero defense takes full skill damage');
assertEqual(calculateNumericArmorDamage({ attack: 0, defense: 100, randomMultiplier: 1 }), 1, 'minimum damage is 1');

if (failures > 0) {
  console.error(`\nCultivator combat attribute tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nCultivator combat attribute tests passed');
