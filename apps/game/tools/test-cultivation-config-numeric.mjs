#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

function assertEqual(actual, expected, msg) {
  assert(Object.is(actual, expected), `${msg} (actual=${actual}, expected=${expected})`);
}

const ranksPath = new URL('../data/definitions/ranks.json', import.meta.url);
const cultivationPath = new URL('../data/balance/cultivation.json', import.meta.url);

const ranks = JSON.parse(await readFile(ranksPath, 'utf8'));
const cultivationText = await readFile(cultivationPath, 'utf8');
const cultivation = JSON.parse(cultivationText);
const oldCapField = ['cultivation', 'Cap'].join('');

for (const rank of ranks.filter(r => r.qiRequired != null)) {
  assertEqual(
    rank.cultivationRequired,
    rank.qiRequired,
    `${rank.id} 的 cultivationRequired 与 qiRequired 同步`
  );
}

assertEqual(Object.hasOwn(cultivation, oldCapField), false, 'cultivation.json 顶层不再有闭关比例上限字段');

assertEqual(cultivation.stageThresholds?.early, 0, 'stageThresholds.early 为 0');
assertEqual(cultivation.stageThresholds?.middle, 0.25, 'stageThresholds.middle 为 0.25');
assertEqual(cultivation.stageThresholds?.late, 0.6, 'stageThresholds.late 为 0.6');
assertEqual(cultivation.stageThresholds?.perfection, 0.9, 'stageThresholds.perfection 为 0.9');

assertEqual(cultivation.breakthrough?.failureQiRetention, 0.5, 'breakthrough.failureQiRetention 为 0.5');
assertEqual(cultivation.breakthrough?.failureCultivationRetention, 0.2, 'breakthrough.failureCultivationRetention 为 0.2');
assertEqual(cultivation.breakthrough?.failureInjuryLevel, 3, 'breakthrough.failureInjuryLevel 为 3');

for (const legacyTerm of [
  ['cultivation', 'Progress'].join(''),
  ['in', 'sight'].join(''),
  ['total', 'Progress'].join(''),
  oldCapField,
  ['failure', 'Progress', 'Reset'].join(''),
]) {
  assertEqual(cultivationText.includes(legacyTerm), false, 'cultivation.json 文本不包含旧比例字段');
}

for (const legacyPhrase of ['progress 0~1', '进度增量', '闭关进度', '进度满']) {
  assertEqual(cultivationText.includes(legacyPhrase), false, `cultivation.json 文本不包含旧比例叙述 ${legacyPhrase}`);
}

if (failed > 0) {
  console.error(`\nCultivation config numeric tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nCultivation config numeric tests passed');
