/**
 * npc-action-utils —— NPC 行为执行器共享工具（从 npc-actions.js 抽离）。
 *
 * 汇集所有行为执行器复用的纯函数 / 配置读取 / 风险结算 / 价值估算 / PvP 致死 / 奖励发放：
 *   - 配置读取：getCultivationConfig / getRiskConfig / getEconomyConfig
 *   - 妖兽任务定位：resolveQuestTargetMonster / preferredHuntGrade / pickQuestCandidate 等
 *   - 风险体系：settleRisk / applyRiskEffect / personalityRiskBoost / RISK_SEVERITY / estimateRiskCost
 *   - GOAP/Utility 接口：computeActionValue / computeDecisionCost
 *   - 战斗与奖励：killNPCByPvP / rollAndGrantReward
 *
 * 这些工具被 actions/ 下各域执行器与 planner/utility 层共享，集中于此保证单一真相源、便于测试。
 */
import { ItemRegistry } from '../../items/item-registry.js';
import {
  factionNeedsMonsterExchangeMaterials,
  missingFactionExchangeItems,
  grantItemAndMaybeEquip,
} from '../npc-economy.js';
import {
  isMonsterHuntQuest,
} from '../../monster/monster-resources.js';

export function getCultivationConfig(worldContext) {
  return worldContext.balanceConfig?.cultivation || {};
}

export function getRiskConfig(worldContext) {
  return worldContext.balanceConfig?.risk || {};
}

export function getEconomyConfig(worldContext) {
  return worldContext.balanceConfig?.economy || {};
}

function isAliveMonster(monster) {
  return !!monster && monster.alive !== false && monster.state?.get?.('alive') !== false;
}

export function resolveQuestTargetMonster(entity, worldContext, difficulty) {
  const registry = worldContext?.entityRegistry;
  if (!registry) return null;

  const lockedId = entity.state.get('questTargetMonsterId');
  const locked = lockedId ? registry.getById?.(lockedId) : null;
  if (isAliveMonster(locked)) return locked;

  const monsters = typeof registry.getAliveByType === 'function'
    ? registry.getAliveByType('monster').filter(m => m?.hasSpatial?.() || m?.spatial)
    : [];
  if (monsters.length === 0) return null;

  const cfg = getEconomyConfig(worldContext)?.monsterResources || {};
  const gap = cfg.retargetGradeGap ?? 2;
  const qx = entity.state.get('questTargetX');
  const qy = entity.state.get('questTargetY');
  const here = (typeof qx === 'number' && typeof qy === 'number')
    ? { x: qx, y: qy }
    : (entity.spatial ? { x: entity.spatial.tileX, y: entity.spatial.tileY } : { x: 0, y: 0 });

  const desired = Number(difficulty) || 1;
  const sameBand = monsters.filter(m => Math.abs((m.grade || 1) - desired) <= gap);
  const pool = sameBand.length > 0 ? sameBand : monsters;
  let best = null;
  let bestDist = Infinity;
  for (const m of pool) {
    const sp = m.spatial;
    const x = sp?.tileX ?? sp?.x;
    const y = sp?.tileY ?? sp?.y;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    const dist = Math.abs(x - here.x) + Math.abs(y - here.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  if (best) {
    entity.state.set('questTargetMonsterId', best.id);
    const sp = best.spatial;
    entity.state.set('questTargetX', sp.tileX ?? sp.x);
    entity.state.set('questTargetY', sp.tileY ?? sp.y);
  }
  return best;
}

/** 按 [{weight}] 列表做加权随机，返回选中项（无有效权重返回首项/null） */
export function weightedPickFrom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const total = list.reduce((s, e) => s + (e.weight || 0), 0);
  if (total <= 0) return list[0];
  let roll = Math.random() * total;
  for (const e of list) {
    roll -= (e.weight || 0);
    if (roll < 0) return e;
  }
  return list[list.length - 1];
}

function gradedResourceValue(baseItemId, grade) {
  const safeGrade = Math.max(1, Math.min(9, Math.floor(Number(grade) || 1)));
  const itemId = `${baseItemId}_g${safeGrade}`;
  const def = ItemRegistry.get(itemId) || ItemRegistry.get(baseItemId);
  return Number(def?.properties?.value ?? def?.value ?? 0);
}

function expectedHuntMaterialValue(difficulty) {
  const grade = Math.max(1, Math.min(9, Math.floor(Number(difficulty) || 1)));
  return gradedResourceValue('monster_core', grade) + gradedResourceValue('beast_material', grade);
}

function monsterResourceGrade(itemId) {
  const match = /_g(\d+)$/.exec(itemId || '');
  if (match) return Math.max(1, Math.min(9, Number(match[1]) || 1));
  if (itemId === 'beast_material') return 2;
  if (itemId === 'monster_core') return 3;
  return null;
}

function preferredHuntGrade(entity, worldContext) {
  const missing = [
    ...missingFactionExchangeItems(entity, worldContext, 'breakthrough_pill'),
    ...missingFactionExchangeItems(entity, worldContext, 'artifact_low'),
  ];
  const grades = missing
    .map(m => monsterResourceGrade(m.itemId))
    .filter(g => Number.isFinite(g));
  return grades.length > 0 ? Math.max(...grades) : null;
}

export function pickQuestCandidate(entity, worldContext, available, opts = {}) {
  if (!Array.isArray(available) || available.length === 0) return null;
  const economy = getEconomyConfig(worldContext);
  const needsHuntMaterials = factionNeedsMonsterExchangeMaterials(entity, worldContext);
  const preferredGrade = preferredHuntGrade(entity, worldContext);
  const weighted = available.map((candidate) => {
    const hunt = isMonsterHuntQuest(candidate.quest.id, economy);
    let weight = 1;
    if (hunt) {
      const gradeFit = preferredGrade
        ? 1 / (1 + Math.abs(candidate.difficulty - preferredGrade))
        : 0.5;
      weight += 2 + expectedHuntMaterialValue(candidate.difficulty) / 500 + gradeFit * 10;
      if (needsHuntMaterials || opts.forceMonsterHunt) weight += 8;
    } else if (needsHuntMaterials) {
      weight *= 0.25;
    }
    return { ...candidate, weight };
  });
  return weightedPickFrom(weighted);
}

/**
 * 性格对某风险分项触发概率的加成（绝对值叠加）。数据驱动：见 risk.json 的 personalityModifiers。
 * 加成量 = (trait - minThreshold) / (100 - minThreshold) × maxChanceBoost，trait<阈值则为 0。
 * @returns {number} 概率增量（>=0）
 */
function personalityRiskBoost(entity, modifiers) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return 0;
  const personality = entity.staticData?.personality || {};
  let boost = 0;
  for (const mod of modifiers) {
    const traitVal = personality[mod.trait] ?? 50;
    const minT = mod.minThreshold ?? 0;
    if (traitVal < minT) continue;
    const denom = Math.max(1, 100 - minT);
    boost += ((traitVal - minT) / denom) * (mod.maxChanceBoost ?? 0);
  }
  return boost;
}

/**
 * 结算某行为的风险分项（数据驱动，见 risk.json）。逐项独立 roll，命中则施加效果。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {Object} worldContext
 * @param {string} actionKey risk.json 下的行为键（如 'explore'）
 * @returns {{ triggered: Array, died: boolean, totalRiskPct: number }}
 */
export function settleRisk(entity, worldContext, actionKey) {
  const riskCfg = getRiskConfig(worldContext);
  const cfg = riskCfg[actionKey];
  const out = { triggered: [], died: false, totalRiskPct: 0 };
  if (!cfg || !Array.isArray(cfg.items)) return out;

  const rankId = entity.state.get('rankId') || 'mortal';
  const rankMitigation = (cfg.rankMitigation && cfg.rankMitigation[rankId]) ?? 1.0;

  for (const item of cfg.items) {
    const baseChance = item.baseChance ?? 0;
    out.totalRiskPct += baseChance;
    if (baseChance <= 0 && (!item.personalityModifiers || item.personalityModifiers.length === 0)) continue;

    let chance = baseChance + personalityRiskBoost(entity, item.personalityModifiers);
    if (item.appliesRankMitigation) chance *= rankMitigation;
    chance = Math.max(0, Math.min(1, chance));
    if (chance <= 0) continue;

    if (Math.random() < chance) {
      const applied = applyRiskEffect(entity, item.effect, item.name);
      out.triggered.push(applied);
      if (applied.died) out.died = true;
    }
  }
  return out;
}

/** 施加单个风险效果。返回结算描述。 */
function applyRiskEffect(entity, effect, riskName) {
  if (!effect) return { risk: riskName, type: 'none' };
  switch (effect.type) {
    case 'injury': {
      const amt = (effect.amountMin ?? 1)
        + Math.floor(Math.random() * ((effect.amountMax ?? 1) - (effect.amountMin ?? 1) + 1));
      entity.state.set('injuryLevel', (entity.state.get('injuryLevel') || 0) + amt);
      return { risk: riskName, type: 'injury', amount: amt };
    }
    case 'resource_loss': {
      const itemId = effect.itemId || 'low_spirit_stone';
      const have = entity.inventory.getAmount(itemId) || 0;
      const ratio = (effect.lossRatioMin ?? 0)
        + Math.random() * ((effect.lossRatioMax ?? 0) - (effect.lossRatioMin ?? 0));
      const lost = Math.floor(have * ratio);
      if (lost > 0) entity.inventory.remove(itemId, lost);
      return { risk: riskName, type: 'resource_loss', itemId, amount: lost };
    }
    case 'morale_loss': {
      const amt = (effect.amountMin ?? 0)
        + Math.floor(Math.random() * ((effect.amountMax ?? 0) - (effect.amountMin ?? 0) + 1));
      entity.state.set('morale', Math.max(0, (entity.state.get('morale') || 0) - amt));
      return { risk: riskName, type: 'morale_loss', amount: amt };
    }
    case 'death': {
      entity.state.set('alive', false);
      entity.alive = false;
      entity._deathInfo = {
        cause: effect.cause || 'explore',
        npcId: entity.id,
        npcName: entity.name,
        factionId: entity.state.get('factionId'),
        ageYears: entity.state.get('ageYears'),
        maxAgeYears: entity.state.get('maxAgeYears'),
        rankName: entity.state.get('rankName'),
      };
      return { risk: riskName, type: 'death', died: true };
    }
    default:
      return { risk: riskName, type: effect.type || 'unknown' };
  }
}

/**
 * 风险效果的“严重度”权重：把不同类型的风险折算成统一损失量纲（0~1 量级），
 * 供 estimateRiskCost 计算期望损失。death 最重，资源/士气损失较轻。可后续按需调参。
 */
const RISK_SEVERITY = {
  death: 1.0,
  injury: 0.25,
  resource_loss: 0.1,
  morale_loss: 0.05,
};

/**
 * 估算某行为的【期望风险损失】（不 roll，用期望值）。复用 risk.json 分项与性格加成，
 * 与 settleRisk 同一套触发概率公式，但取 Σ(chance × severity) 而非掷骰，保证规划期可重复。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {Object} worldContext
 * @param {?string} riskKey risk.json 下的行为键（如 'explore'）；空/缺失视为无风险返回 0
 * @returns {number} 期望损失（>=0，通常 0~1 量级）
 */
export function estimateRiskCost(entity, worldContext, riskKey) {
  if (!riskKey) return 0;
  const riskCfg = getRiskConfig(worldContext);
  const cfg = riskCfg[riskKey];
  if (!cfg || !Array.isArray(cfg.items)) return 0;

  const rankId = entity.state.get('rankId') || 'mortal';
  const rankMitigation = (cfg.rankMitigation && cfg.rankMitigation[rankId]) ?? 1.0;

  let expected = 0;
  for (const item of cfg.items) {
    const baseChance = item.baseChance ?? 0;
    let chance = baseChance + personalityRiskBoost(entity, item.personalityModifiers);
    if (item.appliesRankMitigation) chance *= rankMitigation;
    chance = Math.max(0, Math.min(1, chance));
    if (chance <= 0) continue;
    const severity = RISK_SEVERITY[item.effect?.type] ?? 0.1;
    expected += chance * severity;
  }
  return expected;
}

/**
 * 计算某行为的【价值】。当前 = 行为基础价值 action.valueScore +（命中上头时）headstrongBonus。
 * 道具期望价值预留（待道具产出系统落地后接入，见 ADR-017 / resources.json 的 value 字段）。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {Object} worldContext
 * @param {import('../abstract/action.js').Action} action
 * @param {Object} [opts]
 * @param {boolean} [opts.headstrong=false] 本次决策该行为是否命中“上头”
 * @param {number} [opts.headstrongBonus=0] 上头命中时注入的价值加成
 * @returns {number}
 */
export function computeActionValue(entity, worldContext, action, opts = {}) {
  const base = action?.valueScore ?? 0;
  // TODO(道具产出系统): 累加 action 预期产出道具的 resources.json value 期望值。
  let value = base;
  if (opts.headstrong) value += (opts.headstrongBonus ?? 0);
  return value;
}

/**
 * 返回行为的纯路径代价（GOAP step cost，ADR-021 重构后职责）。
 *
 * 职责收窄：GOAP 只负责「如何实现目标」（HOW），step cost 仅反映路径长度/消耗，
 * 不再包含风险、价值、上头、路径偏好等目标选择因素——这些均已迁移至 Utility 选目标层
 * （见 npc-utility.js decorateGoalConsiderations，ADR-021）。
 *
 * 参数保留向后兼容签名（entity/worldContext/perDecisionCtx），但实际仅读取 costFloor，
 * 供外部工具/测试代码无需修改调用方式。
 *
 * @param {import('../abstract/base-entity.js').BaseEntity} _entity
 * @param {Object} _worldContext
 * @param {import('../abstract/action.js').Action} action
 * @param {Object} [perDecisionCtx] 仅读取 perDecisionCtx.decisionConfig.costFloor
 * @returns {number} 基础路径代价（>= costFloor）
 */
export function computeDecisionCost(_entity, _worldContext, action, perDecisionCtx = {}) {
  const dc = perDecisionCtx.decisionConfig || {};
  const costFloor = dc.costFloor ?? 0.1;

  const base = typeof action.getPlanCost === 'function'
    ? action.getPlanCost()
    : ((action.weight ?? 1) + Math.max(0, (action.duration ?? 1) - 1));

  return Math.max(costFloor, base);
}

/**
 * PvP 致死统一写入（ADR-020 阶段D/E）：标记死亡并写 _deathInfo，含 killerId/killerFactionId，
 * 打通 _collectDeaths→recordMemory→relationships→后代复仇执念的恩怨闭环。
 * @param {Object} victim 被杀者
 * @param {Object} killer 凶手
 */
export function killNPCByPvP(victim, killer) {
  if (!victim || !victim.state) return;
  victim.state.set('alive', false);
  victim.alive = false;
  victim._deathInfo = {
    cause: 'slain',
    npcId: victim.id,
    npcName: victim.name,
    factionId: victim.state.get('factionId'),
    ageYears: victim.state.get('ageYears'),
    maxAgeYears: victim.state.get('maxAgeYears'),
    rankName: victim.state.get('rankName'),
    killerId: killer ? killer.id : null,
    killerName: killer ? killer.name : null,
    killerFactionId: killer ? killer.state?.get('factionId') ?? null : null,
  };
}

/**
 * 按 reward.json 某 source 的 outcomes 抽取结果，并把真实物品写入背包（ADR-024/025）。
 * 与旧的"仅加 qi"不同：若 outcome 带 itemId，则发放实物（artifact/material/pill），
 * 否则回退为真气收益。返回 { outcome, qiGain, grantedItems }。
 */
export function rollAndGrantReward(entity, rewardCfg, sourceKey) {
  const outcomes = rewardCfg?.rewardsBySource?.[sourceKey]?.outcomes;
  const result = { outcome: null, qiGain: 0, grantedItems: [] };
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    const match = /^opportunity_corpse_g(\d+)$/.exec(sourceKey || '');
    if (!match) return result;
    const grade = Math.max(1, Math.min(9, Number(match[1]) || 1));
    const materialId = ItemRegistry.has(`beast_material_g${grade}`) ? `beast_material_g${grade}` : 'beast_material';
    const coreId = ItemRegistry.has(`monster_core_g${grade}`) ? `monster_core_g${grade}` : 'monster_core';
    const materialQty = Math.max(1, Math.floor(grade / 3));
    grantItemAndMaybeEquip(entity, materialId, materialQty);
    result.grantedItems.push({ itemId: materialId, qty: materialQty });
    if (Math.random() < Math.min(0.85, 0.25 + grade * 0.06)) {
      grantItemAndMaybeEquip(entity, coreId, 1);
      result.grantedItems.push({ itemId: coreId, qty: 1 });
    }
    result.outcome = { id: `corpse_grade_${grade}`, value: Math.min(1, grade / 9) };
    return result;
  }
  let roll = Math.random();
  let picked = outcomes[outcomes.length - 1];
  for (const o of outcomes) {
    roll -= (o.prob ?? 0);
    if (roll < 0) { picked = o; break; }
  }
  result.outcome = picked;
  if (picked.itemId) {
    const qty = picked.qty ?? 1;
    grantItemAndMaybeEquip(entity, picked.itemId, qty);
    result.grantedItems.push({ itemId: picked.itemId, qty });
  } else if ((picked.value ?? 0) > 0) {
    const qiGain = Math.round(picked.value * 200);
    if (qiGain > 0) entity.state.set('qi', (entity.state.get('qi') || 0) + qiGain);
    result.qiGain = qiGain;
  }
  return result;
}
