import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { DATASET_SCHEMAS } from '../js/editor/schema-registry.js';
import { createMapSummary, createRecordPreviewText } from '../js/editor/map-summary.js';

const map = JSON.parse(readFileSync('data/world/map.json', 'utf-8'));
const terrains = JSON.parse(readFileSync('data/definitions/terrains.json', 'utf-8'));
const factions = JSON.parse(readFileSync('data/entities/factions.json', 'utf-8'));

const mapTilesField = DATASET_SCHEMAS.map.fields.find((field) => field.path === 'tiles');
assert.equal(
  mapTilesField.type,
  'tileSummary',
  '地图 tiles 字段默认应使用摘要控件，不能直接渲染完整格子 JSON textarea。'
);

const summary = createMapSummary(map, { terrains, factions });
assert.equal(summary.width, 300);
assert.equal(summary.height, 300);
assert.equal(summary.tileCount, 90000);
assert.ok(summary.terrainCounts.mountain > 0, '地图摘要应统计地形数量。');
assert.ok(summary.ownerCounts.unowned > 0, '地图摘要应统计无主地数量。');

const previewText = createRecordPreviewText('map', map, { terrains, factions });
assert.ok(previewText.length < 5000, `地图预览必须保持轻量，当前长度：${previewText.length}`);
assert.ok(!previewText.includes('"tiles"'), '地图预览不应包含完整 tiles 数组。');
assert.ok(previewText.includes('"tileCount": 90000'), '地图预览应保留格子总数。');

console.log('editor map lightweight tests passed');

