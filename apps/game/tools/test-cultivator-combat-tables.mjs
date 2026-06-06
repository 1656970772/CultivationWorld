import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gameRoot = path.resolve(__dirname, '..');

const attrs = ['hp', 'yuan', 'attack', 'defense', 'speed', 'soul'];
const ranks = [
  'mortal',
  'qi_refining',
  'foundation_building',
  'golden_core',
  'nascent_soul',
  'mahayana',
  'tribulation',
  'spirit_transformation',
  'earth_immortal',
  'heaven_immortal',
  'great_luo_heaven_immortal',
  'dao_ancestor',
];

async function readJson(relativePath) {
  const content = await readFile(path.join(gameRoot, relativePath), 'utf8');
  return JSON.parse(content);
}

async function readText(relativePath) {
  return readFile(path.join(gameRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNumber(value, message) {
  assert(typeof value === 'number' && Number.isFinite(value), message);
}

function assertRankAttrs(table, tableName) {
  for (const rank of ranks) {
    assert(table.ranks?.[rank], `${tableName}.${rank} missing`);
    for (const attr of attrs) {
      assertNumber(table.ranks[rank][attr], `${tableName}.${rank}.${attr} must be number`);
    }
  }
}

try {
  const [base, cultivator, monster, loaderSource] = await Promise.all([
    readJson('data/definitions/combat-base-table.json'),
    readJson('data/definitions/cultivator-combat.json'),
    readJson('data/definitions/monster-combat.json'),
    readText('js/core/config-loader.js'),
  ]);

  assert(base.version === 1, 'base.version must be 1');
  assert(base.stageMultipliers?.early === 1, 'base.stageMultipliers.early must be 1');
  assert(base.stageMultipliers?.middle === 1.15, 'base.stageMultipliers.middle must be 1.15');
  assert(base.stageMultipliers?.late === 1.45, 'base.stageMultipliers.late must be 1.45');
  assert(base.stageMultipliers?.perfection === 2, 'base.stageMultipliers.perfection must be 2');
  assertRankAttrs(base, 'base');
  assert(base.ranks.mortal.yuan === 0, 'base mortal yuan must be 0');
  assert(base.ranks.dao_ancestor.attack === 4000000, 'base dao_ancestor attack must be 4000000');

  assertRankAttrs(cultivator, 'cultivator');
  assertRankAttrs(monster, 'monster');
  assert(
    cultivator.ranks.qi_refining.hp < monster.ranks.qi_refining.hp,
    'cultivator qi_refining hp must be less than monster qi_refining hp',
  );
  assert(
    cultivator.ranks.qi_refining.yuan > base.ranks.qi_refining.yuan,
    'cultivator qi_refining yuan must be greater than base qi_refining yuan',
  );

  for (const token of [
    'combat-base-table.json',
    'cultivator-combat.json',
    'monster-combat.json',
    'combatBaseTable',
    'cultivatorCombat',
    'monsterCombat',
    'export async function loadGameConfigs',
  ]) {
    assert(loaderSource.includes(token), `config-loader.js must include ${token}`);
  }

  console.log('Cultivator combat table tests passed');
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
