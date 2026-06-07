#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');

let failures = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failures++;
}

function readGameFile(path) {
  return readFileSync(resolve(GAME_ROOT, path), 'utf-8');
}

console.log('1) config-loader uses manifest-driven runtime data loading');
const configLoaderSource = readGameFile('js/core/config-loader.js');
for (const token of [
  'data/effects/combat-effects.json',
  'data/abilities/combat-abilities.json',
  'data/items/currency.json',
]) {
  ok(!configLoaderSource.includes(token), `config-loader does not hardcode ${token}`);
}
for (const token of ['loadGameDataManifest', 'loadJsonGroup']) {
  ok(configLoaderSource.includes(token), `config-loader wires ${token}`);
}

console.log('2) follow-up hardcode watchlist for parallel workers');
const forbiddenChecks = [
  {
    file: 'js/engine/monster/monster-entity.js',
    forbidden: ['monster-bt-presets.js', 'const GRADE_TO_ORDER', 'protectedRole', "role === 'leader'", "role === 'elder'"],
    required: ['behaviorTreeRegistry', 'resolveMonsterBTTier', 'resolveMonsterOrderEquivalent'],
  },
  {
    file: 'js/engine/monster/monster-spawner.js',
    forbidden: ['if (grade >= 5)', 'if (grade >= 3)', "return 'tier1'"],
    required: ['resolveMonsterBTTier', 'aiConfig'],
  },
  {
    file: 'js/engine/combat/combat-pipeline.js',
    forbidden: ['maxHp * lockRatio', "state.set('hp', maxHp * lockRatio)"],
    required: ['tryActivateByTag', 'Trigger.LethalDamage'],
  },
  {
    file: 'js/engine/economy/asset-adapter.js',
    forbidden: ['DEFAULT_FACTION_STATE_RESOURCE_IDS', 'DEFAULT_ORGANIZATION_POINT_KEYS'],
    required: ['resourceRegistry'],
  },
  {
    file: 'js/renderer/tile-renderer.js',
    forbidden: ['sect_001', 'sect_002', 'sect_003'],
    required: ['presentation'],
  },
  {
    file: 'js/ui/map-legend.js',
    forbidden: ['TERRAIN_ITEMS', 'FACTION_ITEMS', 'sect_001'],
    required: ['presentation'],
  },
  {
    file: 'js/engine/world/relationship-system.js',
    forbidden: ['MARK_BY_EDGE_TYPE', 'TAG_BY_EDGE_TYPE', 'EDGE_TYPES_BY_MARK_TYPE', 'EDGE_TYPES_BY_TAG_TYPE'],
    required: ['compileLegacyProjectionIndex', 'legacyEdges'],
  },
];

for (const item of forbiddenChecks) {
  const source = readGameFile(item.file);
  for (const token of item.forbidden || []) {
    ok(!source.includes(token), `${item.file} does not contain ${token}`);
  }
  for (const token of item.required || []) {
    ok(source.includes(token), `${item.file} contains ${token}`);
  }
}

if (failures > 0) {
  console.error(`\nHardcode architecture audit failed: ${failures}`);
  process.exit(1);
}

console.log('\nHardcode architecture audit passed');
