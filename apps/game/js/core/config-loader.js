/**
 * ConfigLoader - v2 游戏配置统一加载器
 *
 * 职责：加载所有运行时 JSON 数据，供 GameManager 和 SimulationApp 共用。
 * 消除了 game-manager.js 与 simulation-main.js 之间的重复加载逻辑。
 *
 * 数据路径遵循 docs/data/data-config-rules.md 定义的 v2 目录结构。
 */
import {
  loadGameConfigsFromManifest,
  loadGameDataManifest,
  loadJsonGroup,
} from './data-manifest-loader.js';

/**
 * 加载所有 v2 游戏配置
 *
 * 返回的对象字段名与 WorldEngine.init(configs) 期望的字段完全一致。
 * @returns {Promise<GameConfigs>}
 */
export async function loadGameConfigs() {
  const manifest = await loadGameDataManifest();
  return loadGameConfigsFromManifest(manifest);
}

export { loadGameDataManifest, loadJsonGroup };

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
 * @property {Object} economicTransactionConfig 统一经济交易底座配置
 * @property {Object} relationshipPlatform 三层关系全数据平台配置
 * @property {Object} jobs               合并后的 Job 定义
 * @property {Object} toils              合并后的 Toil 定义
 * @property {Array}  monsters           妖兽定义
 * @property {Object} monsterAttributeTemplates 妖兽五层模板与阶位基准
 * @property {Object} monsterSpawn       妖兽分布平衡配置
 * @property {Object} combatBaseTable    境界战斗参考基表
 * @property {Object} cultivatorCombat   普通修士裸面板
 * @property {Object} monsterCombat      普通妖兽/猛兽裸面板参考表
 * @property {Object} monsterResourceRules 妖兽材料族与掉落物品规则
 * @property {Object} behaviorTrees      行为树数据注册表输入
 * @property {Object} dataManifest       运行时 JSON 加载清单
 * @property {Object} gameConfig         全局游戏配置
 * @property {Object} aiConfig           AI 配置
 * @property {Object} names              姓名池
 */
