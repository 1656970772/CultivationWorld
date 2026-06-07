import { ItemRegistry } from '../items/item-registry.js';
import { EffectEngine } from '../abstract/gameplay-effect.js';
import { EffectPool } from '../pools/effect-pool.js';
import { addCultivation, getCultivationRequired, refreshRankStage, syncTotalCultivation } from './numeric-cultivation.js';

/**
 * 丹药机制化开关（ADR-042 阶段2）：economy.npcExchange.useItems.pillEffects.enabled（默认 true）。
 * 开则丹药效果经 data/effects 的 Instant Effect 由 EffectEngine 结算；关则回退旧的直接 state.set。
 */
function pillEffectsEnabled(worldContext) {
  const economy = economyConfigFrom(worldContext);
  return economy?.npcExchange?.useItems?.pillEffects?.enabled !== false;
}

/**
 * 通用"消耗物品→施加其挂载 Effect"入口（ADR-042 阶段2 增强）。
 *
 * 从物品定义（items.json）的 effects 字段读取该物品挂载的通用 Effect 列表，逐条经
 * EffectEngine.applyEffect(entity, def, { spec }) 结算——【数值来自物品自身 effects 项】，
 * 而非写死在 Effect 里。丹药/灵草/灵果/强者精血等任何"服用即生效"的来源都走此入口，
 * 复用同一批通用 Effect 原语（ge_add_qi/ge_add_hp/ge_add_progress/...）。
 *
 * @param {Object} entity 目标实体（须有 abilityComponent/attributes/state）
 * @param {string} itemId 物品 id（从 ItemRegistry 读其 effects）
 * @returns {{ applied: boolean, deltas: Object }} deltas: {attribute: 累计增量}，供叙事事件取实际增量
 */
export function applyItemEffects(entity, itemId) {
  const def = ItemRegistry.get(itemId);
  const specs = def?.properties?.effects || def?.effects;
  if (!Array.isArray(specs) || specs.length === 0) return { applied: false, deltas: {} };

  const deltas = {};
  let applied = false;
  for (const spec of specs) {
    const effDef = EffectPool.get(spec.effect);
    if (!effDef) continue;
    const res = EffectEngine.applyEffect(entity, effDef, { spec });
    applied = applied || res.applied;
    for (const m of res.mods || []) {
      deltas[m.attribute] = (deltas[m.attribute] || 0) + m.delta;
    }
  }
  if (deltas.cultivation !== undefined || deltas.experienceCultivation !== undefined) {
    syncTotalCultivation(entity);
    refreshRankStage(entity, entity?._ranksData || [], entity?._cultivationConfig || {});
  }
  return { applied, deltas };
}

function economyConfigFrom(worldContext) {
  return worldContext?.balanceConfig?.economy || worldContext?.economyConfig || worldContext || {};
}

function stateNumber(entity, key) {
  return Number(entity?.state?.get?.(key) || 0);
}

function addStateNumber(entity, key, amount) {
  entity.state.set(key, stateNumber(entity, key) + amount);
}

function addCultivationFromProgressGain(entity, progressGain, worldContext) {
  const cultivationConfig = worldContext?.balanceConfig?.cultivation || entity?._cultivationConfig || {};
  const ranks = worldContext?.ranksData || entity?._ranksData || [];
  const required = getCultivationRequired(entity, ranks);
  const gain = required > 0 ? progressGain * required : progressGain;
  return addCultivation(entity, ranks, gain, cultivationConfig);
}

function artifactBonus(itemId) {
  const def = ItemRegistry.get(itemId);
  return def?.properties?.combatBonus ?? def?.combatBonus ?? 0;
}

function isArtifact(itemId) {
  const def = ItemRegistry.get(itemId);
  return def?.category === 'artifact';
}

function resolveFaction(entity, worldContext) {
  const factionId = entity?.state?.get?.('factionId');
  if (!factionId) return null;
  const faction = worldContext?.entityRegistry?.getById?.(factionId) || null;
  return faction?.alive === false ? null : faction;
}

function donationRules(economyConfig) {
  const cfg = economyConfig?.npcMaterialDonation || {};
  if (cfg.enabled === false) return [];
  const rules = Array.isArray(cfg.items) ? [...cfg.items] : [];
  const monsterCfg = economyConfig?.monsterResources?.donation || {};
  if (monsterCfg.enabled !== false) {
    const maxGrade = Math.max(1, Math.floor(monsterCfg.maxGrade ?? 9));
    const coreBase = monsterCfg.coreBaseContribution ?? 12;
    const materialBase = monsterCfg.materialBaseContribution ?? 10;
    const mult = monsterCfg.gradeMultiplier ?? 1.35;
    const existing = new Set(rules.map(r => r.itemId));
    for (let grade = 1; grade <= maxGrade; grade++) {
      const factor = Math.pow(grade, mult);
      const coreId = `monster_core_g${grade}`;
      const matId = `beast_material_g${grade}`;
      if (!existing.has(coreId)) {
        const contribution = Math.round(coreBase * factor);
        rules.push({ itemId: coreId, contribution, monthlyContribution: contribution, factionQty: 1 });
      }
      if (!existing.has(matId)) {
        const contribution = Math.round(materialBase * factor);
        rules.push({ itemId: matId, contribution, monthlyContribution: contribution, factionQty: 1 });
      }
    }
  }
  return rules;
}

function requiredFactionItems(option) {
  return Array.isArray(option?.requiredFactionItems) ? option.requiredFactionItems : [];
}

function missingFactionItems(faction, required) {
  const missing = [];
  for (const req of required) {
    const need = Math.max(0, Math.floor(req.qty ?? 1));
    const have = faction?.inventory?.getAmount(req.itemId) || 0;
    if (have < need) missing.push({ itemId: req.itemId, need, have });
  }
  return missing;
}

function isMonsterExchangeItem(itemId) {
  return /^monster_core_g\d+$/.test(itemId || '')
    || /^beast_material_g\d+$/.test(itemId || '');
}

export function missingFactionExchangeItems(entity, worldContext, optionKey) {
  const economy = economyConfigFrom(worldContext);
  const option = economy.npcExchange?.options?.[optionKey];
  const required = requiredFactionItems(option);
  if (required.length === 0) return [];
  const faction = resolveFaction(entity, worldContext);
  return missingFactionItems(faction, required);
}

export function factionNeedsMonsterExchangeMaterials(entity, worldContext, optionKeys = ['breakthrough_pill', 'artifact_low']) {
  if (entity?.state?.get?.('hasFaction') === false || !entity?.state?.get?.('factionId')) return false;
  return optionKeys.some((optionKey) =>
    missingFactionExchangeItems(entity, worldContext, optionKey)
      .some(m => isMonsterExchangeItem(m.itemId))
  );
}

export function canFactionProvideExchangeMaterials(entity, worldContext, optionKey) {
  const economy = economyConfigFrom(worldContext);
  const option = economy.npcExchange?.options?.[optionKey];
  const required = requiredFactionItems(option);
  if (required.length === 0) return true;
  const faction = resolveFaction(entity, worldContext);
  return missingFactionItems(faction, required).length === 0;
}

export function countDonatableMaterials(entity, economyConfig) {
  if (!entity?.inventory) return 0;
  if (entity.state?.get?.('hasFaction') === false || !entity.state?.get?.('factionId')) return 0;
  let total = 0;
  for (const rule of donationRules(economyConfig)) {
    total += entity.inventory.getAmount(rule.itemId) || 0;
  }
  return total;
}

export function equipBestArtifact(entity) {
  if (!entity?.inventory || !entity?.state) {
    return { changed: false, equippedArtifactId: null };
  }

  const currentId = entity.state.get('equippedArtifactId') || null;
  let bestId = currentId;
  let bestBonus = currentId ? artifactBonus(currentId) : -Infinity;
  const all = entity.inventory.getAll();

  for (const [itemId, amount] of Object.entries(all)) {
    if (amount <= 0 || !isArtifact(itemId)) continue;
    const bonus = artifactBonus(itemId);
    if (bonus > bestBonus) {
      bestBonus = bonus;
      bestId = itemId;
    }
  }

  if (!bestId || bestId === currentId) {
    return { changed: false, equippedArtifactId: currentId };
  }

  if (currentId) entity.inventory.add(currentId, 1);
  entity.inventory.remove(bestId, 1);
  entity.state.set('equippedArtifactId', bestId);
  entity.refreshArtifactCombatModifiers?.();
  return { changed: true, equippedArtifactId: bestId, replacedArtifactId: currentId };
}

export function grantItemAndMaybeEquip(entity, itemId, qty = 1) {
  const amount = Math.max(1, Number(qty) || 1);
  entity.inventory.add(itemId, amount);
  const equip = isArtifact(itemId) ? equipBestArtifact(entity) : { changed: false, equippedArtifactId: entity.state?.get?.('equippedArtifactId') || null };
  return { itemId, qty: amount, equip };
}

export function donateMaterials(entity, worldContext, options = {}) {
  const economy = economyConfigFrom(worldContext);
  const cfg = economy.npcMaterialDonation || {};
  const faction = resolveFaction(entity, worldContext);
  if (!faction) return { success: false, outcome: 'no_faction', eventType: 'material_donate' };

  const candidates = donationRules(economy)
    .filter(rule => (entity.inventory.getAmount(rule.itemId) || 0) > 0)
    .sort((a, b) => (b.contribution || 0) - (a.contribution || 0));
  const rule = candidates[0];
  if (!rule) return { success: false, outcome: 'no_material', eventType: 'material_donate' };

  const maxStacks = Math.max(1, cfg.maxStacksPerAction ?? 1);
  const qty = Math.min(entity.inventory.getAmount(rule.itemId) || 0, rule.qty ?? maxStacks, maxStacks);
  if (qty <= 0) return { success: false, outcome: 'no_material', eventType: 'material_donate' };

  if (options.applyInventory !== false) entity.inventory.remove(rule.itemId, qty);
  if (options.applyFactionInventory !== false) {
    faction.inventory?.add(rule.itemId, (rule.factionQty ?? 1) * qty);
  }

  const contribution = (rule.contribution || 0) * qty;
  const monthlyContribution = (rule.monthlyContribution ?? rule.contribution ?? 0) * qty;
  if (options.applyContribution !== false) {
    addStateNumber(entity, 'contribution', contribution);
    addStateNumber(entity, 'monthlyContribution', monthlyContribution);
  }

  const name = ItemRegistry.get(rule.itemId)?.name || rule.itemId;
  return {
    success: true,
    outcome: 'donated',
    eventType: 'material_donate',
    itemId: rule.itemId,
    qty,
    contribution,
    monthlyContribution,
    description: `${entity.name || entity.staticData?.name || entity.id} 上交${name}x${qty}，换得${contribution}贡献`,
  };
}

export function redeemExchangeItem(entity, worldContext, optionKey, options = {}) {
  const economy = economyConfigFrom(worldContext);
  const option = economy.npcExchange?.options?.[optionKey];
  if (!option) return { success: false, outcome: 'missing_option', optionKey, eventType: `redeem_${optionKey}` };
  if (entity.state?.get?.('hasFaction') === false || !entity.state?.get?.('factionId')) {
    return { success: false, outcome: 'no_faction', optionKey, eventType: `redeem_${optionKey}` };
  }

  const contributionCost = option.contributionCost || 0;
  const stoneCost = option.stoneCost || 0;
  const contribution = stateNumber(entity, 'contribution');
  const stones = entity.inventory.getAmount('low_spirit_stone') || 0;
  if (options.checkAfford !== false && contribution < contributionCost) {
    return { success: false, outcome: 'not_enough_contribution', optionKey, eventType: `redeem_${optionKey}` };
  }
  if (options.checkAfford !== false && stones < stoneCost) {
    return { success: false, outcome: 'not_enough_stone', optionKey, eventType: `redeem_${optionKey}` };
  }

  const faction = resolveFaction(entity, worldContext);
  const required = requiredFactionItems(option);
  const missing = missingFactionItems(faction, required);
  if (options.checkFactionItems !== false && missing.length > 0) {
    return {
      success: false,
      outcome: 'not_enough_faction_material',
      optionKey,
      missing,
      eventType: `redeem_${optionKey}`,
    };
  }

  if (options.applyContribution !== false) entity.state.set('contribution', contribution - contributionCost);
  if (options.applyStoneCost !== false && stoneCost > 0) entity.inventory.remove('low_spirit_stone', stoneCost);
  if (options.applyFactionItems !== false && faction) {
    for (const req of required) {
      faction.inventory?.remove(req.itemId, Math.max(0, Math.floor(req.qty ?? 1)));
    }
  }

  const qty = option.qty ?? 1;
  let grant = null;
  if (options.grantItem !== false) grant = grantItemAndMaybeEquip(entity, option.itemId, qty);

  const name = ItemRegistry.get(option.itemId)?.name || option.itemId;
  return {
    success: true,
    outcome: 'redeemed',
    eventType: `redeem_${optionKey}`,
    optionKey,
    itemId: option.itemId,
    qty,
    contributionCost,
    stoneCost,
    requiredFactionItems: required,
    equippedArtifactId: grant?.equip?.equippedArtifactId || entity.state?.get?.('equippedArtifactId') || null,
    description: `${entity.name || entity.staticData?.name || entity.id} 兑换${name}x${qty}`,
  };
}

export function useQiPill(entity, worldContext, options = {}) {
  const economy = economyConfigFrom(worldContext);
  const cfg = economy.npcExchange?.useItems?.qiPill || {};
  const itemId = cfg.itemId || 'item_qi_pill';
  if ((entity.inventory.getAmount(itemId) || 0) <= 0) {
    return { success: false, outcome: 'no_item', eventType: 'use_qi_pill', itemId };
  }

  if (options.consumeItem !== false) entity.inventory.remove(itemId, 1);
  const baseQiGain = cfg.qiGain ?? 120;
  const progressGain = cfg.progressGain ?? 0.01;

  // ADR-040: 低阶丹对高境界效果递减（数值与参数现来自 items.json 该丹药的 effects 项）。
  let qiGain = computeQiPillGain(entity, cfg, baseQiGain);

  if (options.applyState !== false) {
    if (pillEffectsEnabled(worldContext)) {
      // ADR-042 阶段2 增强：经通用 Effect 原语结算，数值取自物品 effects（rankDecay/clamp 由 spec 表达）。
      const { applied, deltas } = applyItemEffects(entity, itemId);
      if (applied) {
        qiGain = deltas.qi ?? qiGain;
      } else {
        addStateNumber(entity, 'qi', qiGain);
        addCultivationFromProgressGain(entity, progressGain, worldContext);
      }
    } else {
      addStateNumber(entity, 'qi', qiGain);
      addCultivationFromProgressGain(entity, progressGain, worldContext);
    }
  }

  return {
    success: true,
    outcome: 'used',
    eventType: 'use_qi_pill',
    itemId,
    qiGain,
    baseQiGain,
    progressGain,
    description: `${entity.name || entity.staticData?.name || entity.id} 服用聚气丹，真气+${Math.round(qiGain)}`,
  };
}

/**
 * 计算一颗聚气丹对当前实体的【实际真气增量】，含按境界衰减（ADR-040）。
 * @param {Object} entity NPCEntity（需可读 rankId 与 _ranksData）
 * @param {Object} cfg economy.npcExchange.useItems.qiPill 配置
 * @param {number} baseQiGain 丹药基础真气量
 * @returns {number} 实际真气增量
 */
export function computeQiPillGain(entity, cfg, baseQiGain) {
  const decay = cfg.rankDecay;
  const baseRankId = cfg.baseRankId;
  const minQiGain = cfg.minQiGain ?? 1;
  // 未配置衰减 → 退回固定量（向后兼容）
  if (!decay || decay >= 1 || !baseRankId) return baseQiGain;

  const ranks = entity._ranksData || [];
  if (ranks.length === 0) return baseQiGain;
  const curRankId = entity.state.get('rankId') || 'mortal';
  const curRank = ranks.find(r => r.id === curRankId);
  const baseRank = ranks.find(r => r.id === baseRankId);
  if (!curRank || !baseRank) return baseQiGain;

  const step = Math.max(0, (curRank.order ?? 0) - (baseRank.order ?? 0));
  const effective = baseQiGain * Math.pow(decay, step);
  return Math.max(minQiGain, effective);
}

export function useBreakthroughPill(entity, worldContext, options = {}) {
  const economy = economyConfigFrom(worldContext);
  const cfg = economy.npcExchange?.useItems?.breakthroughPill || {};
  const itemId = cfg.itemId || 'item_breakthrough_pill';
  if ((entity.inventory.getAmount(itemId) || 0) <= 0) {
    return { success: false, outcome: 'no_item', eventType: 'use_breakthrough_pill', itemId };
  }

  if (options.consumeItem !== false) entity.inventory.remove(itemId, 1);
  let qiGain = cfg.qiGain ?? 300;
  let bonus = cfg.breakthroughBonus ?? 0.08;
  const maxBonus = cfg.maxBreakthroughBonus ?? 0.25;

  if (options.applyState !== false) {
    if (pillEffectsEnabled(worldContext)) {
      // ADR-042 阶段2 增强：经通用 Effect 原语结算，数值取自物品 effects（qi 直加、突破助益累加并 clamp 至 maxBonus）。
      const { applied, deltas } = applyItemEffects(entity, itemId);
      if (applied) {
        qiGain = deltas.qi ?? qiGain;
        if (deltas.breakthroughAidBonus !== undefined) bonus = deltas.breakthroughAidBonus;
      } else {
        addStateNumber(entity, 'qi', qiGain);
        const nextBonus = Math.min(maxBonus, stateNumber(entity, 'breakthroughAidBonus') + bonus);
        entity.state.set('breakthroughAidBonus', nextBonus);
      }
    } else {
      addStateNumber(entity, 'qi', qiGain);
      const nextBonus = Math.min(maxBonus, stateNumber(entity, 'breakthroughAidBonus') + bonus);
      entity.state.set('breakthroughAidBonus', nextBonus);
    }
  }

  return {
    success: true,
    outcome: 'used',
    eventType: 'use_breakthrough_pill',
    itemId,
    qiGain,
    breakthroughBonus: bonus,
    description: `${entity.name || entity.staticData?.name || entity.id} 服用破境丹，下一次突破判定获得加成`,
  };
}
