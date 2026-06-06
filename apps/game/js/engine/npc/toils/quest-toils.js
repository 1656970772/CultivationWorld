import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';
import {
  acceptQuest,
  bindMonsterHuntTarget,
  executeQuestDay,
  prepareMonsterHunt,
  turnInQuest,
} from '../services/quest-service.js';
import { applyCultivationExperience } from '../cultivation-experience.js';
import { scoreRouteRisk } from '../services/combat-route-risk.js';
import { assessCombatRisk, combatRiskBranchReason } from './combat-toils.js';

function read(entity, key) {
  if (typeof entity?.state?.get === 'function') return entity.state.get(key);
  return entity?.state?.[key];
}

function write(entity, key, value) {
  if (typeof entity?.state?.set === 'function') {
    entity.state.set(key, value);
    return;
  }
  if (entity?.state) entity.state[key] = value;
}

function normalizeTarget(entity) {
  const x = read(entity, 'questTargetX');
  const y = read(entity, 'questTargetY');
  if (typeof x === 'number' && typeof y === 'number') return { x, y };
  return null;
}

function applyQuestExperience(entity, worldContext, job, result, sourceKind, outcome) {
  const difficulty = read(entity, 'activeQuestDifficulty') || result?.difficulty || job?.context?.difficulty || 1;
  const value = job?.context?.value
    ?? result?.monsterPower
    ?? result?.value
    ?? read(entity, 'activeQuestValue')
    ?? difficulty * 100;
  const riskScore = job?.context?.combatRiskScore
    ?? result?.combatRiskScore
    ?? read(entity, 'activeQuestRiskScore')
    ?? (result?.winChance != null ? Math.max(0, 1 - result.winChance) : difficulty * 0.1);
  return applyCultivationExperience(entity, worldContext, {
    sourceKind,
    value,
    riskScore,
    durationDays: job?.context?.durationDays || result?.durationDays || 1,
    outcome,
  });
}

export class NPCAcceptQuestToilExecutor extends ToilExecutor {
  run(entity, worldContext, job) {
    const result = acceptQuest(entity, worldContext, {
      forceMonsterHunt: !!job?.context?.forceMonsterHunt,
    });
    if (!result.success) {
      return { status: ToilResultStatus.FAILED, reason: result.reason || 'quest_accept_failed' };
    }
    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'quest_accepted',
      contextPatch: {
        questTypeId: result.questTypeId,
        questCategory: result.questCategory,
        difficulty: result.difficulty,
        value: result.questValue,
        riskScore: result.questRiskScore,
        questTarget: result.questTarget,
        durationDays: result.diffInfo?.durationDays || 1,
      },
    };
  }
}

export class NPCBindMonsterHuntQuestToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const result = bindMonsterHuntTarget(entity, worldContext);
    if (!result.success) {
      return { status: ToilResultStatus.REPLAN, reason: result.reason || 'monster_hunt_target_missing' };
    }
    return {
      status: ToilResultStatus.SUCCESS,
      reason: result.skipped ? 'monster_hunt_target_skipped' : 'monster_hunt_target_bound',
      contextPatch: result,
    };
  }
}

export class NPCAssessMonsterHuntRiskToilExecutor extends ToilExecutor {
  run(entity, worldContext, job) {
    const bound = bindMonsterHuntTarget(entity, worldContext);
    if (!bound.success) {
      return { status: ToilResultStatus.REPLAN, reason: bound.reason || 'monster_hunt_risk_unavailable' };
    }
    const result = assessCombatRisk(entity, worldContext, {
      ...(job?.context || {}),
      monster: bound.monster,
      monsterId: bound.monsterId,
      monsterGrade: bound.monsterGrade,
    });
    const reason = combatRiskBranchReason(result);
    if (reason) {
      return {
        status: ToilResultStatus.REPLAN,
        reason,
        contextPatch: {
          ...bound,
          combatRiskScore: result.riskScore,
          monsterPower: result.monsterPower,
          huntPartyPower: result.huntPartyPower,
        },
      };
    }
    return {
      status: ToilResultStatus.SUCCESS,
      reason: bound.skipped ? 'monster_hunt_risk_skipped' : 'monster_hunt_risk_assessed',
      contextPatch: {
        ...bound,
        combatRiskScore: result.riskScore,
        monsterPower: result.monsterPower,
        huntPartyPower: result.huntPartyPower,
      },
    };
  }
}

export class NPCPrepareMonsterHuntToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const result = prepareMonsterHunt(entity, worldContext);
    if (!result.success) {
      return { status: ToilResultStatus.REPLAN, reason: result.reason || 'monster_hunt_prepare_failed' };
    }
    return {
      status: ToilResultStatus.SUCCESS,
      reason: result.skipped ? 'monster_hunt_prepare_skipped' : 'monster_hunt_prepared',
      contextPatch: result,
    };
  }
}

export class NPCMoveToQuestTargetToilExecutor extends ToilExecutor {
  run(entity) {
    const target = normalizeTarget(entity);
    if (!target) return { status: ToilResultStatus.FAILED, reason: 'quest_target_missing' };
    if (!entity.spatial) return { status: ToilResultStatus.SUCCESS, reason: 'no_spatial' };
    if (entity.spatial.tileX === target.x && entity.spatial.tileY === target.y) {
      return { status: ToilResultStatus.SUCCESS, reason: 'arrived_quest_target' };
    }
    if (typeof entity.spatial.setDestination !== 'function') {
      return { status: ToilResultStatus.BLOCKED, reason: 'spatial_destination_unavailable' };
    }
    entity.spatial.setDestination(target.x, target.y);
    return { status: ToilResultStatus.RUNNING, reason: 'moving_to_quest_target' };
  }
}

export class NPCPlanSafeHuntRouteToilExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    const target = normalizeTarget(entity);
    if (!target) return { status: ToilResultStatus.REPLAN, reason: 'safe_hunt_target_missing' };

    const params = toil?.params || {};
    const threshold = Number(params.routeRiskThreshold ?? worldContext?.balanceConfig?.economy?.monsterResources?.huntRouteRiskThreshold ?? 4);
    const radius = Number(params.radius ?? worldContext?.balanceConfig?.economy?.monsterResources?.huntRouteThreatRadius ?? 2);
    const monsterId = read(entity, 'questTargetMonsterId');
    const risk = scoreRouteRisk(entity, target, worldContext, { radius, ignoreMonsterId: monsterId });

    write(entity, 'combatRouteRiskScore', risk.routeRiskScore);
    write(entity, 'nearbyRouteThreatIds', risk.nearbyThreatIds);

    if (risk.routeRiskScore > threshold) {
      write(entity, 'safeHuntRouteReady', false);
      write(entity, 'needsEasierHuntTarget', true);
      return {
        status: ToilResultStatus.REPLAN,
        reason: 'hunt_route_too_dangerous',
        contextPatch: {
          combatRouteRiskScore: risk.routeRiskScore,
          nearbyThreatIds: risk.nearbyThreatIds,
        },
      };
    }

    write(entity, 'safeHuntRouteReady', true);
    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'safe_hunt_route_ready',
      contextPatch: {
        combatRouteRiskScore: risk.routeRiskScore,
        nearbyThreatIds: risk.nearbyThreatIds,
      },
    };
  }
}

export class NPCHuntMonsterTargetToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const result = bindMonsterHuntTarget(entity, worldContext);
    if (!result.success) {
      return { status: ToilResultStatus.REPLAN, reason: result.reason || 'monster_hunt_target_missing' };
    }
    return {
      status: ToilResultStatus.SUCCESS,
      reason: result.skipped ? 'monster_hunt_skipped' : 'monster_hunt_target_ready',
      contextPatch: result,
    };
  }
}

export class NPCUpdateQuestProgressToilExecutor extends ToilExecutor {
  run(entity, worldContext, job) {
    const result = executeQuestDay(entity, worldContext);
    if (result.outcome === 'in_progress') {
      const cultivationExperience = applyQuestExperience(entity, worldContext, job, result, 'quest_progress', 'partial');
      return {
        status: ToilResultStatus.RUNNING,
        reason: 'quest_in_progress',
        remaining: result.daysLeft,
        contextPatch: { ...result, cultivationExperience },
      };
    }
    if (!result.success) {
      const sourceKind = result.winChance != null ? 'monster_hunt_failure' : 'quest_progress';
      const cultivationExperience = applyQuestExperience(entity, worldContext, job, result, sourceKind, 'failure');
      return {
        status: ToilResultStatus.FAILED,
        reason: result.outcome || result.reason || 'quest_failed',
        contextPatch: { ...result, cultivationExperience },
      };
    }
    const sourceKind = result.monsterId ? 'monster_hunt_success' : 'quest_complete';
    const cultivationExperience = result.cultivationExperience
      || applyQuestExperience(entity, worldContext, job, result, sourceKind, 'success');
    return { status: ToilResultStatus.SUCCESS, reason: 'quest_progress_updated', contextPatch: { ...result, cultivationExperience } };
  }
}

export class NPCTurnInQuestToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const result = turnInQuest(entity, worldContext);
    if (!result.success) {
      return { status: ToilResultStatus.FAILED, reason: result.reason || 'quest_turn_in_failed' };
    }
    return { status: ToilResultStatus.SUCCESS, reason: 'quest_turned_in', contextPatch: result };
  }
}
