#!/usr/bin/env node
import { resolveCombatEncounter } from '../js/engine/combat/combat-encounter.js';

let failed = 0;

function assertEqual(actual, expected, message) {
  if (Object.is(actual, expected)) {
    console.log('  OK:', message);
    return;
  }
  console.error(`  FAIL: ${message} (expected ${expected}, got ${actual})`);
  failed++;
}

const numericWorldContext = {
  balanceConfig: {
    combat: {
      cultivatorAttributes: {
        numericArmorDamage: true,
      },
    },
    monsterSpawn: {
      combat: {
        damageMultiplier: 1,
      },
    },
  },
};

const legacyWorldContext = {
  balanceConfig: {
    monsterSpawn: {
      combat: {
        damageMultiplier: 1,
      },
    },
  },
};

const numericAmbush = resolveCombatEncounter({
  scene: 'monster_ambush',
  power: 100,
  defense: 100,
  random: () => 0.5,
  worldContext: numericWorldContext,
});
assertEqual(numericAmbush.damage, 50, 'numeric monster_ambush uses numeric armor damage');

const legacyAmbush = resolveCombatEncounter({
  scene: 'monster_ambush',
  power: 100,
  defense: 0.4,
  random: () => 0.5,
  worldContext: legacyWorldContext,
});
assertEqual(legacyAmbush.damage, 60, 'legacy monster_ambush keeps proportional defense damage');

const numericPvp = resolveCombatEncounter({
  scene: 'pvp',
  power: 100,
  defense: 100,
  random: () => 0,
  worldContext: numericWorldContext,
});
assertEqual(numericPvp.damage, 50, 'numeric pvp uses numeric armor without random multiplier');

const numericCounter = resolveCombatEncounter({
  scene: 'monster_counter',
  power: 90,
  randomBonus: 20,
  defense: 50,
  random: () => 0.5,
  worldContext: numericWorldContext,
});
assertEqual(numericCounter.damage, 100 * (100 / 150), 'numeric monster_counter uses power plus random bonus as attack');

if (failed > 0) {
  console.error(`\nCombat numeric armor tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nCombat numeric armor tests passed');
