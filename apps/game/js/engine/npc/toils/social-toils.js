import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';
import { applyCultivationExperience } from '../cultivation-experience.js';
import { addExperienceCultivation } from '../numeric-cultivation.js';

function stateOf(entity) {
  const state = entity?.state;
  if (!state || typeof state.get !== 'function' || typeof state.set !== 'function') return null;
  return state;
}

function readState(entity, key) {
  if (typeof entity?.state?.get === 'function') return entity.state.get(key);
  return entity?.state?.[key];
}

function writeState(entity, key, value) {
  if (typeof entity?.state?.set === 'function') {
    entity.state.set(key, value);
    return;
  }
  if (entity?.state) entity.state[key] = value;
}

function getNPCs(worldContext) {
  const registry = worldContext?.entityRegistry;
  const list = typeof registry?.getAliveByType === 'function'
    ? registry.getAliveByType('npc')
    : registry?.getByType?.('npc');
  return Array.isArray(list) ? list : [];
}

function aliveNPC(entity) {
  return entity && entity.alive !== false && readState(entity, 'alive') !== false;
}

function pointOf(entity) {
  const x = entity?.spatial?.tileX ?? entity?.spatial?.x ?? entity?.x;
  const y = entity?.spatial?.tileY ?? entity?.spatial?.y ?? entity?.y;
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

function distance(a, b) {
  const pa = pointOf(a);
  const pb = pointOf(b);
  if (!pa || !pb) return 0;
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
}

function powerOf(entity, worldContext) {
  const fromWorld = typeof worldContext?.npcCombatPower === 'function'
    ? Number(worldContext.npcCombatPower(entity))
    : NaN;
  if (Number.isFinite(fromWorld)) return fromWorld;
  const fromState = Number(readState(entity, 'power', 0));
  return Number.isFinite(fromState) ? fromState : 0;
}

function questTarget(entity) {
  const x = readState(entity, 'questTargetX');
  const y = readState(entity, 'questTargetY');
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

function clearHuntCompanion(entity) {
  writeState(entity, 'hasHuntCompanion', false);
  writeState(entity, 'huntCompanionId', null);
  writeState(entity, 'huntPartyIds', entity?.id ? [entity.id] : []);
  writeState(entity, 'needsCompanion', false);
}

function grantSocialTravelExperience(entity, worldContext) {
  return applyCultivationExperience(entity, worldContext, {
    sourceKind: 'social_travel',
    value: 100,
    riskScore: 0.2,
    durationDays: 1,
    outcome: 'success',
  });
}

function grantDiscipleTeachingExperience(disciple, worldContext) {
  const teachCfg = worldContext.relationshipConfig?.masterDiscipleGoals?.teachDisciple || {};
  const experienceCultivationGain = teachCfg.experienceCultivationGain ?? 12;
  const totalCultivation = addExperienceCultivation(
    disciple,
    worldContext?.ranksData || disciple?._ranksData || [],
    experienceCultivationGain,
    worldContext?.balanceConfig?.cultivation || disciple?._cultivationConfig || {},
  );
  return { experienceCultivationGain, totalCultivation };
}

export class NPCSelectCompanionToilExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    if (!job?.context) return { status: ToilResultStatus.FAILED, reason: 'job_context_missing' };

    const params = toil?.params || {};
    const preferredFactionId = params.factionId || readState(entity, 'factionId', null);
    const explicitFactionId = !!params.factionId;
    const sameFactionPreferred = params.sameFactionPreferred === true;
    const maxDistance = Number.isFinite(Number(params.maxDistance)) ? Number(params.maxDistance) : Infinity;
    const minPowerRatio = Number(params.minPowerRatio ?? 0);
    const myPower = Math.max(1, powerOf(entity, worldContext));
    const candidates = getNPCs(worldContext)
      .filter((npc) => aliveNPC(npc) && npc.id !== entity?.id)
      .map((npc) => {
        const dist = distance(entity, npc);
        const power = powerOf(npc, worldContext);
        const sameFaction = preferredFactionId && readState(npc, 'factionId') === preferredFactionId;
        return {
          npc,
          dist,
          power,
          sameFaction,
          score: (sameFaction && sameFactionPreferred ? 10000 : 0) + power * 10 - dist,
        };
      })
      .filter(item => !explicitFactionId || item.sameFaction)
      .filter(item => item.dist <= maxDistance)
      .filter(item => item.power / myPower >= minPowerRatio);
    candidates.sort((a, b) => b.score - a.score);
    const companion = candidates[0]?.npc || null;
    if (!companion) {
      return { status: ToilResultStatus.BLOCKED, reason: 'companion_not_found' };
    }

    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'companion_selected',
      contextPatch: {
        companionId: companion.id,
        companionPower: powerOf(companion, worldContext),
        companionDistance: distance(entity, companion),
      },
    };
  }
}

export class NPCRequestCompanionToilExecutor extends ToilExecutor {
  run(entity, _worldContext, job) {
    const companionId = job?.context?.companionId;
    if (!companionId) {
      return { status: ToilResultStatus.BLOCKED, reason: 'companion_not_found' };
    }

    const state = stateOf(entity);
    if (!state) return { status: ToilResultStatus.FAILED, reason: 'state_missing' };

    const partyIds = [entity?.id, companionId].filter(Boolean);
    state.set('lastCompanionId', companionId);
    state.set('huntCompanionId', companionId);
    state.set('huntPartyIds', partyIds);
    state.set('huntCompanionRequested', true);
    state.set('hasHuntCompanion', true);
    state.set('needsCompanion', false);
    state.set('needsEasierHuntTarget', false);
    state.set('monsterTooDangerous', false);
    state.set('huntCompanionWaitDays', 0);

    const companion = _worldContext?.entityRegistry?.getById?.(companionId);
    writeState(companion, 'assistingHuntLeaderId', entity?.id || null);
    writeState(companion, 'huntPartyIds', partyIds);

    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'companion_requested',
      contextPatch: { companionId, huntPartyIds: partyIds },
    };
  }
}

export class NPCWaitForHuntCompanionToilExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    const companionId = job?.context?.companionId
      || readState(entity, 'huntCompanionId', null)
      || readState(entity, 'lastCompanionId', null);
    const companion = companionId ? worldContext?.entityRegistry?.getById?.(companionId) : null;
    if (!aliveNPC(companion)) {
      clearHuntCompanion(entity);
      return { status: ToilResultStatus.REPLAN, reason: 'hunt_companion_missing' };
    }

    const target = questTarget(entity);
    if (!target) {
      return { status: ToilResultStatus.SUCCESS, reason: 'hunt_companion_no_target' };
    }

    const companionPoint = pointOf(companion);
    if (companionPoint && companionPoint.x === target.x && companionPoint.y === target.y) {
      writeState(entity, 'huntCompanionWaitDays', 0);
      writeState(entity, 'hasHuntCompanion', true);
      writeState(entity, 'huntCompanionId', companion.id);
      writeState(entity, 'huntPartyIds', [entity?.id, companion.id].filter(Boolean));
      return {
        status: ToilResultStatus.SUCCESS,
        reason: 'hunt_companion_arrived',
        contextPatch: { companionId: companion.id, huntPartyIds: [entity?.id, companion.id].filter(Boolean) },
      };
    }

    const maxDays = Math.max(0, Number(toil?.params?.maxDays ?? 3) || 0);
    const waited = Number(readState(entity, 'huntCompanionWaitDays', 0)) || 0;
    if (waited >= maxDays) {
      clearHuntCompanion(entity);
      writeState(entity, 'huntCompanionWaitDays', 0);
      writeState(entity, 'huntCompanionRequested', true);
      return { status: ToilResultStatus.REPLAN, reason: 'hunt_companion_timeout' };
    }

    if (typeof companion?.spatial?.setDestination === 'function') {
      companion.spatial.setDestination(target.x, target.y);
    }
    writeState(companion, 'huntTargetX', target.x);
    writeState(companion, 'huntTargetY', target.y);
    writeState(entity, 'huntCompanionWaitDays', waited + 1);
    return {
      status: ToilResultStatus.RUNNING,
      reason: 'hunt_companion_moving',
      remaining: Math.max(0, maxDays - waited - 1),
      contextPatch: { companionId: companion.id, target },
    };
  }
}

export class NPCTeachDiscipleToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const state = stateOf(entity);
    if (!state) return { status: ToilResultStatus.FAILED, reason: 'state_missing' };

    const discipleId = state.get('targetRelationshipId');
    const disciple = discipleId && worldContext?.entityRegistry
      ? worldContext.entityRegistry.getById(discipleId)
      : null;
    state.set('taughtDisciple', true);
    state.set('targetRelationshipId', null);

    if (!disciple || disciple.alive === false) {
      return { status: ToilResultStatus.FAILED, reason: 'disciple_missing' };
    }

    const teachingExperience = grantDiscipleTeachingExperience(disciple, worldContext);

    const rs = worldContext.relationshipSystem;
    if (rs && typeof rs.addEdge === 'function') {
      rs.addEdge(entity.id, disciple.id, 'master', { strengthDelta: 6, tick: worldContext.currentDay ?? 0 });
    }
    const cultivationExperience = grantSocialTravelExperience(entity, worldContext);

    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'disciple_taught',
      contextPatch: {
        discipleId: disciple.id,
        experienceCultivationGain: teachingExperience.experienceCultivationGain,
        totalCultivation: teachingExperience.totalCultivation,
        cultivationExperience,
      },
    };
  }
}

export class NPCVisitMasterToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const state = stateOf(entity);
    if (!state) return { status: ToilResultStatus.FAILED, reason: 'state_missing' };

    const masterId = state.get('targetRelationshipId');
    const master = masterId && worldContext?.entityRegistry
      ? worldContext.entityRegistry.getById(masterId)
      : null;
    state.set('visitedMaster', true);
    state.set('targetRelationshipId', null);

    if (!master || master.alive === false) {
      return { status: ToilResultStatus.FAILED, reason: 'master_missing' };
    }

    const rs = worldContext.relationshipSystem;
    if (rs && typeof rs.addEdge === 'function') {
      rs.addEdge(entity.id, master.id, 'disciple', { strengthDelta: 5, tick: worldContext.currentDay ?? 0 });
    }
    const cultivationExperience = grantSocialTravelExperience(entity, worldContext);

    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'master_visited',
      contextPatch: { masterId: master.id, cultivationExperience },
    };
  }
}
