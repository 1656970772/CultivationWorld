#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');

const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));
const imp = (path) => import(pathToFileURL(resolve(GAME_ROOT, path)).href);

let failures = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failures++;
}

function sortedJsonFiles(dir) {
  return readdirSync(resolve(GAME_ROOT, dir))
    .filter((file) => file.endsWith('.json'))
    .sort();
}

function ids(list) {
  return new Set((list || []).map((item) => item.id));
}

console.log('1) data manifest declares required runtime groups');
const manifest = load('data/config/data-manifest.json');
for (const key of ['itemDefs', 'effects', 'abilities', 'jobs', 'toils', 'behaviorTrees']) {
  ok(manifest.groups?.[key], `manifest.groups.${key} exists`);
}
ok(manifest.singletons?.techniques === 'data/definitions/techniques.json', 'manifest.singletons.techniques loads definitions/techniques.json');
ok(manifest.singletons?.weapons === 'data/definitions/weapons.json', 'manifest.singletons.weapons loads definitions/weapons.json');

console.log('2) manifest group files exactly match their data directories');
for (const [key, group] of Object.entries(manifest.groups || {})) {
  if (!group.directory) continue;
  const actual = sortedJsonFiles(group.directory);
  const expected = [...(group.files || [])].sort();
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${key} manifest files match ${group.directory}`);
}

console.log('3) data-manifest-loader merges directory groups');
const {
  loadGameDataManifest,
  loadJsonGroup,
  loadGameConfigsFromManifest,
} = await imp('js/core/data-manifest-loader.js');

const loadedManifest = await loadGameDataManifest({ basePath: GAME_ROOT, loadJson: load });
ok(loadedManifest.groups.itemDefs.files.length === sortedJsonFiles('data/items').length, 'loadGameDataManifest loads data-manifest.json');

const itemDefs = await loadJsonGroup(loadedManifest.groups.itemDefs, { basePath: GAME_ROOT, loadJson: load });
ok(itemDefs.items.length === loadedManifest.groups.itemDefs.files.flatMap((file) => load(`data/items/${file}`).items || []).length, 'loadJsonGroup merges itemDefs.items');

const effects = await loadJsonGroup(loadedManifest.groups.effects, { basePath: GAME_ROOT, loadJson: load });
ok(ids(effects.effects).has('ge_add_qi'), 'loadJsonGroup merges effects.effects');

const behaviorTrees = await loadJsonGroup(loadedManifest.groups.behaviorTrees, { basePath: GAME_ROOT, loadJson: load });
ok(ids(behaviorTrees.trees).has('bt_npc_default'), 'loadJsonGroup collects behavior tree documents');

console.log('4) manifest-driven config loading preserves WorldEngine config keys');
const configs = await loadGameConfigsFromManifest(loadedManifest, { basePath: GAME_ROOT, loadJson: load });
for (const key of [
  'factions', 'npcs', 'ranks', 'items', 'terrains',
  'techniques', 'weapons',
  'factionNeeds', 'npcNeeds', 'factionActions', 'npcActions', 'npcJobActions',
  'questTemplates', 'mapData', 'balanceCombat', 'balanceEconomy',
  'gameConfig', 'aiConfig', 'names', 'itemDefs', 'tags', 'effects',
  'abilities', 'jobs', 'toils', 'relationshipPlatform',
]) {
  ok(Object.prototype.hasOwnProperty.call(configs, key), `configs.${key} is present`);
}
ok(ids(configs.itemDefs.items).has('item_qi_pill'), 'configs.itemDefs includes pill item');
ok(ids(configs.techniques).has('tech_basic_qi'), 'configs.techniques includes basic technique');
ok(ids(configs.weapons).has('weapon_001'), 'configs.weapons includes weapon definitions');
ok(ids(configs.effects.effects).has('ge_add_progress'), 'configs.effects includes core effect');
ok(ids(configs.abilities.abilities).has('ga_lock_hp'), 'configs.abilities includes combat ability');
ok(ids(configs.jobs.jobs).has('job_npc_cultivate'), 'configs.jobs includes cultivation job');
ok(ids(configs.toils.toils).has('toil_cultivate'), 'configs.toils includes cultivation toil');
ok(ids(configs.behaviorTrees.trees).has('bt_faction_default'), 'configs.behaviorTrees includes faction tree');

console.log('5) public loadGameConfigs fetches the manifest first');
const requested = [];
globalThis.fetch = async (path) => {
  requested.push(path);
  try {
    const data = readFileSync(resolve(GAME_ROOT, path), 'utf-8');
    return {
      ok: true,
      status: 200,
      async json() { return JSON.parse(data); },
    };
  } catch (_err) {
    return {
      ok: false,
      status: 404,
      async json() { throw new Error(`missing mock fetch path: ${path}`); },
    };
  }
};

const { loadGameConfigs } = await imp('js/core/config-loader.js');
const fetchedConfigs = await loadGameConfigs();
ok(requested[0] === 'data/config/data-manifest.json', 'loadGameConfigs requests data/config/data-manifest.json first');
ok(ids(fetchedConfigs.itemDefs.items).has('item_escape_talisman'), 'loadGameConfigs returns manifest-driven itemDefs');
ok(ids(fetchedConfigs.techniques).has('tech_basic_qi'), 'loadGameConfigs returns manifest-driven techniques');
ok(ids(fetchedConfigs.weapons).has('weapon_001'), 'loadGameConfigs returns manifest-driven weapons');
ok(ids(fetchedConfigs.effects.effects).has('ge_add_hp'), 'loadGameConfigs returns manifest-driven effects');
ok(ids(fetchedConfigs.behaviorTrees.trees).has('bt_monster_tier1'), 'loadGameConfigs returns behaviorTrees');

if (failures > 0) {
  console.error(`\nData manifest load tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nData manifest load tests passed');
