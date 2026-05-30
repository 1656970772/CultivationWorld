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
    factionActions, npcActions, worldRules,
    questTemplates, mapData, modifierTemplates,
    balanceCombat, balanceEconomy, balanceCultivation, balanceSocial, balanceMovement,
    balancePersonality, balanceRisk, balanceMemory, balanceObsession, balanceEmotion,
    balanceUtility, balanceReward,
    gameConfig, aiConfig, names,
    monsters, monsterSpawn,
    worldNews, worldOpportunities, balanceCovet, itemDefs,
  ] = await Promise.all([
    loadJSON('data/entities/factions.json'),
    loadJSON('data/entities/npcs.json'),
    loadJSON('data/definitions/ranks.json'),
    loadJSON('data/definitions/resources.json'),
    loadJSON('data/definitions/terrains.json'),
    loadJSON('data/needs/faction-needs.json'),
    loadJSON('data/needs/npc-needs.json'),
    loadJSON('data/actions/faction-actions.json'),
    loadJSON('data/actions/npc-actions.json'),
    loadJSON('data/actions/world-rules.json'),
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
    loadJSON('data/config/game-config.json'),
    loadJSON('data/config/ai-config.json'),
    loadJSON('data/definitions/names.json'),
    loadJSON('data/definitions/monsters.json'),
    loadJSON('data/balance/monster-spawn.json'),
    loadJSON('data/world/news.json'),
    loadJSON('data/world/opportunities.json'),
    loadJSON('data/balance/covet.json'),
    loadJSON('data/items/items.json'),
  ]);

  return {
    factions, npcs, ranks, items, terrains,
    factionNeeds, npcNeeds,
    factionActions, npcActions, worldRules,
    questTemplates, mapData, modifierTemplates,
    balanceCombat, balanceEconomy, balanceCultivation, balanceSocial, balanceMovement,
    balancePersonality, balanceRisk, balanceMemory, balanceObsession, balanceEmotion,
    balanceUtility, balanceReward,
    gameConfig, aiConfig, names,
    monsters, monsterSpawn,
    worldNews, worldOpportunities, balanceCovet, itemDefs,
  };
}

/**
 * @typedef {Object} GameConfigs
 * @property {Array}  factions           势力数据
 * @property {Array}  npcs               NPC 数据
 * @property {Array}  ranks              境界定义
 * @property {Array}  items              资源/物品定义
 * @property {Array}  terrains           地形定义
 * @property {Array}  factionNeeds       势力需求模板
 * @property {Array}  npcNeeds           NPC 需求模板
 * @property {Array}  factionActions     势力行为模板
 * @property {Array}  npcActions         NPC 行为模板
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
 * @property {Array}  monsters           妖兽定义
 * @property {Object} monsterSpawn       妖兽分布平衡配置
 * @property {Object} gameConfig         全局游戏配置
 * @property {Object} aiConfig           AI 配置
 * @property {Object} names              姓名池
 */
