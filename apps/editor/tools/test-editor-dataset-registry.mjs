#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const editorRoot = join(repoRoot, 'apps', 'editor');

const readText = (relPath) => readFileSync(join(repoRoot, relPath), 'utf-8');
const readJson = (relPath) => JSON.parse(readText(relPath));

function listJsonFiles(absDir) {
  if (!existsSync(absDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        out.push(relative(editorRoot, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(absDir);
  return out;
}

const projectSource = readText('apps/editor/src-tauri/src/project.rs');
assert.doesNotMatch(
  projectSource,
  /\bDATASET_FILES\b/,
  'project.rs 不应再使用 DATASET_FILES 固定 7 数据集白名单。'
);
assert.match(
  projectSource,
  /struct\s+DatasetRegistry|DatasetRegistry/,
  'project.rs 应声明 DatasetRegistry，用扫描/注册表替代旧白名单。'
);

const frontendSchemaSources = [
  'apps/editor/js/editor/schema-registry.js',
  'apps/editor/data/schemas/datasets.json',
  'apps/editor/data/schemas/references.json',
  'apps/editor/data/schemas/fields.json',
].map((relPath) => [relPath, existsSync(join(repoRoot, relPath)) ? readText(relPath) : '']);

for (const [relPath, source] of frontendSchemaSources) {
  assert.doesNotMatch(source, /(^|[/"'\s])rules\.json\b/, `${relPath} 不应再声明旧 rules.json 数据源。`);
  assert.doesNotMatch(source, /(^|[/"'\s])events\.json\b/, `${relPath} 不应再声明旧 events.json 数据源。`);
  assert.doesNotMatch(source, /(?<![a-z_])spirit_stone(?![a-z_])/, `${relPath} 不应保留旧 spirit_stone 字段。`);
  assert.doesNotMatch(source, /\bFACTION_TYPES\b/, `${relPath} 不应再硬编码 FACTION_TYPES。`);
}

for (const relPath of [
  'apps/editor/data/schemas/datasets.json',
  'apps/editor/data/schemas/references.json',
  'apps/editor/data/schemas/fields.json',
  'apps/editor/data/adapters/map-editor.json',
  'apps/editor/data/ui/dataset-categories.json',
  'apps/editor/data/templates/records/factions.json',
  'apps/editor/data/templates/records/npcs.json',
]) {
  assert.ok(existsSync(join(repoRoot, relPath)), `必须存在声明式文件：${relPath}`);
}

const datasets = readJson('apps/editor/data/schemas/datasets.json');
assert.ok(Array.isArray(datasets.datasets), 'datasets.json 应包含 datasets 数组。');
assert.ok(datasets.datasets.length >= 6, 'datasets.json 应至少声明核心编辑器数据集。');
for (const dataset of datasets.datasets) {
  assert.ok(dataset.key, '每个数据集必须有 key。');
  assert.ok(dataset.path, `${dataset.key} 必须声明 path。`);
  assert.match(
    dataset.path,
    /^apps\/game\/data\/.+\.json$/,
    `${dataset.key} 的运行时数据源必须指向 apps/game/data/**。`
  );
  assert.doesNotMatch(
    dataset.path,
    /^apps\/editor\/data\/(entities|world)\//,
    `${dataset.key} 不得指向 editor 运行时镜像。`
  );
}

const keys = new Set(datasets.datasets.map((dataset) => dataset.key));
for (const requiredKey of [
  'entities/factions',
  'entities/npcs',
  'definitions/terrains',
  'world/modifiers',
  'world/map',
  'actions/world-rules',
]) {
  assert.ok(keys.has(requiredKey), `datasets.json 缺少核心数据集：${requiredKey}`);
}

const mapDataset = datasets.datasets.find((dataset) => dataset.key === 'world/map');
assert.equal(
  mapDataset?.adapter,
  'data/adapters/map-editor.json',
  'world/map 应声明地图编辑器 adapter，避免地图编辑入口继续散落字段约定。'
);

const mapAdapter = readJson('apps/editor/data/adapters/map-editor.json');
assert.equal(mapAdapter.datasetKey, 'world/map', 'map-editor adapter 应绑定 world/map 数据集。');
assert.deepEqual(
  mapAdapter.tileFields,
  {
    terrain: 'terrain',
    owner: 'ownerId',
    resource: 'resourceType',
    buildings: 'buildings'
  },
  'map-editor adapter 应声明 tile 字段映射。'
);
assert.equal(mapAdapter.optionSources.terrains.dataset, 'definitions/terrains');
assert.equal(mapAdapter.optionSources.owners.dataset, 'entities/factions');

const references = readJson('apps/editor/data/schemas/references.json');
assert.ok(references.references?.['entities/factions'], 'references.json 应声明 factions 引用源。');
assert.ok(references.references?.['entities/npcs'], 'references.json 应声明 npcs 引用源。');

const fields = readJson('apps/editor/data/schemas/fields.json');
assert.ok(fields.fields?.['entities/factions'], 'fields.json 应声明 factions 字段。');
assert.ok(fields.fields?.['entities/npcs'], 'fields.json 应声明 npcs 字段。');

const categories = readJson('apps/editor/data/ui/dataset-categories.json');
assert.ok(Array.isArray(categories.categories), 'dataset-categories.json 应包含 categories 数组。');
assert.ok(categories.categories.some((category) => category.key === 'entities'), '分类应包含 entities。');

const mirrorJsonFiles = [
  ...listJsonFiles(join(editorRoot, 'data', 'entities')),
  ...listJsonFiles(join(editorRoot, 'data', 'world')),
];
assert.deepEqual(
  mirrorJsonFiles,
  [],
  `apps/editor/data/entities 与 apps/editor/data/world 不应再保留运行时镜像 JSON：${mirrorJsonFiles.join(', ')}`
);

const dataStoreSource = readText('apps/editor/js/editor/data-store.js');
assert.doesNotMatch(
  dataStoreSource,
  /getFileHandle\(['"]entities\/factions\.json['"]\)/,
  'FSA 能力检测不能把 entities/factions.json 当作单个文件名传给 getFileHandle。'
);
assert.match(
  dataStoreSource,
  /async\s+saveAll\s*\(/,
  'DataStore 应提供 saveAll 统一入口，前端保存全部不应直接逐个 saveDataset。'
);
assert.match(
  dataStoreSource,
  /tauriStore\.saveAll/,
  'DataStore.saveAll 在 Tauri 模式应调用 save_all_datasets 回滚入口。'
);

const editorAppSource = readText('apps/editor/js/editor/editor-app.js');
assert.match(
  editorAppSource,
  /this\.store\.saveAll\(/,
  'editor-app 保存全部应调用 DataStore.saveAll。'
);
assert.doesNotMatch(
  editorAppSource,
  /for\s*\(\s*const\s+key\s+of\s+this\.dirtyDatasets\s*\)[\s\S]{0,300}this\.store\.saveDataset/,
  'editor-app 保存全部不应循环逐个 saveDataset，以免 Tauri 模式半写入。'
);

console.log('editor dataset registry tests passed');
