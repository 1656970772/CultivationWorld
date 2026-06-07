#!/usr/bin/env node

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

function assertClose(actual, expected, msg, epsilon = 1e-9) {
  assert(Math.abs(actual - expected) <= epsilon, `${msg} (actual=${actual}, expected=${expected})`);
}

function mapEntity(entries) {
  const data = new Map(entries);
  return {
    data,
    entity: {
      state: {
        get: (k) => data.get(k),
        set: (k, v) => data.set(k, v),
      },
    },
  };
}

const mod = await import(new URL('../js/engine/npc/numeric-cultivation.js', import.meta.url).href);

const oldHelpers = [
  'syncNumericCultivationFromRatios',
  'syncProgressRatiosFromNumeric',
  'migrateProgressToNumericCultivation',
  'nextCultivationRequired',
];
for (const helper of oldHelpers) {
  assertEqual(Object.hasOwn(mod, helper), false, `旧 helper ${helper} 不再导出`);
}

const ranks = [
  { id: 'mortal', name: '凡人', order: 0, category: 'mortal' },
  { id: 'qi_refining', name: '炼气', order: 20, category: 'cultivation', cultivationRequired: 50, qiRequired: 50 },
  { id: 'foundation_building', name: '筑基', order: 40, category: 'cultivation', qiRequired: 500 },
  { id: 'golden_core', name: '金丹', order: 60, category: 'cultivation', cultivationRequired: 5000, qiRequired: 5000 },
];

{
  const plain = { state: { rankId: 'mortal' } };
  const next = mod.nextCultivationRank(plain, ranks);
  assertEqual(next?.id, 'qi_refining', 'nextCultivationRank 从凡人返回 qi_refining');
  assertEqual(mod.getCultivationRequired(plain, ranks), 50, 'getCultivationRequired 返回目标境界 cultivationRequired');
}

{
  const plain = { state: { rankId: 'qi_refining' } };
  assertEqual(mod.getCultivationRequired(plain, ranks), 500, 'getCultivationRequired 缺省 cultivationRequired 时镜像 qiRequired');
}

{
  const top = { state: { rankId: 'golden_core' } };
  assertEqual(mod.getCultivationRequired(top, ranks), 0, 'getCultivationRequired 无下一境界时返回 0');
  assertEqual(mod.computeCultivationGain(top, ranks, 100, { cultivationDecayK: 2.5 }), 0, 'computeCultivationGain 无下一境界时返回 0');
}

{
  const { entity, data } = mapEntity([
    ['rankId', 'qi_refining'],
    ['cultivation', 120],
    ['experienceCultivation', 0],
  ]);
  assertEqual(mod.getTotalCultivation(entity), 120, 'getTotalCultivation 汇总两类修为');
  assertEqual(mod.syncTotalCultivation(entity), 120, 'syncTotalCultivation 返回 totalCultivation');
  assertEqual(data.get('totalCultivation'), 120, 'syncTotalCultivation 写入 totalCultivation');

  assertEqual(mod.addCultivation(entity, ranks, 7, { middle: 0.25 }), 127, 'addCultivation 返回同步后的 totalCultivation');
  assertEqual(data.get('cultivation'), 127, 'addCultivation 只增加 cultivation');
  assertEqual(data.get('experienceCultivation'), 0, 'addCultivation 不改变 experienceCultivation');
  assertEqual(data.get('totalCultivation'), 127, 'addCultivation 同步 totalCultivation');
  assertEqual(data.get('rankStage'), 'middle', 'addCultivation 累加后刷新小层');

  assertEqual(mod.addExperienceCultivation(entity, ranks, 3, { middle: 0.25 }), 130, 'addExperienceCultivation 返回同步后的 totalCultivation');
  assertEqual(data.get('cultivation'), 127, 'addExperienceCultivation 不改变 cultivation');
  assertEqual(data.get('experienceCultivation'), 3, 'addExperienceCultivation 只增加 experienceCultivation');
  assertEqual(data.get('totalCultivation'), 130, 'addExperienceCultivation 同步 totalCultivation');
  assertEqual(data.get('rankStage'), 'middle', 'addExperienceCultivation 累加后刷新小层');
}

{
  const thresholds = { early: 0, middle: 0.25, late: 0.6, perfection: 0.9 };
  assertEqual(mod.computeRankStage({ state: { rankId: 'qi_refining', totalCultivation: 0 } }, ranks, thresholds), 'early', 'computeRankStage 0 为 early');
  assertEqual(mod.computeRankStage({ state: { rankId: 'qi_refining', totalCultivation: 124.99 } }, ranks, thresholds), 'early', 'computeRankStage 低于 0.25 为 early');
  assertEqual(mod.computeRankStage({ state: { rankId: 'qi_refining', totalCultivation: 125 } }, ranks, thresholds), 'middle', 'computeRankStage 0.25 为 middle');
  assertEqual(mod.computeRankStage({ state: { rankId: 'qi_refining', totalCultivation: 300 } }, ranks, thresholds), 'late', 'computeRankStage 0.6 为 late');
  assertEqual(mod.computeRankStage({ state: { rankId: 'qi_refining', totalCultivation: 450 } }, ranks, thresholds), 'perfection', 'computeRankStage 0.9 为 perfection');
  assertEqual(mod.computeRankStage({ state: { rankId: 'mortal', totalCultivation: 50 } }, ranks, thresholds), 'perfection', 'computeRankStage 凡人按下一境界 required 刷新小层');
  assertEqual(mod.computeRankStage({ state: { rankId: 'golden_core', totalCultivation: 5000 } }, ranks, thresholds), 'early', 'computeRankStage 顶级修仙境界无下一境界时保持有效小层');

  const top = { state: { rankId: 'golden_core', cultivation: 0, experienceCultivation: 0, totalCultivation: 0, rankStage: 'early' } };
  assertEqual(mod.addExperienceCultivation(top, ranks, 1, thresholds), 1, '顶级境界仍可同步历练修为');
  assertEqual(top.state.rankStage, 'early', '顶级境界获得历练修为后不把 rankStage 覆盖为 null');

  const plain = { state: { rankId: 'qi_refining', cultivation: 100, experienceCultivation: 25 } };
  assertEqual(mod.refreshRankStage(plain, ranks, thresholds), 'middle', 'refreshRankStage 使用 totalCultivation / cultivationRequired');
  assertEqual(plain.state.rankStage, 'middle', 'refreshRankStage 写入 rankStage');

  const fullConfigEntity = { state: { rankId: 'qi_refining', cultivation: 300, experienceCultivation: 0 } };
  assertEqual(
    mod.refreshRankStage(fullConfigEntity, ranks, { stageThresholds: thresholds }),
    'late',
    'refreshRankStage 兼容完整 config 的 stageThresholds'
  );
  assertEqual(fullConfigEntity.state.rankStage, 'late', 'refreshRankStage 完整 config 形态写入 rankStage');
}

{
  const base = {
    state: {
      rankId: 'mortal',
      cultivation: 10,
      experienceCultivation: 0,
    },
  };
  const withExperience = {
    state: {
      rankId: 'mortal',
      cultivation: 10,
      experienceCultivation: 40,
    },
  };
  const expected = 100 * Math.exp(-2.5 * (10 / 50));
  assertClose(mod.computeCultivationGain(base, ranks, 100, { cultivationDecayK: 2.5 }), expected, 'computeCultivationGain 按 cultivation / cultivationRequired 衰减');
  assertClose(
    mod.computeCultivationGain(withExperience, ranks, 100, { cultivationDecayK: 2.5 }),
    expected,
    'computeCultivationGain 不受 experienceCultivation 影响'
  );
}

{
  const notEnoughClosedCultivation = {
    state: {
      rankId: 'mortal',
      cultivation: 14,
      experienceCultivation: 36,
      totalCultivation: 50,
      qi: 50,
    },
  };
  assertEqual(
    mod.canAttemptBreakthrough(notEnoughClosedCultivation, ranks, { minCultivationRatio: 0.3 }),
    false,
    'canAttemptBreakthrough 要求闭关修为达到 minCultivationRatio'
  );

  const ready = {
    state: {
      rankId: 'mortal',
      cultivation: 15,
      experienceCultivation: 35,
      totalCultivation: 50,
      qi: 50,
    },
  };
  assertEqual(mod.canAttemptBreakthrough(ready, ranks, { minCultivationRatio: 0.3 }), true, 'canAttemptBreakthrough 要求 total 满、闭关修为达标、qi 满');
}

{
  const { entity, data } = mapEntity([
    ['rankId', 'mortal'],
    ['rankName', '凡人'],
    ['rankStage', 'perfection'],
    ['cultivation', 20],
    ['experienceCultivation', 30],
    ['totalCultivation', 50],
    ['qi', 75],
  ]);
  const next = mod.nextCultivationRank(entity, ranks);
  const promoted = mod.applyBreakthroughSuccess(entity, next, { qiRequired: next.qiRequired });
  assertEqual(promoted?.id, 'qi_refining', 'applyBreakthroughSuccess 返回突破后的目标境界');
  assertEqual(data.get('rankId'), 'qi_refining', 'applyBreakthroughSuccess 更新 rankId');
  assertEqual(data.get('rankName'), '炼气', 'applyBreakthroughSuccess 更新 rankName');
  assertEqual(data.get('rankStage'), 'early', 'applyBreakthroughSuccess 重置 rankStage');
  assertEqual(data.get('cultivation'), 0, 'applyBreakthroughSuccess 清零 cultivation');
  assertEqual(data.get('experienceCultivation'), 0, 'applyBreakthroughSuccess 清零 experienceCultivation');
  assertEqual(data.get('totalCultivation'), 0, 'applyBreakthroughSuccess 清零 totalCultivation');
  assertEqual(data.get('qi'), 25, 'applyBreakthroughSuccess 扣除目标境界 qiRequired');
}

{
  const plain = {
    state: {
      rankId: 'mortal',
      cultivation: 30,
      experienceCultivation: 20,
      totalCultivation: 50,
      qi: 81,
      injuryLevel: 1,
    },
  };
  mod.applyBreakthroughFailure(plain, {
    breakthrough: {
      failureQiRetention: 0.5,
      failureCultivationRetention: 0.2,
      failureInjuryLevel: 3,
    },
  });
  assertEqual(plain.state.qi, 40, 'applyBreakthroughFailure 保留 50% qi');
  assertEqual(plain.state.cultivation, 6, 'applyBreakthroughFailure 保留 20% cultivation');
  assertEqual(plain.state.experienceCultivation, 4, 'applyBreakthroughFailure 保留 20% experienceCultivation');
  assertEqual(plain.state.totalCultivation, 10, 'applyBreakthroughFailure 重算 totalCultivation');
  assertEqual(plain.state.injuryLevel, 3, 'applyBreakthroughFailure injuryLevel 至少为 3');
}

if (failed > 0) {
  console.error(`\nNumeric cultivation tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nNumeric cultivation tests passed');
