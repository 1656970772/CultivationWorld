/**
 * TickManager - Tick 编排器（中介者 + 模板方法）。
 *
 * 重构后职责收敛为：
 *   1. tick() 模板方法骨架：按固定步骤顺序编排世界/势力/NPC/妖兽演化，每步委托给独立服务；
 *   2. 共享工具宿主：为各服务提供低层 helper（位置/地点名/关系建边/战力/寻路/地形索引/境界查询等）；
 *   3. 公共 API：getFactionBuilding / getTickHistory / getLatestTick / setFactionAI。
 *
 * 各 tick-phase 职责拆分到 services/ 下独立服务（单一职责、可独立测试/扩展）：
 *   - WorldContextBuilder：每 tick 装配 worldContext（数据 + 工具委托 + 势力 AI 委托）。
 *   - FactionAIService：势力 AI 决策（扩张/攻伐/结盟/贸易/态势/晋升，策略模式）。
 *   - PromotionService：宗门晋升原语 + 月度考核/门派活动/贡献晋升。
 *   - PopulationService：道侣匹配与生育。
 *   - DeathCollector：死亡收集与遗志继承。
 *   - InfoCoordinator：信息传播/机会点/怀璧其罪编排（ADR-024/025）。
 *   - MonsterRespawnService：妖兽种群补充与妖群建边。
 *
 * 战斗/贸易/结盟参数来自 data/balance/combat.json；社会/人口参数来自 data/balance/social.json；
 * 姓名池来自 data/definitions/names.json。
 */
import { MovementSystem } from './movement-system.js';
import { InfoPropagationSystem } from './info-propagation.js';
import { OpportunitySystem } from './opportunity.js';
import { ItemRegistry } from '../items/item-registry.js';
import { WorldContextBuilder } from './services/world-context-builder.js';
import { FactionAIService } from './services/faction-ai-service.js';
import { PromotionService } from './services/promotion-service.js';
import { PopulationService } from './services/population-service.js';
import { DeathCollector } from './services/death-collector.js';
import { InfoCoordinator } from './services/info-coordinator.js';
import { MonsterRespawnService } from './services/monster-respawn-service.js';

export class TickManager {
  /**
   * @param {Object} deps
   * @param {import('../abstract/entity-registry.js').EntityRegistry} deps.entityRegistry
   * @param {import('./world-entity.js').WorldEntity} deps.worldEntity
   * @param {Object} [deps.balanceConfig] 平衡配置（来自 data/balance/）
   * @param {Object} [deps.namesConfig] 姓名配置（来自 data/definitions/names.json）
   * @param {Array}  [deps.modifierTemplates] 修正器模板（来自 data/world/modifiers.json）
   * @param {Object} [deps.gameConfig] 游戏全局配置（来自 data/config/game-config.json）
   * @param {Object} [deps.entityConfig] 实体配置（用于动态创建NPC时传递）
   */
  constructor({ entityRegistry, worldEntity, rng, questTemplates, tileIndex, terrainIndex, ranksData,
                balanceConfig, namesConfig, modifierTemplates, gameConfig, entityConfig,
                techniqueRegistry, monsterSpawner, monsterInitialCount, factionBuildings,
                gridGraph, hierGraph, worldNewsConfig, opportunityConfig, dynamicEventsConfig, dynamicGoalsConfig,
                worldEventSystem, covetConfig,
                relationshipConfig, relationshipSystem }) {
    this.entityRegistry = entityRegistry;
    this.worldEntity = worldEntity;
    // 确定性随机源（由 WorldEngine 注入）。挂到 worldContext，供所有模拟逻辑取随机。
    this.rng = rng || null;
    this.questTemplates = questTemplates || null;
    this.tileIndex = tileIndex || new Map();
    this.terrainIndex = terrainIndex || new Map();
    this.gridGraph = gridGraph || null;
    this.hierGraph = hierGraph || null;
    this.movementSystem = new MovementSystem({
      tileIndex: this.tileIndex,
      terrainIndex: this.terrainIndex,
      graph: this.gridGraph,
      hierGraph: this.hierGraph,
    });
    this.ranksData = ranksData || [];
    this.balanceConfig = balanceConfig || {};
    this.namesConfig = namesConfig || {};
    this.modifierTemplates = modifierTemplates || [];
    this.gameConfig = gameConfig || {};
    this.entityConfig = entityConfig || {};
    this.techniqueRegistry = techniqueRegistry || new Map();
    this.monsterSpawner = monsterSpawner || null;
    this.monsterInitialCount = monsterInitialCount || 0;
    /** Map<factionId, { hq:{x,y}, byType: Map<buildingType, {x,y}[]> }> */
    this._factionBuildings = factionBuildings || new Map();
    this._tickResults = [];
    this.factionAIEnabled = true;
    this._nextNpcId = 1000;
    this.sectEventLog = [];

    // 信息传播 / 机会点 / 怀璧其罪系统（ADR-024/025）。默认 enabled=false。
    this.covetConfig = covetConfig || {};
    this.infoSystem = new InfoPropagationSystem(worldNewsConfig || {});
    this.opportunitySystem = new OpportunitySystem(opportunityConfig || {});
    this.dynamicEventsConfig = dynamicEventsConfig || {};
    this.dynamicGoalsConfig = dynamicGoalsConfig || {};
    this.worldEventSystem = worldEventSystem || null;

    // 关系网系统（ADR-027，世界级单一真相源）。由 WorldEngine 创建并传入，
    // 在各事件结算点维护人际/人妖/妖妖关系边，每日衰减挂在 _updateRelations 旁。
    this.relationshipConfig = relationshipConfig || {};
    this.relationshipSystem = relationshipSystem || null;

    // ── 子服务装配（各持 host 引用，通过共享 helper 协作）──
    this.factionAIService = new FactionAIService({ host: this, combatConfig: this.balanceConfig.combat || {} });
    this.promotionService = new PromotionService({ host: this });
    this.populationService = new PopulationService({ host: this });
    this.deathCollector = new DeathCollector({ host: this });
    this.infoCoordinator = new InfoCoordinator({ host: this });
    this.monsterRespawnService = new MonsterRespawnService({ host: this });
    this._contextBuilder = new WorldContextBuilder({ host: this, factionAI: this.factionAIService });
  }

  /** 道侣生育用的新 NPC 自增 id（供 PopulationService 调用，保持原 _nextNpcId 递增语义）。 */
  _nextBornNpcId() {
    return ++this._nextNpcId;
  }

  /** 道侣匹配日志（PopulationService 持有，供报告读取）。 */
  get companionLog() { return this.populationService.companionLog; }
  /** 生育日志（PopulationService 持有，供报告读取）。 */
  get birthLog() { return this.populationService.birthLog; }

  /**
   * 查询某势力指定类型建筑坐标（取最靠近 from 的一个；无 from 取第一个）。
   * 找不到该建筑时回退势力总部（hq），再不行返回 null。
   * @param {string} factionId
   * @param {string} buildingType layout-constants BuildingType
   * @param {{x:number,y:number}|null} [from]
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

  /**
   * 执行一次完整 Tick
   * @returns {Object} tick 结果
   */
  tick() {
    const tickLog = {
      day: this.worldEntity.currentDay + 1,
      worldRules: null,
      factionDecisions: [],
      npcUpdates: [],
      conflicts: [],
      events: [],
      dynamicEvents: [],
      infoEvents: [],
      deaths: [],
      monsterDeaths: [],
    };

    this._attackedThisTick = new Set();
    const worldContext = this._contextBuilder.build();

    // 1. 世界规则
    tickLog.worldRules = this.worldEntity.tick(worldContext);
    if (this.worldEventSystem) {
      tickLog.dynamicEvents = this.worldEventSystem.tick(this.worldEntity.currentDay);
    }

    // 2. 势力需求评估 + 行为规划
    const factions = this.entityRegistry.getAliveByType('faction');

    if (this.factionAIEnabled) {
      for (const faction of factions) {
        faction._tickLog = {
          entityId: faction.id,
          entityType: faction.type,
          needs: null,
          plan: null,
          execution: null,
        };
        faction.onPreTick(worldContext);
        faction._evaluateNeeds(worldContext);
        faction._planBehavior(worldContext);
      }

      // 3. 冲突解决
      tickLog.conflicts = this._resolveConflicts(factions, worldContext);

      // 4. 势力行为执行
      for (const faction of factions) {
        const execResult = faction._executeBehavior(worldContext);
        faction.onPostTick(worldContext);

        tickLog.factionDecisions.push({
          factionId: faction.id,
          factionName: faction.name,
          needs: faction.needSystem.toJSON(),
          plan: faction.behaviorSystem.getLastPlanResult(),
          execution: execResult,
          state: {
            stability: faction.state.get('stability'),
            territoryCount: faction.state.get('territoryCount'),
            low_spirit_stone: faction.inventory.getAmount('low_spirit_stone'),
            disciples: faction.inventory.getAmount('disciples'),
            food: faction.inventory.getAmount('food'),
            alive: faction.alive,
          },
        });
      }

      tickLog.infoEvents = [...(worldContext.infoEvents || [])];
    } else {
      for (const faction of factions) {
        faction.onPreTick(worldContext);
        faction.onPostTick(worldContext);
      }
    }

    // 5. 实体移动推进（NPC：有移动目标的实体沿路径前进）
    this._tickMovement(worldContext);

    // 6. NPC 更新
    const npcs = this.entityRegistry.getAliveByType('npc');
    for (const npc of npcs) {
      const npcLog = npc.tick(worldContext);
      tickLog.npcUpdates.push(npcLog);
      this._emitNpcActionEvent(tickLog, npc, npcLog);
    }

    // 6b. 妖兽更新（轻量状态机：游荡/觅食/休整）
    const monsters = this.entityRegistry.getAliveByType('monster');
    for (const monster of monsters) {
      monster.tick(worldContext);
    }
    tickLog.infoEvents = [...(tickLog.infoEvents || []), ...(worldContext.infoEvents || []).filter(e => e.type === 'monster_attack')];

    // 6c. 统一收集本 tick 的死亡（自然/妖兽/任务），保证死亡都能进日志
    this.deathCollector.collect(tickLog);

    // 6c-2. 为本 tick 的 infoEvents（攻击/结盟/妖兽袭击）补坐标与地点名
    this.infoCoordinator.enrichInfoEvents(tickLog);

    // 6c-info. 信息传播 / 机会点 / 怀璧其罪系统（ADR-024/025）。默认 enabled=false 时全部静默。
    this.infoCoordinator.tickInfoSystems(tickLog, npcs, worldContext);

    // 6d. 妖兽种群补充（维持生态在目标数量附近，避免被清空 / 永不变化）
    this.monsterRespawnService.respawn(tickLog);

    // 7. 更新世界统计
    this._updateWorldStats();

    // 8. 关系更新（势力外交衰减 + 个人/族群关系网边衰减，ADR-027）
    this._updateRelations(factions, tickLog);
    if (this.relationshipSystem) this.relationshipSystem.tick();

    // 9. 道侣匹配
    const currentDay = this.worldEntity.currentDay;
    const socialCfg = this.balanceConfig.social || {};
    const companionInterval = socialCfg.daoCompanion?.matchIntervalDays ?? 60;
    if (currentDay > 0 && currentDay % companionInterval === 0) {
      this.populationService.matchDaoCompanions(worldContext, tickLog);
    }

    // 10. 生育
    const birthInterval = socialCfg.birth?.processIntervalDays ?? 90;
    if (currentDay > 0 && currentDay % birthInterval === 0) {
      this.populationService.processBirths(worldContext, tickLog);
    }

    // 11. 月度贡献考核 + 势力定时活动（门派考核/大比）+ 贡献晋升
    this.promotionService.processMonthlyContribution(worldContext, tickLog, currentDay);
    this.promotionService.processSectEvents(worldContext, tickLog, currentDay);
    this.promotionService.processPromotions(worldContext, tickLog, currentDay);

    this._tickResults.push(tickLog);
    return tickLog;
  }

  /**
   * 连续执行多次 Tick
   */
  multiTick(count) {
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(this.tick());
    }
    return results;
  }

  /**
   * 计算各势力的矿脉灵石产出。
   *
   * 性能：原本每 tick 遍历全图 9 万格。矿脉归属变化极慢（仅领地扩张/攻占时），
   * 故缓存结果并每 veinRecalcInterval 天才重算一次（默认 10 天），其余 tick 直接复用。
   */
  _calcFactionVeinOutput() {
    const interval = this.balanceConfig.economy?.veinRecalcInterval ?? 10;
    const day = this.worldEntity.currentDay;
    if (this._veinOutputCache && (day - this._veinOutputCacheDay) < interval) {
      return this._veinOutputCache;
    }

    const output = new Map();
    const veinOutput = this.balanceConfig.economy?.veinOutput || {
      low_spirit_vein: 2,
      mid_spirit_vein: 100,
      high_spirit_vein: 500,
      top_spirit_vein: 5000,
    };
    for (const [, tile] of this.tileIndex) {
      if (!tile.ownerId) continue;
      const value = veinOutput[tile.terrain];
      if (value) {
        output.set(tile.ownerId, (output.get(tile.ownerId) || 0) + value);
      }
    }
    this._veinOutputCache = output;
    this._veinOutputCacheDay = day;
    return output;
  }

  /**
   * 判断两个势力是否"地理上够得着"：领地存在相邻格，或总部曼哈顿距离在阈值内。
   * 用于修复原 checkAdjacentEnemy 只看关系值、不看地理的缺陷。
   * @returns {boolean}
   */
  _factionsGeographicallyClose(selfFactionId, enemyFactionId) {
    const self_ = this.entityRegistry.getById(selfFactionId);
    const enemy = this.entityRegistry.getById(enemyFactionId);
    if (!self_ || !enemy) return false;

    const reachDistance = this.balanceConfig.combat?.diplomacy?.attackReachDistance ?? 60;

    // 1) 领地相邻判定
    const selfTerritory = self_.state?.get('territory') || [];
    const enemyTerritory = new Set(enemy.state?.get('territory') || []);
    if (selfTerritory.length > 0 && enemyTerritory.size > 0) {
      for (const key of selfTerritory) {
        const [x, y] = key.split(',').map(Number);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          if (enemyTerritory.has(`${x + dx},${y + dy}`)) return true;
        }
      }
    }

    // 2) 总部距离判定（兜底，避免领地为空时永远够不着）
    const selfHq = self_.staticData?.headquarters;
    const enemyHq = enemy.staticData?.headquarters;
    if (selfHq && enemyHq && typeof selfHq.x === 'number' && typeof enemyHq.x === 'number') {
      const dist = Math.abs(selfHq.x - enemyHq.x) + Math.abs(selfHq.y - enemyHq.y);
      if (dist <= reachDistance) return true;
    }

    return false;
  }

  /**
   * 取实体当前坐标 → {x,y}|null（统一用于位置事件日志）。
   * @param {Object} entity
   * @returns {{x:number,y:number}|null}
   */
  _entityPos(entity) {
    const sp = entity?.spatial;
    if (sp && typeof sp.tileX === 'number') return { x: sp.tileX, y: sp.tileY };
    return null;
  }

  /**
   * 解析坐标处的地点名（领地所属势力名 / 地形名），用于位置事件日志可读性。
   * 找不到时返回 null。
   * @param {number} x
   * @param {number} y
   * @returns {string|null}
   */
  _resolveLocationName(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    const tile = this.tileIndex.get(`${x},${y}`);
    if (!tile) return null;
    if (tile.ownerId) {
      const owner = this.entityRegistry.getById(tile.ownerId);
      if (owner) return `${owner.name}领地`;
    }
    const terrainName = this.terrainIndex.get(tile.terrain)?.name;
    return terrainName || tile.terrain || null;
  }

  /**
   * 统一的位置事件发射：把带坐标的事件写入 tickLog.events，自动补地点名。
   * 所有"在某地发生的事"（悬赏接取/完成、攻击、结盟、妖兽袭击、死亡、道侣、生育）
   * 都经此发射，保证事件日志含 {day, x, y, locationName}。
   * @param {Object} tickLog
   * @param {Object} payload 至少含 type；可含 x,y 或 entity（用于自动取坐标）
   */
  _emitLocationEvent(tickLog, payload) {
    if (!tickLog.events) tickLog.events = [];
    let { x, y } = payload;
    if ((typeof x !== 'number' || typeof y !== 'number') && payload.entity) {
      const pos = this._entityPos(payload.entity);
      if (pos) { x = pos.x; y = pos.y; }
    }
    const evt = { day: this.worldEntity.currentDay, ...payload };
    delete evt.entity;
    if (typeof x === 'number' && typeof y === 'number') {
      evt.x = x; evt.y = y;
      evt.locationName = payload.locationName || this._resolveLocationName(x, y);
    }
    tickLog.events.push(evt);
    return evt;
  }

  /**
   * 检查 NPC 本 tick 完成的行为，对悬赏/任务相关行为发位置事件。
   * 仅在行为真正结算（step_done / plan_complete 且含 result）时触发，
   * 避免移动中/执行中的中间 tick 重复发事件。
   * @param {Object} tickLog
   * @param {Object} npc
   * @param {Object} npcLog npc.tick() 返回值
   */
  _emitNpcActionEvent(tickLog, npc, npcLog) {
    const exec = npcLog?.execution;
    if (!exec || !exec.result || !exec.action) return;
    if (exec.status !== 'step_done' && exec.status !== 'plan_complete') return;

    const actionId = exec.action.id;
    const result = exec.result;
    const isWanderer = !npc.state?.get('factionId');

    // 仅对悬赏/任务链发位置事件（散修悬赏为主，宗门任务同样记录）
    const bountyActionMap = {
      act_npc_accept_hunt_quest: isWanderer ? 'wanderer_bounty_accept' : 'quest_accept',
      act_npc_accept_quest: isWanderer ? 'wanderer_bounty_accept' : 'quest_accept',
      act_npc_do_quest: isWanderer ? 'wanderer_bounty_do' : 'quest_do',
      act_npc_turn_in_quest: isWanderer ? 'wanderer_bounty_turn_in' : 'quest_turn_in',
    };
    const type = bountyActionMap[actionId];
    if (!type) return;

    // do_quest 仅在"完成"节点记录位置事件；过程逐日推进不刷屏，
    // 身陨已由 _collectDeaths 统一记录（含坐标），此处跳过避免重复。
    if (actionId === 'act_npc_do_quest' && result.outcome !== 'complete') {
      return;
    }

    this._emitLocationEvent(tickLog, {
      type,
      entity: npc,
      npcId: npc.id,
      npcName: npc.name,
      isWanderer,
      success: result.success !== false,
      description: result.description || '',
    });
  }

  /** 懒构建：地形类型 → 该地形所有格坐标 */
  _ensureTerrainTilesIndex() {
    if (this._terrainTilesByType) return;
    this._terrainTilesByType = new Map();
    for (const tile of this.tileIndex.values()) {
      if (!this._terrainTilesByType.has(tile.terrain)) {
        this._terrainTilesByType.set(tile.terrain, []);
      }
      this._terrainTilesByType.get(tile.terrain).push({ x: tile.x, y: tile.y });
    }
  }

  /** 找到距 (fromX,fromY) 最近的指定地形格 */
  nearestTerrainTile(fromX, fromY, terrainType) {
    this._ensureTerrainTilesIndex();
    const list = this._terrainTilesByType.get(terrainType);
    if (!list || list.length === 0) return null;
    let best = null, bestD = Infinity;
    for (const t of list) {
      const d = Math.abs(t.x - fromX) + Math.abs(t.y - fromY);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /**
   * 散修接/交悬赏的去处：优先悬赏阁(bounty_hall)，按任务类别可分流到坊市/镖行等，
   * 取最近一个中立机构总部坐标。参考凡人修仙传/完美世界「坊市悬赏榜、私人委托」设定。
   * @param {{x:number,y:number}|null} here
   * @param {string[]} [subtypes] 允许的机构 subtype，按优先级；默认悬赏阁+坊市
   * @returns {{x:number,y:number,orgId:string,orgName:string}|null}
   */
  _nearestBountyOrg(here, subtypes = ['bounty_hall', 'market']) {
    if (!here) return null;
    const orgs = this.entityRegistry.getByType('faction')
      .filter(f => f.alive && f.staticData?.headquarters && subtypes.includes(f.staticData?.subtype));
    // 先按 subtype 优先级，再按距离选最近
    let best = null, bestRank = Infinity, bestD = Infinity;
    for (const f of orgs) {
      const hq = f.staticData?.headquarters;
      if (!hq || typeof hq.x !== 'number') continue;
      const subtype = f.staticData?.subtype;
      const rank = subtypes.indexOf(subtype);
      const d = Math.abs(hq.x - here.x) + Math.abs(hq.y - here.y);
      if (rank < bestRank || (rank === bestRank && d < bestD)) {
        bestRank = rank; bestD = d;
        best = { x: hq.x, y: hq.y, orgId: f.id, orgName: f.name };
      }
    }
    return best;
  }

  /** 在势力列表中找距 here 最近的总部坐标 */
  _nearestHq(here, factions) {
    if (!here) return null;
    let best = null, bestD = Infinity;
    for (const f of factions) {
      const hq = f.staticData?.headquarters;
      if (!hq || typeof hq.x !== 'number') continue;
      const d = Math.abs(hq.x - here.x) + Math.abs(hq.y - here.y);
      if (d < bestD) { bestD = d; best = { x: hq.x, y: hq.y }; }
    }
    return best;
  }

  /** 在实体列表中找距 here 最近实体的坐标 */
  _nearestEntityPos(here, entities) {
    if (!here) return null;
    let best = null, bestD = Infinity;
    for (const e of entities) {
      const sp = e.spatial;
      if (!sp) continue;
      const d = Math.abs(sp.tileX - here.x) + Math.abs(sp.tileY - here.y);
      if (d < bestD) { bestD = d; best = { x: sp.tileX, y: sp.tileY }; }
    }
    return best;
  }

  /**
   * 游历目标：朝随机方向走到一段距离外的可通行野外点（不主动靠近妖兽）。
   * 在 [minDist, maxDist] 半径内随机采样若干次，取首个 gridGraph.isWalkable 的格子；
   * 无 gridGraph 或多次采样失败时回退到 here（原地游历，仍会正常结算机缘/风险）。
   */
  _randomWanderTarget(here, minDist = 6, maxDist = 16) {
    if (!here) return null;
    const g = this.gridGraph;
    if (!g || typeof g.isWalkable !== 'function') return here;
    const W = g.width || 0;
    const H = g.height || 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const dist = minDist + Math.floor(this.rng.next() * (maxDist - minDist + 1));
      const angle = this.rng.next() * Math.PI * 2;
      let x = Math.round(here.x + Math.cos(angle) * dist);
      let y = Math.round(here.y + Math.sin(angle) * dist);
      if (W > 0) x = Math.max(0, Math.min(W - 1, x));
      if (H > 0) y = Math.max(0, Math.min(H - 1, y));
      if (g.isWalkable(x, y)) return { x, y };
    }
    return here;
  }

  /**
   * 推进所有持有空间组件、且设置了移动目标的实体一 tick 的移动。
   * 行为耗时层（Agent B）通过 spatial.setDestination 触发移动，此处负责沿路径前进。
   */
  _tickMovement(worldContext) {
    const movers = [
      ...this.entityRegistry.getAliveByType('npc'),
      ...this.entityRegistry.getAliveByType('monster'),
    ];
    for (const entity of movers) {
      if (entity.hasSpatial && entity.hasSpatial() && entity.spatial.destination) {
        this.movementSystem.tickMove(entity);
      }
    }
  }

  /**
   * 冲突解决（责任链模式，当前为空实现）
   */
  _resolveConflicts(factions, worldContext) {
    return [];
  }

  /**
   * 更新势力间关系（自然衰减）
   */
  _updateRelations(factions, tickLog) {
    const combatCfg = this.balanceConfig.combat || {};
    const relDecayPos = combatCfg.relations?.decayThresholdPos ?? 60;
    const relDecayNeg = combatCfg.relations?.decayThresholdNeg ?? -60;

    for (const faction of factions) {
      if (!faction.alive) continue;
      const relations = faction.state.get('relations') || {};
      const updated = { ...relations };

      for (const [fId, rel] of Object.entries(updated)) {
        if (rel > 0 && rel < relDecayPos) {
          updated[fId] = Math.max(0, rel - 1);
        } else if (rel < 0 && rel > relDecayNeg) {
          updated[fId] = Math.min(0, rel + 1);
        }
      }

      faction.state.set('relations', updated);
    }
  }

  /**
   * 关系网便捷封装（ADR-027）：按 relationship.json eventBindings 在两实体间建/强化关系边。
   * 静默失败（无关系系统 / 未启用 / 缺参数时不报错），使各事件结算点接入零负担。
   * @param {string} eventType eventBindings 的键
   * @param {string} fromId
   * @param {string} toId
   */
  _applyRelationEvent(eventType, fromId, toId) {
    if (!this.relationshipSystem || !this.relationshipSystem.enabled) return;
    if (!fromId || !toId) return;
    this.relationshipSystem.applyEvent(eventType, fromId, toId, { tick: this.worldEntity.currentDay });
  }

  /** 直接建一条关系边（用于初始化/对称类型），同样静默失败。 */
  _addRelationEdge(fromId, toId, type, opts = {}) {
    if (!this.relationshipSystem || !this.relationshipSystem.enabled) return;
    if (!fromId || !toId) return;
    this.relationshipSystem.addEdge(fromId, toId, type, { tick: this.worldEntity.currentDay, ...opts });
  }

  _updateWorldStats() {
    const factions = this.entityRegistry.getByType('faction');
    const npcs = this.entityRegistry.getByType('npc');

    this.worldEntity.state.setMany({
      totalFactions: factions.length,
      aliveFactions: factions.filter(f => f.alive).length,
      totalNPCs: npcs.length,
      aliveNPCs: npcs.filter(n => n.alive).length,
    });
  }

  /** 查境界 order（cultivation 类）；找不到返回 0 */
  _rankOrderOf(rankId) {
    const r = this.ranksData.find(x => x.id === rankId);
    return r ? (r.order || 0) : 0;
  }

  /**
   * 解析某 NPC 的复仇对象实体（ADR-020）。
   * 优先取复仇执念锁定的 targetId（个人仇人），其次取个人恩怨图中仇恨最深者。
   * 仅返回仍在世且具备空间组件的目标，否则 null。
   * @param {Object} entity
   * @returns {Object|null}
   */
  _resolveRevengeTarget(entity) {
    if (!entity) return null;
    let targetId = null;
    const obs = entity.obsessions?.obsessions || [];
    // 复仇执念，以及夺舍图谋（ADR-029：邪修师傅夺徒，轻度复用击杀链）——均锁定 targetId 走 hunt/kill。
    const revenge = obs.find(o => (o.type === 'revenge' || o.type === 'seizure') && o.targetId);
    if (revenge) targetId = revenge.targetId;
    if (!targetId && entity.relationships?.topGrudge) {
      const top = entity.relationships.topGrudge();
      if (top) targetId = top.actorId;
    }
    // 关系复仇（ADR-028）：goalsEnabled 时，高强度 enemy 边（势力攻战结仇等）也可成为复仇目标。
    // 仅当强度达 npcGoals.relationRevenge.minEnemyStrength 门槛，避免轻微敌对即追杀。
    if (!targetId && this._relationGoalsEnabled() && this.relationshipSystem) {
      const minStrength = this.relationshipConfig?.npcGoals?.relationRevenge?.minEnemyStrength ?? 40;
      const topEnemy = this.relationshipSystem.topEdgeOfType(entity.id, 'enemy');
      if (topEnemy && topEnemy.strength >= minStrength) targetId = topEnemy.toId;
    }
    if (!targetId) return null;
    const target = this.entityRegistry.getById(targetId);
    if (!target || !target.alive) return null;
    if (!(target.hasSpatial && target.hasSpatial())) return null;
    return target;
  }

  /** 关系驱动决策总开关（ADR-028）：relationship.json goalsEnabled !== false 且数据层 enabled。 */
  _relationGoalsEnabled() {
    return this.relationshipConfig?.enabled !== false
      && this.relationshipConfig?.goalsEnabled !== false
      && !!this.relationshipSystem
      && this.relationshipSystem.enabled !== false;
  }

  /**
   * 夺职受辱记仇（ADR-020 阶段E）：被挑战者拉下职位的现任，记下对挑战者的『被贬』记忆并锁定 actor，
   * 使个人恩怨图累积仇恨，可触发对挑战者的复仇执念，形成宗门内部权斗叙事。
   * @param {?string} displacedNpcId 被拉下来的现任 id
   * @param {Object} challenger 挑战者实体
   */
  _recordDisplacementGrudge(displacedNpcId, challenger) {
    if (!displacedNpcId || !challenger) return;
    const displaced = this.entityRegistry.getById(displacedNpcId);
    if (!displaced || !displaced.alive || typeof displaced.recordMemory !== 'function') return;
    // 用 humiliated（含 grudgeGain）而非 demoted（无 actor 的考核降级），锁定挑战者为仇人。
    displaced.recordMemory('humiliated', {
      actorId: challenger.id,
      factionId: challenger.state?.get('factionId') ?? null,
      tick: this.worldEntity.currentDay,
    });
    // 关系网（ADR-027）：被夺职者对挑战者结『竞争』边（宗门内部权斗叙事）。
    this._applyRelationEvent('humiliated', displaced.id, challenger.id);
  }

  /**
   * NPC 战力（ADR-020）：用于复仇 PvP 胜负比拼。
   *   power = 境界 successionScore 基底 × (1 + qi 折算) × (1 - 伤势折损)
   * 法宝/功法加成预留（待对应系统接入），当前以境界为主、真气与伤势为修正。
   * @param {Object} npc
   * @returns {number}
   */
  _npcCombatPower(npc) {
    if (!npc || !npc.state) return 0;
    const rank = this.ranksData.find(r => r.id === npc.state.get('rankId'));
    const rankBase = rank ? (rank.successionScore ?? rank.order ?? 1) : 1;
    const qi = npc.state.get('qi') || 0;
    const injury = npc.state.get('injuryLevel') || 0;
    const qiFactor = 1 + Math.min(2, qi / 1000);
    const injuryFactor = Math.max(0.2, 1 - injury * 0.08);
    // 法宝加成（ADR-025）：已装备法宝的 combatBonus 提升战力。默认 NPC 无装备 → 系数 1。
    const artifactFactor = this._artifactCombatFactor(npc);
    return Math.max(0.01, (rankBase + 1) * qiFactor * injuryFactor * artifactFactor);
  }

  /** 已装备法宝的战力乘子（1 + combatBonus），无装备返回 1。 */
  _artifactCombatFactor(npc) {
    const artifactId = npc.state?.get('equippedArtifactId');
    if (!artifactId) return 1;
    const def = ItemRegistry.get(artifactId);
    const bonus = def?.properties?.combatBonus ?? def?.combatBonus ?? 0;
    return 1 + bonus;
  }

  /** 机会点选目标（ADR-024）：委托 InfoCoordinator。供 worldContext.resolveTarget 的 nearest_opportunity 分支调用。 */
  _bestOpportunityFor(entity) {
    return this.infoCoordinator.bestOpportunityFor(entity);
  }

  /** 事件→新闻/机会点（ADR-024）：委托 InfoCoordinator。保留转发以兼容直接调用方（如单测）。 */
  _spawnNewsFromEvents(tickLog, day, log) {
    return this.infoCoordinator.spawnNewsFromEvents(tickLog, day, log);
  }

  getTickHistory() {
    return this._tickResults;
  }

  getLatestTick() {
    return this._tickResults[this._tickResults.length - 1] || null;
  }
}
