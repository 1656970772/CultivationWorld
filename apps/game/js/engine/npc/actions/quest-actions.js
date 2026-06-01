/**
 * quest-actions —— 任务域行为执行器（从 npc-actions.js 拆分）。
 *
 * 含接取任务 / 执行任务（含猎妖结算）/ 交付任务领赏：
 *   AcceptQuest / DoQuest / TurnInQuest
 * 任务候选筛选、妖兽定位等共享工具统一从 ./npc-action-utils.js 引入。
 */
import { ActionExecutor } from '../../abstract/action.js';
import { applyQuestRewardProfile, describeQuestExtraRewards } from '../quest-rewards.js';
import {
  describeMonsterDrops,
  isMonsterHuntQuest,
  settleMonsterHunt,
} from '../../monster/monster-resources.js';
import {
  getCultivationConfig,
  getEconomyConfig,
  pickQuestCandidate,
  resolveQuestTargetMonster,
} from './npc-action-utils.js';

export class NPCAcceptQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const questTemplates = worldContext.questTemplates;
    if (!questTemplates) {
      return { success: false, description: '任务系统未初始化' };
    }

    const cult = getCultivationConfig(worldContext);
    const rankMaxDifficulty = cult.rankMaxDifficulty || {};

    const rankId = entity.state.get('rankId') || 'mortal';
    const maxDiff = rankMaxDifficulty[rankId] ?? 2;

    const { difficulties, questTypes, randomQuestSpawnChance } = questTemplates;
    const forceMonsterHunt = action?.id === 'act_npc_accept_hunt_quest';
    const economy = getEconomyConfig(worldContext);

    const available = [];
    for (const qt of questTypes) {
      if (forceMonsterHunt && !isMonsterHuntQuest(qt.id, economy)) continue;
      const [minD, maxD] = qt.difficultyRange;
      const effectiveMax = Math.min(maxD, maxDiff);
      if (minD > effectiveMax) continue;

      if (qt.repeatable) {
        for (let d = minD; d <= effectiveMax; d++) {
          available.push({ quest: qt, difficulty: d });
        }
      } else {
        for (let d = minD; d <= effectiveMax; d++) {
          const chance = randomQuestSpawnChance[String(d)] || 0.5;
          if (Math.random() < chance) {
            available.push({ quest: qt, difficulty: d });
          }
        }
      }
    }

    if (available.length === 0) {
      return { success: false, description: `${entity.name} 没有可接取的任务` };
    }

    const picked = pickQuestCandidate(entity, worldContext, available, { forceMonsterHunt });
    const diffInfo = difficulties.find(d => d.level === picked.difficulty);

    entity.state.set('hasActiveQuest', true);
    entity.state.set('activeQuestTypeId', picked.quest.id);
    entity.state.set('activeQuestTypeName', picked.quest.name);
    entity.state.set('activeQuestDifficulty', picked.difficulty);
    entity.state.set('activeQuestDiffName', diffInfo?.name || '');
    entity.state.set('questDaysRemaining', diffInfo?.durationDays || 1);
    entity.state.set('questComplete', false);

    // 锁定任务发生地（固定坐标），弟子做任务时需先走过去
    let questLoc = null;
    if (typeof worldContext.resolveQuestLocation === 'function') {
      questLoc = worldContext.resolveQuestLocation(entity, picked.quest, picked.difficulty);
    }
    if (questLoc && typeof questLoc.x === 'number') {
      entity.state.set('questTargetX', questLoc.x);
      entity.state.set('questTargetY', questLoc.y);
      entity.state.set('questTargetMonsterId', questLoc.monsterId || null);
    } else {
      entity.state.set('questTargetX', null);
      entity.state.set('questTargetY', null);
      entity.state.set('questTargetMonsterId', null);
    }

    const dist = (questLoc && entity.spatial)
      ? Math.abs(questLoc.x - entity.spatial.tileX) + Math.abs(questLoc.y - entity.spatial.tileY)
      : 0;

    return {
      success: true,
      questTypeId: picked.quest.id,
      questType: picked.quest.name,
      difficulty: picked.difficulty,
      difficultyName: diffInfo?.name,
      questTarget: questLoc,
      questDistance: dist,
      description: `${entity.name} 接取了${diffInfo?.name}${picked.quest.name}任务${dist > 0 ? `（地点距 ${dist} 格）` : ''}`,
    };
  }
}

export class NPCDoQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const questTemplates = worldContext.questTemplates;
    const difficulty = entity.state.get('activeQuestDifficulty') || 1;
    const questTypeId = entity.state.get('activeQuestTypeId');
    const questName = entity.state.get('activeQuestTypeName') || '任务';
    const diffName = entity.state.get('activeQuestDiffName') || '';
    const daysLeft = entity.state.get('questDaysRemaining') || 1;

    const diffInfo = questTemplates?.difficulties?.find(d => d.level === difficulty);
    // dangerInjury/dangerDeath 是【整段任务】的总风险；任务按天推进（每天一次 do_quest），
    // 故把总风险摊到每天，使整段累计风险≈配置值，避免长任务因逐日掷骰累计成必死。
    const totalDays = Math.max(1, diffInfo?.durationDays || 1);
    const dangerInjury = (diffInfo?.dangerInjury || 0.05) / totalDays;
    const dangerDeath = (diffInfo?.dangerDeath || 0) / totalDays;

    const roll = Math.random();
    if (roll < dangerDeath) {
      entity.state.set('alive', false);
      entity.alive = false;
      entity.state.set('hasActiveQuest', false);
      entity.state.set('questComplete', false);
      entity._deathInfo = {
        cause: 'quest',
        npcId: entity.id,
        npcName: entity.name,
        factionId: entity.state.get('factionId'),
        ageYears: entity.state.get('ageYears'),
        maxAgeYears: entity.state.get('maxAgeYears'),
        rankName: entity.state.get('rankName'),
        questName: `${diffName}${questName}`,
      };
      return {
        success: false,
        outcome: 'death',
        questTypeId,
        description: `${entity.name} 在执行${diffName}${questName}任务中殒命`,
      };
    }

    if (roll < dangerDeath + dangerInjury) {
      const maxAgeDays = entity.state.get('maxAgeDays') || 1;
      const ageDays = entity.state.get('ageDays') || 0;
      // 受伤损耗寿元：相对寿命的小比例（按难度递增），避免一次受伤折损过多
      const lifeLoss = Math.floor(maxAgeDays * (0.002 + difficulty * 0.001));
      entity.state.set('ageDays', ageDays + lifeLoss);
      entity.state.set('lifeRatio', (ageDays + lifeLoss) / maxAgeDays);
      entity.state.set('injuryLevel', (entity.state.get('injuryLevel') || 0) + 1);
    }

    if (daysLeft <= 1) {
      if (isMonsterHuntQuest(questTypeId, getEconomyConfig(worldContext))) {
        const monster = resolveQuestTargetMonster(entity, worldContext, difficulty);
        const hunt = settleMonsterHunt(entity, monster, worldContext);
        if (!hunt.success) {
          entity.state.set('questDaysRemaining', 0);
          entity.state.set('questComplete', false);
          entity.state.set('hasActiveQuest', false);
          entity.state.set('questTargetMonsterId', null);
          const reason = hunt.outcome === 'target_lost'
            ? '目标妖兽已失踪'
            : (hunt.outcome === 'death' ? '殒身' : '受创败退');
          return {
            success: false,
            outcome: hunt.outcome,
            questTypeId,
            winChance: hunt.winChance,
            description: `${entity.name} 执行${diffName}${questName}任务失败：${reason}`,
          };
        }
        const lootDesc = describeMonsterDrops(hunt.drops);
        entity.state.set('questDaysRemaining', 0);
        entity.state.set('questComplete', true);
        return {
          success: true,
          outcome: 'complete',
          questTypeId,
          monsterId: monster?.id || null,
          monsterName: monster?.name || monster?.staticData?.name || null,
          monsterDrops: hunt.drops,
          description: `${entity.name} 完成了${diffName}${questName}任务，斩杀${monster?.name || '妖兽'}，取得${lootDesc}`,
        };
      }

      entity.state.set('questDaysRemaining', 0);
      entity.state.set('questComplete', true);
      return {
        success: true,
        outcome: 'complete',
        questTypeId,
        description: `${entity.name} 完成了${diffName}${questName}任务`,
      };
    }

    entity.state.set('questDaysRemaining', daysLeft - 1);
    entity.state.set('questComplete', false);
    return {
      success: true,
      outcome: 'in_progress',
      questTypeId,
      daysLeft: daysLeft - 1,
      description: `${entity.name} 正在执行${diffName}${questName}任务（剩余${daysLeft - 1}天）`,
    };
  }
}

export class NPCTurnInQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const questTemplates = worldContext.questTemplates;
    const difficulty = entity.state.get('activeQuestDifficulty') || 1;
    const questTypeId = entity.state.get('activeQuestTypeId');
    const questName = entity.state.get('activeQuestTypeName') || '任务';
    const diffName = entity.state.get('activeQuestDiffName') || '';
    const factionId = entity.state.get('factionId');

    const diffInfo = questTemplates?.difficulties?.find(d => d.level === difficulty);
    const baseReward = diffInfo?.rewardStones || 5;
    const rewardContribution = diffInfo?.rewardContribution || 2;
    const factionStones = diffInfo?.factionStones || 10;
    const isWanderer = !factionId;

    // 散修走悬赏阁/坊市：悬赏佣金抽成后，散修拿到的灵石更多（无宗门抽水），
    // 但没有宗门贡献点。参考凡人修仙传/完美世界「坊市悬赏榜、私人委托」设定。
    const bountyCfg = getCultivationConfig(worldContext).bounty || {};
    const wandererBonus = bountyCfg.wandererRewardMultiplier ?? 1.5;
    const rewardStones = isWanderer ? Math.round(baseReward * wandererBonus) : baseReward;

    let bountyOrgName = null;
    let faction = null;
    if (isWanderer) {
      // 悬赏由悬赏阁/坊市垫付：从其库存扣除（不足则照常发放，视作公共平台兜底）
      const org = worldContext._resolveBountyOrgFor
        ? worldContext._resolveBountyOrgFor(entity)
        : null;
      if (org && org.alive) {
        bountyOrgName = org.name;
        const orgStone = org.inventory?.getAmount('low_spirit_stone') || 0;
        if (orgStone > 0) org.inventory.remove('low_spirit_stone', Math.min(rewardStones, orgStone));
      }
    } else if (worldContext.entityRegistry) {
      faction = worldContext.entityRegistry.getById(factionId);
      if (faction && faction.alive) {
        faction.inventory.add('low_spirit_stone', factionStones);
      }
    }

    entity.inventory.add('low_spirit_stone', rewardStones);
    const extraRewards = applyQuestRewardProfile(
      entity,
      isWanderer ? null : faction,
      questTemplates,
      difficulty,
      questTypeId,
    );

    if (!isWanderer) {
      const contribution = entity.state.get('contribution') || 0;
      entity.state.set('contribution', contribution + rewardContribution);
      // 月度贡献：当月累计，供月末考核与排名（月末清零）
      const monthly = entity.state.get('monthlyContribution') || 0;
      entity.state.set('monthlyContribution', monthly + rewardContribution);
    }

    const totalQuests = entity.state.get('totalQuestsCompleted') || 0;
    entity.state.set('totalQuestsCompleted', totalQuests + 1);

    entity.state.set('hasActiveQuest', false);
    entity.state.set('questComplete', false);
    entity.state.set('questTurnedIn', true);
    entity.state.set('activeQuestTypeId', null);
    entity.state.set('activeQuestTypeName', null);
    entity.state.set('activeQuestDifficulty', 0);
    entity.state.set('activeQuestDiffName', null);
    entity.state.set('questDaysRemaining', 0);
    entity.state.set('questTargetX', null);
    entity.state.set('questTargetY', null);
    entity.state.set('questTargetMonsterId', null);

    const description = isWanderer
      ? `${entity.name} 向${bountyOrgName || '悬赏阁'}交付了${diffName}${questName}悬赏，领取 ${rewardStones} 灵石`
      : `${entity.name} 交付了${diffName}${questName}任务，获得 ${rewardStones} 灵石、${rewardContribution} 贡献点，宗门获得 ${factionStones} 灵石`;

    const extraDescription = describeQuestExtraRewards(extraRewards);

    return {
      success: true,
      eventType: extraRewards.questItemReward > 0 ? 'quest_item_reward' : 'quest_turn_in',
      isWanderer,
      rewardStones,
      rewardContribution: isWanderer ? 0 : rewardContribution,
      factionStones: isWanderer ? 0 : factionStones,
      extraRewards,
      bountyOrgName,
      description: `${description}${extraDescription}`,
    };
  }
}
