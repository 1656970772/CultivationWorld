import { ItemRegistry } from '../items/item-registry.js';

function economyConfigFrom(worldContext) {
  return worldContext?.balanceConfig?.economy || worldContext?.economyConfig || worldContext || {};
}

function stateNumber(entity, key) {
  return Number(entity?.state?.get?.(key) || 0);
}

function addStateNumber(entity, key, amount) {
  entity.state.set(key, stateNumber(entity, key) + amount);
}

function artifactBonus(itemId) {
  const def = ItemRegistry.get(itemId);
  return def?.properties?.combatBonus ?? def?.combatBonus ?? 0;
}

function isArtifact(itemId) {
  const def = ItemRegistry.get(itemId);
  return def?.category === 'artifact' || itemId?.startsWith?.('item_artifact_');
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
  return itemId === 'monster_core'
    || itemId === 'beast_material'
    || /^monster_core_g\d+$/.test(itemId || '')
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
  const qiGain = cfg.qiGain ?? 120;
  const progressGain = cfg.progressGain ?? 0.01;

  if (options.applyState !== false) {
    addStateNumber(entity, 'qi', qiGain);
    const nextProgress = Math.min(1, stateNumber(entity, 'cultivationProgress') + progressGain);
    entity.state.set('cultivationProgress', nextProgress);
    entity.state.set('totalProgress', nextProgress + stateNumber(entity, 'insight'));
  }

  return {
    success: true,
    outcome: 'used',
    eventType: 'use_qi_pill',
    itemId,
    qiGain,
    progressGain,
    description: `${entity.name || entity.staticData?.name || entity.id} 服用聚气丹，真气与修炼进度增长`,
  };
}

export function useBreakthroughPill(entity, worldContext, options = {}) {
  const economy = economyConfigFrom(worldContext);
  const cfg = economy.npcExchange?.useItems?.breakthroughPill || {};
  const itemId = cfg.itemId || 'item_breakthrough_pill';
  if ((entity.inventory.getAmount(itemId) || 0) <= 0) {
    return { success: false, outcome: 'no_item', eventType: 'use_breakthrough_pill', itemId };
  }

  if (options.consumeItem !== false) entity.inventory.remove(itemId, 1);
  const qiGain = cfg.qiGain ?? 300;
  const bonus = cfg.breakthroughBonus ?? 0.08;
  const maxBonus = cfg.maxBreakthroughBonus ?? 0.25;

  if (options.applyState !== false) {
    addStateNumber(entity, 'qi', qiGain);
    const nextBonus = Math.min(maxBonus, stateNumber(entity, 'breakthroughAidBonus') + bonus);
    entity.state.set('breakthroughAidBonus', nextBonus);
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
