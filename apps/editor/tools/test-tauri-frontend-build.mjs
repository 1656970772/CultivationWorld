import { strict as assert } from 'node:assert';
import { existsSync, rmSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'desktop-dist');

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

execFileSync(process.execPath, ['tools/build-tauri-frontend.mjs'], {
  cwd: rootDir,
  stdio: 'pipe'
});

const requiredPaths = [
  'data-editor.html',
  'css/data-editor.css',
  'js/editor/editor-app.js',
  'js/editor/data-store.js',
  'data/entities/factions.json',
  'data/world/map.json'
];

for (const relativePath of requiredPaths) {
  const outputPath = path.join(distDir, relativePath);
  assert.ok(existsSync(outputPath), `应复制 ${relativePath} 到 desktop-dist。`);
  assert.ok(statSync(outputPath).size > 0, `${relativePath} 不应为空。`);
}

const topLevelEntries = await readdir(distDir);
assert.ok(topLevelEntries.includes('data-editor.html'), '桌面资源目录应包含编辑器入口。');
assert.ok(topLevelEntries.includes('js'), '桌面资源目录应包含 js 目录。');
assert.ok(topLevelEntries.includes('data'), '桌面资源目录应包含示例 data 目录。');

console.log('tauri frontend build test passed');
