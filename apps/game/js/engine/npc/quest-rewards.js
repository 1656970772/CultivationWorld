import { ItemRegistry } from '../items/item-registry.js';
import { grantItemAndMaybeEquip } from './npc-economy.js';

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rewardQty(rule, difficulty) {
  if (!rule) return 0;
  if (rule.minLevel && difficulty < rule.minLevel) return 0;
  let qty = rule.qty ?? ((rule.qtyBase ?? 0) + Math.floor(difficulty * (rule.qtyPerLevel ?? 0)));
  if (rule.minQty != null) qty = Math.max(rule.minQty, qty);
  if (rule.maxQty != null) qty = Math.min(rule.maxQty, qty);
  return Math.max(0, Math.floor(qty));
}

function grantToFaction(faction, itemId, qty) {
  if (!faction?.inventory || qty <= 0) return null;
  faction.inventory.add(itemId, qty);
  return { itemId, qty };
}

function grantToNpc(entity, itemId, qty) {
  if (!entity?.inventory || qty <= 0) return null;
  grantItemAndMaybeEquip(entity, itemId, qty);
  return { itemId, qty };
}

function applyItemRules(rules, difficulty, randomFn, grantFn) {
  const granted = [];
  if (!Array.isArray(rules)) return granted;
  for (const rule of rules) {
    const chance = rule.chance ?? 1;
    if (chance < 1 && randomFn() >= chance) continue;
    const qty = rewardQty(rule, difficulty);
    const itemId = rule.itemId;
    const grant = itemId ? grantFn(itemId, qty) : null;
    if (grant) granted.push(grant);
  }
  return granted;
}

export function resolveQuestRewardProfile(questTemplates, questTypeId) {
  return questTemplates?.rewardProfiles?.[questTypeId] || null;
}

export function applyQuestRewardProfile(entity, faction, questTemplates, difficulty, questTypeId, randomFn = Math.random) {
  const profile = resolveQuestRewardProfile(questTemplates, questTypeId);
  const result = {
    questTypeId,
    npcItems: [],
    factionItems: [],
    randomItems: [],
    factionStability: 0,
    questItemReward: 0,
  };
  if (!profile) return result;

  result.npcItems.push(...applyItemRules(
    profile.npcItems,
    difficulty,
    randomFn,
    (itemId, qty) => grantToNpc(entity, itemId, qty),
  ));

  if (faction) {
    result.factionItems.push(...applyItemRules(
      profile.factionItems,
      difficulty,
      randomFn,
      (itemId, qty) => grantToFaction(faction, itemId, qty),
    ));
  }

  result.randomItems.push(...applyItemRules(
    profile.randomItems,
    difficulty,
    randomFn,
    (itemId, qty) => grantToNpc(entity, itemId, qty),
  ));

  if (faction?.state && profile.factionStability) {
    const current = faction.state.get('stability') || 0;
    const max = profile.maxStability ?? 100;
    const gain = Number(profile.factionStability) || 0;
    faction.state.set('stability', clampNumber(current + gain, 0, max));
    result.factionStability = gain;
  }

  result.questItemReward = result.npcItems.reduce((sum, item) => sum + item.qty, 0)
    + result.randomItems.reduce((sum, item) => sum + item.qty, 0);
  return result;
}

export function describeQuestExtraRewards(extra) {
  if (!extra) return '';
  const parts = [];
  const items = [...(extra.npcItems || []), ...(extra.randomItems || [])];
  if (items.length > 0) {
    parts.push(items.map(item => `${ItemRegistry.get(item.itemId)?.name || item.itemId}x${item.qty}`).join('、'));
  }
  if ((extra.factionItems || []).length > 0) {
    parts.push(`宗门库存+${extra.factionItems.map(item => `${ItemRegistry.get(item.itemId)?.name || item.itemId}x${item.qty}`).join('、')}`);
  }
  if (extra.factionStability > 0) parts.push(`宗门稳定+${extra.factionStability}`);
  return parts.length > 0 ? `，额外获得${parts.join('，')}` : '';
}
