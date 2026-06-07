/**
 * ConfigLoader - v2 游戏配置统一加载器
 *
 * 职责：加载所有运行时 JSON 数据，供 GameManager 和 SimulationApp 共用。
 * 消除了 game-manager.js 与 simulation-main.js 之间的重复加载逻辑。
 *
 * 数据路径遵循 docs/data/data-config-rules.md 定义的 v2 目录结构。
 */

/**
 * 加载单个 JSON 文件
 * @param {string} path 相对于 game 根目录的路径
 * @returns {Promise<any>}
 */
async function loadJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`加载配置失败 [${path}]: HTTP ${resp.status}`);
  return resp.json();
}

/**
 * 加载所有 v2 游戏配置
 *
 * 返回的对象字段名与 WorldEngine.init(configs) 期望的字段完全一致。
 * @returns {Promise<GameConfigs>}
 */
export async function loadGameConfigs() {
  const [
    factions, npcs, ranks, items, terrains,
    factionNeeds, npcNeeds,
    factionActions, npcActions, npcJobActions, npcActionSets, reactionActions, worldRules,
    dynamicEventJobs, economyJobs, socialJobs, questJobs, combatJobs, cultivationJobs,
    coreToils, dynamicEventToils, economyToils, socialToils, questToils, combatToils, cultivationToils,
    questTemplates, mapData, modifierTemplates,
    balanceCombat, balanceEconomy, balanceCultivation, balanceSocial, balanceMovement,
    balancePersonality, balanceRisk, balanceMemory, balanceObsession, balanceEmotion,
    balanceUtility, balanceReward, balanceRelationship, balanceReaction,
    gameConfig, aiConfig, names,
    monsters, monsterAttributeTemplates, monsterSpawn,
    combatBaseTable, cultivatorCombat, monsterCombat,
    worldNews, worldOpportunities, dynamicEvents, dynamicGoals, balanceCovet,
    itemsCurrency, itemsMaterial, itemsPill, itemsArtifact, itemsTalisman, itemsTechnique,
    tags, combatEffects, coreEffects, abilities,
    relationshipLedgerSchema, relationshipMarks, relationshipTags, relationshipSignals,
    relationshipEventTypes, relationshipGroupTypes, relationshipLegacyEvents,
    relationshipCombatRules, relationshipSocialRules, relationshipFactionRules,
    relationshipWantedSignals, relationshipGroups,
  ] = await Promise.all([
    loadJSON('data/entities/factions.json'),
    loadJSON('data/entities/npcs.json'),
    loadJSON('data/definitions/ranks.json'),
    loadJSON('data/definitions/macro-resources.json'),
    loadJSON('data/definitions/terrains.json'),
    loadJSON('data/needs/faction-needs.json'),
    loadJSON('data/needs/npc-needs.json'),
    loadJSON('data/actions/faction-actions.json'),
    loadJSON('data/actions/npc-actions.json'),
    loadJSON('data/actions/npc-job-actions.json'),
    loadJSON('data/actions/npc-action-sets.json'),
    loadJSON('data/actions/reaction-actions.json'),
    loadJSON('data/actions/world-rules.json'),
    loadJSON('data/jobs/npc-dynamic-event-jobs.json'),
    loadJSON('data/jobs/npc-economy-jobs.json'),
    loadJSON('data/jobs/npc-social-jobs.json'),
    loadJSON('data/jobs/npc-quest-jobs.json'),
    loadJSON('data/jobs/npc-combat-jobs.json'),
    loadJSON('data/jobs/npc-cultivation-jobs.json'),
    loadJSON('data/toils/core-toils.json'),
    loadJSON('data/toils/npc-dynamic-event-toils.json'),
    loadJSON('data/toils/npc-economy-toils.json'),
    loadJSON('data/toils/npc-social-toils.json'),
    loadJSON('data/toils/npc-quest-toils.json'),
    loadJSON('data/toils/npc-combat-toils.json'),
    loadJSON('data/toils/npc-cultivation-toils.json'),
    loadJSON('data/quests/quest-templates.json'),
    loadJSON('data/world/map.json'),
    loadJSON('data/world/modifiers.json'),
    loadJSON('data/balance/combat.json'),
    loadJSON('data/balance/economy.json'),
    loadJSON('data/balance/cultivation.json'),
    loadJSON('data/balance/social.json'),
    loadJSON('data/balance/movement.json'),
    loadJSON('data/balance/personality.json'),
    loadJSON('data/balance/risk.json'),
    loadJSON('data/balance/memory.json'),
    loadJSON('data/balance/obsession.json'),
    loadJSON('data/balance/emotion.json'),
    loadJSON('data/balance/utility.json'),
    loadJSON('data/balance/reward.json'),
    loadJSON('data/balance/relationship.json'),
    loadJSON('data/balance/reaction.json'),
    loadJSON('data/config/game-config.json'),
    loadJSON('data/config/ai-config.json'),
    loadJSON('data/definitions/names.json'),
    loadJSON('data/definitions/monsters.json'),
    loadJSON('data/definitions/monster-attribute-templates.json'),
    loadJSON('data/balance/monster-spawn.json'),
    loadJSON('data/definitions/combat-base-table.json'),
    loadJSON('data/definitions/cultivator-combat.json'),
    loadJSON('data/definitions/monster-combat.json'),
    loadJSON('data/world/news.json'),
    loadJSON('data/world/opportunities.json'),
    loadJSON('data/world/dynamic-events.json'),
    loadJSON('data/goals/dynamic-goals.json'),
    loadJSON('data/balance/covet.json'),
    loadJSON('data/items/currency.json'),
    loadJSON('data/items/material.json'),
    loadJSON('data/items/pill.json'),
    loadJSON('data/items/artifact.json'),
    loadJSON('data/items/talisman.json'),
    loadJSON('data/items/technique.json'),
    loadJSON('data/tags/tags.json'),
    loadJSON('data/effects/combat-effects.json'),
    loadJSON('data/effects/core-effects.json'),
    loadJSON('data/abilities/combat-abilities.json'),
    loadJSON('data/relationships/schemas/ledgers.json'),
    loadJSON('data/relationships/dictionaries/marks.json'),
    loadJSON('data/relationships/dictionaries/tags.json'),
    loadJSON('data/relationships/dictionaries/signal-keys.json'),
    loadJSON('data/relationships/dictionaries/relation-event-types.json'),
    loadJSON('data/relationships/dictionaries/group-types.json'),
    loadJSON('data/relationships/event-hooks/legacy-events.json'),
    loadJSON('data/relationships/impact-rules/combat.json'),
    loadJSON('data/relationships/impact-rules/social.json'),
    loadJSON('data/relationships/impact-rules/faction.json'),
    loadJSON('data/relationships/signal-rules/wanted-chain.json'),
    loadJSON('data/relationships/groups/groups.json'),
  ]);

  // 合并所有 Effect 数据源（combat 专用机制 + core 通用原语），供 EffectPool 一次性加载。
  const effects = { effects: [
    ...(combatEffects?.effects || []),
    ...(coreEffects?.effects || []),
  ] };

  // 合并按 category 拆分的物品定义（ADR-045）为单一 itemDefs.items 数组，
  // 下游 WorldEngine/ItemRegistry 消费结构不变（仍是 { items:[...] }）。
  const itemDefs = { items: [
    ...(itemsCurrency?.items || []),
    ...(itemsMaterial?.items || []),
    ...(itemsPill?.items || []),
    ...(itemsArtifact?.items || []),
    ...(itemsTalisman?.items || []),
    ...(itemsTechnique?.items || []),
  ] };

  const jobs = { jobs: [
    ...(dynamicEventJobs?.jobs || []),
    ...(economyJobs?.jobs || []),
    ...(socialJobs?.jobs || []),
    ...(questJobs?.jobs || []),
    ...(combatJobs?.jobs || []),
    ...(cultivationJobs?.jobs || []),
  ] };

  const toils = { toils: [
    ...(coreToils?.toils || []),
    ...(dynamicEventToils?.toils || []),
    ...(economyToils?.toils || []),
    ...(socialToils?.toils || []),
    ...(questToils?.toils || []),
    ...(combatToils?.toils || []),
    ...(cultivationToils?.toils || []),
  ] };

  const relationshipPlatform = {
    schemas: { ledgers: relationshipLedgerSchema },
    dictionaries: {
      marks: relationshipMarks,
      tags: relationshipTags,
      signals: relationshipSignals,
      eventTypes: relationshipEventTypes,
      groupTypes: relationshipGroupTypes,
    },
    eventHooks: [relationshipLegacyEvents],
    impactRules: [relationshipCombatRules, relationshipSocialRules, relationshipFactionRules],
    signalRules: [relationshipWantedSignals],
    groups: relationshipGroups,
  };

  return {
    factions, npcs, ranks, items, terrains,
    factionNeeds, npcNeeds,
    factionActions, npcActions, npcJobActions, npcActionSets, reactionActions, worldRules,
    questTemplates, mapData, modifierTemplates,
    balanceCombat, balanceEconomy, balanceCultivation, balanceSocial, balanceMovement,
    balancePersonality, balanceRisk, balanceMemory, balanceObsession, balanceEmotion,
    balanceUtility, balanceReward, balanceRelationship, balanceReaction,
    gameConfig, aiConfig, names,
    monsters, monsterAttributeTemplates, monsterSpawn,
    combatBaseTable, cultivatorCombat, monsterCombat,
    worldNews, worldOpportunities, dynamicEvents, dynamicGoals, balanceCovet, itemDefs,
    tags, effects, abilities, jobs, toils, relationshipPlatform,
  };
}

/**
 * @typedef {Object} GameConfigs
 * @property {Array}  factions           势力数据
 * @property {Array}  npcs               NPC 数据
 * @property {Array}  ranks              境界定义
 * @property {Array}  items              势力宏观资源定义（macro-resources.json：粮食/弟子；可持有物品见 itemDefs）
 * @property {Array}  terrains           地形定义
 * @property {Array}  factionNeeds       势力需求模板
 * @property {Array}  npcNeeds           NPC 需求模板
 * @property {Array}  factionActions     势力行为模板
 * @property {Array}  npcActions         NPC 行为模板
 * @property {Array}  npcJobActions      NPC JobAction 行为模板
 * @property {Object} npcActionSets      NPC 默认行为集
 * @property {Array}  worldRules         世界规则模板
 * @property {Object} questTemplates     任务模板
 * @property {Object} mapData            地图数据
 * @property {Array}  modifierTemplates  世界修正器模板
 * @property {Object} balanceCombat      战斗平衡配置
 * @property {Object} balanceEconomy     经济平衡配置
 * @property {Object} balanceCultivation 修炼平衡配置
 * @property {Object} balanceSocial      社交平衡配置
 * @property {Object} balanceMovement    移动速度平衡配置
 * @property {Object} balancePersonality 性格系统平衡配置
 * @property {Object} balanceRisk        风险系统平衡配置
 * @property {Object} balanceMemory      记忆系统平衡配置
 * @property {Object} balanceObsession   执念系统平衡配置
 * @property {Object} balanceEmotion     情绪系统平衡配置
 * @property {Object} balanceUtility     Utility 考量因素配置（ADR-020）
 * @property {Object} balanceReward      期望收益配置（ADR-022）
 * @property {Object} balanceRelationship 关系网系统配置（ADR-027）
 * @property {Object} dynamicEvents      动态世界事件配置
 * @property {Object} dynamicGoals       动态 Goal 配置
 * @property {Object} relationshipPlatform 三层关系全数据平台配置
 * @property {Object} jobs               合并后的 Job 定义
 * @property {Object} toils              合并后的 Toil 定义
 * @property {Array}  monsters           妖兽定义
 * @property {Object} monsterAttributeTemplates 妖兽五层模板与阶位基准
 * @property {Object} monsterSpawn       妖兽分布平衡配置
 * @property {Object} combatBaseTable    境界战斗参考基表
 * @property {Object} cultivatorCombat   普通修士裸面板
 * @property {Object} monsterCombat      普通妖兽/猛兽裸面板参考表
 * @property {Object} gameConfig         全局游戏配置
 * @property {Object} aiConfig           AI 配置
 * @property {Object} names              姓名池
 */
