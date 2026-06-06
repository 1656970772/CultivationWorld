import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';
import { applyCultivationExperience } from '../cultivation-experience.js';

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

function normalizeEvent(event) {
  if (!event) return null;
  if (typeof event.toJSON === 'function') return event.toJSON();
  return event;
}

function resolveDynamicEvent(worldContext, eventId) {
  if (!eventId || typeof worldContext?.dynamicEventById !== 'function') return null;
  return normalizeEvent(worldContext.dynamicEventById(eventId));
}

function eventPosition(event) {
  if (!event) return null;
  if (event.pos && typeof event.pos.x === 'number' && typeof event.pos.y === 'number') {
    return { target: { x: event.pos.x, y: event.pos.y } };
  }
  if (event.pos && typeof event.pos.resolver === 'string') {
    return { targetResolver: 'dynamic_event_target' };
  }
  if (typeof event.x === 'number' && typeof event.y === 'number') {
    return { target: { x: event.x, y: event.y } };
  }
  return null;
}

function allowedPhases(params) {
  return Array.isArray(params?.phases) ? params.phases : [];
}

export class NPCBindDynamicEventToilExecutor extends ToilExecutor {
  run(entity, worldContext, job) {
    const eventId = job?.context?.eventId
      || job?.context?.dynamicEventId
      || readState(entity, 'targetDynamicEventId');
    const event = resolveDynamicEvent(worldContext, eventId);

    if (!event) {
      return { status: ToilResultStatus.ABORT, reason: 'dynamic_event_missing' };
    }

    job.context.dynamicEventId = event.id || eventId;
    job.context.dynamicEventName = event.name || event.type || eventId;
    job.context.dynamicEventType = event.type || null;
    job.context.dynamicEventPhase = event.phase || null;
    const position = eventPosition(event);
    if (position?.target) job.context.target = position.target;
    if (position?.targetResolver) job.context.targetResolver = position.targetResolver;

    return { status: ToilResultStatus.SUCCESS, reason: 'dynamic_event_bound' };
  }
}

export class NPCValidateDynamicEventPhaseToilExecutor extends ToilExecutor {
  run(_entity, worldContext, job, toil) {
    const event = resolveDynamicEvent(worldContext, job?.context?.dynamicEventId);
    if (!event) {
      return { status: ToilResultStatus.ABORT, reason: 'dynamic_event_missing' };
    }

    const phases = allowedPhases(toil?.params);
    if (phases.length > 0 && !phases.includes(event.phase)) {
      return { status: ToilResultStatus.ABORT, reason: 'dynamic_event_phase_invalid' };
    }

    job.context.dynamicEventPhase = event.phase || null;
    return { status: ToilResultStatus.SUCCESS, reason: 'dynamic_event_phase_valid' };
  }
}

export class NPCWaitUntilEventPhaseToilExecutor extends ToilExecutor {
  run(_entity, worldContext, job, toil) {
    const event = resolveDynamicEvent(worldContext, job?.context?.dynamicEventId);
    if (!event) {
      return { status: ToilResultStatus.ABORT, reason: 'dynamic_event_missing' };
    }

    const phases = allowedPhases(toil?.params);
    job.context.dynamicEventPhase = event.phase || null;
    if (phases.length > 0 && !phases.includes(event.phase)) {
      return { status: ToilResultStatus.RUNNING, reason: 'waiting_dynamic_event_phase' };
    }

    return { status: ToilResultStatus.SUCCESS, reason: 'dynamic_event_phase_reached' };
  }
}

export class NPCMarkDynamicEventPreparedToilExecutor extends ToilExecutor {
  run(entity, worldContext, job) {
    const eventId = job?.context?.dynamicEventId;
    const marked = typeof worldContext?.markDynamicEventPrepared === 'function'
      ? worldContext.markDynamicEventPrepared(eventId, entity?.id) === true
      : false;
    if (!marked) {
      return { status: ToilResultStatus.FAILED, reason: 'mark_dynamic_event_prepared_failed' };
    }

    writeState(entity, 'lastPreparedDynamicEventId', eventId);
    return { status: ToilResultStatus.SUCCESS, reason: 'dynamic_event_prepared_marked' };
  }
}

export class NPCMarkDynamicEventParticipantToilExecutor extends ToilExecutor {
  run(entity, worldContext, job) {
    const eventId = job?.context?.dynamicEventId;
    const event = resolveDynamicEvent(worldContext, eventId);
    const marked = typeof worldContext?.markDynamicEventParticipant === 'function'
      ? worldContext.markDynamicEventParticipant(eventId, entity?.id) === true
      : false;
    if (!marked) {
      return { status: ToilResultStatus.FAILED, reason: 'mark_dynamic_event_participant_failed' };
    }

    writeState(entity, 'lastJoinedDynamicEventId', eventId);
    const cultivationExperience = applyCultivationExperience(entity, worldContext, {
      sourceKind: 'dynamic_event',
      value: event?.value || 0,
      riskScore: event?.riskScore ?? (event?.riskKey ? 1 : 0),
      durationDays: 1,
      outcome: 'success',
    });
    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'dynamic_event_participant_marked',
      contextPatch: { cultivationExperience },
    };
  }
}
