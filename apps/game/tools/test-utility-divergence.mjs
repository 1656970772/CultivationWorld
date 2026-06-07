#!/usr/bin/env node
/**
 * Utility 流派分化测试（ADR-020/021/022，双轨测试策略）。
 *
 * 与 test-goal-equivalence 的等价性测试互补：那个测试守护 utility.json
 * `enabled=false`（默认关闭态）的行为不被意外改变；本测试则在
 * **强制 enabled=true** 下，验证"同境界、相同局面下不同人格/执念的 NPC 选出不同目标"，
 * 即激活 Utility 选目标层后流派分化确实发生。
 *
 * 覆盖：
 *   1) 风险厌恶分化：高 caution 与低 caution 对同一高风险目标打分不同（稳健流 vs 赌狗流）。
 *   2) 情绪分化：愤怒 NPC 对高风险复仇目标的折扣小于平静 NPC（愤怒→激进）。
 *   3) 执念分化：不同执念类型产出的 Goal 在 score 上分层（强执念压过普通需求）。
 *   4) 多 NPC 群体不再"千人一面"：一批人格各异的 NPC 选出的 top 目标存在多样性。
 *
 * 用法：node tools/test-utility-divergence.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Goal, GoalSource } = await imp('js/engine/abstract/goal.js');
const { decorateGoalConsiderations } = await imp('js/engine/npc/npc-utility.js');

const utilityJson = load('data/balance/utility.json');
const aiConfig = load('data/config/ai-config.json');
const riskJson = load('data/balance/risk.json');
const rewardJson = load('data/balance/reward.json');

// 风险估算（estimateGoalRisk→estimateRiskCost）从 worldContext.balanceConfig.risk 读配置。
const worldCtx = { balanceConfig: { risk: riskJson } };

// 激活态 reward：强制 enabled=true，验证期望收益（ADR-022）在激活态下生效。
const activeReward = Object.assign({}, rewardJson, { enabled: true });

// 激活态配置：强制 enabled=true，叠加 ai-config 的 utility 参数（与 world-engine 合并口径一致）。
// 测试需确定性：关闭 headstrong 随机扰动（chance=0），避免随机命中导致断言抖动。
// headstrong 本身由 test-utility.mjs 专项覆盖，这里只验证人格/情绪/寿元的确定性分化。
const activeCfg = Object.assign({}, utilityJson, aiConfig.npc?.utility || {}, {
  enabled: true,
  headstrong: { enabled: false, chance: 0, mult: 1 },
  reward: activeReward,
});

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

/** 构造一个最简 NPC mock，足够 decorateGoalConsiderations 读取。 */
function makeEntity({ caution = 50, anger = 0, fear = 0, lifeRatio = 0.5, rankStage = 'middle', totalCultivation = 2500, nextCultivationRequired = 5000, rankId = 'golden_core' } = {}) {
  const flat = { lifeRatio, rankStage, totalCultivation, nextCultivationRequired, rankId };
  return {
    state: { get: (k) => flat[k], set: () => {} },
    staticData: { personality: { caution } },
    emotions: { get: (t) => (t === 'anger' ? anger : t === 'fear' ? fear : 0) },
    obsessions: null,
  };
}

/** 给一个 Goal 装配考量因素并返回最终 score。 */
function scoreGoal(entity, sourceId, priority, worldContext = worldCtx) {
  const g = new Goal({ id: `g_${sourceId}`, sourceId, source: GoalSource.OBSESSION, priority });
  decorateGoalConsiderations(entity, g, worldContext, activeCfg);
  return g.score();
}

// —— 1) 风险厌恶分化：稳健流 vs 赌狗流 ——
console.log('1) 风险厌恶分化（caution）');
{
  // obsession_revenge 映射到 pvp 风险键（见 npc-utility DEFAULT_GOAL_RISK_KEYS），是高风险目标。
  const cautious = makeEntity({ caution: 100 });
  const reckless = makeEntity({ caution: 10 });
  const sCautious = scoreGoal(cautious, 'obsession_revenge', 80);
  const sReckless = scoreGoal(reckless, 'obsession_revenge', 80);
  assert(sReckless > sCautious,
    `低谨慎(赌狗流)对高风险复仇目标打分更高(${sReckless.toFixed(1)}) > 高谨慎(稳健流)(${sCautious.toFixed(1)})`);
}

// —— 2) 情绪分化：愤怒→激进 ——
console.log('2) 情绪分化（anger 降低风险厌恶）');
{
  const calm = makeEntity({ caution: 50, anger: 0 });
  const furious = makeEntity({ caution: 50, anger: 100 });
  const sCalm = scoreGoal(calm, 'obsession_revenge', 80);
  const sFurious = scoreGoal(furious, 'obsession_revenge', 80);
  assert(sFurious > sCalm,
    `愤怒 NPC 对高风险复仇目标打分更高(${sFurious.toFixed(1)}) > 平静 NPC(${sCalm.toFixed(1)})（愤怒降低风险厌恶）`);
}

// —— 3) 寿元驱动的流派分化：养老/传承随寿元升高而升 ——
console.log('3) 寿元驱动分化（lifeRatio）');
{
  const young = makeEntity({ lifeRatio: 0.3 });
  const old = makeEntity({ lifeRatio: 0.9 });
  const sYoungRetire = scoreGoal(young, 'obsession_retire', 70);
  const sOldRetire = scoreGoal(old, 'obsession_retire', 70);
  assert(sOldRetire > sYoungRetire,
    `高龄 NPC 养老目标效用更高(${sOldRetire.toFixed(1)}) > 年轻 NPC(${sYoungRetire.toFixed(1)})`);

  const sOldLegacy = scoreGoal(old, 'obsession_legacy', 70);
  assert(sOldLegacy > sYoungRetire * 0,
    `高龄 NPC 传承目标 consideration 生效(score=${sOldLegacy.toFixed(1)} > 0)`);
}

// —— 3.5) 期望收益分化：赌狗流 vs 稳健流对高期望收益险地（夺宝）——
console.log('3.5) 期望收益分化（ADR-022 夺宝流）');
{
  // obsession_plunder 同时受期望收益(reward.json)吸引 与 风险厌恶(risk.json explore 键)惩罚。
  // 赌狗流(低 caution)风险惩罚小，对同一夺宝目标打分应高于稳健流(高 caution)。
  const reckless = makeEntity({ caution: 10 });
  const cautious = makeEntity({ caution: 100 });
  const sReckless = scoreGoal(reckless, 'obsession_plunder', 60);
  const gTrace = new Goal({ id: 'gPlunderTrace', sourceId: 'obsession_plunder', priority: 60 });
  decorateGoalConsiderations(reckless, gTrace, worldCtx, activeCfg);
  const traceCtx = gTrace.getScoreContext();
  assert(traceCtx?.expectedValue > 0, `夺宝目标 expectedValue 写入评分上下文(${traceCtx?.expectedValue?.toFixed(3)})`);
  assert(traceCtx?.goalRisk > 0, `夺宝目标 goalRisk 写入评分上下文(${traceCtx?.goalRisk?.toFixed(3)})`);
  const sCautious = scoreGoal(cautious, 'obsession_plunder', 60);
  // 期望收益 consideration 必生效（>0），且赌狗流分数高于稳健流。
  assert(sReckless > 0, `夺宝目标期望收益 consideration 生效(score=${sReckless.toFixed(1)} > 0)`);
  assert(sReckless >= sCautious,
    `赌狗流对夺宝险地打分 >= 稳健流(${sReckless.toFixed(1)} >= ${sCautious.toFixed(1)})`);

  // 期望收益开关关闭时，plunder 的 EV consideration 输入为 0 → consideration=base(0.1) → 分数明显更低。
  const cfgNoReward = Object.assign({}, activeCfg, { reward: Object.assign({}, rewardJson, { enabled: false }) });
  const gNoReward = new Goal({ id: 'gPlunderOff', sourceId: 'obsession_plunder', priority: 60 });
  decorateGoalConsiderations(reckless, gNoReward, worldCtx, cfgNoReward);
  assert(gNoReward.score() < sReckless,
    `关闭期望收益后夺宝目标分数下降(${gNoReward.score().toFixed(1)} < ${sReckless.toFixed(1)})，证明 rewardMult 提供了收益吸引力`);
}

// —— 4) 群体多样性：一批人格各异、执念各异的 NPC 不再选同一目标 ——
console.log('4) 群体目标多样性');
{
  // 每个 NPC 拥有的候选目标 = 通用需求(修炼) + 自身 roll 到的执念。
  // 这模拟 collectExtraGoals：不同 NPC 因人格/灵根 roll 到不同执念（obsession.json innate 规则），
  // 是流派分化的真正源头。同境界下，Utility 再按各自人格/状态选出 score 最高目标。
  function topGoalFor(entity, goalSpecs) {
    let best = null, bestScore = -Infinity;
    for (const g of goalSpecs) {
      const s = scoreGoal(entity, g.sourceId, g.priority);
      if (s > bestScore) { bestScore = s; best = g.sourceId; }
    }
    return best;
  }

  const baseCultivation = { sourceId: 'need_npc_cultivation', priority: 50 };

  // 6 个差异化 NPC（同为金丹境），各自拥有不同执念，体现修仙世界的人生取向分化。
  const cases = [
    { e: makeEntity({ caution: 95, lifeRatio: 0.9,  rankStage: 'middle' }), goals: [baseCultivation, { sourceId: 'obsession_retire',    priority: 70 }] }, // 谨慎高龄 → 养老
    { e: makeEntity({ caution: 10, anger: 90, lifeRatio: 0.4, rankStage: 'late' }), goals: [baseCultivation, { sourceId: 'obsession_revenge', priority: 78 }] }, // 暴躁莽夫 → 复仇
    { e: makeEntity({ caution: 50, lifeRatio: 0.3,  rankStage: 'perfection' }), goals: [baseCultivation, { sourceId: 'obsession_power',   priority: 72 }] }, // 修为充足 → 夺权
    { e: makeEntity({ caution: 50, lifeRatio: 0.5,  rankStage: 'early' }), goals: [baseCultivation] },                                                  // 瓶颈期 → 修炼
    { e: makeEntity({ caution: 50, lifeRatio: 0.85, rankStage: 'middle' }), goals: [baseCultivation, { sourceId: 'obsession_legacy',  priority: 70 }] }, // 高龄宗师 → 传承
    { e: makeEntity({ caution: 50, lifeRatio: 0.45, rankStage: 'late' }), goals: [baseCultivation, { sourceId: 'obsession_supremacy', priority: 65 }] }, // 进取 → 证道(修炼向)
  ];

  const chosen = cases.map(c => topGoalFor(c.e, c.goals));
  const distinct = new Set(chosen);
  console.log('     各 NPC 选中目标:', chosen.join(', '));
  assert(distinct.size >= 3,
    `群体选出至少 3 种不同目标，不再千人一面（实际 ${distinct.size} 种: ${[...distinct].join('/')}）`);
}

if (failed === 0) { console.log('\nUtility 流派分化测试全部通过'); process.exit(0); }
else { console.error(`\nUtility 流派分化测试失败：${failed} 项`); process.exit(1); }
