#!/usr/bin/env node
import { resolveCombatEncounter } from '../js/engine/combat/combat-encounter.js';
import { ItemRegistry } from '../js/engine/items/item-registry.js';
import { TickManager } from '../js/engine/world/tick-manager.js';

let failed = 0;
const EPSILON = 1e-9;

function assertNear(actual, expected, message) {
  if (Math.abs(actual - expected) <= EPSILON) {
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

const enabledWithoutNumericArmorWorldContext = {
  balanceConfig: {
    combat: {
      cultivatorAttributes: {
        enabled: true,
        numericArmorDamage: false,
      },
    },
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
assertNear(numericAmbush.damage, 50, 'numeric monster_ambush uses numeric armor damage');

const legacyAmbush = resolveCombatEncounter({
  scene: 'monster_ambush',
  power: 100,
  defense: 0.4,
  random: () => 0.5,
  worldContext: legacyWorldContext,
});
assertNear(legacyAmbush.damage, 60, 'legacy monster_ambush keeps proportional defense damage');

const enabledWithoutNumericArmorAmbush = resolveCombatEncounter({
  scene: 'monster_ambush',
  power: 100,
  defense: 0.4,
  random: () => 0.5,
  worldContext: enabledWithoutNumericArmorWorldContext,
});
assertNear(
  enabledWithoutNumericArmorAmbush.damage,
  60,
  'cultivatorAttributes enabled without numericArmorDamage keeps proportional defense damage',
);

const numericPvp = resolveCombatEncounter({
  scene: 'pvp',
  power: 100,
  defense: 100,
  random: () => 0,
  worldContext: numericWorldContext,
});
assertNear(numericPvp.damage, 50, 'numeric pvp uses numeric armor without random multiplier');

const numericPvpWithSceneMultiplier = resolveCombatEncounter({
  scene: 'pvp',
  power: 100,
  defense: 100,
  random: () => 0,
  worldContext: {
    balanceConfig: {
      combat: {
        cultivatorAttributes: {
          numericArmorDamage: true,
        },
        encounterScenes: {
          pvp: {
            damageMultiplier: 0.5,
          },
        },
      },
    },
  },
});
assertNear(numericPvpWithSceneMultiplier.damage, 25, 'numeric pvp applies scene damageMultiplier');

const numericCounter = resolveCombatEncounter({
  scene: 'monster_counter',
  power: 90,
  randomBonus: 20,
  defense: 50,
  random: () => 0.5,
  worldContext: numericWorldContext,
});
assertNear(numericCounter.damage, 100 * (100 / 150), 'numeric monster_counter uses power plus random bonus as attack');

ItemRegistry.clear();
ItemRegistry.loadFromArray([{
  id: 'artifact_green_sword',
  name: '青锋剑',
  category: 'artifact',
  combatBonus: 0.5,
}]);

function makeCombatPowerManager(cultivatorAttributes) {
  return new TickManager({
    entityRegistry: {
      getAliveByType: () => [],
      getByType: () => [],
      getById: () => null,
    },
    worldEntity: {
      currentDay: 0,
      state: {
        get: () => null,
        setMany: () => {},
      },
    },
    ranksData: [{ id: 'qi_refining', successionScore: 10 }],
    balanceConfig: {
      combat: {
        cultivatorAttributes,
      },
    },
    gameConfig: {},
  });
}

const numericCombatNpc = {
  attributes: {
    getEffective: (key) => ({
      attack: 100,
      defense: 50,
      speed: 20,
      soul: 10,
    })[key],
  },
  state: {
    get: (key) => ({
      injuryLevel: 2,
      equippedArtifactId: 'artifact_green_sword',
    })[key],
  },
};
const numericCombatPower = makeCombatPowerManager({ enabled: true })._npcCombatPower(numericCombatNpc);
assertNear(
  numericCombatPower,
  (100 + 50 * 0.7 + 20 * 0.35 + 10 * 0.25) * (1 - 2 * 0.08),
  'cultivatorAttributes enabled combat power does not multiply legacy artifactFactor',
);

const legacyCombatNpc = {
  state: {
    get: (key) => ({
      rankId: 'qi_refining',
      qi: 0,
      injuryLevel: 0,
      equippedArtifactId: 'artifact_green_sword',
    })[key],
  },
};
const legacyCombatPower = makeCombatPowerManager({ enabled: false })._npcCombatPower(legacyCombatNpc);
assertNear(
  legacyCombatPower,
  (10 + 1) * 1.5,
  'legacy combat power keeps artifactFactor',
);

if (failed > 0) {
  console.error(`\nCombat numeric armor tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nCombat numeric armor tests passed');
