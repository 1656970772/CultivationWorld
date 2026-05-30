/**
 * TickManager - Tick 编排器
 *
 * 中介者模式：协调世界、势力、NPC 的 Tick 执行顺序。
 * 模板方法模式：固定流程骨架。
 *
 * 战斗/贸易/结盟参数来自 data/balance/combat.json。
 * 社会/人口参数来自 data/balance/social.json。
 * 姓名池来自 data/definitions/names.json。
 */
import { NPCEntity } from '../npc/npc-entity.js';
import { MovementSystem } from './movement-system.js';
import { computePath } from './pathfinding.js';
import { BuildingType } from './layout-constants.js';
import { InfoPropagationSystem } from './info-propagation.js';
import { OpportunitySystem } from './opportunity.js';
import { NewsType, OpportunityType } from '../../core/constants.js';
import { ItemRegistry } from '../items/item-registry.js';
import {
  exchangeNews, syncSectNews, syncGuildNews, broadcastTownNews,
  computeAssetScore, settleRobbery, decideCovet,
} from '../npc/info-actions.js';

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
  constructor({ entityRegistry, worldEntity, questTemplates, tileIndex, terrainIndex, ranksData,
                balanceConfig, namesConfig, modifierTemplates, gameConfig, entityConfig,
                techniqueRegistry, monsterSpawner, monsterInitialCount, factionBuildings,
                gridGraph, hierGraph, worldNewsConfig, opportunityConfig, covetConfig }) {
    this.entityRegistry = entityRegistry;
    this.worldEntity = worldEntity;
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
    this.birthLog = [];
    this.companionLog = [];
    this.sectEventLog = [];

    // 信息传播 / 机会点 / 怀璧其罪系统（ADR-024/025）。默认 enabled=false 零漂移。
    this.covetConfig = covetConfig || {};
    this.infoSystem = new InfoPropagationSystem(worldNewsConfig || {});
    this.opportunitySystem = new OpportunitySystem(opportunityConfig || {});
    this._lastSectSyncDay = -1;
    this._lastGuildSyncDay = -1;
  }

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
      infoEvents: [],
      deaths: [],
      monsterDeaths: [],
    };

    this._attackedThisTick = new Set();
    const worldContext = this._buildWorldContext();

    // 1. 世界规则
    tickLog.worldRules = this.worldEntity.tick(worldContext);

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
    this._collectDeaths(tickLog);

    // 6c-2. 为本 tick 的 infoEvents（攻击/结盟/妖兽袭击）补坐标与地点名
    this._enrichInfoEvents(tickLog);

    // 6c-info. 信息传播 / 机会点 / 怀璧其罪系统（ADR-024/025）。默认 enabled=false 时全部静默。
    this._tickInfoSystems(tickLog, npcs, worldContext);

    // 6d. 妖兽种群补充（维持生态在目标数量附近，避免被清空 / 永不变化）
    this._respawnMonsters(tickLog);

    // 7. 更新世界统计
    this._updateWorldStats();

    // 8. 关系更新
    this._updateRelations(factions, tickLog);

    // 9. 道侣匹配
    const currentDay = this.worldEntity.currentDay;
    const socialCfg = this.balanceConfig.social || {};
    const companionInterval = socialCfg.daoCompanion?.matchIntervalDays ?? 60;
    if (currentDay > 0 && currentDay % companionInterval === 0) {
      this._matchDaoCompanions(worldContext, tickLog);
    }

    // 10. 生育
    const birthInterval = socialCfg.birth?.processIntervalDays ?? 90;
    if (currentDay > 0 && currentDay % birthInterval === 0) {
      this._processBirths(worldContext, tickLog);
    }

    // 11. 月度贡献考核 + 势力定时活动（门派考核/大比）+ 贡献晋升
    this._processMonthlyContribution(worldContext, tickLog, currentDay);
    this._processSectEvents(worldContext, tickLog, currentDay);
    this._processPromotions(worldContext, tickLog, currentDay);

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

  _buildWorldContext() {
    const self = this;
    const infoEvents = [];
    const combatCfg = this.balanceConfig.combat || {};
    const socialCfg = this.balanceConfig.social || {};

    // 从配置中读取战斗参数（有默认值保证向后兼容）
    const hostileThreshold = combatCfg.diplomacy?.hostileThreshold ?? -50;
    const alignmentHostileThreshold = combatCfg.diplomacy?.alignmentHostileThreshold ?? 0;
    const weakEnemyStability = combatCfg.diplomacy?.weakEnemyStabilityThreshold ?? 30;
    const weakEnemyDisciples = combatCfg.diplomacy?.weakEnemyDisciplesThreshold ?? 50;
    const maxTerritory = combatCfg.diplomacy?.maxTerritory ?? 50;
    const disciplesWeight = combatCfg.military?.disciplesWeight ?? 1.0;
    const territoryWeight = combatCfg.military?.territoryWeight ?? 10;
    const stabilityWeight = combatCfg.military?.stabilityWeight ?? 0.5;

    // 结盟参数
    const allyMinRel = combatCfg.alliance?.minRelation ?? 20;
    const allyMaxRel = combatCfg.alliance?.maxRelation ?? 60;
    const allyRelGain = combatCfg.alliance?.relationGain ?? 20;

    // 贸易参数
    const tradeStoneRatio = combatCfg.trade?.stoneRatio ?? 0.1;
    const tradeMaxAmount = combatCfg.trade?.maxTradeAmount ?? 200;
    const tradeFoodRate = combatCfg.trade?.foodExchangeRate ?? 2;
    const tradeRelGain = combatCfg.trade?.relationGain ?? 3;
    const tradeMinRel = combatCfg.trade?.minRelation ?? 20;

    // 攻击参数
    const attackerMult = combatCfg.attack?.attackerPowerMultiplier ?? 1.2;
    const attackerStabFactor = combatCfg.attack?.attackerStabilityFactor ?? 200;
    const defenderMult = combatCfg.attack?.defenderPowerMultiplier ?? 1.0;
    const defenderStabFactor = combatCfg.attack?.defenderStabilityFactor ?? 100;
    const winLootRatio = combatCfg.attack?.winLootRatio ?? 0.2;
    const winDefLoss = combatCfg.attack?.winDefenderDisciplineLossRatio ?? 0.08;
    const winDefMin = combatCfg.attack?.winDefenderMinDisciples ?? 5;
    const winDefStabLoss = combatCfg.attack?.winDefenderStabilityLoss ?? 15;
    const winAttLoss = combatCfg.attack?.winAttackerDisciplineLossRatio ?? 0.05;
    const winAttMin = combatCfg.attack?.winAttackerMinDisciples ?? 5;
    const winAttStabLoss = combatCfg.attack?.winAttackerStabilityLoss ?? 5;
    const loseAttLoss = combatCfg.attack?.loseAttackerDisciplineLossRatio ?? 0.10;
    const loseAttMin = combatCfg.attack?.loseAttackerMinDisciples ?? 5;
    const loseAttStabLoss = combatCfg.attack?.loseAttackerStabilityLoss ?? 10;
    const loseDefStabGain = combatCfg.attack?.loseDefenderStabilityGain ?? 5;
    const winRelChange = combatCfg.attack?.winRelationChange ?? -20;
    const loseRelChange = combatCfg.attack?.loseRelationChange ?? -10;
    const maxTerritoryPerFaction = combatCfg.attack?.maxTerritoryPerFaction ?? 20;

    // 关系衰减参数
    const relDecayPos = combatCfg.relations?.decayThresholdPos ?? 60;
    const relDecayNeg = combatCfg.relations?.decayThresholdNeg ?? -60;

    return {
      worldState: this.worldEntity.state,
      entityRegistry: this.entityRegistry,
      currentDay: this.worldEntity.currentDay,
      activeModifiers: this.worldEntity.activeModifiers,
      questTemplates: this.questTemplates || null,
      tileIndex: this.tileIndex,
      terrainIndex: this.terrainIndex,
      factionVeinOutput: this._calcFactionVeinOutput(),
      balanceConfig: this.balanceConfig,
      modifierTemplates: this.modifierTemplates,
      techniqueRegistry: this.techniqueRegistry,
      movementSystem: this.movementSystem,
      // 信息传播 / 机会点系统（ADR-024）：供 NPC 选目标层读取已知消息关联的机会点。
      infoSystem: this.infoSystem,
      opportunitySystem: this.opportunitySystem,

      /** NPC 战力（供机会/抢夺风险评估，复用势力战 _npcCombatPower）。 */
      npcCombatPower(npc) {
        return self._npcCombatPower(npc);
      },

      /**
       * 解析某 NPC 当前最值得前往的机会点（已知消息 → 机会点 → 价值/风险打分）。
       * 仅在机会系统 enabled 时有效；返回 { opp, score } 或 null。供 collectExtraGoals 与 nearest_opportunity 用。
       */
      bestOpportunityFor(entity) {
        return self._bestOpportunityFor(entity);
      },

      /** 便捷寻路：返回不含起点的路径或 null（启用 JPS / 远距离 HPA*） */
      computePath(from, to) {
        const manhattan = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        const useHier = self.hierGraph && manhattan > 96;
        return computePath(from, to, self.tileIndex, {
          terrainIndex: self.terrainIndex,
          graph: self.gridGraph,
          hier: useHier ? self.hierGraph : null,
        });
      },

      /** 找最近的某地形格 → {x,y}|null */
      nearestTerrainTile(fromX, fromY, terrainType) {
        return self.nearestTerrainTile(fromX, fromY, terrainType);
      },

      /** 查询势力建筑坐标 → {x,y}|null（委托引擎） */
      getFactionBuilding(factionId, buildingType, from = null) {
        return self.getFactionBuilding(factionId, buildingType, from);
      },

      /**
       * 解析为某散修发布/垫付悬赏的机构实体（最近的悬赏阁/坊市）。
       * 供散修交付悬赏时从机构库存扣除赏金。返回 FactionEntity|null。
       */
      _resolveBountyOrgFor(entity) {
        const sp = entity?.spatial;
        const here = sp ? { x: sp.tileX, y: sp.tileY } : null;
        const org = self._nearestBountyOrg(here);
        return org ? self.entityRegistry.getById(org.orgId) : null;
      },

      /**
       * 据任务类型的 locationTarget 解析任务发生地（接取任务时调用，锁定固定坐标）。
       * 返回 {x,y}|null。
       */
      resolveQuestLocation(entity, questType) {
        const sp = entity?.spatial;
        const here = sp ? { x: sp.tileX, y: sp.tileY } : null;
        const target = questType?.locationTarget || 'hq';

        if (target === 'hq') {
          const factionId = entity.state?.get('factionId');
          if (factionId) {
            const faction = self.entityRegistry.getById(factionId);
            const hq = faction?.staticData?.headquarters;
            return hq && typeof hq.x === 'number' ? { x: hq.x, y: hq.y } : here;
          }
          // 散修无本门：此类「驻守」型悬赏在悬赏阁/坊市附近完成
          const org = self._nearestBountyOrg(here);
          return org ? { x: org.x, y: org.y } : here;
        }
        if (target === 'monster') {
          const monsters = self.entityRegistry.getAliveByType('monster')
            .filter(m => m.hasSpatial && m.hasSpatial());
          return self._nearestEntityPos(here, monsters) || here;
        }
        if (target.startsWith('terrain:')) {
          const terrainType = target.slice('terrain:'.length);
          if (!here) return null;
          // 地形若全图不存在，回退到最近平原，再回退到原地，保证任务点可解析
          return self.nearestTerrainTile(here.x, here.y, terrainType)
            || self.nearestTerrainTile(here.x, here.y, 'plain')
            || here;
        }
        return here;
      },

      /**
       * 解析行为目标地点 → {x, y}
       * 供行为耗时层（Agent B）按 action.targetResolver 设置移动目标。
       * 支持：self / faction_hq / market / nearest_monster / nearest_faction_enemy_hq
       * 未识别的 resolver 返回实体当前位置（等价于原地行为）。
       */
      resolveTarget(entity, targetResolver) {
        const sp = entity?.spatial;
        const here = sp ? { x: sp.tileX, y: sp.tileY } : null;
        if (!targetResolver || targetResolver === 'self') return here;

        // 散修接/交悬赏：去最近的悬赏阁/坊市（无本门任务堂可用）
        if (targetResolver === 'quest_hall' && !entity.state?.get('factionId')) {
          const org = self._nearestBountyOrg(here);
          return org ? { x: org.x, y: org.y } : here;
        }

        switch (targetResolver) {
          case 'faction_hq':
          case 'main_hall':
          case 'quest_hall':
          case 'library':
          case 'alchemy':
          case 'training': {
            // 把 resolver 名映射到建筑类型；faction_hq 等价于主殿
            const buildingMap = {
              faction_hq: BuildingType.MAIN_HALL,
              main_hall: BuildingType.MAIN_HALL,
              quest_hall: BuildingType.QUEST_HALL,
              library: BuildingType.LIBRARY,
              alchemy: BuildingType.ALCHEMY,
              training: BuildingType.TRAINING,
            };
            const factionId = entity.state?.get('factionId');
            if (factionId) {
              const pos = self.getFactionBuilding(factionId, buildingMap[targetResolver], here);
              if (pos) return pos;
              // 回退：势力总部坐标
              const faction = self.entityRegistry.getById(factionId);
              const hq = faction?.staticData?.headquarters;
              if (hq && typeof hq.x === 'number') return { x: hq.x, y: hq.y };
            }
            // 无势力（散修）：去最近的中立机构（坊市）兑换相应服务
            const orgs = self.entityRegistry.getByType('faction')
              .filter(f => f.alive && f.staticData?.headquarters);
            return self._nearestHq(here, orgs) || here;
          }
          case 'market': {
            // 寻找类型为坊市/拍卖等的中立 org 势力总部，取最近一个
            const orgs = self.entityRegistry.getByType('faction')
              .filter(f => f.alive && f.staticData?.headquarters);
            return self._nearestHq(here, orgs) || here;
          }
          case 'nearest_monster': {
            const monsters = self.entityRegistry.getAliveByType('monster')
              .filter(m => m.hasSpatial && m.hasSpatial());
            return self._nearestEntityPos(here, monsters) || here;
          }
          case 'wander_far': {
            // 游历历练：朝随机方向走到一定距离的野外可通行点（不主动靠近妖兽）
            return self._randomWanderTarget(here) || here;
          }
          case 'quest_target': {
            // 接取任务时已锁定的固定坐标（见 NPCAcceptQuestExecutor）
            const qx = entity.state?.get('questTargetX');
            const qy = entity.state?.get('questTargetY');
            return (typeof qx === 'number' && typeof qy === 'number') ? { x: qx, y: qy } : here;
          }
          case 'revenge_target': {
            // 复仇行为链（ADR-020）：按执念锁定的仇人 / 个人恩怨图最深仇人定位坐标。
            const target = self._resolveRevengeTarget(entity);
            if (target && target.spatial) {
              return { x: target.spatial.tileX, y: target.spatial.tileY };
            }
            return here;
          }
          case 'nearest_opportunity': {
            // 机会点（ADR-024）：前往接取目标时锁定的机会点坐标（见 act_npc_goto_opportunity 选目标层）。
            const oppId = entity.state?.get('targetOpportunityId');
            if (oppId) {
              const o = self.opportunitySystem.getById(oppId);
              if (o) return { x: o.pos.x, y: o.pos.y };
            }
            // 回退：实时取最值得前往的机会点
            const pick = self._bestOpportunityFor(entity);
            if (pick) return { x: pick.opp.pos.x, y: pick.opp.pos.y };
            return here;
          }
          default:
            return here;
        }
      },

      getLeaderPersonality(npcId) {
        if (!npcId) return null;
        const npc = self.entityRegistry.getById(npcId);
        if (!npc || !npc.alive) return null;
        return npc.staticData?.get('personality') || null;
      },

      /** 复仇行为链（ADR-020）：解析某 NPC 的复仇对象实体（执念锁定优先，回退个人恩怨图）。 */
      resolveRevengeTarget(entity) {
        return self._resolveRevengeTarget(entity);
      },

      /** 复仇行为链（ADR-020）：计算 NPC 战力，供 PvP 胜负比拼。 */
      npcCombatPower(npc) {
        return self._npcCombatPower(npc);
      },

      checkAdjacentUnowned(territory) {
        if (!territory || territory.length === 0) return true;
        for (const key of territory) {
          const [x, y] = key.split(',').map(Number);
          for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
            const nx = x + dx, ny = y + dy;
            const neighbor = self.tileIndex.get(`${nx},${ny}`);
            if (neighbor && !neighbor.ownerId) return true;
          }
        }
        return false;
      },

      checkAdjacentEnemy(territory, relations, selfFactionId) {
        const selfFaction = selfFactionId ? self.entityRegistry.getById(selfFactionId) : null;
        const selfType = selfFaction?.factionType || '';

        for (const [fId, rel] of Object.entries(relations || {})) {
          const enemy = self.entityRegistry.getById(fId);
          if (!enemy || !enemy.alive) continue;

          let hostile = false;
          if (rel <= hostileThreshold) {
            hostile = true;
          } else if (rel <= alignmentHostileThreshold && selfType && enemy.factionType) {
            const enemyType = enemy.factionType;
            hostile =
              (selfType === 'righteous' && (enemyType === 'evil' || enemyType === 'demon')) ||
              ((selfType === 'evil' || selfType === 'demon') && enemyType === 'righteous');
          }
          if (!hostile) continue;

          // 地理邻接判定：双方领地存在相邻格，或总部距离较近，才算"够得着"
          if (self._factionsGeographicallyClose(selfFactionId, fId)) return true;
        }
        return false;
      },

      calculateBorderThreat(territory, relations) {
        let threat = 0;
        for (const [fId, rel] of Object.entries(relations || {})) {
          if (rel <= hostileThreshold) {
            const enemy = self.entityRegistry.getById(fId);
            if (enemy && enemy.alive) threat++;
          }
        }
        return threat;
      },

      checkWeakEnemy(relations) {
        for (const [fId, rel] of Object.entries(relations || {})) {
          if (rel <= hostileThreshold) {
            const enemy = self.entityRegistry.getById(fId);
            if (enemy && enemy.alive) {
              const stability = enemy.state?.get('stability') || 50;
              const disciples = enemy.inventory?.getAmount('disciples') || 0;
              if (stability < weakEnemyStability || disciples < weakEnemyDisciples) return true;
            }
          }
        }
        return false;
      },

      calculateMilitaryAdvantage(factionIdOrSnapshot) {
        let disciples, territoryCount, stability, factionId;

        if (typeof factionIdOrSnapshot === 'string') {
          factionId = factionIdOrSnapshot;
          const faction = self.entityRegistry.getById(factionId);
          if (!faction) return 0;
          disciples = faction.state.get('disciples') || 0;
          territoryCount = faction.state.get('territoryCount') || 0;
          stability = faction.state.get('stability') || 0;
        } else {
          const snap = factionIdOrSnapshot || {};
          disciples = snap.disciples || 0;
          territoryCount = snap.territoryCount || 0;
          stability = snap.stability || 0;
          factionId = null;
        }

        const allFactions = self.entityRegistry.getByType('faction')
          .filter(f => f.alive && (!factionId || f.id !== factionId));
        if (allFactions.length === 0) return 1;

        const myPower = disciples * disciplesWeight + territoryCount * territoryWeight + stability * stabilityWeight;
        const avgPower = allFactions.reduce((sum, f) => {
          const d = f.state.get('disciples') || 0;
          const t = f.state.get('territoryCount') || 0;
          const s = f.state.get('stability') || 0;
          return sum + d * disciplesWeight + t * territoryWeight + s * stabilityWeight;
        }, 0) / allFactions.length;

        return avgPower > 0 ? (myPower - avgPower) / avgPower : 0;
      },

      /**
       * 沿职位阶梯晋升一名 NPC（供"挑战上位"行为调用）。
       * 晋入稀缺顶层（elder/heir）时遵守"有空缺补位 / 满员则挑战现任、成功现任降一级"规则。
       * @returns {{ promoted:false }|{ promoted:string, fromRole:string, viaChallenge:boolean, displacedNpcId:?string }}
       */
      promoteByLadder(npcId) {
        const npc = self.entityRegistry.getById(npcId);
        if (!npc) return { promoted: false };
        const factionId = npc.state.get('factionId');
        const faction = factionId ? self.entityRegistry.getById(factionId) : null;
        const members = factionId
          ? self.entityRegistry.getAliveByType('npc').filter(n => n.state.get('factionId') === factionId)
          : [npc];
        const roleCounts = self._countRolesInFaction(factionId, members);
        const fromRole = npc.state.get('currentRole');
        npc._lastChallengeDisplaced = null;
        const promoted = self._promoteRole(npc, {
          roleCounts, faction, members, allowChallenge: true, checkQuota: false,
        });
        if (!promoted) return { promoted: false };
        const displaced = npc._lastChallengeDisplaced || null;
        npc._lastChallengeDisplaced = null;
        // 夺职受辱（ADR-020 阶段E）：被挑战拉下来的现任记下对挑战者的仇怨，可累积为复仇/野心执念。
        self._recordDisplacementGrudge(displaced, npc);
        if (factionId) {
          self.sectEventLog.push({
            day: self.worldEntity.currentDay, type: 'challenge_promote', factionId,
            npcId: npc.id, npcName: npc.name, fromRole, toRole: promoted,
            viaChallenge: !!displaced, displacedNpcId: displaced,
          });
        }
        return { promoted, fromRole, viaChallenge: !!displaced, displacedNpcId: displaced };
      },

      expandTerritory(factionId) {
        const faction = self.entityRegistry.getById(factionId);
        if (!faction) return { success: false };
        const territory = faction.state.get('territory') || [];
        if (territory.length === 0) {
          const hq = faction.staticData?.headquarters || {};
          const hqX = typeof hq.x === 'number' ? hq.x : 0;
          const hqY = typeof hq.y === 'number' ? hq.y : 0;
          for (const [dx, dy] of [[0,0],[0,1],[0,-1],[1,0],[-1,0]]) {
            const nx = hqX + dx, ny = hqY + dy;
            const nkey = `${nx},${ny}`;
            const tile = self.tileIndex.get(nkey);
            if (tile && !tile.ownerId) {
              tile.ownerId = factionId;
              faction.state.set('territory', [...territory, nkey]);
              return { success: true, tileKey: nkey };
            }
          }
          return { success: false, reason: '无可扩张的相邻格子' };
        }
        for (const key of territory) {
          const [x, y] = key.split(',').map(Number);
          for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
            const nx = x + dx, ny = y + dy;
            const nkey = `${nx},${ny}`;
            const tile = self.tileIndex.get(nkey);
            if (tile && !tile.ownerId) {
              tile.ownerId = factionId;
              faction.state.set('territory', [...territory, nkey]);
              return { success: true, tileKey: nkey };
            }
          }
        }
        return { success: false, reason: '无可扩张的相邻格子' };
      },

      attackEnemy(factionId) {
        const faction = self.entityRegistry.getById(factionId);
        if (!faction) return { success: false };
        const relations = faction.state.get('relations') || {};
        let targetId = null;
        let worstRelation = 0;
        for (const [fId, rel] of Object.entries(relations)) {
          if (rel < worstRelation) {
            const enemy = self.entityRegistry.getById(fId);
            // 仅攻击地理上够得着的敌对势力（领地相邻或总部足够近）
            if (enemy && enemy.alive && self._factionsGeographicallyClose(factionId, fId)) {
              worstRelation = rel;
              targetId = fId;
            }
          }
        }
        if (!targetId) return { success: false, description: '无可达的敌对势力可攻击' };

        if (self._attackedThisTick && self._attackedThisTick.has(targetId)) {
          return { success: false, description: '目标本轮已遭受攻击' };
        }
        if (self._attackedThisTick) self._attackedThisTick.add(targetId);

        const target = self.entityRegistry.getById(targetId);
        // 资源以 state 为单一真相源（与 faction-actions 约定一致）：读写一律走 state，
        // 避免 onPostTick 用 state 覆盖 inventory 导致战果（掠夺/伤亡）丢失。
        const attackerDisciples = faction.state.get('disciples') || 0;
        const defenderDisciples = target.state.get('disciples') || 0;
        const attackerStability = faction.state.get('stability') || 50;
        const defenderStability = target.state.get('stability') || 50;

        const attackerPower = attackerDisciples * attackerMult * (1 + attackerStability / attackerStabFactor);
        const defenderPower = defenderDisciples * defenderMult * (1 + defenderStability / defenderStabFactor);
        const success = attackerPower > defenderPower;

        if (success) {
          const loot = Math.floor((target.state.get('low_spirit_stone') || 0) * winLootRatio);
          target.state.set('low_spirit_stone', Math.max(0, (target.state.get('low_spirit_stone') || 0) - loot));
          faction.state.set('low_spirit_stone', (faction.state.get('low_spirit_stone') || 0) + loot);

          const defenderLoss = Math.floor(defenderDisciples * winDefLoss);
          const defenderAfter = Math.max(winDefMin, defenderDisciples - defenderLoss);
          target.state.set('disciples', defenderAfter);
          target.state.set('stability', Math.max(0, (target.state.get('stability') || 50) - winDefStabLoss));

          const attackerLoss = Math.floor(attackerDisciples * winAttLoss);
          const attackerAfter = Math.max(winAttMin, attackerDisciples - attackerLoss);
          faction.state.set('disciples', attackerAfter);
          faction.state.set('stability', Math.max(0, attackerStability - winAttStabLoss));

          const attackerTerritory = faction.state.get('territoryCount') || 0;
          const defenderTerritory = target.state.get('territoryCount') || 0;
          if (defenderTerritory > 0 && attackerTerritory < maxTerritoryPerFaction) {
            faction.state.set('territoryCount', attackerTerritory + 1);
            target.state.set('territoryCount', defenderTerritory - 1);
          }

          const fRel = faction.state.get('relations') || {};
          fRel[targetId] = Math.max(-100, (fRel[targetId] || 0) + winRelChange);
          faction.state.set('relations', { ...fRel });

          const tRel = target.state.get('relations') || {};
          tRel[factionId] = Math.max(-100, (tRel[factionId] || 0) + winRelChange);
          target.state.set('relations', { ...tRel });
        } else {
          const attackerLoss = Math.floor(attackerDisciples * loseAttLoss);
          const attackerAfter = Math.max(loseAttMin, attackerDisciples - attackerLoss);
          faction.inventory.remove('disciples', attackerDisciples - attackerAfter);
          faction.state.set('stability', Math.max(0, attackerStability - loseAttStabLoss));

          target.state.set('stability', Math.min(100, (target.state.get('stability') || 50) + loseDefStabGain));

          const fRel = faction.state.get('relations') || {};
          fRel[targetId] = Math.max(-100, (fRel[targetId] || 0) + loseRelChange);
          faction.state.set('relations', { ...fRel });

          const tRel = target.state.get('relations') || {};
          tRel[factionId] = Math.max(-100, (tRel[factionId] || 0) + loseRelChange);
          target.state.set('relations', { ...tRel });
        }

        target.state.set('underAttack', true);

        this.infoEvents.push({
          type: 'attack',
          day: self.worldEntity.currentDay,
          attackerId: factionId,
          attackerName: faction.name,
          targetId,
          targetName: target.name,
          success,
          description: success
            ? `${faction.name} 攻击 ${target.name} 并胜利`
            : `${faction.name} 攻击 ${target.name} 失败`,
        });

        return {
          success,
          targetId,
          targetName: target.name,
          description: success ? `成功攻击了 ${target.name}` : `攻击 ${target.name} 失败`,
        };
      },

      formAlliance(factionId) {
        const faction = self.entityRegistry.getById(factionId);
        if (!faction) return { success: false };
        const relations = faction.state.get('relations') || {};
        let bestId = null;
        let bestRelation = allyMinRel;
        for (const [fId, rel] of Object.entries(relations)) {
          if (rel > bestRelation && rel < allyMaxRel) {
            const candidate = self.entityRegistry.getById(fId);
            if (candidate && candidate.alive) {
              bestRelation = rel;
              bestId = fId;
            }
          }
        }
        if (!bestId) return { success: false, description: '无合适的结盟对象' };

        const ally = self.entityRegistry.getById(bestId);
        const fRel = faction.state.get('relations') || {};
        fRel[bestId] = Math.min(100, (fRel[bestId] || 0) + allyRelGain);
        faction.state.set('relations', { ...fRel });

        const aRel = ally.state.get('relations') || {};
        aRel[factionId] = Math.min(100, (aRel[factionId] || 0) + allyRelGain);
        ally.state.set('relations', { ...aRel });

        this.infoEvents.push({
          type: 'alliance',
          day: self.worldEntity.currentDay,
          factionId,
          factionName: faction.name,
          allyId: bestId,
          allyName: ally.name,
          description: `${faction.name} 与 ${ally.name} 结盟`,
        });

        return { success: true, allyId: bestId, allyName: ally.name };
      },

      conductTrade(factionId) {
        const faction = self.entityRegistry.getById(factionId);
        if (!faction) return { success: false };

        const allFactions = self.entityRegistry.getByType('faction')
          .filter(f => f.alive && f.id !== factionId);
        const relations = faction.state.get('relations') || {};

        let bestPartner = null;
        let bestRelation = tradeMinRel;
        for (const f of allFactions) {
          const rel = relations[f.id] || 0;
          if (rel > bestRelation) {
            bestRelation = rel;
            bestPartner = f;
          }
        }

        if (!bestPartner) {
          return { success: false, description: '无合适贸易伙伴' };
        }

        const myStone = faction.inventory.getAmount('low_spirit_stone');
        const tradeAmount = Math.min(Math.floor(myStone * tradeStoneRatio), tradeMaxAmount);
        if (tradeAmount <= 0) return { success: false, description: '灵石不足以贸易' };

        faction.inventory.remove('low_spirit_stone', tradeAmount);
        faction.inventory.add('food', tradeAmount * tradeFoodRate);
        bestPartner.inventory.add('low_spirit_stone', tradeAmount);
        const partnerFood = bestPartner.inventory.getAmount('food');
        bestPartner.inventory.remove('food', Math.min(tradeAmount * tradeFoodRate, partnerFood));

        const fRel = { ...relations };
        fRel[bestPartner.id] = Math.min((fRel[bestPartner.id] || 0) + tradeRelGain, 100);
        faction.state.set('relations', fRel);

        const pRel = { ...(bestPartner.state.get('relations') || {}) };
        pRel[factionId] = Math.min((pRel[factionId] || 0) + tradeRelGain, 100);
        bestPartner.state.set('relations', pRel);

        return {
          success: true,
          partnerId: bestPartner.id,
          partnerName: bestPartner.name,
          tradeAmount,
          description: `与 ${bestPartner.name} 完成贸易`,
        };
      },

      infoEvents,

      // 关系衰减阈值（供 _updateRelations 使用）
      _relDecayPos: relDecayPos,
      _relDecayNeg: relDecayNeg,
    };
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
   * 统一收集本 tick 发生的死亡，写入 tickLog.deaths / monsterDeaths。
   * 通过实体上的 _deathInfo（含 cause）与 _deathLogged 标记避免重复。
   * 死亡同时带上发生坐标与地点名，供位置事件日志使用。
   */
  _collectDeaths(tickLog) {
    for (const npc of this.entityRegistry.getByType('npc')) {
      if (npc.alive) continue;
      if (npc._deathLogged) continue;
      const info = npc._deathInfo || {};
      const pos = this._entityPos(npc);
      tickLog.deaths.push({
        npcId: npc.id,
        npcName: info.npcName || npc.name,
        cause: info.cause || 'unknown',
        factionId: info.factionId ?? npc.state?.get('factionId') ?? null,
        rankName: info.rankName || npc.state?.get('rankName') || '',
        ageYears: info.ageYears ?? npc.state?.get('ageYears'),
        maxAgeYears: info.maxAgeYears ?? npc.state?.get('maxAgeYears'),
        monsterName: info.monsterName || null,
        monsterGrade: info.monsterGrade || null,
        questName: info.questName || null,
        x: pos?.x ?? null,
        y: pos?.y ?? null,
        locationName: pos ? this._resolveLocationName(pos.x, pos.y) : null,
      });

      // 记忆：道侣陨落（ADR-019）。在世道侣记下这段刻骨之痛，可触发"复活/复仇"执念。
      const companionId = npc.state?.get('daoCompanionId');
      if (companionId) {
        const companion = this.entityRegistry.getById(companionId);
        if (companion && companion.alive && typeof companion.recordMemory === 'function') {
          companion.recordMemory('companion_lost', {
            actorId: info.killerId || null,
            factionId: info.killerFactionId || null,
            tick: this.worldEntity.currentDay,
            location: pos ? { x: pos.x, y: pos.y } : null,
          });
        }
      }

      npc._deathLogged = true;
    }
    for (const monster of this.entityRegistry.getByType('monster')) {
      if (monster.alive) continue;
      if (monster._deathLogged) continue;
      const info = monster._deathInfo || {};
      const pos = this._entityPos(monster);
      tickLog.monsterDeaths.push({
        monsterId: monster.id,
        monsterName: info.monsterName || monster.name,
        grade: monster.grade,
        cause: info.cause || 'unknown',
        killerName: info.killerName || null,
        ageYears: info.ageYears ?? null,
        maxAgeYears: info.maxAgeYears ?? null,
        x: pos?.x ?? null,
        y: pos?.y ?? null,
        locationName: pos ? this._resolveLocationName(pos.x, pos.y) : null,
      });
      monster._deathLogged = true;
    }
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

  /**
   * 为 infoEvents（攻击/结盟/妖兽袭击）补坐标与地点名，使其成为位置事件。
   * - attack/alliance：取发起方势力总部坐标
   * - monster_attack：取妖兽当前坐标（其次 NPC 坐标）
   */
  _enrichInfoEvents(tickLog) {
    const events = tickLog.infoEvents || [];
    for (const evt of events) {
      if (typeof evt.x === 'number' && typeof evt.y === 'number') continue;
      let pos = null;
      if (evt.type === 'attack' || evt.type === 'alliance') {
        const originId = evt.attackerId || evt.factionId;
        const origin = originId ? this.entityRegistry.getById(originId) : null;
        const hq = origin?.staticData?.headquarters;
        if (hq && typeof hq.x === 'number') pos = { x: hq.x, y: hq.y };
      } else if (evt.type === 'monster_attack') {
        const monster = evt.monsterId ? this.entityRegistry.getById(evt.monsterId) : null;
        const npc = evt.npcId ? this.entityRegistry.getById(evt.npcId) : null;
        pos = this._entityPos(monster) || this._entityPos(npc);
      }
      if (pos) {
        evt.x = pos.x; evt.y = pos.y;
        evt.locationName = evt.locationName || this._resolveLocationName(pos.x, pos.y);
      }
    }
  }

  /**
   * 信息传播 / 机会点 / 怀璧其罪 统一推进（ADR-024/025）。
   * 顺序：① 事件→新闻+机会点 ② 多渠道传播 ③ 怀璧其罪暴露与觊觎 ④ 系统 tick（扩散/过期）。
   * 所有产物写入 tickLog.infoEvents（沿用现有日志通道）。默认配置下 enabled=false，整体静默。
   */
  _tickInfoSystems(tickLog, npcs, worldContext) {
    const day = this.worldEntity.currentDay;
    const info = this.infoSystem;
    const opp = this.opportunitySystem;
    const covetCfg = this.covetConfig || {};
    if (!info.enabled && !opp.enabled && covetCfg.enabled !== true) return;

    const log = tickLog.infoEvents;
    const powerFn = (n) => this._npcCombatPower(n);

    // ① 事件 → 新闻 + 机会点
    if (info.enabled || opp.enabled) {
      this._spawnNewsFromEvents(tickLog, day, log);
    }

    // ② 多渠道传播（口耳 / 宗门 / 商会 / 城镇）
    if (info.enabled) {
      this._propagateChannels(npcs, day, log);
    }

    // ③ 怀璧其罪：暴露 + 觊觎抢夺
    if (covetCfg.enabled === true) {
      this._tickCovet(npcs, day, log, powerFn);
    }

    // ④ 系统每日推进：新闻半径扩散 + 过期；机会点过期
    if (info.enabled) {
      const spreadLog = info.tick({ currentDay: day, npcs });
      for (const e of spreadLog) log.push(e);
    }
    if (opp.enabled) {
      const expireLog = opp.tick(day);
      for (const e of expireLog) log.push(e);
    }
  }

  /**
   * 把本 tick 的世界事件转化为 WorldNews（+ 关联 WorldOpportunity）。
   * 妖王陨落→尸骸机会；秘境开启→入口机会；宗门大战→战报；拍卖（暂无源，预留）。
   */
  _spawnNewsFromEvents(tickLog, day, log) {
    const info = this.infoSystem;
    const opp = this.opportunitySystem;

    // 妖王陨落（高阶妖兽死亡）→ monster_king_death + 尸骸机会
    for (const md of (tickLog.monsterDeaths || [])) {
      if ((md.grade ?? 0) < 3) continue; // 仅高阶妖兽视为"妖王"
      if (typeof md.x !== 'number') continue;
      let oppId = null;
      if (opp.enabled) {
        const o = opp.spawn({ type: OpportunityType.MONSTER_CORPSE, pos: { x: md.x, y: md.y }, currentDay: day });
        oppId = o?.id ?? null;
      }
      const news = info.publishNews({
        type: NewsType.MONSTER_KING_DEATH, origin: { x: md.x, y: md.y }, day,
        value: opp.typeConfig(OpportunityType.MONSTER_CORPSE).value ?? 600,
        opportunityId: oppId,
        text: `${md.monsterName || '妖王'}陨落于${md.locationName || '荒野'}，遗下机缘`,
      });
      if (news) log.push({ type: 'news_born', newsType: news.type, newsId: news.id, x: md.x, y: md.y, day, description: news.text });
    }

    // 秘境开启（本 tick 新生成的 secret_realm 修正器）→ secret_realm_open + 入口机会
    const wr = tickLog.worldRules;
    const newMod = wr?.modifier;
    if (newMod && /secret_realm|秘境/.test(`${newMod.id} ${newMod.name}`)) {
      const here = this._secretRealmPos();
      if (here) {
        let oppId = null;
        if (opp.enabled) {
          const o = opp.spawn({ type: OpportunityType.SECRET_REALM, pos: here, currentDay: day });
          oppId = o?.id ?? null;
        }
        const news = info.publishNews({
          type: NewsType.SECRET_REALM_OPEN, origin: here, day,
          value: opp.typeConfig(OpportunityType.SECRET_REALM).value ?? 1000,
          opportunityId: oppId,
          text: `${newMod.name || '秘境'}开启，引动天地灵机`,
        });
        if (news) log.push({ type: 'news_born', newsType: news.type, newsId: news.id, x: here.x, y: here.y, day, description: news.text });
      }
    }

    // 宗门大战（本 tick 的攻击事件）→ faction_war 战报（不生成机会点）
    for (const evt of (tickLog.infoEvents || [])) {
      if (evt.type !== 'attack' || typeof evt.x !== 'number' || evt._newsPublished) continue;
      evt._newsPublished = true;
      const news = info.publishNews({
        type: NewsType.FACTION_WAR, origin: { x: evt.x, y: evt.y }, day,
        value: 0, text: evt.description || '宗门交锋',
      });
      if (news) log.push({ type: 'news_born', newsType: news.type, newsId: news.id, x: evt.x, y: evt.y, day, description: news.text });
    }
  }

  /**
   * 为某 NPC 评估其已知消息关联的机会点，返回得分最高且可行的一个（ADR-024 决策层）。
   * 得分 = value × reliability × winChance − 路程折损。低于 decision.minScore 返回 null。
   * @returns {{ opp:import('./opportunity.js').WorldOpportunity, score:number }|null}
   */
  _bestOpportunityFor(entity) {
    const opp = this.opportunitySystem;
    if (!opp.enabled || !entity?._knownNews || !entity.spatial) return null;
    const day = this.worldEntity.currentDay;
    const decision = opp.decision;
    const distCost = decision.distanceCostPerTile ?? 0.3;
    const minScore = decision.minScore ?? 50;
    const here = { x: entity.spatial.tileX, y: entity.spatial.tileY };
    const myPower = this._npcCombatPower(entity);

    let best = null, bestScore = -Infinity;
    for (const [, entry] of entity._knownNews) {
      if (!entry.opportunityId) continue;
      const o = opp.getById(entry.opportunityId);
      if (!o || !o.isOpen(day)) continue;
      // 怀璧其罪类机会点不走通用前往逻辑（由 _tickCovet 处理抢夺）。
      if (o.type === OpportunityType.WEALTH_TARGET) continue;
      // 风险：以机会点风险键近似为"境界/战力"门槛——战力越低，命中风险价值折损越大。
      const winFactor = Math.max(0.05, Math.min(1, myPower / 10));
      const dist = Math.abs(o.pos.x - here.x) + Math.abs(o.pos.y - here.y);
      const score = o.value * entry.reliability * winFactor - dist * distCost;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (best && bestScore >= minScore) {
      return { opp: best, score: bestScore };
    }
    return null;
  }

  /** 取一个秘境入口坐标（地图上最近的高/顶级灵脉格，回退世界中心）。 */
  _secretRealmPos() {
    const cx = Math.floor((this.worldEntity.state.get('width') || 300) / 2);
    const cy = Math.floor((this.worldEntity.state.get('height') || 300) / 2);
    return this.nearestTerrainTile(cx, cy, 'top_spirit_vein')
      || this.nearestTerrainTile(cx, cy, 'high_spirit_vein')
      || { x: cx, y: cy };
  }

  /** 多渠道传播：口耳相传 / 宗门情报网 / 商会情报网 / 城镇广播。 */
  _propagateChannels(npcs, day, log) {
    const info = this.infoSystem;
    const belief = info.defaultBeliefThreshold;

    // 口耳相传：相遇（曼哈顿距离 < meetDistance）的 NPC 互传消息。O(n²) 仅在 enabled 时执行。
    if (info.channelEnabled('oral')) {
      const cfg = info.channelConfig('oral');
      const d = cfg.meetDistance ?? 2;
      for (let i = 0; i < npcs.length; i++) {
        const a = npcs[i];
        if (!a.spatial) continue;
        for (let j = i + 1; j < npcs.length; j++) {
          const b = npcs[j];
          if (!b.spatial) continue;
          if (Math.abs(a.spatial.tileX - b.spatial.tileX) + Math.abs(a.spatial.tileY - b.spatial.tileY) > d) continue;
          exchangeNews(a, b, cfg, day, belief);
        }
      }
    }

    // 宗门 / 商会情报网：按 factionId 分组，按 syncInterval 周期同步。
    const byFaction = new Map();
    for (const npc of npcs) {
      const fid = npc.state?.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }
    const sectCfg = info.channelConfig('sect');
    const guildCfg = info.channelConfig('guild');
    const sectInterval = sectCfg.syncIntervalDays ?? 5;
    const guildInterval = guildCfg.syncIntervalDays ?? 3;
    const doSect = info.channelEnabled('sect') && day - this._lastSectSyncDay >= sectInterval;
    const doGuild = info.channelEnabled('guild') && day - this._lastGuildSyncDay >= guildInterval;
    if (doSect) this._lastSectSyncDay = day;
    if (doGuild) this._lastGuildSyncDay = day;
    for (const [fid, members] of byFaction) {
      const faction = this.entityRegistry.getById(fid);
      const isGuild = faction?.staticData?.type === 'mortal_kingdom' || /org_|商会|坊市/.test(fid);
      if (isGuild) {
        if (doGuild) syncGuildNews(members, guildCfg, day);
      } else if (doSect) {
        syncSectNews(members, sectCfg, day);
      }
    }

    // 城镇广播：进入有 HQ 的机构格的 NPC 获得近期热门消息。
    if (info.channelEnabled('town')) {
      const townCfg = info.channelConfig('town');
      const recent = this._recentHotNews(day, townCfg);
      if (recent.length > 0) {
        for (const npc of npcs) {
          if (!npc.spatial) continue;
          if (!this._isAtTown(npc.spatial.tileX, npc.spatial.tileY)) continue;
          broadcastTownNews(npc, recent, townCfg, day, belief);
        }
      }
    }
  }

  /** 近期热门新闻（按重要性排序，截断 maxBroadcast 条）。 */
  _recentHotNews(day, townCfg) {
    const recentDays = townCfg.recentDays ?? 30;
    const max = townCfg.maxBroadcast ?? 5;
    return this.infoSystem.activeNews
      .filter(n => day - n.day <= recentDays)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, max);
  }

  /** 某坐标是否位于某机构 HQ（坊市/酒馆视为城镇）。 */
  _isAtTown(x, y) {
    for (const f of this.entityRegistry.getByType('faction')) {
      const hq = f.staticData?.headquarters;
      if (hq && Math.abs(hq.x - x) <= 1 && Math.abs(hq.y - y) <= 1) return true;
    }
    return false;
  }

  /** 怀璧其罪：暴露高身家 → 生成消息 + 机会点；听闻者觊觎抢夺/放过。 */
  _tickCovet(npcs, day, log, powerFn) {
    const covetCfg = this.covetConfig;
    const exposeCfg = covetCfg.expose || {};
    const threshold = exposeCfg.exposeThreshold ?? 500;
    const witnessD = exposeCfg.witnessDistance ?? 3;
    const exposeChance = exposeCfg.exposeChancePerDay ?? 0.15;

    // 1) 暴露：高身家 NPC 周围有目击者且概率命中 → wealth_exposed 消息 + wealth_target 机会点
    for (const npc of npcs) {
      if (!npc.spatial) continue;
      const asset = computeAssetScore(npc, this.techniqueRegistry);
      if (asset < threshold) continue;
      npc._assetScore = asset;
      if (npc._wealthExposed) continue;
      if (Math.random() >= exposeChance) continue;
      // 附近是否有目击者
      let witnessed = false;
      for (const other of npcs) {
        if (other.id === npc.id || !other.spatial) continue;
        if (Math.abs(other.spatial.tileX - npc.spatial.tileX) + Math.abs(other.spatial.tileY - npc.spatial.tileY) <= witnessD) {
          witnessed = true; break;
        }
      }
      if (!witnessed) continue;
      npc._wealthExposed = true;
      let oppId = null;
      if (this.opportunitySystem.enabled) {
        const o = this.opportunitySystem.spawn({
          type: OpportunityType.WEALTH_TARGET, pos: { x: npc.spatial.tileX, y: npc.spatial.tileY },
          currentDay: day, value: asset, subjectId: npc.id,
        });
        oppId = o?.id ?? null;
      }
      const news = this.infoSystem.publishNews({
        type: NewsType.WEALTH_EXPOSED, origin: { x: npc.spatial.tileX, y: npc.spatial.tileY }, day,
        value: asset, subjectId: npc.id, opportunityId: oppId,
        text: `${npc.staticData.name} 身怀重宝（估值${asset}）的消息不胫而走`,
      });
      if (news) log.push({ type: 'wealth_exposed', newsId: news?.id, npcId: npc.id, npcName: npc.name, assetScore: asset, x: npc.spatial.tileX, y: npc.spatial.tileY, day, description: news.text });
    }

    // 2) 觊觎：知晓 wealth_exposed 消息的 NPC 评估抢夺/放过（每个目标每 tick 至多一次抢夺）
    const robbedThisTick = new Set();
    for (const seeker of npcs) {
      if (!seeker.alive || !seeker._knownNews) continue;
      for (const [, entry] of seeker._knownNews) {
        if (entry.type !== NewsType.WEALTH_EXPOSED || !entry.subjectId) continue;
        if (robbedThisTick.has(entry.subjectId)) continue;
        const target = this.entityRegistry.getById(entry.subjectId);
        if (!target || !target.alive || target.id === seeker.id) continue;
        const asset = target._assetScore ?? computeAssetScore(target, this.techniqueRegistry);
        const decision = decideCovet(seeker, target, asset, covetCfg, powerFn);
        if (decision.spare) {
          log.push({ type: 'covet_spare', seekerId: seeker.id, seekerName: seeker.name, targetId: target.id, targetName: target.name, day, description: `${seeker.staticData.name} 顾念情面，放过了怀宝的 ${target.staticData?.name || target.id}` });
          continue;
        }
        if (!decision.act) continue;
        // 距离限制：仅当 seeker 已在 target 附近才动手（否则视为"得知后伺机"，本版简化为就近抢）
        if (seeker.spatial && target.spatial) {
          const dist = Math.abs(seeker.spatial.tileX - target.spatial.tileX) + Math.abs(seeker.spatial.tileY - target.spatial.tileY);
          if (dist > 6) continue;
        }
        const result = settleRobbery(seeker, target, covetCfg, powerFn);
        robbedThisTick.add(target.id);
        target._wealthExposed = false;
        // 抢夺结仇（被抢者记仇）
        if (typeof target.recordMemory === 'function') {
          target.recordMemory('humiliated', { actorId: seeker.id, tick: day, location: target.spatial ? { x: target.spatial.tileX, y: target.spatial.tileY } : null });
        }
        log.push({ type: 'covet_rob', seekerId: seeker.id, seekerName: seeker.name, targetId: target.id, targetName: target.name, success: result.success, killed: result.killed, day, x: seeker.spatial?.tileX ?? null, y: seeker.spatial?.tileY ?? null, description: result.description });
      }
    }
  }

  /**
   * 妖兽种群补充：存活数低于目标比例时，每 tick 最多补充若干只，
   * 让妖兽总数在猎杀/反杀/自然死亡下保持动态波动而非固定不变。
   */
  _respawnMonsters(tickLog) {
    if (!this.monsterSpawner) return;
    const popCfg = this.monsterSpawner.cfg?.population || {};
    if (!popCfg.respawnEnabled) return;

    const alive = this.entityRegistry.getAliveByType('monster').length;
    const target = Math.floor(this.monsterInitialCount * (popCfg.respawnTargetRatio ?? 0.85));
    if (alive >= target) return;

    const maxPerTick = popCfg.respawnPerTickMax ?? 2;
    let added = 0;
    for (let i = 0; i < maxPerTick && alive + added < target; i++) {
      const m = this.monsterSpawner.spawnOne();
      if (!m) break;
      this.entityRegistry.register(m);
      added++;
    }
    if (added > 0) {
      tickLog.monsterRespawned = (tickLog.monsterRespawned || 0) + added;
    }
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
      const dist = minDist + Math.floor(Math.random() * (maxDist - minDist + 1));
      const angle = Math.random() * Math.PI * 2;
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

  /**
   * 道侣匹配 - 同门或友好势力间的修士结为道侣
   */
  _matchDaoCompanions(worldContext, tickLog) {
    const socialCfg = this.balanceConfig.social || {};
    const companionCfg = socialCfg.daoCompanion || {};

    const minAge = companionCfg.minAgeYears ?? 20;
    const maxLifeRatio = companionCfg.maxLifeRatio ?? 0.8;
    const maxRankDiff = companionCfg.maxRankDiff ?? 1;
    const sameFactionBonus = companionCfg.sameFactionScoreBonus ?? 20;
    const baseScore = companionCfg.baseScore ?? 10;
    const ageDiffScoreRange = companionCfg.ageDiffScoreRange ?? 10;
    const ageDiffScaleFactor = companionCfg.ageDiffScaleFactor ?? 10;
    const successRate = companionCfg.matchSuccessRate ?? 0.15;

    const npcs = this.entityRegistry.getAliveByType('npc');
    const singles = npcs.filter(n =>
      !n.state.get('daoCompanionId') &&
      n.state.get('ageYears') >= minAge &&
      n.state.get('lifeRatio') < maxLifeRatio
    );

    const males = singles.filter(n => n.state.get('gender') === 'male');
    const females = singles.filter(n => n.state.get('gender') === 'female');

    const RANK_ORDER = {
      mortal: 0, disciple: 0, qi_refining: 1,
      foundation_building: 2, golden_core: 3,
      nascent_soul: 4, spirit_transformation: 5,
    };

    const matched = new Set();
    const pairs = [];

    for (const m of males) {
      if (matched.has(m.id)) continue;
      const mFaction = m.state.get('factionId');
      const mRankOrder = RANK_ORDER[m.state.get('rankId')] ?? 0;

      let bestMatch = null;
      let bestMatchScore = -1;

      for (const f of females) {
        if (matched.has(f.id)) continue;
        const fFaction = f.state.get('factionId');
        const fRankOrder = RANK_ORDER[f.state.get('rankId')] ?? 0;

        if (Math.abs(mRankOrder - fRankOrder) > maxRankDiff) continue;

        let score = baseScore;
        if (mFaction === fFaction) score += sameFactionBonus;

        const ageDiff = Math.abs(m.state.get('ageYears') - f.state.get('ageYears'));
        score += Math.max(0, ageDiffScoreRange - ageDiff / ageDiffScaleFactor);

        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatch = f;
        }
      }

      if (bestMatch && Math.random() < successRate) {
        m.state.set('daoCompanionId', bestMatch.id);
        bestMatch.state.set('daoCompanionId', m.id);
        matched.add(m.id);
        matched.add(bestMatch.id);
        const entry = {
          day: this.worldEntity.currentDay,
          npc1Id: m.id, npc1Name: m.name,
          npc2Id: bestMatch.id, npc2Name: bestMatch.name,
          faction: m.state.get('factionId'),
        };
        pairs.push(entry);
        this.companionLog.push(entry);
      }
    }

    for (const p of pairs) {
      const m = this.entityRegistry.getById(p.npc1Id);
      this._emitLocationEvent(tickLog, { type: 'dao_companion', entity: m, ...p });
    }
  }

  /**
   * 生育系统 - 道侣有机会诞生后代 NPC
   */
  _processBirths(worldContext, tickLog) {
    const socialCfg = this.balanceConfig.social || {};
    const birthCfg = socialCfg.birth || {};

    const successRate = birthCfg.successRate ?? 0.20;
    const maxChildren = birthCfg.maxChildren ?? 3;
    const motherMaxLifeRatio = birthCfg.motherMaxLifeRatio ?? 0.7;
    const fatherWeight = birthCfg.childPersonalityFatherWeight ?? 0.5;
    const motherWeight = birthCfg.childPersonalityMotherWeight ?? 0.5;
    const loyaltyBase = birthCfg.childLoyaltyBase ?? 60;
    const loyaltyVariance = birthCfg.childLoyaltyVariance ?? 40;
    const diplomacyMax = birthCfg.childDiplomacyMax ?? 80;
    const mutationRange = birthCfg.personalityMutationRange ?? 20;

    // 通用「双亲均值 + 变异」遗传：father/mother 该维度均值后叠加 ±mutationRange 随机偏移，clamp 0~100。
    // 父母缺该维度时回退 50（与 personality 默认一致）。用于 courage/justice 等新维度。见 ADR-017。
    const inheritTrait = (father, mother, trait) => {
      const f = father.staticData?.get('personality')?.[trait] ?? 50;
      const m = mother.staticData?.get('personality')?.[trait] ?? 50;
      const avg = (f + m) / 2;
      const mutated = avg + (Math.random() * 2 - 1) * mutationRange;
      return Math.round(Math.max(0, Math.min(100, mutated)));
    };

    const surnames = this.namesConfig.surnames || ['陈','李','张','王','刘'];
    const maleNames = this.namesConfig.maleNames || ['天','云','风','龙'];
    const femaleNames = this.namesConfig.femaleNames || ['月','雪','兰','瑶'];

    const npcs = this.entityRegistry.getAliveByType('npc');
    const processed = new Set();
    const births = [];

    for (const npc of npcs) {
      const companionId = npc.state.get('daoCompanionId');
      if (!companionId || processed.has(npc.id)) continue;
      processed.add(npc.id);
      processed.add(companionId);

      const companion = this.entityRegistry.getById(companionId);
      if (!companion || !companion.alive) continue;

      const mother = npc.state.get('gender') === 'female' ? npc : companion;
      const father = npc.state.get('gender') === 'female' ? companion : npc;

      if (mother.state.get('lifeRatio') >= motherMaxLifeRatio) continue;
      if (mother.state.get('childrenCount') >= maxChildren) continue;

      if (Math.random() > successRate) continue;

      const childGender = Math.random() < 0.5 ? 'male' : 'female';
      const namePool = childGender === 'male' ? maleNames : femaleNames;
      const surname = father.name.charAt(0);
      const useSurname = surnames.includes(surname) ? surname : surnames[Math.floor(Math.random() * surnames.length)];
      const givenName = namePool[Math.floor(Math.random() * namePool.length)];
      const childName = useSurname + givenName;

      const childId = `npc_born_${++this._nextNpcId}`;
      const factionId = mother.state.get('factionId') || father.state.get('factionId');

      const childConfig = {
        id: childId,
        name: childName,
        factionId: factionId,
        role: 'disciple',
        personality: {
          ambition: Math.floor((father.staticData?.get('personality')?.ambition || 50) * fatherWeight + Math.random() * 50),
          caution: Math.floor((mother.staticData?.get('personality')?.caution || 50) * motherWeight + Math.random() * 50),
          loyalty: Math.floor(Math.min(100, loyaltyBase + Math.random() * loyaltyVariance)),
          diplomacy: Math.floor(Math.random() * diplomacyMax),
          // courage/justice 走通用「双亲均值 + 变异」遗传（ADR-017）。
          courage: inheritTrait(father, mother, 'courage'),
          justice: inheritTrait(father, mother, 'justice'),
        },
        alive: true,
        gender: childGender,
        rankId: 'mortal',
      };

      const child = new NPCEntity(childConfig, this.ranksData, this.entityConfig);
      child.state.set('ageDays', 0);
      child.state.set('ageYears', 0);
      child.state.set('cultivationProgress', 0);
      this.entityRegistry.register(child);

      mother.state.set('childrenCount', (mother.state.get('childrenCount') || 0) + 1);
      father.state.set('childrenCount', (father.state.get('childrenCount') || 0) + 1);

      const entry = {
        day: this.worldEntity.currentDay,
        childId, childName, childGender,
        fatherId: father.id, fatherName: father.name,
        motherId: mother.id, motherName: mother.name,
        factionId,
      };
      births.push(entry);
      this.birthLog.push(entry);
    }

    for (const b of births) {
      const mother = this.entityRegistry.getById(b.motherId);
      this._emitLocationEvent(tickLog, { type: 'birth', entity: mother, ...b });
    }
  }

  /** 查境界 order（cultivation 类）；找不到返回 0 */
  _rankOrderOf(rankId) {
    const r = this.ranksData.find(x => x.id === rankId);
    return r ? (r.order || 0) : 0;
  }

  /** 角色月俸（用于月度考核前三名奖励基数） */
  _roleSalaryOf(role) {
    const roles = this.balanceConfig.economy?.salary?.roles || {};
    return roles[role] ?? 5;
  }

  /** 贬为外门弟子 */
  _demoteToOuter(npc) {
    if (npc.state.get('currentRole') === 'outer_disciple') return false;
    // 掌门/长老/继承人不参与贬谪（治理层豁免）
    const role = npc.state.get('currentRole');
    if (role === 'leader' || role === 'elder' || role === 'heir') return false;
    npc.state.set('currentRole', 'outer_disciple');
    npc.state.set('roleRank', 0);
    npc.state.set('isLeader', false);
    npc.state.set('isElder', false);
    // 记忆：被贬谪是一段屈辱经历（ADR-019），可累积为后续野心/复仇执念的诱因。
    if (typeof npc.recordMemory === 'function') {
      npc.recordMemory('demoted', {
        factionId: npc.state.get('factionId'),
        tick: this.worldEntity.currentDay,
      });
    }
    return true;
  }

  /**
   * 月度贡献考核（每 monthlyContribution.intervalDays 天）：
   * - 弟子当月贡献需达 quotaByRank[境界]，否则贬为外门弟子；
   * - 各势力当月贡献前三名额外奖励灵石 = 该弟子月俸 × topRewardMultipliers；
   * - 结算后清零 monthlyContribution，并刷新 monthlyQuotaMet 标记。
   */
  _processMonthlyContribution(worldContext, tickLog, currentDay) {
    const cfg = this.balanceConfig.cultivation?.monthlyContribution;
    if (!cfg) return;
    const interval = cfg.intervalDays ?? 30;
    if (currentDay <= 0 || currentDay % interval !== 0) return;

    const quotaByRank = cfg.quotaByRank || {};
    const topMult = cfg.topRewardMultipliers || [5, 3, 2];

    // 按势力分组本门存活弟子
    const byFaction = new Map();
    for (const npc of this.entityRegistry.getAliveByType('npc')) {
      const fid = npc.state.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }

    for (const [factionId, members] of byFaction) {
      // 前三名奖励（按当月贡献降序）
      const ranked = [...members].sort(
        (a, b) => (b.state.get('monthlyContribution') || 0) - (a.state.get('monthlyContribution') || 0)
      );
      for (let i = 0; i < topMult.length && i < ranked.length; i++) {
        const npc = ranked[i];
        if ((npc.state.get('monthlyContribution') || 0) <= 0) break;
        const reward = Math.round(this._roleSalaryOf(npc.state.get('currentRole')) * topMult[i]);
        npc.inventory.add('low_spirit_stone', reward);
        this.sectEventLog.push({
          day: currentDay, type: 'monthly_top', factionId,
          npcId: npc.id, npcName: npc.name, place: i + 1, reward,
        });
      }

      // 额度考核 + 清零
      for (const npc of members) {
        const role = npc.state.get('currentRole');
        // 治理层（掌门/长老/继承人）豁免月度额度考核：其职责是治理而非刷贡献
        if (role === 'leader' || role === 'elder' || role === 'heir') {
          npc.state.set('monthlyQuotaMet', true);
          npc.state.set('monthlyContribution', 0);
          continue;
        }
        const monthly = npc.state.get('monthlyContribution') || 0;
        const quota = quotaByRank[npc.state.get('rankId')] ?? 3;
        const met = monthly >= quota;
        npc.state.set('monthlyQuotaMet', met);
        if (!met) {
          const demoted = this._demoteToOuter(npc);
          this.sectEventLog.push({
            day: currentDay, type: 'monthly_fail', factionId,
            npcId: npc.id, npcName: npc.name, monthly, quota, demoted,
          });
        }
        npc.state.set('monthlyContribution', 0);
      }
    }
  }

  /**
   * 势力定时活动：门派考核（查境界，未达贬外门）、门派大比（实力排名，奖前五，冠军晋升）。
   */
  _processSectEvents(worldContext, tickLog, currentDay) {
    const cfg = this.balanceConfig.cultivation?.sectEvents;
    if (!cfg || currentDay <= 0) return;

    // 按势力分组
    const byFaction = new Map();
    for (const npc of this.entityRegistry.getAliveByType('npc')) {
      const fid = npc.state.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }

    // 门派考核
    const exam = cfg.sect_exam;
    if (exam && currentDay % (exam.intervalDays ?? 180) === 0) {
      const minOrder = exam.minRankOrder ?? 20;
      for (const [factionId, members] of byFaction) {
        for (const npc of members) {
          // 新晋弟子（年龄过小）暂不考核
          if ((npc.state.get('ageYears') || 0) < 16) continue;
          if (this._rankOrderOf(npc.state.get('rankId')) < minOrder) {
            const demoted = this._demoteToOuter(npc);
            this.sectEventLog.push({
              day: currentDay, type: 'exam_fail', factionId,
              npcId: npc.id, npcName: npc.name,
              rankName: npc.state.get('rankName'), demoted,
            });
          }
        }
      }
    }

    // 门派大比（按境界分组比试：同境界的弟子才放在一起排名，避免高境界永远碾压、低境界毫无机会。
    // 参考修仙设定中『同辈/同境较量』——天骄战、内院选拔皆按辈分/境界分组。每个境界组内各取前 N 名梯度奖励，
    // 每组第一名（同境之冠）获得一次沿阶梯晋升机会。可用 grandCompetition.byRank=false 回退为全门派混排。）
    const grand = cfg.grandCompetition;
    if (grand && currentDay % (grand.intervalDays ?? 360) === 0) {
      const stoneRewards = grand.stoneRewards || [];
      const contribRewards = grand.contributionRewards || [];
      const count = grand.rewardCount ?? 5;
      const byRank = grand.byRank !== false; // 默认按境界分组
      const roleCounts = null; // 大比冠军晋升为弹性通道，不受名额限制
      // 治理层（掌门/继承人/长老）豁免大比：大比意在激励中下层后辈上升，
      // 顶层职位已是宗门核心，不再下场拿奖、挤占后辈机会。可由 exemptRoles 配置。
      const exemptRoles = new Set(grand.exemptRoles || ['leader', 'heir', 'elder']);

      for (const [factionId, members] of byFaction) {
        // 按境界分组（byRank=false 时所有人归入同一组 'all'）；治理层不参赛
        const groups = new Map();
        for (const npc of members) {
          if (exemptRoles.has(npc.state.get('currentRole'))) continue;
          const key = byRank ? (npc.state.get('rankId') || 'unknown') : 'all';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(npc);
        }

        for (const [rankId, groupMembers] of groups) {
          // 同境内实力近似 = qi（境界相同，纯比真气积累）
          const ranked = [...groupMembers].sort(
            (a, b) => (b.state.get('qi') || 0) - (a.state.get('qi') || 0)
          );
          for (let i = 0; i < count && i < ranked.length; i++) {
            const npc = ranked[i];
            const stone = stoneRewards[i] ?? 0;
            const contrib = contribRewards[i] ?? 0;
            if (stone > 0) npc.inventory.add('low_spirit_stone', stone);
            if (contrib > 0) {
              npc.state.set('contribution', (npc.state.get('contribution') || 0) + contrib);
              npc.state.set('monthlyContribution', (npc.state.get('monthlyContribution') || 0) + contrib);
            }
            let promoted = false;
            // 同境之冠晋升：沿职位阶梯升一级。晋入稀缺顶层（elder/heir）时同样遵守"有空缺补位/满员挑战"规则。
            if (i === 0 && grand.championPromote) {
              const faction = this.entityRegistry.getById(factionId);
              const fRoleCounts = this._countRolesInFaction(factionId, members);
              promoted = this._promoteRole(npc, {
                roleCounts: fRoleCounts, faction, members, allowChallenge: true, checkQuota: false,
              });
            }
            this.sectEventLog.push({
              day: currentDay, type: 'grand_competition', factionId,
              rankId: byRank ? rankId : undefined,
              rankName: byRank ? npc.state.get('rankName') : undefined,
              npcId: npc.id, npcName: npc.name, place: i + 1, stone, contrib, promoted,
            });
          }
        }
      }
    }
  }

  /** 晋升配置（promotion 段），带默认值兜底 */
  _promotionCfg() {
    return this.balanceConfig.cultivation?.promotion || {
      ladder: ['outer_disciple', 'disciple', 'core_disciple', 'officer', 'general', 'elder', 'heir'],
      roleRankByStep: {
        outer_disciple: 0, disciple: 1, core_disciple: 2,
        officer: 3, general: 3, elder: 4, heir: 5,
      },
      contributionByStep: {},
      rankOrderByStep: {},
      quotaByRole: {},
    };
  }

  /** 统计某势力当前各职位人数（存活），用于名额限制 */
  _countRolesInFaction(factionId, members) {
    const counts = {};
    for (const npc of members) {
      const role = npc.state.get('currentRole');
      counts[role] = (counts[role] || 0) + 1;
    }
    return counts;
  }

  /**
   * 某职位在某宗门的名额上限：
   * 优先宗门自身配置 staticData.roleQuota[role]（按规模），回退全局 promotion.quotaByRole[role]，
   * 再无则 Infinity（不限）。
   */
  _factionRoleQuota(faction, role) {
    const fq = faction?.staticData?.roleQuota;
    if (fq && fq[role] != null) return fq[role];
    const cfg = this._promotionCfg();
    if (cfg.quotaByRole && cfg.quotaByRole[role] != null) return cfg.quotaByRole[role];
    return Infinity;
  }

  /** 该职位是否为"宗门稀缺顶层席位"（在宗门 roleQuota 中显式配置，如 elder/heir） */
  _isScarceSeat(faction, role) {
    const fq = faction?.staticData?.roleQuota;
    return !!(fq && fq[role] != null);
  }

  /** NPC 实力比较分：境界 successionScore（按 rankId）为主，qi 为次。用于挑战席位时择强弱。 */
  _npcSeatStrength(npc) {
    const rank = this.ranksData.find(r => r.id === npc.state.get('rankId'));
    const score = rank ? (rank.successionScore ?? rank.order ?? 0) : 0;
    return score * 1e6 + (npc.state.get('qi') || 0);
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
    const revenge = obs.find(o => o.type === 'revenge' && o.targetId);
    if (revenge) targetId = revenge.targetId;
    if (!targetId && entity.relationships?.topGrudge) {
      const top = entity.relationships.topGrudge();
      if (top) targetId = top.actorId;
    }
    if (!targetId) return null;
    const target = this.entityRegistry.getById(targetId);
    if (!target || !target.alive) return null;
    if (!(target.hasSpatial && target.hasSpatial())) return null;
    return target;
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
    // 法宝加成（ADR-025）：已装备法宝的 combatBonus 提升战力。默认 NPC 无装备 → 系数 1（零漂移）。
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

  /** 设置职位（同时同步 roleRank / isElder / isLeader） */
  _setRole(npc, role) {
    const cfg = this._promotionCfg();
    npc.state.set('currentRole', role);
    npc.state.set('roleRank', cfg.roleRankByStep[role] ?? 0);
    npc.state.set('isElder', role === 'elder');
    npc.state.set('isLeader', role === 'leader');
  }

  /**
   * 将 NPC 沿职位阶梯晋升一级（数据驱动，全阶梯）。
   *
   * 顶层稀缺席位（宗门 roleQuota 中配置的职位，如 elder/heir）的特殊规则：
   *   - 有空缺（当前人数 < 名额）：达标者直接补位；
   *   - 已满员：必须挑战现任——取最弱现任者，若挑战者更强则现任降一级（退到挑战者原职位），挑战者上位；否则晋升失败。
   * 非稀缺职位：按全局 quotaByRole 可选名额检查后直接晋升。
   *
   * @param {Object} npc
   * @param {Object} [opts]
   * @param {Object} [opts.roleCounts] 本门当前各职位人数（稀缺席位与名额检查必需）
   * @param {Object} [opts.faction]    所属宗门实体（读取 roleQuota）
   * @param {Array}  [opts.members]    本门成员（挑战时定位现任者）
   * @param {boolean}[opts.allowChallenge] 满员时是否允许挑战现任（默认 true）
   * @param {boolean}[opts.checkQuota] 非稀缺职位是否检查全局名额上限
   * @returns {string|false} 晋升后的新职位，或 false（无法晋升）
   */
  _promoteRole(npc, opts = {}) {
    const cfg = this._promotionCfg();
    const ladder = cfg.ladder;
    const role = npc.state.get('currentRole');
    const idx = ladder.indexOf(role);
    if (idx < 0 || idx >= ladder.length - 1) return false;
    const next = ladder[idx + 1];

    const faction = opts.faction;
    const counts = opts.roleCounts;

    // —— 顶层稀缺席位：有空缺补位，满员挑战 ——
    if (faction && this._isScarceSeat(faction, next) && counts) {
      const quota = this._factionRoleQuota(faction, next);
      const cur = counts[next] || 0;
      if (cur < quota) {
        // 有空缺，直接补位
        this._applyPromote(npc, role, next, counts);
        return next;
      }
      // 满员：挑战现任
      const allowChallenge = opts.allowChallenge !== false;
      if (!allowChallenge || !opts.members) return false;
      const incumbents = opts.members.filter(
        m => m.state.get('currentRole') === next && m.id !== npc.id && m.state.get('alive') !== false
      );
      if (incumbents.length === 0) return false;
      // 取最弱现任
      incumbents.sort((a, b) => this._npcSeatStrength(a) - this._npcSeatStrength(b));
      const weakest = incumbents[0];
      if (this._npcSeatStrength(npc) <= this._npcSeatStrength(weakest)) return false; // 挑战者不够强
      // 现任退到挑战者原职位（降一级思路：退到挑战者腾出的位置）
      this._setRole(weakest, role);
      counts[next] = Math.max(0, (counts[next] || 0) - 1);
      counts[role] = (counts[role] || 0) + 1;
      this._applyPromote(npc, role, next, counts);
      // 记录被挑战下来的现任 id（用实例字段而非 state，避免污染 GOAP 状态键）
      npc._lastChallengeDisplaced = weakest.id;
      return next;
    }

    // —— 非稀缺职位：可选全局名额检查后晋升 ——
    if (opts.checkQuota && cfg.quotaByRole && cfg.quotaByRole[next] != null && counts) {
      const cap = cfg.quotaByRole[next];
      if ((counts[next] || 0) >= cap) return false;
    }
    this._applyPromote(npc, role, next, counts);
    return next;
  }

  /** 落实一次晋升的状态写入与计数更新 */
  _applyPromote(npc, fromRole, toRole, counts) {
    this._setRole(npc, toRole);
    if (counts) {
      counts[fromRole] = Math.max(0, (counts[fromRole] || 0) - 1);
      counts[toRole] = (counts[toRole] || 0) + 1;
    }
  }

  /**
   * 贡献晋升通道（每 promotion.intervalDays 天）：
   * 大比冠军之外的第二条透明、可预期的上升通道。弟子终身累计贡献达 contributionByStep[下一职位]
   * 且境界 order ≥ rankOrderByStep[下一职位]，则沿阶梯晋升一级；高阶职位受 quotaByRole 名额限制。
   * 掌门(leader)与继承人(heir 已是阶梯顶)由继任产生，不在此通道额外处理。
   * 参考《宗门运行流程与制度平衡分析》之『多通道原则』『安全网原则』『透明原则』。
   */
  _processPromotions(worldContext, tickLog, currentDay) {
    const cfg = this.balanceConfig.cultivation?.promotion;
    if (!cfg) return;
    const interval = cfg.intervalDays ?? 90;
    if (currentDay <= 0 || currentDay % interval !== 0) return;

    const ladder = cfg.ladder || [];
    const contribByStep = cfg.contributionByStep || {};
    const orderByStep = cfg.rankOrderByStep || {};

    // 按势力分组本门存活弟子
    const byFaction = new Map();
    for (const npc of this.entityRegistry.getAliveByType('npc')) {
      const fid = npc.state.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }

    for (const [factionId, members] of byFaction) {
      const faction = this.entityRegistry.getById(factionId);
      const roleCounts = this._countRolesInFaction(factionId, members);
      // 同等条件下，按终身贡献降序优先晋升（竞争择优），保证名额给到贡献最高者
      const ordered = [...members].sort(
        (a, b) => (b.state.get('contribution') || 0) - (a.state.get('contribution') || 0)
      );
      for (const npc of ordered) {
        const role = npc.state.get('currentRole');
        const idx = ladder.indexOf(role);
        if (idx < 0 || idx >= ladder.length - 1) continue; // leader/heir/wanderer 跳过
        const next = ladder[idx + 1];

        const needContrib = contribByStep[next];
        const needOrder = orderByStep[next] ?? 0;
        if (needContrib == null) continue;

        const contribution = npc.state.get('contribution') || 0;
        const rankOrder = this._rankOrderOf(npc.state.get('rankId'));
        if (contribution < needContrib || rankOrder < needOrder) continue;

        npc._lastChallengeDisplaced = null;
        const promoted = this._promoteRole(npc, {
          roleCounts, faction, members, allowChallenge: true, checkQuota: true,
        });
        if (promoted) {
          const displaced = npc._lastChallengeDisplaced || null;
          // 夺职受辱（ADR-020 阶段E）：被挑战拉下来的现任记仇于挑战者。
          this._recordDisplacementGrudge(displaced, npc);
          this.sectEventLog.push({
            day: currentDay, type: 'promotion', factionId,
            npcId: npc.id, npcName: npc.name,
            fromRole: role, toRole: promoted, contribution,
            viaChallenge: !!displaced, displacedNpcId: displaced,
          });
          npc._lastChallengeDisplaced = null;
        }
      }
    }
  }

  getTickHistory() {
    return this._tickResults;
  }

  getLatestTick() {
    return this._tickResults[this._tickResults.length - 1] || null;
  }
}
