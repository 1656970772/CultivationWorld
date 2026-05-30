import { strict as assert } from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Module = require('node:module');

const URL = 'http://127.0.0.1:8889/data-editor.html';
const LEGACY_PANEL_TEXT = ['校验', '当前记录 JSON', '导出'];
const DATASET_LABELS = [/NPC/, /地图/, /事件模板/];
const DETAIL_SLOT_SELECTOR = 'aside.detail-card-panel > #detail-card.detail-card';

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
  const errors = [];
  try {
    return require('playwright');
  } catch (error) {
    errors.push(`project require: ${error.message}`);
  }

  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const execRoot = path.resolve(path.dirname(process.execPath), '..');
  const candidates = [
    process.env.PLAYWRIGHT_NODE_MODULES,
    path.join(execRoot, 'node_modules'),
    path.join(userHome, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules')
  ].filter(Boolean);

  for (const moduleDir of candidates) {
    const packageDir = path.join(moduleDir, 'playwright');
    if (!existsSync(packageDir)) continue;

    try {
      prependNodePath(getPlaywrightModulePaths(moduleDir));
      return require('playwright');
    } catch (error) {
      errors.push(`${packageDir}: ${error.message}`);
    }
  }

  throw new Error([
    '无法加载 Playwright。请在项目安装 playwright，或设置 PLAYWRIGHT_NODE_MODULES 指向包含 playwright 的 node_modules。',
    ...errors
  ].join('\n'));
};

const { chromium } = resolvePlaywright();

const launchBrowser = async () => {
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch (chromeError) {
    try {
      return await chromium.launch();
    } catch (chromiumError) {
      chromiumError.message = [
        '无法启动 Playwright 浏览器。',
        `Chrome channel error: ${chromeError.message}`,
        `Bundled Chromium error: ${chromiumError.message}`
      ].join('\n');
      throw chromiumError;
    }
  }
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
const consoleErrors = [];
const pageErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});

page.on('pageerror', (error) => {
  pageErrors.push(error.stack || error.message);
});

const assertNoRuntimeErrors = () => {
  assert.deepEqual(consoleErrors, [], `页面不应产生 console error：${consoleErrors.join('\n')}`);
  assert.deepEqual(pageErrors, [], `页面不应产生 pageerror：${pageErrors.join('\n')}`);
};

const assertDetailSlotExists = async () => {
  const detailSlotCount = await page.locator(DETAIL_SLOT_SELECTOR).count();
  assert.equal(detailSlotCount, 1, `应存在唯一详情卡插槽：${DETAIL_SLOT_SELECTOR}`);

  const legacyInspectorCount = await page.locator('.inspector-panel').count();
  assert.equal(legacyInspectorCount, 0, '不应再存在旧 inspector-panel 容器');
};

const assertLegacyPanelTextRemoved = async () => {
  const visibleMatches = await page.evaluate((legacyPanelText) => {
    const visibleLines = document.body.innerText
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return legacyPanelText.filter((text) => visibleLines.includes(text));
  }, LEGACY_PANEL_TEXT);

  assert.deepEqual(
    visibleMatches,
    [],
    `页面可见区域不应再出现旧右侧面板文案：${visibleMatches.join(', ')}`
  );

  const domMatches = await page.evaluate((legacyPanelText) => {
    const targets = new Set(legacyPanelText);
    const matches = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (targets.has(text)) {
        matches.push({
          text,
          source: node.parentElement?.tagName?.toLowerCase() || 'text'
        });
      }
    }

    const legacyAttributes = ['aria-label', 'title', 'value'];
    for (const element of document.body.querySelectorAll('*')) {
      for (const attribute of legacyAttributes) {
        const value = element.getAttribute(attribute);
        if (!value) continue;

        for (const text of legacyPanelText) {
          if (value.includes(text)) {
            matches.push({
              text,
              source: `${element.tagName.toLowerCase()}[${attribute}="${value}"]`
            });
          }
        }
      }
    }

    return matches;
  }, LEGACY_PANEL_TEXT);

  assert.deepEqual(
    domMatches,
    [],
    `DOM 中不应再包含旧右侧面板文案：${JSON.stringify(domMatches, null, 2)}`
  );
};

const clickDataset = async (label) => {
  const tab = page.locator('.dataset-tab').filter({ hasText: label }).first();
  await tab.click();
  await page.waitForTimeout(50);
  await assertDetailSlotExists();
  await assertLegacyPanelTextRemoved();
  assertNoRuntimeErrors();
};

const assertNoHorizontalOverflow = async (viewport, label) => {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(100);

  const viewportMetrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));

  const scrollWidth = Math.max(viewportMetrics.bodyScrollWidth, viewportMetrics.documentScrollWidth);
  assert.ok(
    scrollWidth <= viewportMetrics.innerWidth + 1,
    `${label} 不应产生水平溢出：scrollWidth=${scrollWidth}, innerWidth=${viewportMetrics.innerWidth}`
  );
};

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.dataset-tab');

  await assertDetailSlotExists();
  await assertLegacyPanelTextRemoved();
  assertNoRuntimeErrors();

  for (const label of DATASET_LABELS) {
    await clickDataset(label);
  }

  await assertNoHorizontalOverflow({ width: 1024, height: 768 }, '平板宽度');
  await assertDetailSlotExists();
  await assertLegacyPanelTextRemoved();

  await assertNoHorizontalOverflow({ width: 390, height: 844 }, '移动端');
  await assertDetailSlotExists();
  await assertLegacyPanelTextRemoved();

  assertNoRuntimeErrors();
  console.log('editor detail slot tests passed');
} finally {
  await browser.close();
}
