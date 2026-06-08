export class QuestCompletionHandlerRegistry {
  constructor(entries = []) {
    this.handlers = new Map();
    for (const entry of entries) {
      if (!entry) continue;
      const id = entry.id || entry.questKind || entry.kind;
      const handler = entry.handler || entry;
      if (id) this.register(id, handler);
    }
  }

  register(id, handler) {
    if (!id || typeof handler !== 'function') {
      throw new Error('QuestCompletionHandlerRegistry.register requires id and handler');
    }
    this.handlers.set(id, handler);
    return this;
  }

  get(id) {
    return this.handlers.get(id) || this.handlers.get('default') || null;
  }

  has(id) {
    return this.handlers.has(id);
  }

  list() {
    return [...this.handlers.entries()].map(([id, handler]) => ({ id, handler }));
  }
}

export function defaultQuestCompletionHandler({ questBoard, questId, npc, day } = {}) {
  if (!questBoard || !questId) return { success: false, reason: 'quest_context_missing' };
  const quest = questBoard.byId?.(questId);
  if (quest?.escrowId || (Array.isArray(quest?.escrowRefs) && quest.escrowRefs.length > 0)) {
    return { success: false, reason: 'quest_completion_handler_required', quest };
  }
  return questBoard.complete(questId, npc, day);
}

export function createQuestCompletionHandlerRegistry(entries = []) {
  const registry = new QuestCompletionHandlerRegistry();
  registry.register('default', defaultQuestCompletionHandler);
  for (const entry of entries) {
    if (!entry) continue;
    const id = entry.id || entry.questKind || entry.kind;
    const handler = entry.handler || entry;
    if (id) registry.register(id, handler);
  }
  return registry;
}
