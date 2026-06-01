#!/usr/bin/env node
/**
 * test-editor-dataset-scanner.mjs —— 验证 dataset-scanner 能扫到 game/data 全部 JSON
 *
 * 验证项：
 * 1. 扫描 apps/game/data 找到至少 N 个 json（≥14）
 * 2. 关键数据集（balance/obsession, balance/utility, actions/npc-actions, ...）都出现
 * 3. SKIP 规则：desktop-dist / .snapshots 不被收录
 * 4. 排序：balance 在 actions 之前
 * 5. 归一化：Windows 反斜杠也能处理
 * 6. categorize / defaultLabel / isLargeDataset 正确性
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDatasetsFromFileList,
  scanDatasets,
  scanLocalFilesystem,
  categorize,
  defaultLabel,
  isLargeDataset,
  normalizeRelPath,
  SKIP_DIR_NAMES,
  CATEGORY_ORDER,
} from '../js/editor/dataset-scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const gameData = join(repoRoot, 'apps', 'game', 'data');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('=== dataset-scanner tests ===');
console.log(`game/data: ${gameData}`);
if (!existsSync(gameData)) {
  console.error('FATAL: game/data not found, abort');
  process.exit(2);
}

// ── 1. 纯函数单元测试 ──
console.log('\n[1] pure functions');
test('normalizeRelPath: posix', () => {
  assert(normalizeRelPath('a/b/c.json') === 'a/b/c.json');
  assert(normalizeRelPath('a\\b\\c.json') === 'a/b/c.json');
  assert(normalizeRelPath('./a/b.json') === 'a/b.json');
  assert(normalizeRelPath('a/b/') === 'a/b');
});
test('categorize: 顶层目录', () => {
  assert(categorize('balance/obsession.json') === 'balance');
  assert(categorize('actions/npc-actions.json') === 'actions');
  assert(categorize('config/ai-config.json') === 'config');
  assert(categorize('data/ranks.json') === 'data');
  assert(categorize('entities/factions.json') === 'entities');
  assert(categorize('definitions/terrains.json') === 'definitions');
  assert(categorize('world/map.json') === 'world');
  assert(categorize('zzz/unknown.json') === 'other');
});
test('defaultLabel: 命名转友好', () => {
  assert(defaultLabel('balance/obsession') === 'obsession');
  assert(defaultLabel('config/ai-config') === 'ai config');
  assert(defaultLabel('actions/npcActions') === 'npc Actions');
  assert(defaultLabel('data/monsterSpecies') === 'monster Species');
});
test('isLargeDataset: map / tiles / 大文件', () => {
  assert(isLargeDataset('world/map.json') === true);
  assert(isLargeDataset('world/tiles.json') === true);
  assert(isLargeDataset('balance/obsession.json', 100) === false);
  assert(isLargeDataset('balance/obsession.json', 600_000) === true);
});
test('SKIP_DIR_NAMES 包含 desktop-dist / .snapshots', () => {
  assert(SKIP_DIR_NAMES.has('desktop-dist'));
  assert(SKIP_DIR_NAMES.has('.snapshots'));
  assert(SKIP_DIR_NAMES.has('node_modules'));
});

// ── 2. buildDatasetsFromFileList: 跳过规则 ──
console.log('\n[2] buildDatasetsFromFileList skip rules');
test('跳过 .snapshots', () => {
  const ds = buildDatasetsFromFileList([
    'balance/obsession.json',
    '.snapshots/obsession/20260601.json',
    'desktop-dist/data/obsession.json',
    '__pycache__/foo.json',
    'node_modules/x.json',
    '.git/HEAD',
  ]);
  assert(ds.length === 1, `expect 1, got ${ds.length}`);
  assert(ds[0].key === 'balance/obsession');
});
test('跳过根目录 JSON', () => {
  const ds = buildDatasetsFromFileList([
    'package.json',
    'balance/obsession.json',
  ]);
  assert(ds.length === 1);
});
test('排序: balance 在 actions 之前', () => {
  const ds = buildDatasetsFromFileList([
    'actions/npc-actions.json',
    'balance/obsession.json',
    'balance/combat.json',
  ]);
  assert(ds[0].category === 'balance');
  assert(ds[0].key === 'balance/combat' || ds[0].key === 'balance/obsession');
  assert(ds[2].category === 'actions');
});
test('Windows 反斜杠路径', () => {
  const ds = buildDatasetsFromFileList([
    'balance\\obsession.json',
    'actions\\npc-actions.json',
  ]);
  assert(ds.length === 2);
  assert(ds[0].relativePath === 'balance/obsession.json');
});

// ── 3. Node 端真实扫描 ──
console.log('\n[3] scanDatasets on apps/game/data');
let datasets;
test('scanDatasets 找到 ≥14 个 json', () => {
  datasets = scanDatasets(gameData);
  assert(datasets.length >= 14, `expect >=14, got ${datasets.length}`);
  console.log(`    found ${datasets.length} datasets:`);
  for (const d of datasets) {
    console.log(`      [${d.category}] ${d.relativePath}  (${d.size}B${d.isLarge ? ' LARGE' : ''})`);
  }
});
test('关键数据集出现', () => {
  if (!datasets) datasets = scanDatasets(gameData);
  const keys = new Set(datasets.map(d => d.key));
  for (const need of [
    'balance/obsession',
    'balance/utility',
    'balance/cultivation',
    'balance/combat',
    'balance/emotion',
    'balance/memory',
    'balance/relationship',
    'balance/risk',
    'balance/reward',
    'balance/personality',
    'balance/economy',
    'actions/npc-actions',
    'actions/faction-actions',
    'actions/world-rules',
    'config/ai-config',
    'config/game-config',
    'definitions/ranks',
    'definitions/monsters',
    'definitions/techniques',
    'definitions/weapons',
    'entities/factions',
    'entities/npcs',
    'world/map',
    'world/modifiers',
    'quests/quest-templates',
  ]) {
    assert(keys.has(need), `missing ${need}`);
  }
});
test('desktop-dist 不被扫描', () => {
  if (!datasets) datasets = scanDatasets(gameData);
  for (const d of datasets) {
    assert(!d.relativePath.includes('desktop-dist'), `desktop-dist leaked: ${d.relativePath}`);
    assert(!d.relativePath.includes('.snapshots'), `.snapshots leaked: ${d.relativePath}`);
  }
});
test('元信息 size > 0', () => {
  if (!datasets) datasets = scanDatasets(gameData);
  const withSize = datasets.filter(d => d.size > 0);
  assert(withSize.length === datasets.length, 'all datasets should have size');
});
test('map.json 标 isLarge=true', () => {
  if (!datasets) datasets = scanDatasets(gameData);
  const map = datasets.find(d => d.key === 'world/map');
  if (map) {
    assert(map.isLarge === true, 'map.json should be isLarge');
  }
});
test('排序 CATEGORY_ORDER: balance < actions < config < data < entities < world', () => {
  if (!datasets) datasets = scanDatasets(gameData);
  const seen = new Set();
  let prevIdx = -1;
  for (const d of datasets) {
    const idx = CATEGORY_ORDER.indexOf(d.category);
    assert(idx >= prevIdx, `sort broken: ${d.category} (${idx}) after (${prevIdx})`);
    prevIdx = idx;
  }
});

// ── 4. scanLocalFilesystem 独立性 ──
console.log('\n[4] scanLocalFilesystem');
test('返回 POSIX 相对路径', () => {
  const files = scanLocalFilesystem(gameData);
  for (const f of files.slice(0, 5)) {
    assert(!f.includes('\\'), `not posix: ${f}`);
  }
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
