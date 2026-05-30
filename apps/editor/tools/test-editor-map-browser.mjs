import { strict as assert } from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const URL = 'http://127.0.0.1:8889/data-editor.html';

const getPlaywrightModulePaths = (moduleDir) => {
  const paths = [moduleDir];
  const pnpmDir = path.join(moduleDir, '.pnpm');
  if (!existsSync(pnpmDir)) return paths;
  for (const entry of readdirSync(pnpmDir)) {
    if (entry.startsWith('playwright@') || entry.startsWith('playwright-core@')) {
      paths.push(path.join(pnpmDir, entry, 'node_modules'));
    }
  }
  return paths;
};

const prependNodePath = (paths) => {
  const currentPaths = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
  process.env.NODE_PATH = [...paths, ...currentPaths].join(path.delimiter);
  Module._initPaths();
};

const resolvePlaywright = () => {
  try {
    return require('playwright');
  } catch (projectError) {
    const userHome = process.env.USERPROFILE || process.env.HOME || '';
    const execRoot = path.resolve(path.dirname(process.execPath), '..');
    const candidates = [
      process.env.PLAYWRIGHT_NODE_MODULES,
      path.join(execRoot, 'node_modules'),
      path.join(userHome, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules')
    ].filter(Boolean);

    for (const moduleDir of candidates) {
      if (!existsSync(path.join(moduleDir, 'playwright'))) continue;
      prependNodePath(getPlaywrightModulePaths(moduleDir));
      return require('playwright');
    }

    throw projectError;
  }
};

const { chromium } = resolvePlaywright();
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1310, height: 900 } });
const consoleErrors = [];
const pageErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => {
  pageErrors.push(error.stack || error.message);
});

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.dataset-tab');
  await page.locator('.dataset-tab').filter({ hasText: '地图' }).click();
  await page.waitForSelector('.map-editor-canvas');

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector('.map-editor-canvas');
    const editor = document.querySelector('.map-editor');
    const text = editor?.innerText || '';
    const rect = canvas.getBoundingClientRect();
    return {
      hasMapEditor: Boolean(editor),
      hasCanvas: Boolean(canvas),
      canvasWidth: rect.width,
      canvasHeight: rect.height,
      scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      innerWidth: window.innerWidth,
      containsTilesJson: text.includes('"tiles"'),
      hasTerrainTool: text.includes('地形画笔'),
      hasOwnerTool: text.includes('势力归属'),
      hasUndo: text.includes('撤销'),
      hasRedo: text.includes('重做')
    };
  });

  assert.equal(metrics.hasMapEditor, true, '地图卷宗应挂载地图编辑器。');
  assert.equal(metrics.hasCanvas, true, '地图编辑器应渲染 Canvas。');
  assert.ok(metrics.canvasWidth > 240 && metrics.canvasHeight > 240, `Canvas 尺寸应可用：${JSON.stringify(metrics)}`);
  assert.ok(metrics.scrollWidth <= metrics.innerWidth + 1, `1310px 不应水平溢出：${JSON.stringify(metrics)}`);
  assert.equal(metrics.containsTilesJson, false, '页面不应渲染完整 tiles JSON。');
  assert.equal(metrics.hasTerrainTool, true, '应显示地形画笔。');
  assert.equal(metrics.hasOwnerTool, true, '应显示势力归属。');
  assert.equal(metrics.hasUndo, true, '应显示撤销按钮。');
  assert.equal(metrics.hasRedo, true, '应显示重做按钮。');

  await page.mouse.move(180, 260);
  await page.mouse.down();
  await page.mouse.move(1400, 260);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const afterDragText = await page.locator('.map-editor').innerText();
  assert.ok(
    afterDragText.includes('尚未选择地图格。'),
    '拖拽离开画布后应清理预览选区，不应提交半成品选择。'
  );

  assert.deepEqual(consoleErrors, [], `页面不应产生 console error：${consoleErrors.join('\n')}`);
  assert.deepEqual(pageErrors, [], `页面不应产生 pageerror：${pageErrors.join('\n')}`);
  console.log('editor map browser tests passed');
} finally {
  await browser.close();
}
