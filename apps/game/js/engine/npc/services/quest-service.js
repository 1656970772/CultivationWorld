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
} from '../actions/npc-action-utils.js';
import { chooseSafeHuntTarget } from './combat-route-risk.js';
import {
  createQuestSourceStrategyRegistry,
  pickBoardQuest,
  validateBoardQuestForEntity,
} from '../../quest/quest-source-strategies.js';

function questContext(entity, worldContext) {
  const difficulty = entity.state.get('activeQuestDifficulty') || 1;
  const questTypeId = entity.state.get('activeQuestTypeId');
  const questName = entity.state.get('activeQuestTypeName') || '任务';
  const diffName = entity.state.get('activeQuestDiffName') || '';
  const questTemplates = worldContext.questTemplates;
  const diffInfo = questTemplates?.difficulties?.find(d => d.level === difficulty);
  return { questTemplates, difficulty, questTypeId, questName, diffName, diffInfo };
}

function randomFn(worldContext) {
  if (typeof worldContext?.rng?.fn === 'function') {
    const fn = worldContext.rng.fn();
    return typeof fn === 'function' ? fn : () => fn;
  }
  if (typeof worldContext?.rng?.next === 'function') return () => worldContext.rng.next();
  return Math.random;
}

function economicSource(id = 'quest_reward_source') {
  return {
    id,
    name: id,
    inventory: {
      getAmount() { return Number.MAX_SAFE_INTEGER; },
      remove() { return true; },
      add() {},
    },
    state: {
      get() { return Number.MAX_SAFE_INTEGER; },
      set() {},
    },
  };
}

function questValue(diffInfo = {}, difficulty = 1) {
  const stones = Number(diffInfo.rewardStones) || 0;
  const contribution = Number(diffInfo.rewardContribution) || 0;
  const factionStones = Number(diffInfo.factionStones) || 0;
  return Math.round(stones + contribution * 10 + factionStones * 0.2 + difficulty * 25);
}

function questRiskScore(diffInfo = {}, difficulty = 1) {
  const injury = Number(diffInfo.dangerInjury) || 0;
  const death = Number(diffInfo.dangerDeath) || 0;
  return Number((injury + death * 10 + difficulty * 0.1).toFixed(4));
}

function monsterName(monster) {
  return monster?.name || monster?.staticData?.name || monster?.id || null;
}

function monsterGrade(monster, fallback = null) {
  return monster?.grade || monster?.staticData?.get?.('grade') || fallback;
}

function readQuestInstance(entity) {
  return entity?.state?.get?.('activeQuestInstance') || null;
}

function writeQuestInstance(entity, instance) {
  entity?.state?.set?.('activeQuestInstance', instance);
  return instance;
}

function nextQuestInstanceId(entity, worldContext) {
  const day = worldContext?.currentDay ?? 0;
  const count = (entity.state.get('questInstanceCount') || 0) + 1;
  entity.state.set('questInstanceCount', count);
  return `quest_${day}_${entity.id || 'npc'}_${count}`;
}

function questRewards(diffInfo = {}, difficulty = 1) {
  return {
    stones: Number(diffInfo.rewardStones) || 5,
    contribution: Number(diffInfo.rewardContribution) || 2,
    factionStones: Number(diffInfo.factionStones) || 10,
    difficulty,
  };
}

function pickBoardQuestFromSources(entity, worldContext, opts = {}) {
  const registry = worldContext?.questSourceStrategyRegistry || createQuestSourceStrategyRegistry();
  if (typeof registry?.pick === 'function') {
    return registry.pick({ entity, worldContext, opts });
  }
  const strategy = registry?.get?.('board') || registry?.get?.('quest_board');
  if (typeof strategy === 'function') {
    return strategy({ entity, worldContext, opts });
  }
  if (typeof strategy?.pick === 'function') {
    return strategy.pick({ entity, worldContext, opts });
  }
  return pickBoardQuest(entity, worldContext, opts);
}

function buildQuestTarget(picked, questLoc) {
  const quest = picked.quest || {};
  const monsterIds = Array.isArray(questLoc?.monsterIds)
    ? questLoc.monsterIds.filter(Boolean)
    : (questLoc?.monsterId ? [questLoc.monsterId] : []);
  const monsterTarget = quest.locationTarget === 'monster' || monsterIds.length > 0 || quest.category === 'combat';
  const requiredKills = monsterTarget ? Math.max(1, Number(questLoc?.requiredKills ?? quest.requiredKills ?? 1) || 1) : 0;
  return {
    kind: monsterTarget ? 'monster' : (questLoc ? 'location' : 'none'),
    x: typeof questLoc?.x === 'number' ? questLoc.x : null,
    y: typeof questLoc?.y === 'number' ? questLoc.y : null,
    monsterIds,
    monsterName: null,
    monsterGrade: null,
    requiredKills,
    killedCount: 0,
  };
}

function buildQuestInstance(entity, worldContext, picked, diffInfo, questLoc) {
  const quest = picked.quest || {};
  return {
    id: nextQuestInstanceId(entity, worldContext),
    templateId: quest.id,
    type: quest.id,
    name: quest.name,
    category: quest.category || null,
    difficulty: picked.difficulty,
    value: questValue(diffInfo, picked.difficulty),
    riskKey: quest.riskKey || null,
    riskScore: questRiskScore(diffInfo, picked.difficulty),
    source: quest.source || 'quest_board',
    state: 'accepted',
    target: buildQuestTarget(picked, questLoc),
    rewards: questRewards(diffInfo, picked.difficulty),
  };
}

function updateQuestInstanceTarget(entity, patch) {
  const instance = readQuestInstance(entity);
  if (!instance) return null;
  const target = { ...(instance.target || {}), ...patch };
  const next = { ...instance, target };
  writeQuestInstance(entity, next);
  return next;
}

function markQuestInstanceFailed(entity, reason = 'target_lost') {
  const instance = readQuestInstance(entity);
  if (!instance) return null;
  const next = { ...instance, state: 'failed', failureReason: reason || 'target_lost' };
  writeQuestInstance(entity, next);
  return next;
}

function markQuestInstanceCompleted(entity) {
  const instance = readQuestInstance(entity);
  if (!instance) return null;
  const next = { ...instance, state: 'completed', failureReason: null };
  writeQuestInstance(entity, next);
  return next;
}

function recordMonsterKillProgress(entity, monster) {
  const instance = readQuestInstance(entity);
  if (!instance?.target || instance.target.kind !== 'monster') {
    return { killedCount: 1, requiredKills: 1, complete: true, instance: null };
  }
  const target = instance.target;
  const requiredKills = Math.max(1, Number(target.requiredKills ?? 1) || 1);
  const killedCount = Math.min(requiredKills, (Number(target.killedCount ?? 0) || 0) + 1);
  const monsterIds = Array.isArray(target.monsterIds) ? [...target.monsterIds] : [];
  if (monster?.id && !monsterIds.includes(monster.id)) monsterIds.push(monster.id);
  const killedMonsterIds = Array.isArray(target.killedMonsterIds) ? [...target.killedMonsterIds] : [];
  if (monster?.id && !killedMonsterIds.includes(monster.id)) killedMonsterIds.push(monster.id);
  const next = updateQuestInstanceTarget(entity, {
    monsterIds,
    killedMonsterIds,
    killedCount,
    monsterName: monsterName(monster) || target.monsterName || null,
    monsterGrade: monsterGrade(monster, target.monsterGrade) || target.monsterGrade || null,
  });
  const complete = killedCount >= requiredKills;
  if (complete) markQuestInstanceCompleted(entity);
  else writeQuestInstance(entity, { ...next, state: 'in_progress' });
  return { killedCount, requiredKills, complete, instance: readQuestInstance(entity) };
}

function isAliveMonster(monster) {
  return !!monster && monster.alive !== false && monster.state?.get?.('alive') !== false;
}

function huntTargetPoint(monster) {
  const sp = monster?.spatial;
  const x = sp?.tileX ?? sp?.x;
  const y = sp?.tileY ?? sp?.y;
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

function huntCandidates(entity, worldContext, locked, difficulty) {
  const registry = worldContext?.entityRegistry;
  const monsters = typeof registry?.getAliveByType === 'function'
    ? registry.getAliveByType('monster').filter(m => huntTargetPoint(m))
    : [];
  const all = [];
  if (isAliveMonster(locked) && huntTargetPoint(locked)) all.push(locked);
  for (const monster of monsters) {
    if (!all.some(item => item.id === monster.id)) all.push(monster);
  }

  const cfg = getEconomyConfig(worldContext)?.monsterResources || {};
  const gap = cfg.retargetGradeGap ?? 2;
  const desired = Number(difficulty) || 1;
  const sameBand = all.filter(monster => Math.abs((monsterGrade(monster, desired) || 1) - desired) <= gap);
  return sameBand.length > 0 ? sameBand : all;
}

function bindMonsterState(entity, monster, difficulty) {
  const point = huntTargetPoint(monster);
  if (!point) return;
  entity.state.set('questTargetX', point.x);
  entity.state.set('questTargetY', point.y);
  entity.state.set('questTargetMonsterId', monster.id);
  entity.state.set('questTargetMonsterName', monsterName(monster));
  entity.state.set('questTargetMonsterGrade', monsterGrade(monster, difficulty));
  entity.state.set('questTargetMonsterCount', 1);
  const instance = readQuestInstance(entity);
  const target = instance?.target || {};
  const monsterIds = Array.isArray(target.monsterIds) ? [...target.monsterIds] : [];
  if (monster.id && !monsterIds.includes(monster.id)) monsterIds.push(monster.id);
  updateQuestInstanceTarget(entity, {
    kind: 'monster',
    x: point.x,
    y: point.y,
    monsterIds,
    monsterName: monsterName(monster),
    monsterGrade: monsterGrade(monster, difficulty),
    requiredKills: Math.max(1, Number(target.requiredKills ?? 1) || 1),
    killedCount: Number(target.killedCount ?? 0) || 0,
  });
}

function resolveHuntParty(entity, worldContext) {
  const ids = entity.state.get('huntPartyIds');
  if (!Array.isArray(ids) || typeof worldContext?.entityRegistry?.getById !== 'function') {
    return [entity];
  }
  const party = [];
  for (const id of ids) {
    const member = id === entity.id ? entity : worldContext.entityRegistry.getById(id);
    if (member && member.alive !== false && member.state?.get?.('alive') !== false) {
      party.push(member);
    }
  }
  return party.length > 0 ? party : [entity];
}

function resolveSafeQuestTargetMonster(entity, worldContext, difficulty) {
  const registry = worldContext?.entityRegistry;
  if (!registry) return { monster: null, reason: 'target_lost' };

  let lockedId = entity.state.get('questTargetMonsterId');
  if (entity.state.get('needsEasierHuntTarget') === true) {
    const excluded = entity.state.get('excludedHuntMonsterIds');
    const nextExcluded = Array.isArray(excluded) ? [...excluded] : [];
    if (lockedId && !nextExcluded.includes(lockedId)) nextExcluded.push(lockedId);
    entity.state.set('excludedHuntMonsterIds', nextExcluded);
    entity.state.set('questTargetMonsterId', null);
    lockedId = null;
  }
  const locked = lockedId ? registry.getById?.(lockedId) : null;
  const candidates = huntCandidates(entity, worldContext, locked, difficulty);
  if (candidates.length === 0) return { monster: null, reason: 'target_lost' };

  const cfg = getEconomyConfig(worldContext)?.monsterResources || {};
  const choice = chooseSafeHuntTarget(entity, candidates, worldContext, {
    desiredGrade: difficulty,
    routeRiskThreshold: cfg.huntRouteRiskThreshold ?? 4,
    directRiskThreshold: cfg.huntDirectRiskThreshold ?? 8,
    radius: cfg.huntRouteThreatRadius ?? 2,
    maxDistance: cfg.huntMaxTargetDistance ?? 60,
    stopAtFirstSafe: true,
  });
  if (!choice.monster) {
    return { monster: null, reason: 'safe_hunt_target_missing', rejected: choice.rejected };
  }
  entity.state.set('needsEasierHuntTarget', false);
  entity.state.set('monsterTooDangerous', false);
  return { monster: choice.monster, routeRisk: choice.routeRisk, rejected: choice.rejected };
}

export function acceptQuest(entity, worldContext, opts = {}) {
  const questTemplates = worldContext.questTemplates;
  if (!questTemplates) {
    return { success: false, reason: 'quest_templates_missing', description: '任务系统未初始化' };
  }

  const boardQuest = pickBoardQuestFromSources(entity, worldContext, opts);
  if (boardQuest) {
    return acceptBoardQuest(entity, worldContext, boardQuest);
  }

  const cult = getCultivationConfig(worldContext);
  const rankMaxDifficulty = cult.rankMaxDifficulty || {};
  const rankId = entity.state.get('rankId') || 'mortal';
  const maxDiff = rankMaxDifficulty[rankId] ?? 2;
  const { difficulties, questTypes, randomQuestSpawnChance } = questTemplates;
  const forceMonsterHunt = !!opts.forceMonsterHunt;
  const economy = getEconomyConfig(worldContext);
  const roll = randomFn(worldContext);

  const available = [];
  for (const qt of questTypes) {
    if (forceMonsterHunt && !isMonsterHuntQuest(qt.id, economy)) continue;
    const [minD, maxD] = qt.difficultyRange;
    const effectiveMax = Math.min(maxD, maxDiff);
    if (minD > effectiveMax) continue;

    for (let d = minD; d <= effectiveMax; d++) {
      const chance = qt.repeatable ? 1 : (randomQuestSpawnChance[String(d)] || 0.5);
      if (roll() < chance) {
        available.push({ quest: qt, difficulty: d });
      }
    }
  }

  if (available.length === 0) {
    return {
      success: false,
      reason: 'no_available_quest',
      description: `${entity.name} 没有可接取的任务`,
    };
  }

  const picked = pickQuestCandidate(entity, worldContext, available, { forceMonsterHunt });
  const diffInfo = difficulties.find(d => d.level === picked.difficulty);
  let questLoc = null;
  if (typeof worldContext.resolveQuestLocation === 'function') {
    questLoc = worldContext.resolveQuestLocation(entity, picked.quest, picked.difficulty);
  }

  writeQuestState(entity, picked, diffInfo, questLoc, worldContext);
  entity.state.set('activeBoardQuestId', null);

  const dist = (questLoc && entity.spatial)
    ? Math.abs(questLoc.x - entity.spatial.tileX) + Math.abs(questLoc.y - entity.spatial.tileY)
    : 0;

  return {
    success: true,
    picked,
    diffInfo,
    questLoc,
    questTypeId: picked.quest.id,
    questType: picked.quest.name,
    questCategory: picked.quest.category || null,
    questValue: questValue(diffInfo, picked.difficulty),
    questRiskScore: questRiskScore(diffInfo, picked.difficulty),
    difficulty: picked.difficulty,
    difficultyName: diffInfo?.name,
    questTarget: questLoc,
    questDistance: dist,
    description: `${entity.name} 接取了${diffInfo?.name}${picked.quest.name}任务${dist > 0 ? `（地点距 ${dist} 格）` : ''}`,
  };
}

export function acceptBoardQuest(entity, worldContext, boardQuest) {
  const questTemplates = worldContext.questTemplates;
  const validation = validateBoardQuestForEntity(entity, worldContext, boardQuest);
  if (!validation.success) return validation;
  const quest = validation.quest;
  const difficulty = validation.difficulty;
  const diffInfo = questTemplates?.difficulties?.find(d => d.level === difficulty);
  if (!diffInfo) return { success: false, reason: 'board_quest_difficulty_missing' };

  const accepted = worldContext.questBoard.accept(boardQuest.id, entity, worldContext.currentDay ?? 0);
  if (!accepted.success) return accepted;

  let questLoc = null;
  if (typeof worldContext.resolveQuestLocation === 'function') {
    questLoc = worldContext.resolveQuestLocation(entity, quest, difficulty);
  }

  writeQuestState(entity, { quest, difficulty }, diffInfo, questLoc, worldContext);
  entity.state.set('activeBoardQuestId', boardQuest.id);
  const instance = readQuestInstance(entity) || {};
  writeQuestInstance(entity, {
    ...instance,
    boardQuestId: boardQuest.id,
    issuerType: boardQuest.issuerType || null,
    issuerId: boardQuest.issuerId || null,
    issuerName: boardQuest.issuerName || null,
    questBoard: boardQuest.questBoard || null,
    questKind: boardQuest.questKind || 'generic_task',
    escrowId: boardQuest.escrowId || null,
    rewardContribution: Number(boardQuest.rewardContribution || 0),
  });

  const dist = (questLoc && entity.spatial)
    ? Math.abs(questLoc.x - entity.spatial.tileX) + Math.abs(questLoc.y - entity.spatial.tileY)
    : 0;

  return {
    success: true,
    picked: { quest, difficulty },
    diffInfo,
    questLoc,
    boardQuestId: boardQuest.id,
    issuerType: boardQuest.issuerType || null,
    issuerId: boardQuest.issuerId || null,
    issuerName: boardQuest.issuerName || null,
    questBoard: boardQuest.questBoard || null,
    questKind: boardQuest.questKind || 'generic_task',
    escrowId: boardQuest.escrowId || null,
    rewardContribution: Number(boardQuest.rewardContribution || 0),
    questTypeId: quest.id,
    questType: quest.name,
    questCategory: quest.category || null,
    questValue: questValue(diffInfo, difficulty),
    questRiskScore: questRiskScore(diffInfo, difficulty),
    difficulty,
    difficultyName: diffInfo?.name,
    questTarget: questLoc,
    questDistance: dist,
    description: `${entity.name} 从${boardQuest.issuerName || '任务板'}接取了${diffInfo?.name}${quest.name}任务${dist > 0 ? `（地点距 ${dist} 格）` : ''}`,
  };
}

export function writeQuestState(entity, picked, diffInfo, questLoc, worldContext = {}) {
  entity.state.set('hasActiveQuest', true);
  entity.state.set('activeQuestTypeId', picked.quest.id);
  entity.state.set('activeQuestTypeName', picked.quest.name);
  entity.state.set('activeQuestCategory', picked.quest.category || null);
  entity.state.set('activeQuestDifficulty', picked.difficulty);
  entity.state.set('activeQuestDiffName', diffInfo?.name || '');
  entity.state.set('activeQuestValue', questValue(diffInfo, picked.difficulty));
  entity.state.set('activeQuestRiskScore', questRiskScore(diffInfo, picked.difficulty));
  entity.state.set('questDaysRemaining', diffInfo?.durationDays || 1);
  entity.state.set('questComplete', false);
  writeQuestInstance(entity, buildQuestInstance(entity, worldContext, picked, diffInfo, questLoc));

  if (questLoc && typeof questLoc.x === 'number') {
    entity.state.set('questTargetX', questLoc.x);
    entity.state.set('questTargetY', questLoc.y);
    entity.state.set('questTargetMonsterId', questLoc.monsterId || null);
    entity.state.set('questTargetMonsterName', null);
    entity.state.set('questTargetMonsterGrade', null);
    entity.state.set('questTargetMonsterCount', questLoc.monsterId ? 1 : 0);
  } else {
    entity.state.set('questTargetX', null);
    entity.state.set('questTargetY', null);
    entity.state.set('questTargetMonsterId', null);
    entity.state.set('questTargetMonsterName', null);
    entity.state.set('questTargetMonsterGrade', null);
    entity.state.set('questTargetMonsterCount', 0);
  }
}

export function bindMonsterHuntTarget(entity, worldContext) {
  const { difficulty, questTypeId } = questContext(entity, worldContext);
  if (!isMonsterHuntQuest(questTypeId, getEconomyConfig(worldContext))) {
    return { success: true, skipped: true, reason: 'not_monster_hunt' };
  }

  const resolved = resolveSafeQuestTargetMonster(entity, worldContext, difficulty);
  const monster = resolved.monster;
  if (!monster) return { success: false, reason: resolved.reason || 'target_lost', rejected: resolved.rejected || [] };

  const point = huntTargetPoint(monster);
  bindMonsterState(entity, monster, difficulty);

  return {
    success: true,
    monster,
    target: { x: point?.x, y: point?.y, monsterId: monster.id },
    monsterId: monster.id,
    monsterName: monsterName(monster),
    monsterGrade: monsterGrade(monster, difficulty),
    monsterCount: 1,
    routeRisk: resolved.routeRisk || null,
    rejected: resolved.rejected || [],
  };
}

export function assessMonsterHuntRisk(entity, worldContext) {
  const { difficulty, questTypeId } = questContext(entity, worldContext);
  if (!isMonsterHuntQuest(questTypeId, getEconomyConfig(worldContext))) {
    return { success: true, skipped: true, reason: 'not_monster_hunt' };
  }
  const bound = bindMonsterHuntTarget(entity, worldContext);
  const monster = bound.monster;
  if (!bound.success || !monster) return { success: false, reason: bound.reason || 'target_lost' };
  const npcPower = typeof worldContext.npcCombatPower === 'function'
    ? worldContext.npcCombatPower(entity)
    : 50;
  const monsterPower = Number(monster.state?.get?.('power') || monster.grade * 30 || difficulty * 30);
  return {
    success: true,
    monsterId: monster.id,
    combatRiskScore: monsterPower / Math.max(1, npcPower),
    monsterPower,
    npcPower,
  };
}

export function prepareMonsterHunt(entity, worldContext) {
  const { questTypeId } = questContext(entity, worldContext);
  if (!isMonsterHuntQuest(questTypeId, getEconomyConfig(worldContext))) {
    return { success: true, skipped: true, reason: 'not_monster_hunt' };
  }
  return { success: true, prepared: true };
}

export function executeQuestDay(entity, worldContext) {
  const { questTemplates, difficulty, questTypeId, questName, diffName, diffInfo } = questContext(entity, worldContext);
  const daysLeft = entity.state.get('questDaysRemaining') || 1;
  const totalDays = Math.max(1, diffInfo?.durationDays || 1);
  const dangerInjury = (diffInfo?.dangerInjury || 0.05) / totalDays;
  const dangerDeath = (diffInfo?.dangerDeath || 0) / totalDays;

  const roll = randomFn(worldContext)();
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
    const lifeLoss = Math.floor(maxAgeDays * (0.002 + difficulty * 0.001));
    entity.state.set('ageDays', ageDays + lifeLoss);
    entity.state.set('lifeRatio', (ageDays + lifeLoss) / maxAgeDays);
    entity.state.set('injuryLevel', (entity.state.get('injuryLevel') || 0) + 1);
  }

  if (daysLeft > 1) {
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

  if (isMonsterHuntQuest(questTypeId, getEconomyConfig(worldContext))) {
    const bound = bindMonsterHuntTarget(entity, worldContext);
    const monster = bound.monster;
    if (!bound.success || !monster) {
      markQuestInstanceFailed(entity, bound.reason || 'target_lost');
      entity.state.set('questDaysRemaining', 0);
      entity.state.set('questComplete', false);
      entity.state.set('hasActiveQuest', false);
      entity.state.set('questTargetMonsterId', null);
      entity.state.set('questTargetMonsterName', null);
      entity.state.set('questTargetMonsterGrade', null);
      entity.state.set('questTargetMonsterCount', 0);
      return {
        success: false,
        outcome: bound.reason || 'target_lost',
        questTypeId,
        description: `${entity.name} 执行${diffName}${questName}任务失败：找不到安全斩妖目标`,
      };
    }
    const hunt = settleMonsterHunt(entity, monster, worldContext, randomFn(worldContext), {
      party: resolveHuntParty(entity, worldContext),
    });
    if (!hunt.success) {
      markQuestInstanceFailed(entity, hunt.outcome || 'hunt_failed');
      entity.state.set('questDaysRemaining', 0);
      entity.state.set('questComplete', false);
      entity.state.set('hasActiveQuest', false);
      entity.state.set('questTargetMonsterId', null);
      entity.state.set('questTargetMonsterName', null);
      entity.state.set('questTargetMonsterGrade', null);
      entity.state.set('questTargetMonsterCount', 0);
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
    const progress = recordMonsterKillProgress(entity, monster);
    if (!progress.complete) {
      entity.state.set('questDaysRemaining', 1);
      entity.state.set('questComplete', false);
      entity.state.set('hasActiveQuest', true);
      entity.state.set('questTargetMonsterId', null);
      entity.state.set('questTargetMonsterName', null);
      entity.state.set('questTargetMonsterGrade', null);
      entity.state.set('questTargetMonsterCount', 0);
      return {
        success: true,
        outcome: 'in_progress',
        questTypeId,
        monsterId: monster?.id || null,
        monsterName: monster?.name || monster?.staticData?.name || null,
        monsterDrops: hunt.drops,
        killedCount: progress.killedCount,
        requiredKills: progress.requiredKills,
        activeQuestInstance: progress.instance,
        description: `${entity.name} 完成了${diffName}${questName}阶段目标，斩杀${monster?.name || '妖兽'}，取得${lootDesc}（${progress.killedCount}/${progress.requiredKills}）`,
      };
    }
    entity.state.set('questDaysRemaining', 0);
    entity.state.set('questComplete', true);
    return {
      success: true,
      outcome: 'complete',
      questTypeId,
      monsterId: monster?.id || null,
      monsterName: monster?.name || monster?.staticData?.name || null,
      monsterDrops: hunt.drops,
      huntPartyPower: hunt.huntPartyPower,
      assistNpcIds: hunt.assistNpcIds,
      cultivationExperience: hunt.cultivationExperience,
      companionExperience: hunt.companionExperience,
      killedCount: progress.killedCount,
      requiredKills: progress.requiredKills,
      activeQuestInstance: readQuestInstance(entity),
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
    questTemplates,
  };
}

export function turnInQuest(entity, worldContext) {
  const { questTemplates, difficulty, questTypeId, questName, diffName } = questContext(entity, worldContext);
  const factionId = entity.state.get('factionId');
  const diffInfo = questTemplates?.difficulties?.find(d => d.level === difficulty);
  const activeInstance = readQuestInstance(entity);
  const boardQuestId = activeInstance?.boardQuestId || entity.state.get('activeBoardQuestId') || null;
  const boardQuest = boardQuestId && worldContext?.questBoard?.byId
    ? worldContext.questBoard.byId(boardQuestId)
    : null;
  let boardQuestResult = null;
  if (boardQuestId) {
    const handlerKind = boardQuest?.questKind || activeInstance?.questKind || 'generic_task';
    const handler = worldContext?.questCompletionHandlerRegistry?.get?.(handlerKind);
    if (!handler) {
      return { success: false, reason: `quest_completion_handler_missing:${handlerKind || 'unknown'}` };
    }
    boardQuestResult = handler({
      entity,
      npc: entity,
      completer: entity,
      worldContext,
      questBoard: worldContext.questBoard,
      questId: boardQuestId,
      boardQuestId,
      boardQuest,
      day: worldContext?.currentDay ?? 0,
    });
    if (!boardQuestResult?.success) {
      return {
        success: false,
        reason: boardQuestResult?.reason || 'board_quest_completion_failed',
        boardQuestId,
        boardQuestResult,
      };
    }
    if (activeInstance?.questKind === 'personal_bounty' || boardQuest?.questKind === 'personal_bounty') {
      const totalQuests = entity.state.get('totalQuestsCompleted') || 0;
      entity.state.set('totalQuestsCompleted', totalQuests + 1);
      resetQuestState(entity);
      return {
        success: true,
        eventType: 'quest_turn_in',
        isWanderer: !factionId,
        rewardStones: 0,
        rewardContribution: 0,
        factionStones: 0,
        extraRewards: { questItemReward: 0, rewards: [] },
        bountyOrgName: null,
        transactionId: boardQuestResult?.release?.transactionId || null,
        boardQuestId,
        boardQuestResult,
        description: `${entity.name} 交付了${diffName}${questName}个人悬赏，领取托管奖励`,
      };
    }
  }
  const baseReward = diffInfo?.rewardStones || 5;
  const boardRewardContribution = Number(activeInstance?.rewardContribution || 0);
  const rewardContribution = boardRewardContribution > 0
    ? boardRewardContribution
    : (diffInfo?.rewardContribution || 2);
  const factionStones = diffInfo?.factionStones || 10;
  const isWanderer = !factionId;
  const bountyCfg = getCultivationConfig(worldContext).bounty || {};
  const wandererBonus = bountyCfg.wandererRewardMultiplier ?? 1.5;
  const rewardStones = isWanderer ? Math.round(baseReward * wandererBonus) : baseReward;

  let bountyOrgName = null;
  let faction = null;
  let rewardTransactionId = null;
  let debtOnFailedPayer = null;
  const economicSystem = worldContext?.economicSystem || null;
  if (economicSystem) {
    const systemSource = economicSource();
    const parties = [
      { role: 'receiver', entity },
      { role: 'system_source', entity: systemSource },
    ];
    const transfers = [];
    if (isWanderer) {
      const org = worldContext._resolveBountyOrgFor ? worldContext._resolveBountyOrgFor(entity) : null;
      if (org && org.alive) {
        bountyOrgName = org.name;
        parties.push({ role: 'payer', entity: org });
        transfers.push({ from: 'payer', to: 'receiver', asset: { kind: 'item', itemId: 'low_spirit_stone', quantity: rewardStones } });
        debtOnFailedPayer = org;
      }
    } else if (worldContext.entityRegistry) {
      faction = worldContext.entityRegistry.getById(factionId);
      if (faction && faction.alive) {
        parties.push({ role: 'faction', entity: faction });
        if (rewardStones > 0) {
          transfers.push({ from: 'system_source', to: 'receiver', asset: { kind: 'item', itemId: 'low_spirit_stone', quantity: rewardStones } });
        }
        if (rewardContribution > 0) {
          transfers.push({ from: 'system_source', to: 'receiver', asset: { kind: 'organization_point', pointKey: 'contribution', quantity: rewardContribution } });
          transfers.push({ from: 'system_source', to: 'receiver', asset: { kind: 'organization_point', pointKey: 'monthlyContribution', quantity: rewardContribution } });
        }
        if (factionStones > 0) {
          transfers.push({ from: 'system_source', to: 'faction', asset: { kind: 'faction_state_resource', itemId: 'low_spirit_stone', quantity: factionStones } });
        }
      }
    }
    if (transfers.length > 0) {
      const transaction = economicSystem.settle({
        type: 'quest_reward',
        scenarioId: 'quest_contract',
        day: worldContext?.currentDay ?? 0,
        parties,
        transfers,
        source: { type: 'quest_turn_in', questTypeId },
        visibility: 'institution',
      });
      rewardTransactionId = transaction.transactionId || null;
      if (!transaction.success && debtOnFailedPayer) {
        economicSystem.createDebt({
          day: worldContext?.currentDay ?? 0,
          debtorId: debtOnFailedPayer.id,
          creditorId: entity.id,
          origin: { type: 'quest_reward_shortfall', questTypeId, transactionId: rewardTransactionId },
          assetsDue: [{ kind: 'item', itemId: 'low_spirit_stone', quantity: rewardStones }],
          visibility: 'institution',
        });
      }
    }
  } else if (isWanderer) {
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

  if (!economicSystem) entity.inventory.add('low_spirit_stone', rewardStones);
  const extraRewards = applyQuestRewardProfile(
    entity,
    isWanderer ? null : faction,
    questTemplates,
    difficulty,
    questTypeId,
    randomFn(worldContext),
  );

  if (!isWanderer && !economicSystem) {
    const contribution = entity.state.get('contribution') || 0;
    entity.state.set('contribution', contribution + rewardContribution);
    const monthly = entity.state.get('monthlyContribution') || 0;
    entity.state.set('monthlyContribution', monthly + rewardContribution);
  }

  const totalQuests = entity.state.get('totalQuestsCompleted') || 0;
  entity.state.set('totalQuestsCompleted', totalQuests + 1);
  resetQuestState(entity);

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
    transactionId: rewardTransactionId,
    boardQuestId,
    boardQuestResult,
    description: `${description}${extraDescription}`,
  };
}

export function resetQuestState(entity) {
  entity.state.set('hasActiveQuest', false);
  entity.state.set('questComplete', false);
  entity.state.set('questTurnedIn', true);
  entity.state.set('activeQuestTypeId', null);
  entity.state.set('activeQuestTypeName', null);
  entity.state.set('activeQuestCategory', null);
  entity.state.set('activeQuestDifficulty', 0);
  entity.state.set('activeQuestDiffName', null);
  entity.state.set('activeQuestValue', 0);
  entity.state.set('activeQuestRiskScore', 0);
  entity.state.set('questDaysRemaining', 0);
  entity.state.set('questTargetX', null);
  entity.state.set('questTargetY', null);
  entity.state.set('questTargetMonsterId', null);
  entity.state.set('questTargetMonsterName', null);
  entity.state.set('questTargetMonsterGrade', null);
  entity.state.set('questTargetMonsterCount', 0);
  entity.state.set('activeBoardQuestId', null);
  entity.state.set('activeQuestInstance', null);
}
