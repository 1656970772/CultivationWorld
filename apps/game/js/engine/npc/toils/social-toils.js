import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';

function stateOf(entity) {
  const state = entity?.state;
  if (!state || typeof state.get !== 'function' || typeof state.set !== 'function') return null;
  return state;
}

function readState(entity, key) {
  if (typeof entity?.state?.get === 'function') return entity.state.get(key);
  return entity?.state?.[key];
}

function getNPCs(worldContext) {
  const list = worldContext?.entityRegistry?.getByType?.('npc');
  return Array.isArray(list) ? list : [];
}

function aliveNPC(entity) {
  return entity && entity.alive !== false && readState(entity, 'alive') !== false;
}

export class NPCSelectCompanionToilExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    if (!job?.context) return { status: ToilResultStatus.FAILED, reason: 'job_context_missing' };

    const params = toil?.params || {};
    const preferredFactionId = params.factionId;
    const candidates = getNPCs(worldContext).filter((npc) => aliveNPC(npc) && npc.id !== entity?.id);
    const eligible = preferredFactionId
      ? candidates.filter((npc) => readState(npc, 'factionId') === preferredFactionId)
      : candidates;
    const companion = eligible[0];
    if (!companion) {
      return { status: ToilResultStatus.BLOCKED, reason: 'companion_not_found' };
    }

    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'companion_selected',
      contextPatch: { companionId: companion.id },
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

    state.set('lastCompanionId', companionId);
    return { status: ToilResultStatus.SUCCESS, reason: 'companion_requested' };
  }
}
