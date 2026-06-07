/**
 * combat-actions —— 战斗 / 势力服务 / 游历探险域行为执行器（从 npc-actions.js 拆分）。
 *
 * 含侍奉势力 / 辅佐势力 / 游历历练 / 追踪仇敌 / 击杀仇敌 / 夺宝闯险：
 *   ServeFaction / AssistFaction / Explore / HuntEnemy / KillEnemy / RaidTreasure
 * 风险结算、PvP 致死、奖励发放等共享工具统一从 ./npc-action-utils.js 引入。
 */
import { ActionExecutor } from '../../abstract/action.js';
import { ItemRegistry } from '../../items/item-registry.js';
import {
  getCultivationConfig,
  weightedPickFrom,
  settleRisk,
  killNPCByPvP,
  rollAndGrantReward,
} from './npc-action-utils.js';
import { addExperienceCultivation } from '../numeric-cultivation.js';

export class NPCServeFactionExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    entity.state.set('dutyFulfilled', true);
    const factionId = entity.state.get('factionId');
    let adminBonus = false;
    if (factionId) {
      const faction = worldContext.entityRegistry?.getById(factionId);
      if (faction && faction.alive) {
        const role = entity.state.get('currentRole');
        if (role === 'leader') {
          const cult = getCultivationConfig(worldContext);
          const serveCfg = cult.actions?.serveFaction || {};
          faction.inventory.add('low_spirit_stone', serveCfg.leaderStoneBonus ?? 10);
          faction.inventory.add('food', serveCfg.leaderFoodBonus ?? 10);

          // 行政中枢加成：掌门在主殿坐镇履职，额外提升宗门稳定度与资源产出
          if (this._atMainHall(entity, worldContext, factionId)) {
            adminBonus = true;
            const stoneAdmin = serveCfg.mainHallStoneBonus ?? 15;
            const foodAdmin = serveCfg.mainHallFoodBonus ?? 10;
            const stabAdmin = serveCfg.mainHallStabilityBonus ?? 2;
            faction.inventory.add('low_spirit_stone', stoneAdmin);
            faction.inventory.add('food', foodAdmin);
            const stability = faction.state.get('stability') || 0;
            faction.state.set('stability', Math.min(stability + stabAdmin, 100));
          }
        }
      }
    }
    const role = entity.state.get('currentRole');
    const desc = adminBonus
      ? `${entity.staticData.name} 在主殿坐镇理政，宗门运转更趋稳固`
      : `${entity.staticData.name} 履行了 ${role} 的职责`;
    return { description: desc, adminBonus };
  }

  /** 判断 NPC 当前是否身处本势力主殿所在格（含相邻） */
  _atMainHall(entity, worldContext, factionId) {
    const sp = entity.spatial;
    if (!sp || !worldContext.getFactionBuilding) return false;
    const hall = worldContext.getFactionBuilding(factionId, 'main_hall');
    if (!hall) return false;
    return Math.abs(sp.tileX - hall.x) <= 1 && Math.abs(sp.tileY - hall.y) <= 1;
  }
}

export class NPCAssistFactionExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const factionId = entity.state.get('factionId');
    if (!factionId) return { success: false };

    const faction = worldContext.entityRegistry?.getById(factionId);
    if (!faction || !faction.alive) return { success: false };

    const cult = getCultivationConfig(worldContext);
    const assistCfg = cult.actions?.assistFaction || {};
    const stoneBonusPerContribution = assistCfg.stoneBonusPerContribution ?? 5;
    const stabilityBonusPerContribution = assistCfg.stabilityBonusPerContribution ?? 0.5;

    const rankId = entity.state.get('rankId') || 'mortal';
    const ranks = entity._ranksData || [];
    const rank = ranks.find(r => r.id === rankId);
    const rankOrder = rank ? rank.order : 0;
    const contribution = Math.floor(rankOrder / 10) + 1;

    faction.inventory.add('low_spirit_stone', contribution * stoneBonusPerContribution);
    const stability = faction.state.get('stability') || 0;
    faction.state.set('stability', Math.min(stability + contribution * stabilityBonusPerContribution, 100));

    entity.state.set('dutyFulfilled', true);
    return {
      success: true,
      contribution,
      description: `${entity.staticData.name} 辅助势力发展，贡献 ${contribution * stoneBonusPerContribution} 灵石`,
    };
  }
}

/**
 * 游历历练：外出大世界寻机缘。归来时
 *   ① 按机缘事件表(cultivation.actions.explore.fortuneEvents)加权 roll 一次，产出历练修为 + 真气；
 *   ② 按 risk.json 的 explore 分项逐项结算风险（受伤/资源掉落/陨落，含性格加成）。
 * 历练修为并入 totalCultivation，作为闭关修为之外的外出成长来源。
 * 机缘/夺宝/洞天福地等事件目前仅产出历练修为/qi，预留后续扩展（法宝、材料、修炼加速 buff）。详见 ADR-016。
 */
export class NPCExploreExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const exploreCfg = cult.actions?.explore || {};
    const experienceMin = exploreCfg.experienceCultivationMin ?? 1;
    const experienceMax = exploreCfg.experienceCultivationMax ?? 3;
    const qiMin = exploreCfg.fortuneQiMin ?? 5;
    const qiMax = exploreCfg.fortuneQiMax ?? 20;
    const events = exploreCfg.fortuneEvents || [];

    const event = weightedPickFrom(events, worldContext.rng) || { id: 'normal', name: '游历归来', experienceCultivationMultiplier: 1.0, qiMultiplier: 1.0 };

    const baseExperience = experienceMin + worldContext.rng.next() * (experienceMax - experienceMin);
    const experienceCultivationGain = Number((baseExperience * (event.experienceCultivationMultiplier ?? 1.0)).toFixed(4));
    const totalCultivation = addExperienceCultivation(
      entity,
      worldContext?.ranksData || entity?._ranksData || [],
      experienceCultivationGain,
      cult,
    );

    const baseQi = qiMin + Math.floor(worldContext.rng.next() * (qiMax - qiMin + 1));
    const qiGain = Math.round(baseQi * (event.qiMultiplier ?? 1.0));
    if (qiGain > 0) {
      entity.state.set('qi', (entity.state.get('qi') || 0) + qiGain);
    }

    // 风险结算（数据驱动）。若触发死亡，提前返回（_deathInfo 已由 applyRiskEffect 写入）。
    const risk = settleRisk(entity, worldContext, 'explore');
    if (risk.died) {
      return {
        success: false,
        outcome: 'death',
        fortuneEvent: event.id,
        riskTriggered: risk.triggered,
        description: `${entity.staticData.name} 在游历途中遭遇不测，陨落于大世界`,
      };
    }

    const riskNote = risk.triggered.length > 0
      ? `，但${risk.triggered.map(r => r.risk).join('、')}`
      : '';
    return {
      success: true,
      outcome: 'fortune',
      fortuneEvent: event.id,
      fortuneEventName: event.name,
      experienceCultivationGain,
      totalCultivation,
      qiGain,
      totalRiskPct: Number(risk.totalRiskPct.toFixed(3)),
      riskTriggered: risk.triggered,
      description: `${entity.staticData.name} 游历归来：${event.name}，历练修为+${experienceCultivationGain.toFixed(3)}、真气+${qiGain}${riskNote}`,
    };
  }
}

/**
 * 复仇行为链——追踪仇人（ADR-020）。
 * 行为生命周期的 requiresTravel 已把 NPC 移动到 revenge_target resolver 解析的仇人坐标。
 * 本执行器在抵达后确认仇人在世并临近，标记 nearRevengeTarget，供后续击杀。
 * 若途中仇人已死/失联，复仇执念目标自然失效（GOAP 下一轮重规划）。
 */
export class NPCHuntEnemyExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const target = typeof worldContext.resolveRevengeTarget === 'function'
      ? worldContext.resolveRevengeTarget(entity)
      : null;
    if (!target) {
      return { success: false, outcome: 'no_target', description: `${entity.staticData.name} 失去了仇人的踪迹` };
    }
    entity.state.set('nearRevengeTarget', true);
    return {
      success: true,
      outcome: 'tracked',
      targetId: target.id,
      description: `${entity.staticData.name} 追踪到仇人 ${target.staticData?.name || target.id} 的下落`,
    };
  }
}

/**
 * 复仇行为链——击杀仇人（ADR-020）。
 * 用 npcCombatPower 比拼战力，胜率 = myPower/(myPower+enemyPower)（妖兽式比率）。
 *   - 胜：给仇人写 _deathInfo{cause:'slain', killerId, killerFactionId}，并置自身 enemyKilled=true（执念达成）。
 *   - 负：自身按战力差受伤，劣势悬殊时可能陨落（killerId 指向对方），形成双向恩怨。
 */
export class NPCKillEnemyExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const target = typeof worldContext.resolveRevengeTarget === 'function'
      ? worldContext.resolveRevengeTarget(entity)
      : null;
    if (!target) {
      entity.state.set('nearRevengeTarget', false);
      return { success: false, outcome: 'no_target', description: `${entity.staticData.name} 扑了个空，仇人已不知所踪` };
    }

    const powerFn = typeof worldContext.npcCombatPower === 'function'
      ? worldContext.npcCombatPower
      : null;
    const myPower = powerFn ? powerFn(entity) : 1;
    const enemyPower = powerFn ? powerFn(target) : 1;
    const winChance = myPower / Math.max(1e-6, myPower + enemyPower);
    const win = worldContext.rng.next() < winChance;

    if (win) {
      const kill = killNPCByPvP(target, entity, worldContext);
      entity.state.set('nearRevengeTarget', false);
      if (!kill.died) {
        // 仇人靠锁血/遁地符逃生：执念未达成，等待下次追击。
        return {
          success: false,
          outcome: kill.escaped ? 'enemy_escaped' : 'enemy_survived',
          targetId: target.id,
          winChance: Number(winChance.toFixed(3)),
          description: `${entity.staticData.name} 重创仇人 ${target.staticData?.name || target.id}，但对方${kill.escaped ? '祭出遁地符遁走' : '锁血保命逃脱'}`,
        };
      }
      entity.state.set('enemyKilled', true);
      return {
        success: true,
        outcome: 'enemy_slain',
        targetId: target.id,
        winChance: Number(winChance.toFixed(3)),
        description: `${entity.staticData.name} 手刃仇人 ${target.staticData?.name || target.id}，了却一桩执念`,
      };
    }

    // 败：按劣势程度受伤；悬殊时陨落（被仇人反杀）。
    const disadvantage = 1 - winChance; // 越大越惨败
    const lethal = disadvantage > 0.8 && worldContext.rng.next() < (disadvantage - 0.8) * 2.5;
    if (lethal) {
      const kill = killNPCByPvP(entity, target, worldContext);
      if (kill.died) {
        return {
          success: false,
          outcome: 'slain_by_enemy',
          targetId: target.id,
          winChance: Number(winChance.toFixed(3)),
          description: `${entity.staticData.name} 寻仇反被 ${target.staticData?.name || target.id} 所杀`,
        };
      }
      // 自己靠锁血/遁地符逃生：负伤遁走。
      entity.state.set('nearRevengeTarget', false);
      return {
        success: false,
        outcome: kill.escaped ? 'escaped' : 'survived',
        targetId: target.id,
        winChance: Number(winChance.toFixed(3)),
        description: `${entity.staticData.name} 寻仇大败，${kill.escaped ? '危急中遁地符护身遁走' : '锁血保命狼狈逃脱'}`,
      };
    }
    const injury = 1 + Math.floor(disadvantage * 3);
    entity.state.set('injuryLevel', (entity.state.get('injuryLevel') || 0) + injury);
    entity.state.set('nearRevengeTarget', false);
    return {
      success: false,
      outcome: 'wounded',
      targetId: target.id,
      winChance: Number(winChance.toFixed(3)),
      description: `${entity.staticData.name} 向仇人寻仇不敌，负伤遁走（伤势+${injury}）`,
    };
  }
}

/**
 * 夺宝流执行器（ADR-022/ADR-023，参考凡人修仙传 杀人夺宝/闯秘境）。
 * 高风险高期望收益：按 reward.json obsession_plunder 概率分布产出收益（真气/感悟/灵石），
 * 按 risk.json plunder 键结算受伤/陨落。成功置 treasureObtained=true（执念达成）。
 */
export class NPCRaidTreasureExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    // 风险结算：触发死亡则提前返回（_deathInfo 已由 applyRiskEffect 写入）。
    const risk = settleRisk(entity, worldContext, 'plunder');
    if (risk.died) {
      return {
        success: false,
        outcome: 'death',
        riskTriggered: risk.triggered,
        description: `${entity.staticData.name} 闯荡险地争夺机缘，殒身于乱战之中`,
      };
    }

    // 期望收益落地：按 reward.json 概率分布 roll 一个结果。
    // 若 outcome 带 itemId，则发放真实物品（法宝/材料/丹药）写入背包（ADR-025），否则回退真气收益。
    const rewardCfg = worldContext.balanceConfig?.reward;
    const grant = rollAndGrantReward(entity, rewardCfg, 'obsession_plunder', worldContext.rng, worldContext);

    entity.state.set('treasureObtained', true);
    const riskNote = risk.triggered.length > 0
      ? `，途中${risk.triggered.map(r => r.risk).join('、')}`
      : '';
    const gainNote = grant.grantedItems.length > 0
      ? `夺得${grant.grantedItems.map(g => `${ItemRegistry.get(g.itemId)?.name || g.itemId}×${g.qty}`).join('、')}`
      : (grant.qiGain > 0 ? `夺得${grant.outcome?._name || '机缘'}（真气+${grant.qiGain}）` : '险地一行空手而归');
    return {
      success: true,
      outcome: 'treasure',
      rewardId: grant.outcome?.id ?? null,
      grantedItems: grant.grantedItems,
      qiGain: grant.qiGain,
      riskTriggered: risk.triggered,
      description: `${entity.staticData.name} ${gainNote}${riskNote}`,
    };
  }
}
