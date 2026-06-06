/**
 * monster-resources.js - 妖兽资源化辅助逻辑
 *
 * 负责把活体妖兽的 drops 定义转成真实背包物品，并为斩妖任务提供
 * “具体妖兽 -> 击杀 -> 掉落”的结算工具。
 */
import { ItemRegistry } from '../items/item-registry.js';
import { resolveCombatEncounter } from '../combat/combat-encounter.js';
import { applyCultivationExperience } from '../npc/cultivation-experience.js';
import { resolveMonsterAttributes } from './monster-attributes.js';

const GRADED_BASE_IDS = new Set(['monster_core', 'beast_material']);

export function isMonsterHuntQuest(questTypeId, economyConfig = {}) {
  const ids = economyConfig?.monsterResources?.huntQuestTypeIds
    || ['qt_slay_monster', 'qt_exterminate', 'qt_hunt_beast'];
  return ids.includes(questTypeId);
}

export function clampMonsterGrade(grade) {
  return Math.max(1, Math.min(9, Math.floor(Number(grade) || 1)));
}

export function gradedMonsterResourceId(baseItemId, grade) {
  if (!GRADED_BASE_IDS.has(baseItemId)) return baseItemId;
  const id = `${baseItemId}_g${clampMonsterGrade(grade)}`;
  return ItemRegistry.has(id) ? id : baseItemId;
}

function monsterGrade(monster) {
  return clampMonsterGrade(monster?.grade ?? monster?.staticData?.get?.('grade'));
}

function monsterDrops(monster) {
  return monster?.staticData?.get?.('drops') || monster?._def?.drops || monster?.drops || [];
}

export function resolveMonsterDrops(monster, randomFn = Math.random) {
  const grade = monsterGrade(monster);
  const resolved = [];
  for (const drop of monsterDrops(monster)) {
    const chance = drop.chance ?? 1;
    if (chance < 1 && randomFn() >= chance) continue;
    const dropGrade = drop.coreGrade || grade;
    const itemId = gradedMonsterResourceId(drop.itemId, dropGrade);
    const qty = Math.max(1, Math.floor(drop.qty ?? 1));
    resolved.push({
      itemId,
      qty,
      sourceItemId: drop.itemId,
      grade: clampMonsterGrade(dropGrade),
      material: drop.material || null,
    });
  }
  return resolved;
}

export function grantMonsterDrops(entity, monster, randomFn = Math.random) {
  const drops = resolveMonsterDrops(monster, randomFn);
  if (!entity?.inventory) return drops;
  for (const drop of drops) {
    entity.inventory.add(drop.itemId, drop.qty);
  }
  return drops;
}

export function describeMonsterDrops(drops) {
  if (!Array.isArray(drops) || drops.length === 0) return '无可用材料';
  return drops
    .map((drop) => {
      const name = ItemRegistry.get(drop.itemId)?.name || drop.itemId;
      return `${name}x${drop.qty}`;
    })
    .join('、');
}

export function monsterCombatPower(monster) {
  const statePower = monster?.state?.get?.('power');
  if (Number.isFinite(statePower)) return statePower;
  const attrs = monster?.staticData?.get?.('attributes')
    || resolveMonsterAttributes(monster?._def || monster, monster?.staticData?.get?.('monsterAttributeTemplates'));
  const grade = monsterGrade(monster);
  return Math.round((attrs.attack || attrs.strength || 0) + (attrs.speed || 0) * 0.5 + (attrs.defense || 0) + grade * 30);
}

function alivePartyMember(entity) {
  return entity && entity.alive !== false && entity.state?.get?.('alive') !== false;
}

function uniqueParty(entity, party = []) {
  const members = [entity, ...(Array.isArray(party) ? party : [])].filter(alivePartyMember);
  const seen = new Set();
  const unique = [];
  for (const member of members) {
    const id = member?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(member);
  }
  return unique;
}

function resolvePartyFromState(entity, worldContext) {
  const ids = entity?.state?.get?.('huntPartyIds');
  if (!Array.isArray(ids) || typeof worldContext?.entityRegistry?.getById !== 'function') return [];
  return ids.map(id => worldContext.entityRegistry.getById(id)).filter(Boolean);
}

function partyCombatPower(entity, worldContext, party = []) {
  const powerFn = typeof worldContext?.npcCombatPower === 'function' ? worldContext.npcCombatPower : null;
  const members = uniqueParty(entity, party);
  const mainPower = Math.max(1, Number(powerFn ? powerFn(entity) : 50) || 50);
  let total = mainPower;
  for (const member of members) {
    if (member.id === entity?.id) continue;
    const companionPower = Math.max(0, Number(powerFn ? powerFn(member) : 0) || 0);
    total += companionPower * 0.7;
  }
  return { members, total };
}

function grantHuntExperience(entity, party, worldContext, monsterPower, huntPartyPower) {
  const riskScore = monsterPower / Math.max(1, huntPartyPower);
  const main = applyCultivationExperience(entity, worldContext, {
    sourceKind: 'monster_hunt_success',
    value: monsterPower,
    riskScore,
    durationDays: 1,
    outcome: 'success',
  });
  const companions = [];
  for (const member of party) {
    if (member.id === entity?.id) continue;
    companions.push({
      npcId: member.id,
      cultivationExperience: applyCultivationExperience(member, worldContext, {
        sourceKind: 'monster_hunt_success',
        value: monsterPower,
        riskScore,
        durationDays: 1,
        outcome: 'partial',
      }),
    });
  }
  return { main, companions };
}

function markMonsterKilled(monster, entity, drops, assistNpcIds = []) {
  const killerName = entity?.name || entity?.staticData?.name || entity?.id || null;
  if (typeof monster?._die === 'function') {
    monster._die('quest_hunt', killerName);
  } else if (monster) {
    monster.alive = false;
    monster.state?.set?.('alive', false);
    monster.spatial?.clearDestination?.();
    monster._deathInfo = {
      cause: 'quest_hunt',
      monsterId: monster.id,
      monsterName: monster.name || monster.staticData?.name,
      grade: monsterGrade(monster),
      killerName,
    };
  }
  if (monster) {
    monster._deathInfo = {
      ...(monster._deathInfo || {}),
      cause: 'quest_hunt',
      killerNpcId: entity?.id || null,
      killerName,
      assistNpcIds,
      dropItems: drops.map(d => ({ itemId: d.itemId, qty: d.qty, grade: d.grade })),
    };
  }
}

export function settleMonsterHunt(entity, monster, worldContext = {}, randomFn = Math.random, opts = {}) {
  if (!monster || monster.alive === false || monster.state?.get?.('alive') === false) {
    return { success: false, outcome: 'target_lost', drops: [] };
  }

  const cfg = worldContext?.balanceConfig?.economy?.monsterResources || {};
  const party = uniqueParty(entity, opts.party?.length ? opts.party : resolvePartyFromState(entity, worldContext));
  const { total: huntPartyPower, members: partyMembers } = partyCombatPower(entity, worldContext, party);
  const assistNpcIds = partyMembers.filter(member => member.id !== entity?.id).map(member => member.id);
  const monsterPower = monsterCombatPower(monster);
  const bias = cfg.huntPowerBias ?? 0;
  const effectivePower = huntPartyPower + bias;
  const encounter = resolveCombatEncounter({
    attacker: entity,
    defender: monster,
    scene: 'monster_hunt_quest',
    power: effectivePower,
    defenderPower: monsterPower,
    value: monsterPower,
    riskScore: monsterPower / Math.max(1, effectivePower),
    random: randomFn,
    worldContext,
  });
  const winChance = encounter.winChance;

  if (randomFn() <= winChance) {
    const drops = grantMonsterDrops(entity, monster, randomFn);
    markMonsterKilled(monster, entity, drops, assistNpcIds);
    const cultivationExperience = grantHuntExperience(entity, partyMembers, worldContext, monsterPower, Math.max(1, effectivePower));
    return {
      success: true,
      outcome: 'monster_slain',
      winChance,
      drops,
      huntPartyPower,
      assistNpcIds,
      cultivationExperience: cultivationExperience.main,
      companionExperience: cultivationExperience.companions,
    };
  }

  const deathChance = Math.max(0, Math.min(1, cfg.huntFailureDeathChance ?? 0.01));
  if (randomFn() < deathChance) {
    entity.state?.set?.('alive', false);
    entity.alive = false;
    entity._deathInfo = {
      cause: 'quest_hunt_failed',
      npcId: entity.id,
      npcName: entity.name || entity.staticData?.name,
      factionId: entity.state?.get?.('factionId') ?? null,
      rankName: entity.state?.get?.('rankName') || '',
      monsterName: monster.name || monster.staticData?.name,
      monsterGrade: monsterGrade(monster),
    };
    return { success: false, outcome: 'death', winChance, drops: [] };
  }

  const injury = Math.max(1, Math.floor(cfg.huntFailureInjury ?? 1));
  entity.state?.set?.('injuryLevel', (entity.state?.get?.('injuryLevel') || 0) + injury);
  return { success: false, outcome: 'hunt_failed', winChance, drops: [] };
}
