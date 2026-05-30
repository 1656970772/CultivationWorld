/**
 * WorldEngine - 世界引擎主入口
 *
 * 负责初始化所有子系统、注册需求/行为/物品，创建实体，启动 Tick 循环。
 * 所有平衡配置（战斗、经济、修炼、社交）通过 init(configs) 注入，无硬编码数值。
 */
import { EntityRegistry } from './abstract/entity-registry.js';
import { ItemRegistry } from './items/item-registry.js';
import { NeedPool } from './pools/need-pool.js';
import { ActionPool } from './pools/action-pool.js';
import { WorldEntity } from './world/world-entity.js';
import { TickManager } from './world/tick-manager.js';
import { FactionEntity } from './faction/faction-entity.js';
import { NPCEntity } from './npc/npc-entity.js';
import { nearestPassable } from './world/pathfinding.js';
import { GridGraph } from './world/grid-graph.js';
import { JpsPlusData } from './world/jps-plus.js';
import { HierarchicalGraph } from './world/hierarchical-graph.js';
import { MonsterSpawner } from './monster/monster-spawner.js';
import { TerritoryLayoutGenerator } from './world/territory-layout-generator.js';

import { registerFactionEvaluators } from './faction/faction-needs.js';
import { registerFactionExecutors } from './faction/faction-actions.js';
import { registerNPCEvaluators } from './npc/npc-needs.js';
import { registerNPCExecutors } from './npc/npc-actions.js';
import { registerWorldRuleExecutors } from './world/world-rules.js';

export class WorldEngine {
  constructor() {
    this.entityRegistry = new EntityRegistry();
    this.worldEntity = null;
    this.tickManager = null;
    this._initialized = false;
  }

  /**
   * 初始化引擎
   * @param {Object} configs 所有配置数据（含 balance/config/names/modifiers 等）
   */
  init(configs) {
    // 聚合平衡配置
    this._balanceConfig = {
      combat: configs.balanceCombat || {},
      economy: configs.balanceEconomy || {},
      cultivation: configs.balanceCultivation || {},
      social: configs.balanceSocial || {},
      movement: configs.balanceMovement || {},
      personality: configs.balancePersonality || {},
      risk: configs.balanceRisk || {},
      memory: configs.balanceMemory || {},
      obsession: configs.balanceObsession || {},
      emotion: configs.balanceEmotion || {},
      utility: configs.balanceUtility || {},
      reward: configs.balanceReward || {},
    };
    this._gameConfig = configs.gameConfig || {};
    this._aiConfig = configs.aiConfig || {};
    this._namesConfig = configs.names || {};
    this._modifierTemplates = configs.modifierTemplates || [];
    // 信息传播 / 机会 / 怀璧其罪系统配置（ADR-024/025）。默认 enabled=false 零漂移。
    this._worldNewsConfig = configs.worldNews || {};
    this._opportunityConfig = configs.worldOpportunities || {};
    this._covetConfig = configs.balanceCovet || {};
    this._itemDefs = configs.itemDefs || {};

    // 用于动态创建新NPC时传递的实体配置包
    this._entityConfig = {
      gameConfig: this._gameConfig,
      cultivationConfig: this._balanceConfig.cultivation,
      personalityConfig: this._balanceConfig.personality,
      aiConfig: this._aiConfig.npc || {},
      memoryConfig: this._balanceConfig.memory,
      obsessionConfig: this._balanceConfig.obsession,
      emotionConfig: this._balanceConfig.emotion,
      // utilityConfig：合并 balance/utility.json（enabled 开关 + considerationsBySource 曲线）
      // 与 ai-config.npc.utility（riskAversion/emotionRisk/headstrong/pathPreference 参数），
      // 后者覆盖前者的同名键，避免修改 utility.json 即可调参（ADR-021）。
      // reward：期望收益配置（reward.json，ADR-022），挂在 utilityConfig.reward 供
      // decorateGoalConsiderations 经 deriveExpectedValue 读取。
      utilityConfig: Object.assign(
        {},
        this._balanceConfig.utility,
        this._aiConfig.npc?.utility || {},
        { reward: this._balanceConfig.reward },
      ),
    };

    this._registerSystems(configs);
    this.questTemplates = configs.questTemplates || null;
    this._buildTileIndex(configs);
    this._buildTechniqueRegistry(configs);
    this._createWorldEntity();
    this._createFactions(configs);
    this._initTerritories();
    this._createNPCs(configs);
    this._createMonsters(configs);
    this._createTickManager();
    this._initialized = true;

    return {
      totalFactions: this.entityRegistry.getByType('faction').length,
      totalNPCs: this.entityRegistry.getByType('npc').length,
      totalMonsters: this.entityRegistry.getByType('monster').length,
      worldDay: this.worldEntity.currentDay,
    };
  }

  /**
   * 注册所有子系统
   */
  _registerSystems(configs) {
    if (configs.items) {
      ItemRegistry.loadFromArray(configs.items);
    }
    // 可转移物品定义（ADR-025）：法宝/材料/丹药，category 区别于 resources（resource）。
    if (configs.itemDefs?.items) {
      ItemRegistry.loadFromArray(configs.itemDefs.items);
    }

    registerFactionEvaluators();
    registerNPCEvaluators();

    if (configs.factionNeeds) {
      NeedPool.loadFromArray(configs.factionNeeds);
    }
    if (configs.npcNeeds) {
      NeedPool.loadFromArray(configs.npcNeeds);
    }

    registerFactionExecutors();
    registerNPCExecutors();
    registerWorldRuleExecutors();

    if (configs.factionActions) {
      ActionPool.loadFromArray(configs.factionActions);
    }
    if (configs.npcActions) {
      ActionPool.loadFromArray(configs.npcActions);
    }
    if (configs.worldRules) {
      ActionPool.loadFromArray(configs.worldRules);
    }
  }

  _buildTileIndex(configs) {
    this.tileIndex = new Map();
    /** @type {Map<string, Array<{x:number,y:number}>>} 地形类型 → 该地形所有格坐标（任务选点用）*/
    this.terrainTilesByType = new Map();
    const tiles = configs.mapData?.tiles || [];
    for (const tile of tiles) {
      this.tileIndex.set(`${tile.x},${tile.y}`, tile);
      if (!this.terrainTilesByType.has(tile.terrain)) {
        this.terrainTilesByType.set(tile.terrain, []);
      }
      this.terrainTilesByType.get(tile.terrain).push({ x: tile.x, y: tile.y });
    }

    this.terrainIndex = new Map();
    const terrains = configs.terrains || [];
    for (const terrain of terrains) {
      this.terrainIndex.set(terrain.type, terrain);
    }

    this._mapWidth = configs.mapData?.width || 300;
    this._mapHeight = configs.mapData?.height || 300;

    // 一次性构建寻路位图与分层抽象图（地形静态，全实体共享只读）。
    // GridGraph 启用 JPS，HierarchicalGraph 启用 HPA*（远距离加速）。
    this.gridGraph = new GridGraph({
      tileIndex: this.tileIndex,
      terrainIndex: this.terrainIndex,
      width: this._mapWidth,
      height: this._mapHeight,
    });
    // JPS+ 预处理（4 方向 step 表）：一次性构建并挂到 GridGraph，
    // jpsPath 检测到后自动走查表版（单次再快约 3×，结果与基础 JPS 一致）。
    // 须在 HierarchicalGraph 之前挂上，使簇内边预处理也受益。
    this.gridGraph.jpsPlus = new JpsPlusData(this.gridGraph);
    this.hierGraph = new HierarchicalGraph({ graph: this.gridGraph, clusterSize: 16 });
  }

  /**
   * 找到距 (fromX,fromY) 最近的指定地形格坐标。
   * @returns {{x:number,y:number}|null}
   */
  nearestTerrainTile(fromX, fromY, terrainType) {
    const list = this.terrainTilesByType.get(terrainType);
    if (!list || list.length === 0) return null;
    let best = null, bestD = Infinity;
    for (const t of list) {
      const d = Math.abs(t.x - fromX) + Math.abs(t.y - fromY);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /**
   * 构建功法注册表
   * @param {Object} configs
   */
  _buildTechniqueRegistry(configs) {
    this._techniqueRegistry = new Map();
    const techniques = configs.techniques || [];
    for (const tech of techniques) {
      this._techniqueRegistry.set(tech.id, tech);
    }
  }

  _createWorldEntity() {
    this.worldEntity = new WorldEntity();
    this.entityRegistry.register(this.worldEntity);
  }

  _createFactions(configs) {
    const factions = configs.factions || [];
    for (const factionConfig of factions) {
      const faction = new FactionEntity(factionConfig, {
        aiConfig: this._aiConfig.faction || {},
      });
      this.entityRegistry.register(faction);
    }
  }

  /**
   * 生成势力领地（有机外围 + 规整院落 + 功能建筑）与矿区。
   * 直接在 tileIndex 的 tile 上写入 ownerId / district / building，
   * 渲染层共享同一引用即可读取。
   */
  _initTerritories() {
    const factions = this.entityRegistry.getByType('faction');

    const generator = new TerritoryLayoutGenerator({
      tileIndex: this.tileIndex,
      terrainIndex: this.terrainIndex,
      mapWidth: this._mapWidth,
      mapHeight: this._mapHeight,
      factions,
    });
    const stats = generator.generate();

    // 回填各势力 territory（兼容读取 state.territory 的旧逻辑）
    const territoryByFaction = new Map();
    for (const [key, tile] of this.tileIndex.entries()) {
      if (!tile.ownerId) continue;
      if (!territoryByFaction.has(tile.ownerId)) territoryByFaction.set(tile.ownerId, []);
      territoryByFaction.get(tile.ownerId).push(key);
    }
    for (const faction of factions) {
      faction.state.set('territory', territoryByFaction.get(faction.id) || []);
    }

    this._layoutStats = stats;
    this._factionBuildings = stats.buildingsByFaction || new Map();
  }

  /**
   * 查询某势力指定类型建筑的坐标（取最靠近 from 的一个；无 from 取第一个）。
   * 找不到该建筑时回退到势力总部（hq），再不行返回 null。
   * @param {string} factionId
   * @param {string} buildingType layout-constants BuildingType
   * @param {{x:number,y:number}|null} [from] 参考点（用于多个同类建筑就近选择）
   * @returns {{x:number,y:number}|null}
   */
  getFactionBuilding(factionId, buildingType, from = null) {
    const entry = this._factionBuildings?.get(factionId);
    if (!entry) return null;
    const list = entry.byType?.get(buildingType);
    if (list && list.length > 0) {
      if (from && list.length > 1) {
        let best = list[0], bestD = Infinity;
        for (const p of list) {
          const d = Math.abs(p.x - from.x) + Math.abs(p.y - from.y);
          if (d < bestD) { bestD = d; best = p; }
        }
        return { x: best.x, y: best.y };
      }
      return { x: list[0].x, y: list[0].y };
    }
    return entry.hq ? { x: entry.hq.x, y: entry.hq.y } : null;
  }

  _createNPCs(configs) {
    const npcs = configs.npcs || [];
    const ranks = configs.ranks || [];
    this._ranksData = ranks;
    for (const npcConfig of npcs) {
      const npc = new NPCEntity(npcConfig, ranks, this._entityConfig);
      this._initNpcSpatial(npc, npcConfig);
      this.entityRegistry.register(npc);
    }
  }

  /**
   * 为 NPC 分配初始坐标与移动速度。
   * 优先级：npcConfig.x/y > 所属势力总部 > 地图中心附近随机可通行格。
   */
  _initNpcSpatial(npc, npcConfig) {
    let x = typeof npcConfig.x === 'number' ? npcConfig.x : null;
    let y = typeof npcConfig.y === 'number' ? npcConfig.y : null;

    if (x === null || y === null) {
      const factionId = npc.state.get('factionId');
      const faction = factionId ? this.entityRegistry.getById(factionId) : null;
      const hq = faction?.staticData?.headquarters;
      if (hq && typeof hq.x === 'number' && typeof hq.y === 'number') {
        x = hq.x;
        y = hq.y;
      } else {
        x = Math.floor(this._mapWidth / 2);
        y = Math.floor(this._mapHeight / 2);
      }
    }

    const fixed = nearestPassable(x, y, this.tileIndex, this.terrainIndex) || { x, y };
    const speed = this._npcSpeed(npc.state.get('rankId'));
    npc.initSpatial({ x: fixed.x, y: fixed.y, speed });
  }

  /**
   * 游历目标：从 here 朝随机方向走到 [minDist, maxDist] 距离的野外可通行点。
   * 用于「游历历练」行为，避免直接走向妖兽。
   * @param {{x:number,y:number}|null} here
   * @returns {{x:number,y:number}|null}
   */
  _randomWanderTarget(here, minDist = 8, maxDist = 25) {
    if (!here) return null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      const tx = Math.round(here.x + Math.cos(angle) * dist);
      const ty = Math.round(here.y + Math.sin(angle) * dist);
      const cx = Math.max(0, Math.min(this._mapWidth - 1, tx));
      const cy = Math.max(0, Math.min(this._mapHeight - 1, ty));
      const fixed = nearestPassable(cx, cy, this.tileIndex, this.terrainIndex);
      if (fixed) return { x: fixed.x, y: fixed.y };
    }
    return null;
  }

  /** 按境界获取 NPC 移动速度 */
  _npcSpeed(rankId) {
    const map = this._balanceConfig.movement?.npcSpeedByRank || {};
    return map[rankId] ?? map.default ?? 2;
  }

  /** 构建 rankId → order 映射（供妖兽与 NPC 境界比较） */
  _buildRankOrderMap() {
    const map = {};
    for (const r of (this._ranksData || [])) {
      if (r && r.id) map[r.id] = r.order ?? 0;
    }
    return map;
  }

  /**
   * 按地形/区域/境界梯度在地图上生成妖兽实例并注册。
   */
  _createMonsters(configs) {
    const monsterDefs = configs.monsters || [];
    const spawnConfig = configs.monsterSpawn || {};
    if (monsterDefs.length === 0) return;

    const spawner = new MonsterSpawner({
      tileIndex: this.tileIndex,
      terrainIndex: this.terrainIndex,
      monsterDefs,
      factions: this.entityRegistry.getByType('faction'),
      spawnConfig,
      movementConfig: this._balanceConfig.movement || {},
      rankOrderMap: this._buildRankOrderMap(),
      mapWidth: this._mapWidth,
      mapHeight: this._mapHeight,
    });

    this.monsterSpawner = spawner;
    this._monsterInitialCount = 0;
    const monsters = spawner.spawn();
    for (const monster of monsters) {
      this.entityRegistry.register(monster);
    }
    this._monsterInitialCount = monsters.length;
  }

  _createTickManager() {
    this.tickManager = new TickManager({
      entityRegistry: this.entityRegistry,
      worldEntity: this.worldEntity,
      questTemplates: this.questTemplates,
      tileIndex: this.tileIndex,
      terrainIndex: this.terrainIndex,
      ranksData: this._ranksData,
      balanceConfig: this._balanceConfig,
      namesConfig: this._namesConfig,
      modifierTemplates: this._modifierTemplates,
      gameConfig: this._gameConfig,
      entityConfig: this._entityConfig,
      techniqueRegistry: this._techniqueRegistry,
      monsterSpawner: this.monsterSpawner || null,
      monsterInitialCount: this._monsterInitialCount || 0,
      factionBuildings: this._factionBuildings || new Map(),
      gridGraph: this.gridGraph || null,
      hierGraph: this.hierGraph || null,
      worldNewsConfig: this._worldNewsConfig,
      opportunityConfig: this._opportunityConfig,
      covetConfig: this._covetConfig,
    });
  }

  /**
   * 启用/禁用势力 AI 决策
   * @param {boolean} enabled
   */
  setFactionAI(enabled) {
    if (this.tickManager) {
      this.tickManager.factionAIEnabled = enabled;
    }
  }

  /**
   * 执行一次 Tick
   */
  tick() {
    if (!this._initialized) throw new Error('WorldEngine not initialized');
    return this.tickManager.tick();
  }

  /**
   * 执行多次 Tick
   */
  multiTick(count) {
    if (!this._initialized) throw new Error('WorldEngine not initialized');
    return this.tickManager.multiTick(count);
  }

  /**
   * 获取当前世界快照
   */
  getWorldSnapshot() {
    const factions = this.entityRegistry.getByType('faction');
    const npcs = this.entityRegistry.getByType('npc');
    const monsters = this.entityRegistry.getByType('monster');

    return {
      day: this.worldEntity.currentDay,
      activeModifiers: this.worldEntity.activeModifiers,
      // 机会点系统（ADR-024）：供前端在地图上标注江湖热点（默认 enabled=false 时为空数组）。
      opportunities: this.tickManager?.opportunitySystem?.snapshot()?.opportunities || [],
      factions: Object.fromEntries(factions.map(f => [f.id, {
        name: f.name,
        type: f.factionType,
        alive: f.alive,
        stability: f.state.get('stability'),
        territoryCount: f.state.get('territoryCount'),
        territory: f.state.get('territory'),
        resources: f.inventory.getAll(),
        leaderNpcId: f.state.get('leaderNpcId'),
        relations: f.state.get('relations'),
        isDestroyed: f.state.get('isDestroyed'),
      }])),
      npcs: Object.fromEntries(npcs.map(n => [n.id, {
        name: n.name,
        alive: n.alive,
        role: n.state.get('currentRole'),
        factionId: n.state.get('factionId'),
        ageYears: n.state.get('ageYears'),
        maxAgeYears: n.state.get('maxAgeYears'),
        rankName: n.state.get('rankName'),
        rankId: n.state.get('rankId'),
        qi: n.state.get('qi') || 0,
        cultivationProgress: n.state.get('cultivationProgress') || 0,
        contribution: n.state.get('contribution') || 0,
        totalQuestsCompleted: n.state.get('totalQuestsCompleted') || 0,
        gender: n.state.get('gender') || 'male',
        daoCompanionId: n.state.get('daoCompanionId') || null,
        childrenCount: n.state.get('childrenCount') || 0,
        inventory: n.inventory.getAll(),
        spatial: n.spatial ? n.spatial.snapshot() : null,
        actionStatus: n.state.get('actionStatus') || 'idle',
        // 身家/装备（ADR-025）：供前端展示怀璧之人（默认禁用态 _assetScore 不会被赋值）。
        assetScore: n._assetScore || 0,
        equippedArtifactId: n.state.get('equippedArtifactId') || null,
      }])),
      monsters: Object.fromEntries(monsters.filter(m => m.alive).map(m => [m.id, {
        name: m.name,
        alive: m.alive,
        defId: m.staticData.get('defId'),
        grade: m.grade,
        gradeName: m.staticData.get('gradeName'),
        family: m.staticData.get('family'),
        rarity: m.staticData.get('rarity'),
        behaviorState: m.state.get('behaviorState'),
        hp: m.state.get('hp'),
        maxHp: m.state.get('maxHp'),
        spatial: m.spatial ? m.spatial.snapshot() : null,
      }])),
      stats: {
        totalFactions: factions.length,
        aliveFactions: factions.filter(f => f.alive).length,
        totalNPCs: npcs.length,
        aliveNPCs: npcs.filter(n => n.alive).length,
        totalMonsters: monsters.length,
        aliveMonsters: monsters.filter(m => m.alive).length,
      },
    };
  }

  /**
   * 获取 Tick 历史
   */
  getTickHistory() {
    return this.tickManager?.getTickHistory() || [];
  }
}
