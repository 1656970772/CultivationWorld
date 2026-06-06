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
const {
  resolveMonsterAttributes,
  validateMonsterDefinitions,
} = await imp('js/engine/monster/monster-attributes.js');

let failures = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failures++;
}

console.log('1) all monsters have legal five-layer templates and typed skills');
const result = validateMonsterDefinitions(monsters, templates);
ok(result.errors.length === 0, `validation errors: ${result.errors.join('; ') || 'none'}`);
ok(monsters.every((monster) => monster.templates && typeof monster.templates.size === 'string'), 'every monster has templates.size');
ok(monsters.every((monster) => Array.isArray(monster.skills) && monster.skills.length > 0), 'every monster has typed skills array');

console.log('2) attributes are generated from templates, not old hand-filled values');
ok(monsters.every((monster) => monster.attributes && monster.attributes.hp > 0), 'every monster has generated hp');
ok(monsters.every((monster) => monster.attributes.attack > 0 && monster.attributes.defense > 0), 'every monster has generated attack and defense');
ok(monsters.every((monster) => monster.attributes.qi >= 0 && monster.attributes.spirit >= 0), 'every monster has qi and spirit');

console.log('3) typical ecology checks');
const byId = Object.fromEntries(monsters.map((monster) => [monster.id, monster]));
const attrs = (id) => resolveMonsterAttributes(byId[id], templates);
ok(attrs('beast_103').hp < attrs('beast_102').hp, 'bat swarm is less tanky than green-scaled python');
ok(attrs('beast_103').speed > attrs('beast_102').speed, 'bat swarm is faster than green-scaled python');
ok(attrs('beast_304').spirit > attrs('beast_304').attack, 'young nine-tail fox emphasizes spirit over direct attack');
ok(attrs('beast_504').defense > attrs('beast_501').defense, 'ten-thousand-year turtle is tougher than adult sky roc');
ok(attrs('beast_501').speed > attrs('beast_504').speed, 'adult sky roc is faster than ten-thousand-year turtle');
ok(attrs('beast_905').hp > attrs('beast_101').hp * 100, 'ancient true dragon is vastly above first-grade wolf');

if (failures > 0) {
  console.error(`\nMonster config validation failed: ${failures}`);
  process.exit(1);
}

console.log('\nMonster config validation passed');
