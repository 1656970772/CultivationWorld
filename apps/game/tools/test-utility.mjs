#!/usr/bin/env node
/**
 * Utility 考量层单元测试（ADR-020 / ADR-021 / NPC效用评分公式升级）。
 * 覆盖：
 *   1) Consideration 各响应曲线在 [0,1] 范围且单调性正确
 *   2) Goal.score 新公式：加权几何平均、floor、偏置夹取、收益放大、风险压制
 *   3) 默认态：无 considerations / modulators / scoreContext 时 score === priority
 *   4) 派生输入(timeValue)从 derived 表读取
 *   5) npc-utility 把 goalRisk / expectedValue 写入 Goal 评分上下文
 *   6) 随机扰动（上头）：命中时 Goal 分数按 mult 放大且受偏置上限保护
 *   7) 路径偏好：explore_first 时探索类目标获得 deltaPriority 加成
 *
 * 用法：node tools/test-utility.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Consideration, CurveType, InputSource, buildConsiderations } =
  await imp('js/engine/abstract/consideration.js');
const { Goal } = await imp('js/engine/abstract/goal.js');
const { decorateGoalConsiderations } = await imp('js/engine/npc/npc-utility.js');

let failures = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
function assert(cond, msg) {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else { console.log(`  ✓ ${msg}`); }
}

function stateOf(flat) {
  return { get(k) { return flat[k]; } };
}

console.log('1) 响应曲线');
{
  const lin = new Consideration({ id: 'lin', inputKey: 'x', curve: CurveType.LINEAR, params: { slope: 1, shift: 0 } });
  assert(approx(lin.evaluate(stateOf({ x: 0 })), 0), 'linear(0)=0');
  assert(approx(lin.evaluate(stateOf({ x: 0.5 })), 0.5), 'linear(0.5)=0.5');
  assert(approx(lin.evaluate(stateOf({ x: 2 })), 1), 'linear 上限钳制到 1');

  const inv = new Consideration({ id: 'inv', inputKey: 'x', curve: CurveType.INVERSE, params: { slope: 1 } });
  assert(approx(inv.evaluate(stateOf({ x: 0 })), 1), 'inverse(0)=1（输入越小效用越高）');
  assert(approx(inv.evaluate(stateOf({ x: 1 })), 0), 'inverse(1)=0');

  const thr = new Consideration({ id: 'thr', inputKey: 'x', curve: CurveType.THRESHOLD, params: { threshold: 0.7, high: 1, low: 0 } });
  assert(thr.evaluate(stateOf({ x: 0.6 })) === 0, 'threshold 未达阈值=low');
  assert(thr.evaluate(stateOf({ x: 0.8 })) === 1, 'threshold 达阈值=high');

  const log = new Consideration({ id: 'log', inputKey: 'x', curve: CurveType.LOGISTIC, params: { k: 12, mid: 0.85 } });
  assert(log.evaluate(stateOf({ x: 0.85 })) > 0.49 && log.evaluate(stateOf({ x: 0.85 })) < 0.51, 'logistic 在 mid 处约 0.5');
  assert(log.evaluate(stateOf({ x: 0.95 })) > log.evaluate(stateOf({ x: 0.5 })), 'logistic 单调递增');
}

console.log('2) Goal.score 新公式语义');
{
  const g = new Goal({ id: 'g1', priority: 80, urgency: 0 });
  assert(g.score() === 80, '无考量因素、无调制项、无评分上下文时 score===priority');

  const c1 = new Consideration({ id: 'a', inputKey: 'x', curve: CurveType.LINEAR, params: { slope: 1 } });
  const c2 = new Consideration({ id: 'b', inputKey: 'y', curve: CurveType.LINEAR, params: { slope: 1 } });
  g.evaluateConsiderations([c1, c2], stateOf({ x: 0.5, y: 0.5 }), {});
  assert(approx(g.score(), 80 * 0.5), '两个 0.5 consideration 使用几何平均，score=80×0.5=40');

  const weighted = new Goal({ id: 'gWeighted', priority: 100, urgency: 0 });
  const cw1 = new Consideration({ id: 'w1', inputKey: 'x', weight: 3, curve: CurveType.LINEAR, params: { slope: 1 } });
  const cw2 = new Consideration({ id: 'w2', inputKey: 'y', weight: 1, curve: CurveType.LINEAR, params: { slope: 1 } });
  weighted.evaluateConsiderations([cw1, cw2], stateOf({ x: 0.25, y: 1 }), {});
  const expectedWeightedMean = Math.exp((3 * Math.log(0.25) + Math.log(1)) / 4);
  assert(approx(weighted.score(), 100 * expectedWeightedMean), 'consideration.weight 参与加权几何平均');

  const floored = new Goal({ id: 'gFloor', priority: 100, urgency: 0 });
  const cf = new Consideration({ id: 'floor', inputKey: 'x', floor: 0.2, curve: CurveType.LINEAR, params: { slope: 1 } });
  floored.evaluateConsiderations([cf], stateOf({ x: 0 }), {});
  assert(approx(floored.score(), 20), 'consideration.floor=0.2 防止软因素把目标压成 0');

  const modded = new Goal({ id: 'gMod', priority: 70, urgency: 0 });
  modded.modulators.push({ label: 'obsession', deltaPriority: 0, mult: 1.5 });
  assert(approx(modded.score(), 105), '普通 modulator.mult 保持乘法放大：70×1.5=105');

  const legacyBoost = new Goal({ id: 'gLegacyBoost', priority: 95, urgency: 0 });
  legacyBoost.modulators.push({ label: 'anger', deltaPriority: 25, mult: 1 });
  assert(approx(legacyBoost.score(), 120), '无 scoreContext 的旧调制路径不被新版 base clamp 截断，score=120');

  const capped = new Goal({ id: 'gCap', priority: 50, urgency: 0 });
  capped.modulators.push({ label: 'tooLarge', deltaPriority: 0, mult: 10 });
  capped.setScoreContext({ scoreConfig: { minBiasMult: 0.25, maxBiasMult: 3 } });
  assert(approx(capped.score(), 150), 'biasMult 按 maxBiasMult=3 夹取：50×3=150');

  const rewarded = new Goal({ id: 'gReward', priority: 60, urgency: 0 });
  rewarded.setScoreContext({ expectedValue: 0.5, scoreConfig: { rewardWeight: 0.5 } });
  assert(approx(rewarded.score(), 75), 'rewardMult=1+0.5×0.5，score=60×1.25=75');

  const risky = new Goal({ id: 'gRisk', priority: 60, urgency: 0 });
  risky.setScoreContext({ goalRisk: 0.5, riskWeight: 1 });
  assert(approx(risky.score(), 40), 'riskMult=1/(1+1×0.5)，score=60/1.5=40');

  const missingDelta = new Goal({ id: 'gMissingDelta', priority: 50, urgency: 0 });
  missingDelta.modulators.push({ label: 'missingDelta', mult: 2 });
  assert(approx(missingDelta.score(), 100), '直接 push 缺 deltaPriority 的 modulator 时按 0 处理，score=100');

  const badMod = new Goal({ id: 'gBadMod', priority: 50, urgency: 0 });
  badMod.addModulator({ label: 'bad', deltaPriority: 'bad', mult: NaN });
  assert(approx(badMod.score(), 50), 'addModulator 非法 deltaPriority/mult 不污染分数，score=50');

  const invalidCtx = new Goal({ id: 'gInvalidCtx', priority: 100, urgency: 0 });
  invalidCtx.evaluateConsiderations([new Consideration({ id: 'zero', inputKey: 'x', curve: CurveType.LINEAR })], stateOf({ x: 0 }), {});
  invalidCtx.setScoreContext({ hardGate: NaN, scoreConfig: { defaultConsiderationFloor: NaN } });
  assert(approx(invalidCtx.score(), 5), '非法 hardGate/defaultConsiderationFloor 回退默认值，score=100×0.05=5');

  const nullCtx = new Goal({ id: 'gNullCtx', priority: 60, urgency: 0 });
  let nullCtxThrew = false;
  try {
    nullCtx.setScoreContext(null);
  } catch {
    nullCtxThrew = true;
  }
  assert(!nullCtxThrew && approx(nullCtx.score(), 60), 'setScoreContext(null) 按空上下文处理，score=60');

  const missingUrgency = new Goal({ id: 'gMissingUrgency', priority: 0, urgency: 5 });
  missingUrgency.modulators.push({ label: 'missingUrgency' });
  assert(missingUrgency.urgencyScore() === 5, '直接 push 缺 deltaUrgency 的 modulator 时按 0 处理，urgencyScore=5');
}

console.log('3) 派生输入 timeValue');
{
  const tv = new Consideration({ id: 'tv', inputKey: 'timeValue', source: InputSource.DERIVED, curve: CurveType.LINEAR, params: { slope: 1 } });
  assert(approx(tv.evaluate(stateOf({}), {}, { timeValue: 0.9 }), 0.9), 'derived 来源从 derived 表读取 timeValue');
  assert(approx(tv.evaluate(stateOf({}), {}, {}), 0), 'derived 缺省时按 0 处理');
}

console.log('4) buildConsiderations');
{
  const list = buildConsiderations([{ id: 'a', inputKey: 'x' }, { id: 'b', inputKey: 'y' }]);
  assert(list.length === 2 && list[0] instanceof Consideration, 'buildConsiderations 构建 Consideration 列表');
  assert(buildConsiderations(null).length === 0, 'buildConsiderations(null)=[]');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) npc-utility 评分上下文：风险、情绪、收益
// ─────────────────────────────────────────────────────────────────────────────
console.log('5) npc-utility 评分上下文：风险、情绪、收益');
{
  const riskJson = load('data/balance/risk.json');
  const rewardJson = load('data/balance/reward.json');

  function makeEntity({ caution = 50, anger = 0, fear = 0, obsessions = null } = {}) {
    return {
      state: { get: () => null, set: () => {} },
      staticData: { personality: { caution } },
      emotions: { get: (t) => t === 'anger' ? anger : t === 'fear' ? fear : 0 },
      obsessions,
    };
  }

  const cfg = {
    enabled: true,
    score: {
      minBiasMult: 0.25,
      maxBiasMult: 3,
      defaultConsiderationFloor: 0.05,
      rewardWeight: 0.5,
      riskWeight: 1,
    },
    riskAversion: { enabled: true, weight: 0.3 },
    emotionRisk: { enabled: true, angerFactor: 1.0, fearFactor: 1.0 },
    reward: { ...rewardJson, enabled: true },
  };
  const worldContext = { balanceConfig: { risk: riskJson } };

  const calmGoal = new Goal({ id: 'gCalm', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 0, fear: 0 }), calmGoal, worldContext, cfg);
  const calmCtx = calmGoal.getScoreContext();
  assert(calmCtx?.goalRisk > 0, '高风险复仇目标写入 goalRisk');
  assert(calmCtx?.riskWeight > 0, '高风险复仇目标写入 riskWeight');
  assert(approx(calmCtx?.riskWeight, 1), 'score.riskWeight 优先于旧 riskAversion.weight');
  assert(!calmGoal.modulators.some(m => m.label === 'riskAversion'), 'riskAversion 不再作为 modulator 重复扣分');

  const fallbackCfg = { ...cfg, score: { ...cfg.score } };
  delete fallbackCfg.score.riskWeight;
  const fallbackGoal = new Goal({ id: 'gFallbackRisk', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 0, fear: 0 }), fallbackGoal, worldContext, fallbackCfg);
  assert(approx(fallbackGoal.getScoreContext().riskWeight, 0.3), '缺少 score.riskWeight 时回退 riskAversion.weight');

  const riskDisabledCfg = { ...cfg, riskAversion: { ...cfg.riskAversion, enabled: false } };
  const riskDisabledGoal = new Goal({ id: 'gRiskDisabled', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 0, fear: 0 }), riskDisabledGoal, worldContext, riskDisabledCfg);
  assert(riskDisabledGoal.getScoreContext().riskWeight === 0, 'riskAversion.enabled=false 时高风险目标 riskWeight=0');
  assert(!riskDisabledGoal.modulators.some(m => m.label === 'riskAversion'), 'riskAversion.enabled=false 时不挂 riskAversion modulator');

  const emotionDisabledCfg = { ...cfg, emotionRisk: { ...cfg.emotionRisk, enabled: false } };
  const calmNoEmotionGoal = new Goal({ id: 'gCalmNoEmotion', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 0, fear: 0 }), calmNoEmotionGoal, worldContext, emotionDisabledCfg);
  const intenseNoEmotionGoal = new Goal({ id: 'gIntenseNoEmotion', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 100, fear: 100 }), intenseNoEmotionGoal, worldContext, emotionDisabledCfg);
  assert(approx(intenseNoEmotionGoal.getScoreContext().riskWeight, calmNoEmotionGoal.getScoreContext().riskWeight), 'emotionRisk.enabled=false 时 anger/fear 不改变风险权重');

  const noRiskGoal = new Goal({ id: 'gNoRisk', sourceId: 'need_npc_loyalty', priority: 60 });
  decorateGoalConsiderations(makeEntity({ caution: 50 }), noRiskGoal, worldContext, cfg);
  const noRiskCtx = noRiskGoal.getScoreContext();
  assert(noRiskCtx?.goalRisk === 0, '无风险目标写入 goalRisk=0');
  assert(noRiskCtx?.riskWeight === 0, '无风险目标写入 riskWeight=0');

  const angryGoal = new Goal({ id: 'gAngry', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 100, fear: 0 }), angryGoal, worldContext, cfg);
  assert(angryGoal.getScoreContext().riskWeight < calmCtx.riskWeight, '愤怒降低风险权重');
  assert(approx(angryGoal.getScoreContext().riskWeight, 0), 'anger=100 时风险权重降为 0');

  const overAngryGoal = new Goal({ id: 'gOverAngry', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 200, fear: 0 }), overAngryGoal, worldContext, cfg);
  assert(approx(overAngryGoal.getScoreContext().riskWeight, 0), 'anger=200 超界时风险权重仍钳制为 0');

  const scaredGoal = new Goal({ id: 'gScared', sourceId: 'obsession_revenge', priority: 80 });
  decorateGoalConsiderations(makeEntity({ caution: 50, anger: 0, fear: 100 }), scaredGoal, worldContext, cfg);
  assert(scaredGoal.getScoreContext().riskWeight > calmCtx.riskWeight, '恐惧提高风险权重');

  const plunderGoal = new Goal({ id: 'gPlunder', sourceId: 'obsession_plunder', priority: 60 });
  decorateGoalConsiderations(makeEntity({ caution: 10 }), plunderGoal, worldContext, cfg);
  const plunderCtx = plunderGoal.getScoreContext();
  assert(plunderCtx?.expectedValue > 0, '夺宝目标写入 expectedValue');
  assert(plunderGoal.score() > 0, '收益风险上下文参与评分后仍得到正分');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6) 随机扰动（上头，ADR-021）
// ─────────────────────────────────────────────────────────────────────────────
console.log('6) 随机扰动（上头）');
{
  // 确定性注入：用 mult=2 且 chance=1（必中）的配置
  const cfgHeadstrong = {
    enabled: true,
    headstrong: { enabled: true, chance: 1.0, mult: 2.0 },
  };
  const entity = {
    state: { get: () => null, set: () => {} },
    staticData: {},
    emotions: null,
    obsessions: null,
  };
  const g = new Goal({ id: 'gH', sourceId: 'need_npc_ambition', priority: 50 });
  decorateGoalConsiderations(entity, g, {}, cfgHeadstrong);
  const headstrongMod = g.modulators.find(m => m.label === 'headstrong');
  assert(headstrongMod != null, '上头命中时挂载 headstrong modulator');
  assert(headstrongMod?.mult === 2.0, 'headstrong modulator.mult === 配置值 2.0');
  assert(approx(g.score(), 50 * 2.0), 'score = priority × headstrongMult = 100');

  // chance=0 时不上头
  const cfgNoHead = { enabled: true, headstrong: { enabled: true, chance: 0, mult: 2.0 } };
  const g2 = new Goal({ id: 'gH2', sourceId: 'need_npc_ambition', priority: 50 });
  decorateGoalConsiderations(entity, g2, {}, cfgNoHead);
  assert(!g2.modulators.some(m => m.label === 'headstrong'), 'chance=0 时不挂 headstrong modulator');
  assert(g2.score() === 50, 'chance=0 时 score === priority');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7) 路径偏好（ADR-021）
// ─────────────────────────────────────────────────────────────────────────────
console.log('7) 路径偏好');
{
  const cfgPath = {
    enabled: true,
    pathPreference: { enabled: true, exploreFirstBonus: 40 },
  };
  function makePathEntity(pathOrder) {
    return {
      state: { get: (k) => k === 'breakthroughPathOrder' ? pathOrder : null, set: () => {} },
      staticData: {},
      emotions: null,
      obsessions: null,
    };
  }

  // explore_first + 探索类目标 → 应加分
  const explorerEntity = makePathEntity('explore_first');
  const gExplore = new Goal({ id: 'gE', sourceId: 'need_npc_exploration', priority: 60 });
  decorateGoalConsiderations(explorerEntity, gExplore, {}, cfgPath);
  const pathMod = gExplore.modulators.find(m => m.label === 'pathPreference');
  assert(pathMod != null, 'explore_first + 探索目标 → 挂载 pathPreference modulator');
  assert(pathMod?.deltaPriority === 40, 'pathPreference.deltaPriority === exploreFirstBonus');
  assert(gExplore.score() > 60, 'explore_first 让探索目标分数高于基础 priority');

  // explore_first + 非探索目标 → 不应加分
  const gCult = new Goal({ id: 'gC', sourceId: 'need_npc_cultivation', priority: 60 });
  decorateGoalConsiderations(explorerEntity, gCult, {}, cfgPath);
  assert(!gCult.modulators.some(m => m.label === 'pathPreference'), 'explore_first 对修炼目标不加分');
  assert(gCult.score() === 60, '修炼目标 score === priority（无路径偏好影响）');

  // cultivate_first + 探索类目标 → 不加分
  const cultivatorEntity = makePathEntity('cultivate_first');
  const gExplore2 = new Goal({ id: 'gE2', sourceId: 'need_npc_exploration', priority: 60 });
  decorateGoalConsiderations(cultivatorEntity, gExplore2, {}, cfgPath);
  assert(!gExplore2.modulators.some(m => m.label === 'pathPreference'), 'cultivate_first 时探索目标不加分');
}

if (failures === 0) {
  console.log('\nUtility 考量层单元测试全部通过');
  process.exit(0);
} else {
  console.error(`\nUtility 单元测试失败：${failures} 项`);
  process.exit(1);
}
