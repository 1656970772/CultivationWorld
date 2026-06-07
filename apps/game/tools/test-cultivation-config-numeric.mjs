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
const EXPECTED_REALMS = [
  { id: 'mortal', threshold: 0 },
  { id: 'qi_refining', threshold: 50 },
  { id: 'foundation_building', threshold: 500 },
  { id: 'golden_core', threshold: 5000 },
  { id: 'nascent_soul', threshold: 50000 },
  { id: 'spirit_transformation', threshold: 500000 },
  { id: 'void_refining', threshold: 1000000 },
  { id: 'body_integration', threshold: 2000000 },
  { id: 'mahayana', threshold: 4000000 },
  { id: 'tribulation', threshold: 8000000 },
  { id: 'earth_immortal', threshold: 16000000 },
  { id: 'heaven_immortal', threshold: 32000000 },
];
const EXPECTED_REALM_IDS = EXPECTED_REALMS.map((realm) => realm.id);
const EXPECTED_TRANSITIONS = EXPECTED_REALM_IDS.slice(0, -1).map(
  (rankId, index) => `${rankId}_to_${EXPECTED_REALM_IDS[index + 1]}`,
);
const bannedRuntimeRanks = [
  'disciple',
  ['great_luo', 'heaven', 'immortal'].join('_'),
  ['dao', 'ancestor'].join('_'),
];
const ranksById = new Map(ranks.map((rank) => [rank.id, rank]));

function dataKeys(section) {
  return Object.keys(section ?? {}).filter((key) => !key.startsWith('_'));
}

function assertExactKeys(sectionName, section, expectedKeys) {
  const keys = dataKeys(section);
  assertEqual(keys.length, expectedKeys.length, `${sectionName} 只包含 ${expectedKeys.length} 个运行时键`);
  for (const expectedKey of expectedKeys) {
    assert(Object.hasOwn(section ?? {}, expectedKey), `${sectionName} 包含 ${expectedKey}`);
  }
  for (const key of keys) {
    assert(expectedKeys.includes(key), `${sectionName} 键 ${key} 是运行时键`);
  }
  for (const bannedRank of bannedRuntimeRanks) {
    assertEqual(Object.hasOwn(section ?? {}, bannedRank), false, `${sectionName} 不包含旧运行时键 ${bannedRank}`);
  }
}

for (const rank of ranks.filter(r => r.qiRequired != null)) {
  assertEqual(
    rank.cultivationRequired,
    rank.qiRequired,
    `${rank.id} 的 cultivationRequired 与 qiRequired 同步`
  );
}

assertExactKeys('cultivationSpeed', cultivation.cultivationSpeed, EXPECTED_REALM_IDS);
assertExactKeys('breakthrough.thresholds', cultivation.breakthrough?.thresholds, EXPECTED_REALM_IDS);
assertExactKeys('spiritStoneCost', cultivation.spiritStoneCost, EXPECTED_REALM_IDS);
assertExactKeys('qiBaseGain', cultivation.qiBaseGain, EXPECTED_REALM_IDS);
assertExactKeys('qiPerProgress', cultivation.qiPerProgress, EXPECTED_REALM_IDS);
assertExactKeys('passiveQiGain.base', cultivation.passiveQiGain?.base, EXPECTED_REALM_IDS);
assertExactKeys('rankMaxDifficulty', cultivation.rankMaxDifficulty, EXPECTED_REALM_IDS);
assertExactKeys('monthlyContribution.quotaByRank', cultivation.monthlyContribution?.quotaByRank, EXPECTED_REALM_IDS);
assertExactKeys('breakthrough.successRates', cultivation.breakthrough?.successRates, EXPECTED_TRANSITIONS);

for (const realm of EXPECTED_REALMS) {
  const rank = ranksById.get(realm.id);
  assert(rank, `ranks.json 包含 ${realm.id}`);
  assertEqual(cultivation.breakthrough?.thresholds?.[realm.id], realm.threshold, `${realm.id} threshold 为计划阈值`);
  assertEqual(cultivation.breakthrough?.thresholds?.[realm.id], rank?.qiRequired, `${realm.id} threshold 镜像 ranks.qiRequired`);
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
