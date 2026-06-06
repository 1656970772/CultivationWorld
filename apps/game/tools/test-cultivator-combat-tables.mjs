import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gameRoot = path.resolve(__dirname, '..');

const attrs = ['hp', 'yuan', 'attack', 'defense', 'speed', 'soul'];
const combatRanks = [
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
const tableScope = '包含当前运行时境界和未来/参考高阶层级；不扩展 data/definitions/ranks.json 的 canonical runtime 境界。';

let failures = 0;

async function readJson(relativePath) {
  const content = await readFile(path.join(gameRoot, relativePath), 'utf8');
  return JSON.parse(content);
}

async function readText(relativePath) {
  return readFile(path.join(gameRoot, relativePath), 'utf8');
}

function formatValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failures++;
}

function same(actual, expected, message) {
  ok(Object.is(actual, expected), `${message} (${formatValue(actual)} === ${formatValue(expected)})`);
}

function sameStringSet(actual, expected, message) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !actualSet.has(key));
  const extra = actual.filter((key) => !expectedSet.has(key));
  ok(
    missing.length === 0 && extra.length === 0,
    `${message} (missing: ${missing.join(',') || 'none'}; extra: ${extra.join(',') || 'none'})`,
  );
}

function checkNumber(value, message) {
  ok(typeof value === 'number' && Number.isFinite(value), message);
}

function checkRankAttrs(table, tableName) {
  for (const rank of combatRanks) {
    ok(Boolean(table.ranks?.[rank]), `${tableName}.${rank} exists`);
    for (const attr of attrs) {
      checkNumber(table.ranks?.[rank]?.[attr], `${tableName}.${rank}.${attr} is numeric`);
    }
  }
}

async function loadConfigsWithFetchMock() {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];

  globalThis.fetch = async (requestPath) => {
    const relativePath = String(requestPath);
    fetchCalls.push(relativePath);

    try {
      const text = await readText(relativePath);
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(text),
      };
    } catch {
      return {
        ok: false,
        status: 404,
        json: async () => {
          throw new Error(`mock fetch could not read ${relativePath}`);
        },
      };
    }
  };

  try {
    const loaderModuleUrl = pathToFileURL(path.join(gameRoot, 'js/core/config-loader.js')).href;
    const loader = await import(loaderModuleUrl);
    ok(typeof loader.loadGameConfigs === 'function', 'loadGameConfigs export remains available');
    if (typeof loader.loadGameConfigs !== 'function') {
      return { configs: null, fetchCalls };
    }

    const configs = await loader.loadGameConfigs();
    return { configs, fetchCalls };
  } catch (error) {
    ok(false, `loadGameConfigs loads with mocked fetch: ${error?.message || error}`);
    return { configs: null, fetchCalls };
  } finally {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  }
}

try {
  const [base, cultivator, monster, runtimeRanks, loaderSource] = await Promise.all([
    readJson('data/definitions/combat-base-table.json'),
    readJson('data/definitions/cultivator-combat.json'),
    readJson('data/definitions/monster-combat.json'),
    readJson('data/definitions/ranks.json'),
    readText('js/core/config-loader.js'),
  ]);

  console.log('1) scope and rank coverage');
  for (const [tableName, table] of [
    ['base', base],
    ['cultivator', cultivator],
    ['monster', monster],
  ]) {
    same(table._scope, tableScope, `${tableName} declares combat table scope`);
    const tableRanks = Object.keys(table.ranks || {});
    sameStringSet(tableRanks, combatRanks, `${tableName} rank keys match combat rank plan`);
    for (const rank of runtimeRanks) {
      ok(Boolean(table.ranks?.[rank.id]), `${tableName} covers runtime rank ${rank.id}`);
    }
  }

  console.log('2) base table shape');
  same(base.version, 1, 'base.version is 1');
  same(base.stageMultipliers?.early, 1, 'base.stageMultipliers.early');
  same(base.stageMultipliers?.middle, 1.15, 'base.stageMultipliers.middle');
  same(base.stageMultipliers?.late, 1.45, 'base.stageMultipliers.late');
  same(base.stageMultipliers?.perfection, 2, 'base.stageMultipliers.perfection');
  checkRankAttrs(base, 'base');
  same(base.ranks.mortal.yuan, 0, 'base mortal yuan');
  same(base.ranks.dao_ancestor.attack, 4000000, 'base dao_ancestor attack');

  console.log('3) cultivator and monster table shape');
  checkRankAttrs(cultivator, 'cultivator');
  checkRankAttrs(monster, 'monster');
  ok(
    cultivator.ranks.qi_refining.hp < monster.ranks.qi_refining.hp,
    'cultivator qi_refining hp is less than monster qi_refining hp',
  );
  ok(
    cultivator.ranks.qi_refining.yuan > base.ranks.qi_refining.yuan,
    'cultivator qi_refining yuan is greater than base qi_refining yuan',
  );

  console.log('4) config-loader source contains table wiring');
  for (const token of [
    'combat-base-table.json',
    'cultivator-combat.json',
    'monster-combat.json',
    'combatBaseTable',
    'cultivatorCombat',
    'monsterCombat',
    'export async function loadGameConfigs',
  ]) {
    ok(loaderSource.includes(token), `config-loader.js includes ${token}`);
  }

  console.log('5) config-loader returns the actual table objects');
  const { configs, fetchCalls } = await loadConfigsWithFetchMock();
  for (const relativePath of [
    'data/definitions/combat-base-table.json',
    'data/definitions/cultivator-combat.json',
    'data/definitions/monster-combat.json',
  ]) {
    ok(fetchCalls.includes(relativePath), `mock fetch saw ${relativePath}`);
  }

  same(configs?.combatBaseTable?._description, base._description, 'loader combatBaseTable description comes from combat-base-table.json');
  same(configs?.combatBaseTable?.ranks?.dao_ancestor?.attack, base.ranks.dao_ancestor.attack, 'loader combatBaseTable dao_ancestor.attack');
  same(configs?.cultivatorCombat?.source, cultivator.source, 'loader cultivatorCombat source comes from cultivator-combat.json');
  same(configs?.cultivatorCombat?.ranks?.qi_refining?.yuan, cultivator.ranks.qi_refining.yuan, 'loader cultivatorCombat qi_refining.yuan');
  same(configs?.monsterCombat?.source, monster.source, 'loader monsterCombat source comes from monster-combat.json');
  same(configs?.monsterCombat?.ranks?.qi_refining?.hp, monster.ranks.qi_refining.hp, 'loader monsterCombat qi_refining.hp');

  if (failures > 0) {
    console.error(`Cultivator combat table tests failed: ${failures}`);
    process.exit(1);
  }

  console.log('Cultivator combat table tests passed');
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
