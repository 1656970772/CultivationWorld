#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { NPCState } = await imp('js/engine/npc/npc-state.js');
const { tryBreakthrough } = await imp('js/engine/npc/npc-lifecycle.js');

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
  assert(Object.is(actual, expected), `${msg} (expected ${expected}, got ${actual})`);
}

const ranks = [
  { id: 'mortal', name: '凡人', order: 0, category: 'mortal' },
  {
    id: 'qi_refining',
    name: '炼气',
    order: 20,
    category: 'cultivation',
    cultivationRequired: 50,
    qiRequired: 50,
    lifespan: { baseYears: 120, varianceYears: 0 },
  },
];

const topBreakthroughRanks = [
  { id: 'nascent_soul', name: '元婴', order: 80, category: 'cultivation', cultivationRequired: 500, qiRequired: 500, lifespan: { baseYears: 800, varianceYears: 0 } },
  { id: 'spirit_transformation', name: '化神', order: 100, category: 'cultivation', cultivationRequired: 5000, qiRequired: 5000, lifespan: { baseYears: 1200, varianceYears: 0 } },
];

function entity(seedState, { roll = 0, successRate = 1 } = {}) {
  let refreshCount = 0;
  let pathRolled = 0;
  const npc = {
    id: seedState.id || 'npc_breakthrough_numeric',
    name: seedState.name || '数值突破测试',
    state: new RuntimeState({
      rankId: 'mortal',
      rankName: '凡人',
      rankStage: 'perfection',
      cultivation: 30,
      experienceCultivation: 20,
      totalCultivation: 50,
      qi: 80,
      hp: 10,
      maxHp: 30,
      injuryLevel: 0,
      ageDays: 0,
      maxAgeDays: 36000,
      breakthroughAidBonus: 0,
      ...seedState,
    }),
    _ranksData: ranks,
    _cultivationConfig: {
      minCultivationRatio: 0.3,
      breakthrough: {
        defaultRate: successRate,
        successRates: { mortal_to_qi_refining: successRate },
        failureQiRetention: 0.5,
        failureCultivationRetention: 0.2,
        failureInjuryLevel: 3,
      },
    },
    _rng: { next: () => roll },
    refreshCombatAttributesOnBreakthrough() { refreshCount += 1; },
    tryBreakthroughFullHeal() {},
    _rollBreakthroughPathOrder() { pathRolled += 1; },
    get refreshCount() { return refreshCount; },
    get pathRolled() { return pathRolled; },
  };
  return npc;
}

console.log('1) 突破成功使用数值接口结算');
{
  const npc = entity({ cultivation: 30, experienceCultivation: 20, totalCultivation: 50, qi: 80 }, { roll: 0, successRate: 1 });
  tryBreakthrough(npc);

  assertEqual(npc.state.get('rankId'), 'qi_refining', '成功后晋升目标境界');
  assertEqual(npc.state.get('rankStage'), 'early', '成功后刷新为新境界 early');
  assertEqual(npc.state.get('cultivation'), 0, '成功后清零闭关修为');
  assertEqual(npc.state.get('experienceCultivation'), 0, '成功后清零历练修为');
  assertEqual(npc.state.get('totalCultivation'), 0, '成功后清零总修为');
  assertEqual(npc.state.get('qi'), 30, '成功后扣除目标境界 qiRequired');
  assertEqual(npc.refreshCount, 1, '成功后刷新战斗属性');
  assertEqual(npc.pathRolled, 1, '成功后重掷突破路径偏好');
  assertEqual(npc._breakthroughInfo?.success, true, '成功信息标记 success=true');
  assertEqual(npc._breakthroughInfo?.qiConsumed, 50, '成功信息记录 qi 消耗');
}

console.log('2) 突破失败保留部分数值修为并记录损失');
{
  const npc = entity({ cultivation: 30, experienceCultivation: 20, totalCultivation: 50, qi: 80, injuryLevel: 1 }, { roll: 1, successRate: 0 });
  tryBreakthrough(npc);

  assertEqual(npc.state.get('rankId'), 'mortal', '失败后不晋升');
  assertEqual(npc.state.get('qi'), 40, '失败后保留 50% qi');
  assertEqual(npc.state.get('cultivation'), 6, '失败后保留 20% 闭关修为');
  assertEqual(npc.state.get('experienceCultivation'), 4, '失败后保留 20% 历练修为');
  assertEqual(npc.state.get('totalCultivation'), 10, '失败后重算总修为');
  assertEqual(npc.state.get('injuryLevel'), 3, '失败后 injuryLevel 至少为 3');
  assertEqual(npc.state.get('rankStage'), 'early', '失败后按剩余总修为刷新小层');
  assertEqual(npc._breakthroughInfo?.success, false, '失败信息标记 success=false');
  assertEqual(npc._breakthroughInfo?.qiLost, 40, '失败信息记录 qi 损失');
  assertEqual(npc._breakthroughInfo?.cultivationLost, 24, '失败信息记录闭关修为损失');
  assertEqual(npc._breakthroughInfo?.experienceCultivationLost, 16, '失败信息记录历练修为损失');
  assertEqual(npc._breakthroughInfo?.totalCultivationLost, 40, '失败信息记录总修为损失');
}

console.log('3) 真实 NPCState 突破到顶级境界后仍为 early');
{
  const state = new NPCState(
    {
      id: 'npc_top_breakthrough',
      rankId: 'nascent_soul',
      role: 'elder',
      cultivation: 5000,
      experienceCultivation: 0,
    },
    topBreakthroughRanks,
    {},
    { next: () => 0 },
  );
  state.setMany({
    rankName: '元婴',
    rankStage: 'perfection',
    totalCultivation: 5000,
    qi: 5000,
    hp: 100,
    maxHp: 100,
    injuryLevel: 0,
    breakthroughAidBonus: 0,
  });
  const npc = {
    id: 'npc_top_breakthrough',
    name: '顶级突破测试',
    state,
    _ranksData: topBreakthroughRanks,
    _cultivationConfig: {
      minCultivationRatio: 0.3,
      breakthrough: {
        defaultRate: 1,
        successRates: { nascent_soul_to_spirit_transformation: 1 },
        failureQiRetention: 0.5,
        failureCultivationRetention: 0.2,
        failureInjuryLevel: 3,
      },
    },
    _rng: { next: () => 0 },
    refreshCombatAttributesOnBreakthrough() {},
    tryBreakthroughFullHeal() {},
    _rollBreakthroughPathOrder() {},
  };

  tryBreakthrough(npc);

  assertEqual(state.get('rankId'), 'spirit_transformation', '真实 NPCState 成功突破到顶级境界');
  assertEqual(state.get('cultivation'), 0, '顶级突破后闭关修为清零');
  assertEqual(state.get('totalCultivation'), 0, '顶级突破后总修为清零');
  assertEqual(state.get('rankStage'), 'early', '顶级突破后 rankStage 保持新境界 early');
}

if (failed > 0) {
  console.error(`\n突破数值结算测试失败：${failed} 项`);
  process.exit(1);
}

console.log('\n突破数值结算测试通过');
