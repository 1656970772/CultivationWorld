/**
 * 动态世界事件相关 NPC 行为执行器。
 *
 * Executor 只处理 worldContext 侧事件标记与执行结果；GOAP 状态效果仍由 Action.effects
 * 统一应用，避免执行器复制 planner/action 的职责。
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
  const legacySystem = worldContext?.dynamicEventSystem || worldContext?.worldEventSystem;
  return normalizeEvent(legacySystem?.getById?.(eventId));
}

function markPrepared(worldContext, eventId, npcId) {
  if (typeof worldContext?.markDynamicEventPrepared === 'function') {
    return worldContext.markDynamicEventPrepared(eventId, npcId);
  }
  const legacySystem = worldContext?.dynamicEventSystem || worldContext?.worldEventSystem;
  const event = legacySystem?.getById?.(eventId);
  if (typeof legacySystem?.markPrepared === 'function') {
    return legacySystem.markPrepared(eventId, npcId);
  }
  return event?.markPrepared?.(npcId) === true;
}

function markParticipant(worldContext, eventId, npcId) {
  if (typeof worldContext?.markDynamicEventParticipant === 'function') {
    return worldContext.markDynamicEventParticipant(eventId, npcId);
  }
  const legacySystem = worldContext?.dynamicEventSystem || worldContext?.worldEventSystem;
  const event = legacySystem?.getById?.(eventId);
  if (typeof legacySystem?.markParticipant === 'function') {
    return legacySystem.markParticipant(eventId, npcId);
  }
  return event?.markParticipant?.(npcId) === true;
}

export class NPCPrepareDynamicEventExecutor extends ActionExecutor {
  run(entity, worldContext, _action) {
    const eventId = readTargetDynamicEventId(entity);
    const event = resolveDynamicEvent(worldContext, eventId);
    if (!event) {
      return { dynamicEventId: null, prepared: false };
    }

    markPrepared(worldContext, eventId, entity?.id);
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

    markParticipant(worldContext, eventId, entity?.id);
    entity?.state?.set?.('lastJoinedDynamicEventId', eventId);

    return {
      dynamicEventId: eventId,
      dynamicEventName: event.name || event.type || eventId,
      joined: true,
      description: `${entity?.name || entity?.id || 'NPC'} 已参与 ${event.name || eventId}`,
    };
  }
}
