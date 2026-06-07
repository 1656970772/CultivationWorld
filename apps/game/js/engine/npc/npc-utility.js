/**
 * NPC Utility 工具（ADR-020 / ADR-021）：选目标层的完整价值评估装配。
 *
 * 职责（ADR-021 重构后）：
 *   在「选哪个目标」阶段完成所有决策相关的评估，具体包括：
 *   1. TimeValue（时间价值）：寿命比例越高越紧迫。
 *   2. 目标风险（estimateGoalRisk）：期望风险损失转化为目标分数折扣。
 *   3. 情绪修正风险厌恶（emotionRisk）：愤怒降低风险厌恶，恐惧提高风险厌恶。
 *   4. 随机扰动（headstrong，上头）：小概率让某目标分数暴增，模拟冲动决策。
 *   5. 路径偏好（pathPreference）：explore_first/cultivate_first 对应目标加成。
 *   6. utility.json 自定义 Consideration 曲线。
 *   7. 执念→需求 Goal 乘子（obsessionNeedBoost）。
 *
 * GOAP 只负责"如何实现已选目标"（HOW），step cost 只用 action.getPlanCost()，
 * 不再包含任何风险/价值/情绪/性格计算（见 npc-actions.js computeDecisionCost）。
 *
 * 不改变现有行为：所有新增逻辑均受 utilityConfig 各自开关控制，默认 enabled=false 时
 * 等价旧行为（仅 obsessionNeedBoost 受 obsession.json goalMult.enabled 控制）。
 */
import { buildConsiderations, deriveExpectedValue } from '../abstract/consideration.js';
import { estimateRiskCost } from './npc-actions.js';

/**
 * 目标来源 → 该目标典型行为 riskKey 列表的映射。
 * 用于 estimateGoalRisk 聚合「追这个目标大概要冒多少险」。数据驱动可在 utilityConfig.goalRiskKeys 覆盖。
 */
const DEFAULT_GOAL_RISK_KEYS = {
  need_npc_cultivation: ['cultivate'],
  obsession_supremacy: ['cultivate'],
  obsession_revenge: ['pvp'],
  // 流派分化执念的风险来源（ADR-022/ADR-023）：
  obsession_plunder: ['plunder'],  // 夺宝：闯秘境/厮杀夺宝
  obsession_power: ['power'],      // 夺权：夺位冲突
  // 养老(retire)/传承(legacy) 为低风险目标，不映射风险键（goalRisk=0）。
  // 关系驱动目标（ADR-028）：驰援同门需并肩御敌（pvp 风险）；探望恩人为低风险（不映射）。
  goal_assist_sect_mate: ['pvp'],
  // 师徒互动目标（ADR-029）：护徒驰援需御敌（pvp）；传功/探望恩师为低风险（不映射）。
  goal_protect_disciple: ['pvp'],
  prepare_secret_realm: ['plunder'],
  join_secret_realm: ['plunder'],
  prepare_tournament: ['pvp'],
  loot_fallen_master: ['plunder'],
  avenge_relationship_death: ['pvp'],
};

/**
 * 探索类目标 sourceId 集合，用于路径偏好逻辑识别「explore_first 时应加分的目标」。
 */
const EXPLORE_GOAL_IDS = new Set(['need_npc_exploration', 'need_npc_explore']);

/**
 * 派生时间价值 timeValue ∈ [0,1]：lifeRatio 越接近 1（越接近寿元），时间越宝贵。
 * 老年金丹 timeValue 高（争分夺秒突破/延寿），少年炼气低（来日方长）。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @returns {number}
 */
export function deriveTimeValue(entity) {
  const lifeRatio = entity.state?.get ? entity.state.get('lifeRatio') : undefined;
  if (typeof lifeRatio !== 'number') return 0;
  return Math.max(0, Math.min(1, lifeRatio));
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function computeRiskWeight(entity, goalRisk, utilityConfig) {
  if (goalRisk <= 0) return 0;

  const riskCfg = utilityConfig.riskAversion || {};
  if (riskCfg.enabled === false) return 0;

  const scoreCfg = utilityConfig.score || {};
  const baseWeight = positiveNumber(scoreCfg.riskWeight, positiveNumber(riskCfg.weight, 1));
  const caution = entity.staticData?.personality?.caution ?? 50;
  let riskWeight = baseWeight * (caution / 50);

  const emotionCfg = utilityConfig.emotionRisk || {};
  if (emotionCfg.enabled !== false && entity.emotions) {
    const anger = entity.emotions.get('anger') ?? 0;
    const fear = entity.emotions.get('fear') ?? 0;
    const angerFactor = emotionCfg.angerFactor ?? 1.0;
    const fearFactor = emotionCfg.fearFactor ?? 1.0;
    riskWeight *= (1 - (anger / 100) * angerFactor) * (1 + (fear / 100) * fearFactor);
  }

  return Math.max(0, riskWeight);
}

/**
 * 估算「追求某目标」的期望风险 ∈ 通常 [0,1+] 量级：聚合该目标典型行为的 estimateRiskCost。
 * 复用 npc-actions.estimateRiskCost（与 risk.json 性格加成同一套）。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {import('../abstract/goal.js').Goal} goal
 * @param {Object} worldContext
 * @param {Object} [goalRiskKeys] 目标→riskKey[] 映射（默认 DEFAULT_GOAL_RISK_KEYS）
 * @returns {number}
 */
export function estimateGoalRisk(entity, goal, worldContext, goalRiskKeys = DEFAULT_GOAL_RISK_KEYS) {
  const keys = goalRiskKeys[goal.sourceId] || goalRiskKeys[goal.tag];
  if (!keys || keys.length === 0) return 0;
  let total = 0;
  for (const k of keys) total += estimateRiskCost(entity, worldContext, k);
  return total;
}

/**
 * 为某目标装配考量因素（TimeValue/风险/情绪修正/随机扰动/路径偏好/utility.json 自定义因素），
 * 并挂到 Goal 的 modulators 上。
 * 由 NPCEntity.decorateGoalConsiderations 调用，PlannerNode 在排序前统一触发。
 *
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {import('../abstract/goal.js').Goal} goal
 * @param {Object} worldContext
 * @param {Object} utilityConfig 来自 ai-config.json npc.utility + utility.json 合并后的配置
 */
export function decorateGoalConsiderations(entity, goal, worldContext, utilityConfig) {
  // ── A. 执念→同方向需求 Goal 的乘法加成（ADR-020 阶段C）。
  // 独立于 utility.json 总开关，受 obsession.json goalMult.enabled 控制；默认关闭 → 乘子 1 → 不改变现有行为。
  if (goal.source === 'need' && entity.obsessions && typeof entity.obsessions.needGoalMult === 'function') {
    const m = entity.obsessions.needGoalMult(goal.sourceId);
    if (m !== 1) {
      goal.modulators.push({ label: 'obsessionNeedBoost', deltaPriority: 0, mult: m });
    }
  }

  if (!utilityConfig || utilityConfig.enabled !== true) return; // 默认不挂任何额外乘子，不改变现有行为

  // ── B. 目标风险估算（供后续 riskAversion/emotionRisk 使用）。
  const goalRiskKeys = utilityConfig.goalRiskKeys || DEFAULT_GOAL_RISK_KEYS;
  const goalRisk = estimateGoalRisk(entity, goal, worldContext, goalRiskKeys);

  // ── C. 时间价值（TimeValue）：来自 utility.json 的 consideration 曲线驱动，
  //        或 riskAversion 内建乘子（两者均为 optional）。
  const bySource = utilityConfig.considerationsBySource || {};
  const configs = bySource[goal.sourceId] || bySource[goal.tag] || [];
  const considerations = buildConsiderations(configs);

  // 期望收益（ADR-022）：从 reward.json（经 utilityConfig.reward 注入）按 sourceId 算 Σ(prob×value)。
  // reward.json enabled=false（默认）时 deriveExpectedValue 返回 0，不改变现有行为。
  const expectedValue = deriveExpectedValue(utilityConfig.reward, goal.sourceId)
    || deriveExpectedValue(utilityConfig.reward, goal.tag);

  const scoreCfg = utilityConfig.score || {};
  const riskWeight = computeRiskWeight(entity, goalRisk, utilityConfig);
  const rewardWeight = positiveNumber(scoreCfg.rewardWeight, 0.5);
  if (typeof goal.setScoreContext === 'function') {
    goal.setScoreContext({
      hardGate: 1,
      expectedValue,
      goalRisk,
      rewardWeight,
      riskWeight,
      scoreConfig: scoreCfg,
    });
  }

  const derived = {
    timeValue: deriveTimeValue(entity),
    goalRisk,
    expectedValue,
  };

  if (considerations.length > 0) {
    goal.evaluateConsiderations(considerations, entity.state, worldContext, derived);
  }

  // ── D. 随机扰动（上头，ADR-021 迁入）：
  // 小概率让某目标分数暴增，使 NPC 做出冲动选择。在目标评估阶段 roll，而非 GOAP 行为级。
  const headstrongCfg = utilityConfig.headstrong || {};
  if (headstrongCfg.enabled === true) {
    const chance = headstrongCfg.chance ?? 0.03;
    const mult   = headstrongCfg.mult   ?? 1.8;
    const roll = typeof worldContext?.rng?.next === 'function' ? worldContext.rng.next() : 0;
    if (chance > 0 && roll < chance) {
      goal.modulators.push({ label: 'headstrong', deltaPriority: 0, mult });
      // 写入 state 方便调试/可视化
      if (entity.state && typeof entity.state.set === 'function') {
        entity.state.set('lastDecisionHeadstrong', true);
        entity.state.set('headstrongGoalId', goal.sourceId || goal.id);
      }
    } else if (entity.state && typeof entity.state.set === 'function') {
      entity.state.set('lastDecisionHeadstrong', false);
      entity.state.set('headstrongGoalId', null);
    }
  }

  // ── E. 路径偏好（ADR-021 迁入）：
  // breakthroughPathOrder 决定 NPC 在游历/修炼间的倾向，通过给对应目标加分体现，
  // 而非原来降低 GOAP action 的 cost。
  const pathCfg = utilityConfig.pathPreference || {};
  if (pathCfg.enabled === true && entity.state) {
    const pathOrder = entity.state.get('breakthroughPathOrder');
    if (pathOrder === 'explore_first') {
      const isExploreGoal = EXPLORE_GOAL_IDS.has(goal.sourceId) || EXPLORE_GOAL_IDS.has(goal.tag);
      if (isExploreGoal) {
        const bonus = pathCfg.exploreFirstBonus ?? 40;
        goal.modulators.push({ label: 'pathPreference', deltaPriority: bonus, mult: 1 });
      }
    }
  }
}
