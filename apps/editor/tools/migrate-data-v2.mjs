#!/usr/bin/env node
/** 一次性迁移：将 apps/editor/data 扁平结构对齐 schema v2 分层路径 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const editorData = join(__dirname, '..', 'data');
const gameData = join(__dirname, '..', '..', 'game', 'data');

const copies = [
  'entities/factions.json',
  'entities/npcs.json',
  'definitions/terrains.json',
  'world/modifiers.json',
  'world/map.json',
];

for (const rel of copies) {
  const dir = join(editorData, dirname(rel));
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(gameData, rel), join(editorData, rel));
}

for (const f of ['factions.json', 'npcs.json', 'terrains.json', 'modifiers.json', 'map.json']) {
  const p = join(editorData, f);
  if (existsSync(p)) unlinkSync(p);
}

const map = JSON.parse(readFileSync(join(editorData, 'world/map.json'), 'utf-8'));
console.log('editor data v2 migration ok', {
  width: map.width,
  height: map.height,
  tiles: map.tiles?.length,
});
