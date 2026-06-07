import { ItemRegistry } from '../items/item-registry.js';
import { EffectEngine } from '../abstract/gameplay-effect.js';
import { EffectPool } from '../pools/effect-pool.js';
import { refreshRankStage, syncTotalCultivation } from './numeric-cultivation.js';

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
  if (!def) return { applied: false, deltas: {}, reason: 'missing_item_definition', itemId };
  const specs = def?.properties?.effects || def?.effects;
  if (!Array.isArray(specs) || specs.length === 0) {
    return { applied: false, deltas: {}, reason: 'missing_item_effects', itemId };
  }

  const resolved = [];
  const missingEffects = [];
  for (const spec of specs) {
    if (!spec?.effect) {
      missingEffects.push(null);
      continue;
    }
    const effDef = EffectPool.get(spec.effect);
    if (!effDef) missingEffects.push(spec.effect);
    else resolved.push({ spec, effDef });
  }
  if (missingEffects.length > 0) {
    return {
      applied: false,
      deltas: {},
      reason: 'missing_effect_definition',
      itemId,
      missingEffects,
    };
  }

  const deltas = {};
  let applied = false;
  for (const { spec, effDef } of resolved) {
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
  return { applied, deltas, reason: applied ? null : 'effect_not_applied', itemId };
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

function economicSource(id = 'system_source') {
  return {
    id,
    name: id,
    inventory: {
      getAmount() { return Number.MAX_SAFE_INTEGER; },
      remove() { return true; },
      add() {},
    },
    state: {
      get() { return Number.MAX_SAFE_INTEGER; },
      set() {},
    },
  };
}

function economicSink(id = 'system_sink') {
  return {
    id,
    name: id,
    inventory: {
      getAmount() { return 0; },
      remove() { return true; },
      add() {},
    },
    state: {
      get() { return 0; },
      set() {},
    },
  };
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

function monsterResourceRulesFrom(worldContext, economyConfig = null) {
  return worldContext?.monsterResourceRules
    || worldContext?.balanceConfig?.monsterResourceRules
    || economyConfig?.monsterResourceRules
    || null;
}

function donationRules(economyConfig, monsterResourceRules = null) {
  const cfg = economyConfig?.npcMaterialDonation || {};
  if (cfg.enabled === false) return [];
  const rules = Array.isArray(cfg.items) ? [...cfg.items] : [];
  const monsterCfg = economyConfig?.monsterResources?.donation || {};
  const families = Array.isArray(monsterResourceRules?.itemFamilies)
    ? monsterResourceRules.itemFamilies
    : [];
  if (monsterCfg.enabled !== false) {
    const maxGrade = Math.max(1, Math.floor(monsterCfg.maxGrade ?? 9));
    const mult = monsterCfg.gradeMultiplier ?? 1.35;
    const existing = new Set(rules.map(r => r.itemId));
    for (let grade = 1; grade <= maxGrade; grade++) {
      const factor = Math.pow(grade, mult);
      for (const family of families) {
        const itemId = applyGradeTemplate(family.itemIdTemplate, grade);
        if (!itemId || existing.has(itemId)) continue;
        const base = family.contributionBase ?? family.baseContribution ?? 0;
        const monthlyBase = family.monthlyContributionBase ?? base;
        const contribution = Math.round(base * factor);
        const monthlyContribution = Math.round(monthlyBase * factor);
        rules.push({
          itemId,
          contribution,
          monthlyContribution,
          factionQty: family.factionQty ?? 1,
        });
        existing.add(itemId);
      }
    }
  }
  return rules;
}

function monsterResourceFamilyItemId(familyId, grade, monsterResourceRules = null) {
  if (!familyId) return null;
  const families = Array.isArray(monsterResourceRules?.itemFamilies) ? monsterResourceRules.itemFamilies : [];
  const family = families.find(item =>
    item?.id === familyId
    || item?.baseItemId === familyId
    || item?.itemId === familyId
  );
  return applyGradeTemplate(family?.itemIdTemplate, Math.max(1, Math.floor(Number(grade) || 1)));
}

function normalizeRequiredFactionItem(item, monsterResourceRules = null) {
  if (!item || typeof item !== 'object') return item;
  const itemId = item.itemId || monsterResourceFamilyItemId(
    item.family || item.familyId || item.resourceFamily,
    item.grade,
    monsterResourceRules,
  );
  return { ...item, itemId };
}

function requiredFactionItems(option, monsterResourceRules = null) {
  const list = Array.isArray(option?.requiredFactionItems) ? option.requiredFactionItems : [];
  return list.map(item => normalizeRequiredFactionItem(item, monsterResourceRules));
}

function missingFactionItems(faction, required) {
  const missing = [];
  for (const req of required) {
    const need = Math.max(0, Math.floor(req.qty ?? 1));
    if (!req.itemId) {
      missing.push({ ...req, itemId: null, need, have: 0, reason: 'unresolved_resource_family' });
      continue;
    }
    const have = faction?.inventory?.getAmount(req.itemId) || 0;
    if (have < need) missing.push({ itemId: req.itemId, need, have });
  }
  return missing;
}

function applyGradeTemplate(template, grade) {
  if (!template) return null;
  return String(template).replaceAll('{grade}', String(grade));
}

function templateToPattern(template) {
  if (!template) return null;
  const escaped = String(template)
    .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
    .replace('\\{grade\\}', '\\d+');
  return `^${escaped}$`;
}

function monsterExchangePatterns(economyConfig) {
  const monsterRules = monsterResourceRulesFrom(economyConfig, economyConfig);
  const explicit = Array.isArray(monsterRules?.exchangeItemPatterns) ? monsterRules.exchangeItemPatterns : [];
  const fromFamilies = Array.isArray(monsterRules?.itemFamilies)
    ? monsterRules.itemFamilies.map(f => templateToPattern(f.itemIdTemplate)).filter(Boolean)
    : [];
  return [...explicit, ...fromFamilies];
}

function isMonsterExchangeItem(itemId, economyConfig, monsterResourceRules = null) {
  return monsterExchangePatterns({
    ...economyConfig,
    monsterResourceRules,
  })
    .some(pattern => new RegExp(pattern).test(itemId || ''));
}

export function missingFactionExchangeItems(entity, worldContext, optionKey) {
  const economy = economyConfigFrom(worldContext);
  const option = economy.npcExchange?.options?.[optionKey];
  const required = requiredFactionItems(option, monsterResourceRulesFrom(worldContext, economy));
  if (required.length === 0) return [];
  const faction = resolveFaction(entity, worldContext);
  return missingFactionItems(faction, required);
}

export function factionNeedsMonsterExchangeMaterials(entity, worldContext, optionKeys = ['breakthrough_pill', 'artifact_low']) {
  if (entity?.state?.get?.('hasFaction') === false || !entity?.state?.get?.('factionId')) return false;
  const economy = economyConfigFrom(worldContext);
  const monsterResourceRules = monsterResourceRulesFrom(worldContext, economy);
  return optionKeys.some((optionKey) =>
    missingFactionExchangeItems(entity, worldContext, optionKey)
      .some(m => isMonsterExchangeItem(m.itemId, economy, monsterResourceRules))
  );
}

export function canFactionProvideExchangeMaterials(entity, worldContext, optionKey) {
  const economy = economyConfigFrom(worldContext);
  const option = economy.npcExchange?.options?.[optionKey];
  const required = requiredFactionItems(option, monsterResourceRulesFrom(worldContext, economy));
  if (required.length === 0) return true;
  const faction = resolveFaction(entity, worldContext);
  return missingFactionItems(faction, required).length === 0;
}

export function countDonatableMaterials(entity, economyConfig) {
  if (!entity?.inventory) return 0;
  if (entity.state?.get?.('hasFaction') === false || !entity.state?.get?.('factionId')) return 0;
  let total = 0;
  for (const rule of donationRules(economyConfig, monsterResourceRulesFrom(economyConfig, economyConfig))) {
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

  const candidates = donationRules(economy, monsterResourceRulesFrom(worldContext, economy))
    .filter(rule => (entity.inventory.getAmount(rule.itemId) || 0) > 0)
    .sort((a, b) => (b.contribution || 0) - (a.contribution || 0));
  const rule = candidates[0];
  if (!rule) return { success: false, outcome: 'no_material', eventType: 'material_donate' };

  const maxStacks = Math.max(1, cfg.maxStacksPerAction ?? 1);
  const qty = Math.min(entity.inventory.getAmount(rule.itemId) || 0, rule.qty ?? maxStacks, maxStacks);
  if (qty <= 0) return { success: false, outcome: 'no_material', eventType: 'material_donate' };

  const contribution = (rule.contribution || 0) * qty;
  const monthlyContribution = (rule.monthlyContribution ?? rule.contribution ?? 0) * qty;
  const economicSystem = worldContext?.economicSystem || null;
  if (economicSystem && options.useEconomicSystem !== false) {
    const source = economicSource('organization_point_source');
    const transaction = economicSystem.settle({
      type: 'material_donation',
      scenarioId: 'material_donation',
      day: worldContext?.currentDay ?? 0,
      parties: [
        { role: 'donor', entity },
        { role: 'faction', entity: faction },
        { role: 'point_source', entity: source },
      ],
      transfers: [
        { from: 'donor', to: 'faction', asset: { kind: 'item', itemId: rule.itemId, quantity: qty } },
        { from: 'point_source', to: 'donor', asset: { kind: 'organization_point', pointKey: 'contribution', quantity: contribution } },
        { from: 'point_source', to: 'donor', asset: { kind: 'organization_point', pointKey: 'monthlyContribution', quantity: monthlyContribution } },
      ],
      source: { type: 'npc_material_donation', itemId: rule.itemId },
      visibility: 'institution',
    });
    if (!transaction.success) {
      return {
        success: false,
        outcome: transaction.reason || 'transaction_failed',
        eventType: 'material_donate',
        transactionId: transaction.transactionId,
      };
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
      transactionId: transaction.transactionId,
      description: `${entity.name || entity.staticData?.name || entity.id} 上交${name}x${qty}，换得${contribution}贡献`,
    };
  }

  if (options.applyInventory !== false) entity.inventory.remove(rule.itemId, qty);
  if (options.applyFactionInventory !== false) {
    faction.inventory?.add(rule.itemId, (rule.factionQty ?? 1) * qty);
  }

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
  const required = requiredFactionItems(option, monsterResourceRulesFrom(worldContext, economy));
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

  const economicSystem = worldContext?.economicSystem || null;
  const qty = option.qty ?? 1;
  const name = ItemRegistry.get(option.itemId)?.name || option.itemId;
  if (economicSystem && options.useEconomicSystem !== false) {
    const source = economicSource('faction_exchange_source');
    const sink = economicSink('faction_exchange_sink');
    const transfers = [];
    if (contributionCost > 0) {
      transfers.push({
        from: 'npc',
        to: 'sink',
        asset: { kind: 'organization_point', pointKey: 'contribution', quantity: contributionCost },
      });
    }
    if (stoneCost > 0) {
      transfers.push({
        from: 'npc',
        to: 'faction',
        asset: { kind: 'item', itemId: 'low_spirit_stone', quantity: stoneCost },
      });
    }
    for (const req of required) {
      transfers.push({
        from: 'faction',
        to: 'sink',
        asset: { kind: 'item', itemId: req.itemId, quantity: Math.max(0, Math.floor(req.qty ?? 1)) },
      });
    }
    transfers.push({
      from: 'source',
      to: 'npc',
      asset: { kind: 'item', itemId: option.itemId, quantity: qty },
    });

    const transaction = economicSystem.settle({
      type: 'contribution_exchange',
      scenarioId: 'faction_exchange',
      day: worldContext?.currentDay ?? 0,
      parties: [
        { role: 'npc', entity },
        { role: 'faction', entity: faction },
        { role: 'source', entity: source },
        { role: 'sink', entity: sink },
      ],
      transfers,
      source: { type: 'npc_exchange', optionKey },
      visibility: 'institution',
    });
    if (!transaction.success) {
      return {
        success: false,
        outcome: transaction.reason || 'transaction_failed',
        optionKey,
        eventType: `redeem_${optionKey}`,
        transactionId: transaction.transactionId,
      };
    }
    const equip = isArtifact(option.itemId)
      ? equipBestArtifact(entity)
      : { changed: false, equippedArtifactId: entity.state?.get?.('equippedArtifactId') || null };
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
      equippedArtifactId: equip?.equippedArtifactId || entity.state?.get?.('equippedArtifactId') || null,
      transactionId: transaction.transactionId,
      description: `${entity.name || entity.staticData?.name || entity.id} 兑换${name}x${qty}`,
    };
  }

  if (options.applyContribution !== false) entity.state.set('contribution', contribution - contributionCost);
  if (options.applyStoneCost !== false && stoneCost > 0) entity.inventory.remove('low_spirit_stone', stoneCost);
  if (options.applyFactionItems !== false && faction) {
    for (const req of required) {
      faction.inventory?.remove(req.itemId, Math.max(0, Math.floor(req.qty ?? 1)));
    }
  }

  let grant = null;
  if (options.grantItem !== false) grant = grantItemAndMaybeEquip(entity, option.itemId, qty);

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

  let qiGain = 0;
  let deltas = {};

  if (options.applyState !== false) {
    const result = applyItemEffects(entity, itemId);
    if (!result.applied) {
      return { success: false, outcome: result.reason || 'item_effect_failed', eventType: 'use_qi_pill', itemId };
    }
    deltas = result.deltas || {};
    qiGain = deltas.qi ?? 0;
  }
  if (options.consumeItem !== false) entity.inventory.remove(itemId, 1);

  return {
    success: true,
    outcome: 'used',
    eventType: 'use_qi_pill',
    itemId,
    qiGain,
    cultivationGain: deltas.cultivation ?? 0,
    deltas,
    description: `${entity.name || entity.staticData?.name || entity.id} 服用聚气丹，真气+${Math.round(qiGain)}`,
  };
}

export function useBreakthroughPill(entity, worldContext, options = {}) {
  const economy = economyConfigFrom(worldContext);
  const cfg = economy.npcExchange?.useItems?.breakthroughPill || {};
  const itemId = cfg.itemId || 'item_breakthrough_pill';
  if ((entity.inventory.getAmount(itemId) || 0) <= 0) {
    return { success: false, outcome: 'no_item', eventType: 'use_breakthrough_pill', itemId };
  }

  let qiGain = 0;
  let bonus = 0;
  let deltas = {};

  if (options.applyState !== false) {
    const result = applyItemEffects(entity, itemId);
    if (!result.applied) {
      return { success: false, outcome: result.reason || 'item_effect_failed', eventType: 'use_breakthrough_pill', itemId };
    }
    deltas = result.deltas || {};
    qiGain = deltas.qi ?? 0;
    bonus = deltas.breakthroughAidBonus ?? 0;
  }
  if (options.consumeItem !== false) entity.inventory.remove(itemId, 1);

  return {
    success: true,
    outcome: 'used',
    eventType: 'use_breakthrough_pill',
    itemId,
    qiGain,
    breakthroughBonus: bonus,
    deltas,
    description: `${entity.name || entity.staticData?.name || entity.id} 服用破境丹，下一次突破判定获得加成`,
  };
}
