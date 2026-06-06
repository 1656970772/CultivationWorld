#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));
const imp = (path) => import(pathToFileURL(resolve(GAME_ROOT, path)).href);

const templates = load('data/definitions/monster-attribute-templates.json');
const {
  calculateMonsterAttributes,
  resolveMonsterAttributes,
  validateMonsterDefinition,
} = await imp('js/engine/monster/monster-attributes.js');

let failures = 0;
function same(actual, expected, message) {
  const pass = actual === expected;
  console.log(`  ${pass ? 'OK' : 'FAIL'}: ${message} (${actual} === ${expected})`);
  if (!pass) failures++;
}
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failures++;
}

console.log('1) medium land melee grade 1');
const wolf = {
  id: 'test_wolf',
  name: '模板铁背狼',
  grade: 1,
  templates: {
    size: 'medium',
    movement: ['land'],
    combatStyles: ['melee'],
    elements: ['metal'],
    specialTypes: ['normal'],
    habits: ['aggressive', 'pack'],
  },
};
const wolfAttrs = calculateMonsterAttributes(wolf, templates);
same(wolfAttrs.hp, 240, 'hp uses grade + size + special only');
same(wolfAttrs.attack, 75, 'attack includes melee multiplier');
same(wolfAttrs.defense, 21, 'defense includes melee multiplier');
same(wolfAttrs.speed, 20, 'land medium keeps base speed');
same(wolfAttrs.qi, 24, 'qi includes melee multiplier');
same(wolfAttrs.spirit, 12, 'spirit includes melee multiplier');
same(wolfAttrs.vitality, 240, 'legacy vitality mirrors hp');
same(wolfAttrs.strength, 75, 'legacy strength mirrors attack');
same(wolfAttrs.sense, 12, 'legacy sense mirrors spirit');

console.log('2) small stealth illusion grade 2');
const fox = {
  id: 'test_fox',
  name: '模板幽灵狐',
  grade: 2,
  templates: {
    size: 'small',
    movement: ['land', 'stealth'],
    combatStyles: ['illusion'],
    elements: ['illusion'],
    specialTypes: ['normal'],
    habits: ['ambush_hunter', 'intelligent'],
  },
};
const foxAttrs = calculateMonsterAttributes(fox, templates);
ok(foxAttrs.hp < 600, 'small illusion fox is not as tanky as medium baseline');
ok(foxAttrs.spirit > foxAttrs.attack, 'illusion fox has higher spirit than attack');
ok(foxAttrs.speed > 25, 'small stealth fox remains mobile');

console.log('3) validation reports illegal templates');
const invalid = validateMonsterDefinition({
  id: 'bad_monster',
  name: '错误妖兽',
  grade: 1,
  templates: {
    size: ['small', 'medium'],
    movement: ['flying'],
    combatStyles: ['domain'],
    elements: ['fire'],
    specialTypes: ['normal', 'elite'],
    habits: ['aggressive'],
  },
  skills: [{ id: 'skill_bad', name: '飞遁', type: 'movement' }],
}, templates);
ok(invalid.errors.some((msg) => msg.includes('size')), 'size must be one string');
ok(invalid.errors.some((msg) => msg.includes('normal')), 'normal special type is mutually exclusive');
ok(invalid.errors.some((msg) => msg.includes('cost')), 'movement skill needs resource cost');

console.log('4) legacy fallback still reads old attributes');
const legacy = resolveMonsterAttributes({
  id: 'legacy_monster',
  grade: 1,
  attributes: { vitality: 30, strength: 20, speed: 25, defense: 15, sense: 18 },
}, templates);
same(legacy.hp, 300, 'legacy vitality remains multiplied by 10 for hp');
same(legacy.attack, 20, 'legacy strength maps to attack');
same(legacy.spirit, 18, 'legacy sense maps to spirit');

if (failures > 0) {
  console.error(`\nMonster attribute template tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nMonster attribute template tests passed');
