#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));
const imp = (path) => import(pathToFileURL(resolve(GAME_ROOT, path)).href);

const templates = load('data/definitions/monster-attribute-templates.json');
const monsters = load('data/definitions/monsters.json').filter((monster) => monster.id);
const byId = Object.fromEntries(monsters.map((monster) => [monster.id, monster]));
const { resolveMonsterAttributes } = await imp('js/engine/monster/monster-attributes.js');
const { MonsterEntity } = await imp('js/engine/monster/monster-entity.js');
const { monsterCombatPower } = await imp('js/engine/monster/monster-resources.js');

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

const rng = { next: () => 0.5, derive: () => rng, getState: () => 1337 };
const def = byId.beast_101;
const expected = resolveMonsterAttributes(def, templates);
const monster = new MonsterEntity(def, {
  id: 'monster_test_runtime',
  name: def.name,
  x: 10,
  y: 10,
  speed: 3,
  wanderRadius: 8,
  senseRange: 5,
  rankOrderMap: { mortal: 0, qi_refining: 20 },
  combatConfig: {},
  lifespanConfig: { daysPerYear: 360, byGrade: { 1: { baseYears: 100, varianceYears: 0 } } },
  rng,
  monsterAttributeTemplates: templates,
});

console.log('1) MonsterStaticData stores generated attributes and skills');
same(monster.staticData.get('attributes').hp, expected.hp, 'staticData hp matches template calculation');
same(monster.staticData.get('attributes').attack, expected.attack, 'staticData attack matches template calculation');
ok(Array.isArray(monster.staticData.get('skills')), 'staticData exposes typed skills');

console.log('2) MonsterState uses direct hp instead of legacy vitality*10 after migration');
same(monster.state.get('maxHp'), expected.hp, 'state.maxHp equals generated hp');
same(monster.state.get('hp'), expected.hp, 'state.hp starts full');
const expectedPower = expected.attack + expected.speed * 0.5 + expected.defense + def.grade * 30;
same(monster.state.get('power'), Math.round(expectedPower), 'state.power uses attack/speed/defense');

console.log('3) monsterCombatPower reads generated values');
same(monsterCombatPower(monster), monster.state.get('power'), 'resource combat power uses state power');
same(monsterCombatPower({ grade: def.grade, staticData: monster.staticData }), monster.state.get('power'), 'resource combat power can derive from staticData attributes');

if (failures > 0) {
  console.error(`\nMonster runtime attribute tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nMonster runtime attribute tests passed');
