/**
 * WorldContextBuilder —— 每 tick 的世界上下文（worldContext）装配器。
 *
 * 职责：把原 TickManager._buildWorldContext 中的"数据 + 服务定位 + 势力 AI"对象字面量，
 *   拆分为一个职责单一的装配器：
 *     1. 纯数据载体（worldState/registry/config/index/各子系统引用）；
 *     2. 工具委托（寻路 / 找地形格 / 找建筑 / 解析任务地点 / 解析行为目标坐标）→ 委托 host(TickManager)；
 *     3. 势力 AI（扩张/攻伐/结盟/贸易/态势/晋升）→ 委托注入的 FactionAIService。
 *
 * worldContext 的对外形状（被 NPC executor / faction-actions 鸭子调用的方法签名）保持稳定，
 * 调用方无需改动。infoEvents 数组随 worldContext 暴露，攻击/结盟事件写入其中。
 */
import { BuildingType } from '../layout-constants.js';
import { computePath } from '../pathfinding.js';

export class WorldContextBuilder {
  /**
   * @param {Object} deps
   * @param {import('../tick-manager.js').TickManager} deps.host
   * @param {import('./faction-ai-service.js').FactionAIService} deps.factionAI
   */
  constructor({ host, factionAI }) {
    this.host = host;
    this.factionAI = factionAI;
  }

  /**
   * 装配本 tick 的 worldContext。
   * @returns {Object}
   */
  build() {
    const host = this.host;
    const factionAI = this.factionAI;
    const infoEvents = [];

    return {
      // 确定性随机源：模拟逻辑统一从 worldContext.rng 取随机，保证同 seed 可复现。
      rng: host.rng,
      worldState: host.worldEntity.state,
      entityRegistry: host.entityRegistry,
      get currentDay() { return host.worldEntity.currentDay; },
      activeModifiers: host.worldEntity.activeModifiers,
      questTemplates: host.questTemplates || null,
      tileIndex: host.tileIndex,
      terrainIndex: host.terrainIndex,
      // 妖兽生成器：供遁地符 executor 读 safeRadius / 地图尺寸，遁向安全带（ADR-042 修正）。
      monsterSpawner: host.monsterSpawner || null,
      factionVeinOutput: host._calcFactionVeinOutput(),
      balanceConfig: host.balanceConfig,
      modifierTemplates: host.modifierTemplates,
      techniqueRegistry: host.techniqueRegistry,
      movementSystem: host.movementSystem,
      infoSystem: host.infoSystem,
      opportunitySystem: host.opportunitySystem,
      relationshipSystem: host.relationshipSystem,
      relationshipConfig: host.relationshipConfig,
      dynamicGoalConfig: host.dynamicGoalsConfig || {},

      dynamicEventById(id) {
        const event = host.worldEventSystem?.getById(id);
        return event ? event.toJSON() : null;
      },

      knownDynamicEventsFor(entityOrId) {
        const day = host.worldEntity.currentDay;
        const entity = typeof entityOrId === 'string'
          ? (host.entityRegistry?.getById?.(entityOrId) || { id: entityOrId })
          : entityOrId;
        return host.worldEventSystem
          ? host.worldEventSystem.visibleEventsFor(entity, day).map(event => ({
              event,
              confidence: host.worldEventSystem.awarenessConfidence(event, entity),
              source: event.source,
              scope: event.scope,
              visibilityScope: event.scope,
              day,
            }))
          : [];
      },

      markDynamicEventPrepared(eventId, npcId) {
        return host.worldEventSystem ? host.worldEventSystem.markPrepared(eventId, npcId) : false;
      },

      markDynamicEventParticipant(eventId, npcId) {
        return host.worldEventSystem ? host.worldEventSystem.markParticipant(eventId, npcId) : false;
      },

      recordMonsterGrudge(monsterId, npcId) {
        host._applyRelationEvent('monster_grudge', monsterId, npcId);
      },

      recordTerritoryThreat(monsterId, npcId) {
        if (!host._relationGoalsEnabled()) return;
        host._applyRelationEvent('territory_intrusion', monsterId, npcId);
      },

      relationGoalsEnabled() {
        return host._relationGoalsEnabled();
      },

      npcCombatPower(npc) {
        return host._npcCombatPower(npc);
      },

      bestOpportunityFor(entity) {
        return host._bestOpportunityFor(entity);
      },

      computePath(from, to) {
        const manhattan = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        const useHier = host.hierGraph && manhattan > 96;
        return computePath(from, to, host.tileIndex, {
          terrainIndex: host.terrainIndex,
          graph: host.gridGraph,
          hier: useHier ? host.hierGraph : null,
        });
      },

      nearestTerrainTile(fromX, fromY, terrainType) {
        return host.nearestTerrainTile(fromX, fromY, terrainType);
      },

      getFactionBuilding(factionId, buildingType, from = null) {
        return host.getFactionBuilding(factionId, buildingType, from);
      },

      _resolveBountyOrgFor(entity) {
        const sp = entity?.spatial;
        const here = sp ? { x: sp.tileX, y: sp.tileY } : null;
        const org = host._nearestBountyOrg(here);
        return org ? host.entityRegistry.getById(org.orgId) : null;
      },

      resolveQuestLocation(entity, questType, difficulty = null) {
        const sp = entity?.spatial;
        const here = sp ? { x: sp.tileX, y: sp.tileY } : null;
        const target = questType?.locationTarget || 'hq';

        if (target === 'hq') {
          const factionId = entity.state?.get('factionId');
          if (factionId) {
            const faction = host.entityRegistry.getById(factionId);
            const hq = faction?.staticData?.headquarters;
            return hq && typeof hq.x === 'number' ? { x: hq.x, y: hq.y } : here;
          }
          const org = host._nearestBountyOrg(here);
          return org ? { x: org.x, y: org.y } : here;
        }
        if (target === 'monster') {
          const monsters = host.entityRegistry.getAliveByType('monster')
            .filter(m => m.hasSpatial && m.hasSpatial());
          const economy = host.balanceConfig?.economy || {};
          const gap = economy.monsterResources?.retargetGradeGap ?? 2;
          const wanted = Number(difficulty) || null;
          const sameBand = wanted
            ? monsters.filter(m => Math.abs((m.grade || 1) - wanted) <= gap)
            : monsters;
          const pool = sameBand.length > 0 ? sameBand : monsters;
          let best = null;
          let bestDist = Infinity;
          for (const m of pool) {
            const pos = host._entityPos(m);
            if (!pos) continue;
            const base = here || pos;
            const dist = Math.abs(pos.x - base.x) + Math.abs(pos.y - base.y);
            if (dist < bestDist) {
              best = { monster: m, pos };
              bestDist = dist;
            }
          }
          return best
            ? { x: best.pos.x, y: best.pos.y, monsterId: best.monster.id }
            : here;
        }
        if (target.startsWith('terrain:')) {
          const terrainType = target.slice('terrain:'.length);
          if (!here) return null;
          return host.nearestTerrainTile(here.x, here.y, terrainType)
            || host.nearestTerrainTile(here.x, here.y, 'plain')
            || here;
        }
        return here;
      },

      resolveTarget(entity, targetResolver) {
        const sp = entity?.spatial;
        const here = sp ? { x: sp.tileX, y: sp.tileY } : null;
        if (!targetResolver || targetResolver === 'self') return here;

        if (targetResolver === 'quest_hall' && !entity.state?.get('factionId')) {
          const org = host._nearestBountyOrg(here);
          return org ? { x: org.x, y: org.y } : here;
        }

        switch (targetResolver) {
          case 'faction_hq':
          case 'main_hall':
          case 'quest_hall':
          case 'library':
          case 'alchemy':
          case 'training': {
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
              const pos = host.getFactionBuilding(factionId, buildingMap[targetResolver], here);
              if (pos) return pos;
              const faction = host.entityRegistry.getById(factionId);
              const hq = faction?.staticData?.headquarters;
              if (hq && typeof hq.x === 'number') return { x: hq.x, y: hq.y };
            }
            const orgs = host.entityRegistry.getByType('faction')
              .filter(f => f.alive && f.staticData?.headquarters);
            return host._nearestHq(here, orgs) || here;
          }
          case 'market': {
            const orgs = host.entityRegistry.getByType('faction')
              .filter(f => f.alive && f.staticData?.headquarters);
            return host._nearestHq(here, orgs) || here;
          }
          case 'nearest_monster': {
            const monsters = host.entityRegistry.getAliveByType('monster')
              .filter(m => m.hasSpatial && m.hasSpatial());
            return host._nearestEntityPos(here, monsters) || here;
          }
          case 'wander_far': {
            return host._randomWanderTarget(here) || here;
          }
          case 'quest_target': {
            const qx = entity.state?.get('questTargetX');
            const qy = entity.state?.get('questTargetY');
            return (typeof qx === 'number' && typeof qy === 'number') ? { x: qx, y: qy } : here;
          }
          case 'revenge_target': {
            const target = host._resolveRevengeTarget(entity);
            if (target && target.spatial) {
              return { x: target.spatial.tileX, y: target.spatial.tileY };
            }
            return here;
          }
          case 'nearest_opportunity': {
            const oppId = entity.state?.get('targetOpportunityId');
            if (oppId) {
              const o = host.opportunitySystem.getById(oppId);
              if (o) return { x: o.pos.x, y: o.pos.y };
            }
            const pick = host._bestOpportunityFor(entity);
            if (pick) return { x: pick.opp.pos.x, y: pick.opp.pos.y };
            return here;
          }
          case 'dynamic_event_target': {
            const eventId = entity.state?.get('targetDynamicEventId');
            if (!eventId) return here;
            const liveEvent = host.worldEventSystem?.getById?.(eventId);
            const event = liveEvent
              ? (typeof liveEvent.toJSON === 'function' ? liveEvent.toJSON() : liveEvent)
              : (typeof this?.dynamicEventById === 'function' ? this.dynamicEventById(eventId) : null);
            const pos = event?.pos || null;
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
              return { x: pos.x, y: pos.y };
            }
            if (pos?.resolver === 'secret_realm') {
              return host.infoCoordinator?.secretRealmPos?.() || here;
            }
            if (pos?.resolver === 'faction_hq') {
              const factionId = pos.factionId || event?.subjectId || entity.state?.get('factionId');
              if (factionId) {
                const faction = host.entityRegistry.getById(factionId);
                const hq = faction?.staticData?.headquarters;
                if (hq && typeof hq.x === 'number' && typeof hq.y === 'number') {
                  return { x: hq.x, y: hq.y };
                }
              }
            }
            return here;
          }
          case 'relationship_target': {
            const relId = entity.state?.get('targetRelationshipId');
            if (relId) {
              const t = host.entityRegistry.getById(relId);
              if (t && t.alive && t.hasSpatial && t.hasSpatial()) {
                return { x: t.spatial.tileX, y: t.spatial.tileY };
              }
            }
            return here;
          }
          case 'safe_retreat': {
            // 反应层逃命/撤退落点（ADR-048）：奔向本势力总部（最安全锚点）；
            // 散修无总部时退向最近的势力总部，再兜底当前位置。
            const factionId = entity.state?.get('factionId');
            if (factionId) {
              const faction = host.entityRegistry.getById(factionId);
              const hq = faction?.staticData?.headquarters;
              if (hq && typeof hq.x === 'number') return { x: hq.x, y: hq.y };
            }
            const orgs = host.entityRegistry.getByType('faction')
              .filter(f => f.alive && f.staticData?.headquarters);
            return host._nearestHq(here, orgs) || here;
          }
          default:
            return here;
        }
      },

      getLeaderPersonality(npcId) {
        if (!npcId) return null;
        const npc = host.entityRegistry.getById(npcId);
        if (!npc || !npc.alive) return null;
        return npc.staticData?.get('personality') || null;
      },

      resolveRevengeTarget(entity) {
        return host._resolveRevengeTarget(entity);
      },

      // ── 势力 AI（委托 FactionAIService）──
      checkAdjacentUnowned(territory) {
        return factionAI.checkAdjacentUnowned(territory);
      },
      checkAdjacentEnemy(territory, relations, selfFactionId) {
        return factionAI.checkAdjacentEnemy(territory, relations, selfFactionId);
      },
      calculateBorderThreat(territory, relations) {
        return factionAI.calculateBorderThreat(territory, relations);
      },
      checkWeakEnemy(relations) {
        return factionAI.checkWeakEnemy(relations);
      },
      calculateMilitaryAdvantage(factionIdOrSnapshot) {
        return factionAI.calculateMilitaryAdvantage(factionIdOrSnapshot);
      },
      promoteByLadder(npcId) {
        return factionAI.promoteByLadder(npcId);
      },
      expandTerritory(factionId) {
        return factionAI.expandTerritory(factionId);
      },
      attackEnemy(factionId) {
        // 透传 worldContext（this）使攻战致死走统一伤害管线 applyDamage（ADR-042：锁血/遁地）。
        return factionAI.attackEnemy(factionId, this.infoEvents, this);
      },
      formAlliance(factionId) {
        return factionAI.formAlliance(factionId, this.infoEvents);
      },
      conductTrade(factionId) {
        return factionAI.conductTrade(factionId);
      },

      infoEvents,
    };
  }
}
