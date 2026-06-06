#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const read = (path) => readFileSync(resolve(GAME_ROOT, path), 'utf-8');
const load = (path) => JSON.parse(read(path));

const combatConfig = load('data/balance/combat.json');
const combatBaseTable = load('data/definitions/combat-base-table.json');
const cultivatorCombat = load('data/definitions/cultivator-combat.json');
const monsterCombat = load('data/definitions/monster-combat.json');
const npcStateSource = read('js/engine/npc/npc-state.js');
const npcEntitySource = read('js/engine/npc/npc-entity.js');
const npcLifecycleSource = read('js/engine/npc/npc-lifecycle.js');
const worldEngineSource = read('js/engine/world-engine.js');

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

function assertIncludes(source, fragment, message) {
  assert(source.includes(fragment), message);
}

function assertMatches(source, pattern, message) {
  assert(pattern.test(source), message);
}

console.log('1) combat switch exists');
assertEqual(combatConfig.cultivatorAttributes?.enabled, false, 'cultivatorAttributes.enabled defaults false');
assertEqual(combatConfig.cultivatorAttributes?.numericArmorDamage, false, 'numericArmorDamage defaults false');

console.log('2) NPCState contains new base fields');
for (const field of ['rankStage', 'yuan', 'maxYuan', 'attack', 'defense', 'speed', 'soul']) {
  assertIncludes(npcStateSource, `${field}:`, `NPCState initializes ${field}`);
}

console.log('3) NPCEntity wires calculator and refresh hooks');
assertIncludes(npcEntitySource, "from './cultivator-combat-attributes.js'", 'NPCEntity imports cultivator combat attribute helpers');
assertIncludes(npcEntitySource, '_initCombatAttributes()', 'NPCEntity defines _initCombatAttributes');
assertIncludes(npcEntitySource, 'refreshCombatAttributesOnBreakthrough()', 'NPCEntity defines refreshCombatAttributesOnBreakthrough');
assertMatches(
  npcEntitySource,
  /_computeMaxHp\(\)\s*\{[\s\S]*readEffectiveCombatAttribute\(this,\s*'maxHp'/,
  '_computeMaxHp reads effective maxHp when cultivatorAttributes is enabled',
);

console.log('4) breakthrough resets stage and refreshes attributes');
assertIncludes(
  npcLifecycleSource,
  "entity.state.set('rankStage', nextRank.id === 'mortal' ? null : 'early')",
  'breakthrough success resets rankStage for the new rank',
);
assertIncludes(
  npcLifecycleSource,
  'refreshCombatAttributesOnBreakthrough',
  'breakthrough success refreshes combat attributes',
);

console.log('5) WorldEngine passes combat tables');
for (const fragment of [
  'combatBaseTable: configs.combatBaseTable || null',
  'cultivatorCombat: configs.cultivatorCombat || null',
  'monsterCombat: configs.monsterCombat || null',
  'combatTables: this._combatTables',
]) {
  assertIncludes(worldEngineSource, fragment, `WorldEngine contains ${fragment}`);
}

console.log('6) default switch keeps old hp initialization');
const { NPCEntity } = await import(new URL('../js/engine/npc/npc-entity.js', import.meta.url).href);
const ranks = load('data/definitions/ranks.json');
const gameConfig = load('data/config/game-config.json');
const cultivationConfig = load('data/balance/cultivation.json');
const npc = new NPCEntity(
  {
    id: 'npc_runtime_attribute_test',
    name: 'Runtime Attribute Test',
    role: 'disciple',
    rankId: 'qi_refining',
    factionId: null,
    spiritRootId: 'triple',
    physiqueId: 'mortal_body',
  },
  ranks,
  {
    gameConfig,
    combatConfig,
    cultivationConfig: { traitEffects: { enabled: false } },
    aiConfig: { maxDepth: 1, maxIterations: 1 },
  },
);
assertEqual(npc.state.get('maxHp'), combatConfig.npcHp.baseHp.qi_refining, 'default switch uses legacy npcHp baseHp');
assertEqual(npc.state.get('hp'), npc.state.get('maxHp'), 'legacy initialization fills hp to maxHp');

console.log('7) enabled switch writes physique-scaled runtime hp and refreshes without healing');
const enabledCombatConfig = JSON.parse(JSON.stringify(combatConfig));
enabledCombatConfig.cultivatorAttributes.enabled = true;
const combatTables = { combatBaseTable, cultivatorCombat, monsterCombat };
const combatNpc = new NPCEntity(
  {
    id: 'npc_runtime_attribute_enabled_test',
    name: 'Runtime Attribute Enabled Test',
    role: 'disciple',
    rankId: 'qi_refining',
    rankStage: 'late',
    factionId: null,
    spiritRootId: 'triple',
    physiqueId: 'war_body',
  },
  ranks,
  {
    gameConfig,
    combatConfig: enabledCombatConfig,
    cultivationConfig,
    combatTables,
    aiConfig: { maxDepth: 1, maxIterations: 1 },
  },
);
const qiLateMaxHp = Math.round(220 * 1.45 * 2.5);
assertEqual(combatNpc.state.get('rankStage'), 'late', 'enabled initialization preserves valid rankStage');
assertEqual(combatNpc.state.get('maxHp'), qiLateMaxHp, 'enabled initialization writes physique-scaled maxHp');
assertEqual(combatNpc.state.get('hp'), qiLateMaxHp, 'enabled initialization fills hp to scaled maxHp');
assertEqual(combatNpc.state.get('maxYuan'), Math.round(150 * 1.45), 'enabled initialization writes scaled maxYuan');
assertEqual(combatNpc.state.get('yuan'), Math.round(150 * 1.45), 'enabled initialization fills yuan to maxYuan');
assertEqual(combatNpc.state.get('attack'), Math.round(48 * 1.45), 'enabled initialization writes scaled attack');
assertEqual(combatNpc.state.get('defense'), Math.round(18 * 1.45), 'enabled initialization writes scaled defense');
assertEqual(combatNpc.state.get('speed'), Math.round(25 * 1.45), 'enabled initialization writes scaled speed');
assertEqual(combatNpc.state.get('soul'), Math.round(32 * 1.45), 'enabled initialization writes scaled soul');

combatNpc.state.set('hp', 123);
combatNpc.state.set('yuan', 45);
combatNpc.state.set('rankId', 'foundation_building');
combatNpc.state.set('rankStage', 'early');
combatNpc.refreshCombatAttributesOnBreakthrough();
assertEqual(combatNpc.state.get('rankStage'), 'early', 'refresh keeps normalized early rankStage');
assertEqual(combatNpc.state.get('maxHp'), Math.round(650 * 2.5), 'refresh writes physique-scaled foundation maxHp');
assertEqual(combatNpc.state.get('hp'), 123, 'refresh clamps hp without healing when below new maxHp');
assertEqual(combatNpc.state.get('maxYuan'), 560, 'refresh writes foundation maxYuan');
assertEqual(combatNpc.state.get('yuan'), 45, 'refresh clamps yuan without refilling when below new maxYuan');
assertEqual(combatNpc.state.get('attack'), 145, 'refresh writes foundation attack');

if (failures > 0) {
  console.error(`\nNPC combat attribute runtime tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nNPC combat attribute runtime tests passed');
