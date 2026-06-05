/**
 * 动态世界事件相关 NPC 行为执行器。
 *
 * Executor 只通过 worldContext 窄接口标记事件，并在标记成功后写入运行期状态。
 * GOAP 可规划效果由 Action.plannerEffects 提供，避免事件缺失时 Action.effects 伪完成目标。
 */
import { ActionExecutor } from '../../abstract/action.js';

function readTargetDynamicEventId(entity) {
  return entity?.state?.get?.('targetDynamicEventId') || null;
}

function normalizeEvent(event) {
  if (!event) return null;
  if (typeof event.toJSON === 'function') return event.toJSON();
  return event;
}

function resolveDynamicEvent(worldContext, eventId) {
  if (!eventId) return null;
  if (typeof worldContext?.dynamicEventById === 'function') {
    return normalizeEvent(worldContext.dynamicEventById(eventId));
  }
  return null;
}

function markPrepared(worldContext, eventId, npcId) {
  if (typeof worldContext?.markDynamicEventPrepared === 'function') {
    return worldContext.markDynamicEventPrepared(eventId, npcId);
  }
  return false;
}

function markParticipant(worldContext, eventId, npcId) {
  if (typeof worldContext?.markDynamicEventParticipant === 'function') {
    return worldContext.markDynamicEventParticipant(eventId, npcId);
  }
  return false;
}

export class NPCPrepareDynamicEventExecutor extends ActionExecutor {
  run(entity, worldContext, _action) {
    const eventId = readTargetDynamicEventId(entity);
    const event = resolveDynamicEvent(worldContext, eventId);
    if (!event) {
      return { dynamicEventId: null, prepared: false };
    }

    const prepared = markPrepared(worldContext, eventId, entity?.id) === true;
    if (!prepared) {
      return { dynamicEventId: eventId, dynamicEventName: event.name || event.type || eventId, prepared: false };
    }
    entity?.state?.set?.('preparedForDynamicEvent', true);
    entity?.state?.set?.('lastPreparedDynamicEventId', eventId);

    return {
      dynamicEventId: eventId,
      dynamicEventName: event.name || event.type || eventId,
      prepared: true,
      description: `${entity?.name || entity?.id || 'NPC'} 已筹备 ${event.name || eventId}`,
    };
  }
}

export class NPCJoinDynamicEventExecutor extends ActionExecutor {
  run(entity, worldContext, _action) {
    const eventId = readTargetDynamicEventId(entity);
    const event = resolveDynamicEvent(worldContext, eventId);
    if (!event) {
      return { dynamicEventId: null, joined: false };
    }

    const joined = markParticipant(worldContext, eventId, entity?.id) === true;
    if (!joined) {
      return { dynamicEventId: eventId, dynamicEventName: event.name || event.type || eventId, joined: false };
    }
    entity?.state?.set?.('joinedDynamicEvent', true);
    entity?.state?.set?.('lastJoinedDynamicEventId', eventId);

    return {
      dynamicEventId: eventId,
      dynamicEventName: event.name || event.type || eventId,
      joined: true,
      description: `${entity?.name || entity?.id || 'NPC'} 已参与 ${event.name || eventId}`,
    };
  }
}
