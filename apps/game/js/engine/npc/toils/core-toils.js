import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';

function readState(entity, key) {
  if (typeof entity?.state?.get === 'function') return entity.state.get(key);
  return entity?.state?.[key];
}

function writeState(entity, key, value) {
  if (!key || !entity?.state) return;
  if (typeof entity.state.set === 'function') {
    entity.state.set(key, value);
    return;
  }
  entity.state[key] = value;
}

function hasSpatial(entity) {
  if (typeof entity?.hasSpatial === 'function') return entity.hasSpatial();
  return !!entity?.spatial;
}

function normalizeTarget(target) {
  if (!target) return null;
  if (typeof target.x === 'number' && typeof target.y === 'number') return { x: target.x, y: target.y };
  if (typeof target.tileX === 'number' && typeof target.tileY === 'number') return { x: target.tileX, y: target.tileY };
  if (target.pos && typeof target.pos.x === 'number' && typeof target.pos.y === 'number') {
    return { x: target.pos.x, y: target.pos.y };
  }
  return null;
}

function resolveMoveTarget(entity, worldContext, job, params) {
  const targetResolver = params?.targetResolver || job?.context?.targetResolver;
  if (targetResolver) {
    return typeof worldContext?.resolveTarget === 'function'
      ? normalizeTarget(worldContext.resolveTarget(entity, targetResolver))
      : null;
  }
  return normalizeTarget(job?.context?.target);
}

export class NPCResolveTargetToilExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    const params = toil?.params || {};
    const resolver = params.targetResolver || job?.context?.targetResolver || 'self';
    const target = typeof worldContext?.resolveTarget === 'function'
      ? normalizeTarget(worldContext.resolveTarget(entity, resolver))
      : null;

    if (!target) {
      return { status: ToilResultStatus.BLOCKED, reason: 'target_missing' };
    }

    job.context.target = target;
    return { status: ToilResultStatus.SUCCESS, reason: 'target_resolved' };
  }
}

export class NPCMoveToTargetToilExecutor extends ToilExecutor {
  run(entity, worldContext, job, toil) {
    if (!hasSpatial(entity)) {
      return { status: ToilResultStatus.SUCCESS, reason: 'no_spatial' };
    }

    const params = toil?.params || {};
    const target = resolveMoveTarget(entity, worldContext, job, params);
    if (!target) {
      return { status: ToilResultStatus.BLOCKED, reason: 'target_missing' };
    }

    const sp = entity.spatial;
    if (typeof sp.tileX !== 'number' || typeof sp.tileY !== 'number') {
      return { status: ToilResultStatus.BLOCKED, reason: 'spatial_position_invalid' };
    }

    if (sp.tileX === target.x && sp.tileY === target.y) {
      return { status: ToilResultStatus.SUCCESS, reason: 'already_at_target' };
    }

    if (typeof sp.setDestination !== 'function') {
      return { status: ToilResultStatus.BLOCKED, reason: 'spatial_destination_unavailable' };
    }

    sp.setDestination(target.x, target.y);
    return { status: ToilResultStatus.RUNNING, reason: 'moving_to_target' };
  }
}

export class NPCWaitDaysToilExecutor extends ToilExecutor {
  run(_entity, _worldContext, job, toil) {
    const params = toil?.params || {};
    const days = Math.max(0, Number(params.days ?? params.duration ?? 1));
    job.context.waits = job.context.waits || {};
    const key = toil?.id || 'wait';
    job.context.waits[key] = (job.context.waits[key] || 0) + 1;

    if (job.context.waits[key] < days) {
      return {
        status: ToilResultStatus.RUNNING,
        remaining: days - job.context.waits[key],
        reason: 'waiting_days',
      };
    }
    return { status: ToilResultStatus.SUCCESS, reason: 'wait_days_done' };
  }
}

export class NPCSetStateToilExecutor extends ToilExecutor {
  run(entity, _worldContext, _job, toil) {
    const params = toil?.params || {};
    writeState(entity, params.key, params.value);
    return { status: ToilResultStatus.SUCCESS, reason: 'state_set' };
  }
}

export const __privateCoreToils = {
  readState,
  writeState,
  normalizeTarget,
};
