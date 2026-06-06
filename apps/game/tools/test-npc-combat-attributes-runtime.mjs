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
const coreEffects = load('data/effects/core-effects.json');
const techniques = load('data/definitions/techniques.json');
const artifacts = load('data/items/artifact.json').items || [];
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

function assertNear(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-9, `${message} (expected ${expected}, got ${actual})`);
}

function byId(rows, id) {
  return rows.find(row => row.id === id);
}

function hasModifier(modifiers, attribute, op, magnitude) {
  return Array.isArray(modifiers)
    && modifiers.some(mod => mod.attribute === attribute && mod.op === op && Object.is(mod.magnitude, magnitude));
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

console.log('8) combat modifier data exists for effects, techniques, and artifacts');
const addCombatAttribute = byId(coreEffects.effects || [], 'ge_add_combat_attribute');
const combatAttributeModifier = byId(coreEffects.effects || [], 'ge_combat_attribute_modifier');
assert(!!addCombatAttribute, 'core effects define ge_add_combat_attribute');
assert(!!combatAttributeModifier, 'core effects define ge_combat_attribute_modifier');
assertEqual(addCombatAttribute?.durationType, 'instant', 'ge_add_combat_attribute is instant');
assertEqual(combatAttributeModifier?.durationType, 'infinite', 'ge_combat_attribute_modifier is infinite');
for (const id of ['tech_sword_green', 'tech_blazing_sword']) {
  const mods = byId(techniques, id)?.effects?.combatModifiers;
  assert(hasModifier(mods, 'attack', 'multiply', 1.12), `${id} multiplies attack`);
  assert(hasModifier(mods, 'speed', 'multiply', 1.08), `${id} multiplies speed`);
}
for (const id of ['tech_iron_body', 'tech_dragon_body', 'tech_nine_turns']) {
  const mods = byId(techniques, id)?.effects?.combatModifiers;
  assert(hasModifier(mods, 'maxHp', 'multiply', 1.18), `${id} multiplies maxHp`);
  assert(hasModifier(mods, 'defense', 'multiply', 1.22), `${id} multiplies defense`);
}
for (const id of ['tech_divination', 'tech_da_yan']) {
  const mods = byId(techniques, id)?.effects?.combatModifiers;
  assert(hasModifier(mods, 'soul', 'multiply', 1.35), `${id} multiplies soul`);
}
for (const artifact of artifacts) {
  assert(Array.isArray(artifact.combatModifiers), `${artifact.id} declares combatModifiers`);
  assert(artifact.combatBonus !== undefined, `${artifact.id} keeps legacy combatBonus`);
}
assert(hasModifier(byId(artifacts, 'artifact_green_sword')?.combatModifiers, 'attack', 'multiply', 1.15), 'attack artifact multiplies attack');
assert(hasModifier(byId(artifacts, 'artifact_feng_lei_wing')?.combatModifiers, 'speed', 'multiply', 1.35), 'feng lei wing multiplies speed');
assert(hasModifier(byId(artifacts, 'artifact_feng_lei_wing')?.combatModifiers, 'attack', 'multiply', 1.08), 'feng lei wing multiplies attack');
assert(hasModifier(byId(artifacts, 'artifact_turtle_pattern_pot')?.combatModifiers, 'defense', 'multiply', 1.45), 'turtle pattern pot multiplies defense');
assert(hasModifier(byId(artifacts, 'artifact_turtle_pattern_pot')?.combatModifiers, 'maxHp', 'multiply', 1.25), 'turtle pattern pot multiplies maxHp');

console.log('9) spec can override GameplayEffect modifier attribute and op');
const { EffectEngine, GameplayEffectDef } = await import(new URL('../js/engine/abstract/gameplay-effect.js', import.meta.url).href);
const specNpc = new NPCEntity(
  {
    id: 'npc_runtime_effect_spec_test',
    name: 'Runtime Effect Spec Test',
    role: 'disciple',
    rankId: 'qi_refining',
    factionId: null,
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
const speedBeforeSpecEffect = specNpc.attributes.getEffective('speed');
EffectEngine.applyEffect(
  specNpc,
  new GameplayEffectDef({
    id: 'ge_combat_attribute_modifier',
    durationType: 'infinite',
    modifiers: [{ attribute: 'attack', op: 'add', magnitude: 0 }],
  }),
  {
    instanceId: 'test_speed_spec_override',
    spec: { attribute: 'speed', op: 'multiply', magnitude: 2 },
  },
);
assertNear(specNpc.attributes.getEffective('speed'), speedBeforeSpecEffect * 2, 'spec attribute override applies to speed');
assertNear(specNpc.attributes.getEffective('attack'), specNpc.state.get('attack'), 'spec attribute override does not modify default attack');

console.log('10) technique and artifact combat modifiers affect effective attributes');
const { ItemRegistry } = await import(new URL('../js/engine/items/item-registry.js', import.meta.url).href);
const { equipBestArtifact } = await import(new URL('../js/engine/npc/npc-economy.js', import.meta.url).href);
const { NPCEquipArtifactToilExecutor } = await import(new URL('../js/engine/npc/toils/economy-toils.js', import.meta.url).href);
ItemRegistry.clear();
ItemRegistry.loadFromArray(artifacts);
ItemRegistry.loadFromArray([{
  id: 'artifact_legacy_bonus_only',
  name: '旧式战力法宝',
  category: 'artifact',
  combatBonus: 0.99,
}]);
const techniqueRegistry = new Map(techniques.map(technique => [technique.id, technique]));
const modifierNpc = new NPCEntity(
  {
    id: 'npc_runtime_combat_modifier_test',
    name: 'Runtime Combat Modifier Test',
    role: 'disciple',
    rankId: 'qi_refining',
    rankStage: 'early',
    techniqueId: 'tech_sword_green',
    equippedArtifactId: 'artifact_green_sword',
    factionId: null,
  },
  ranks,
  {
    gameConfig,
    combatConfig: enabledCombatConfig,
    cultivationConfig: { traitEffects: { enabled: false } },
    combatTables,
    techniqueRegistry,
    aiConfig: { maxDepth: 1, maxIterations: 1 },
  },
);
assert(typeof modifierNpc.refreshCombatAttributeModifiers === 'function', 'NPCEntity exposes refreshCombatAttributeModifiers');
modifierNpc.refreshCombatAttributeModifiers?.();
assertNear(modifierNpc.attributes.getEffective('attack'), 48 * 1.12 * 1.15, 'technique and artifact attack multipliers stack');
assertNear(modifierNpc.attributes.getEffective('speed'), 25 * 1.08, 'technique speed multiplier applies');
modifierNpc.refreshCombatAttributeModifiers?.();
assertNear(modifierNpc.attributes.getEffective('attack'), 48 * 1.12 * 1.15, 'refresh without context preserves technique modifiers');

modifierNpc.state.set('equippedArtifactId', 'artifact_legacy_bonus_only');
modifierNpc.refreshArtifactCombatModifiers?.();
assertNear(modifierNpc.attributes.getEffective('attack'), 48 * 1.12, 'legacy combatBonus alone is not an AttributeSet combat modifier');

const economyNpc = new NPCEntity(
  {
    id: 'npc_runtime_economy_artifact_test',
    name: 'Runtime Economy Artifact Test',
    role: 'disciple',
    rankId: 'qi_refining',
    rankStage: 'early',
    items: { artifact_green_sword: 1 },
    factionId: null,
  },
  ranks,
  {
    gameConfig,
    combatConfig: enabledCombatConfig,
    cultivationConfig: { traitEffects: { enabled: false } },
    combatTables,
    techniqueRegistry,
    aiConfig: { maxDepth: 1, maxIterations: 1 },
  },
);
const equipResult = equipBestArtifact(economyNpc);
assert(equipResult.changed === true, 'equipBestArtifact equips an artifact');
assertNear(economyNpc.attributes.getEffective('attack'), 48 * 1.15, 'equipBestArtifact refreshes artifact combat modifier');

const toilNpc = new NPCEntity(
  {
    id: 'npc_runtime_toil_artifact_test',
    name: 'Runtime Toil Artifact Test',
    role: 'disciple',
    rankId: 'qi_refining',
    rankStage: 'early',
    items: { artifact_green_sword: 1 },
    factionId: null,
  },
  ranks,
  {
    gameConfig,
    combatConfig: enabledCombatConfig,
    cultivationConfig: { traitEffects: { enabled: false } },
    combatTables,
    techniqueRegistry,
    aiConfig: { maxDepth: 1, maxIterations: 1 },
  },
);
const toilResult = new NPCEquipArtifactToilExecutor().run(toilNpc, {}, { context: { artifactId: 'artifact_green_sword' } }, {});
assertEqual(toilResult.status, 'success', 'artifact equip toil succeeds');
assertNear(toilNpc.attributes.getEffective('attack'), 48 * 1.15, 'artifact equip toil refreshes artifact combat modifier');

if (failures > 0) {
  console.error(`\nNPC combat attribute runtime tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nNPC combat attribute runtime tests passed');
