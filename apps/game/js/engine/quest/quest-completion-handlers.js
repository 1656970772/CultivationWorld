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
    return this.handlers.get(id) || null;
  }

  has(id) {
    return this.handlers.has(id);
  }

  list() {
    return [...this.handlers.entries()].map(([id, handler]) => ({ id, handler }));
  }
}

export function defaultQuestCompletionHandler(input = {}) {
  const board = input.questBoard || input.worldContext?.questBoard;
  const id = input.questId || input.boardQuestId;
  const completer = input.npc || input.entity || input.completer;
  const currentDay = input.day ?? input.worldContext?.currentDay ?? 0;
  if (!board || !id) return { success: false, reason: 'quest_context_missing' };
  const quest = board.byId?.(id);
  if (quest?.escrowId || (Array.isArray(quest?.escrowRefs) && quest.escrowRefs.length > 0)) {
    return { success: false, reason: 'quest_completion_handler_required', quest };
  }
  const completed = board.complete(id, completer, currentDay);
  if (!completed.success || typeof board.turnIn !== 'function') return completed;
  const turnedIn = board.turnIn(id, completer, currentDay);
  if (!turnedIn.success) return turnedIn;
  return { success: true, quest: turnedIn.quest, completed, turnedIn };
}

export function createQuestCompletionHandlerRegistry(entries = []) {
  const registry = new QuestCompletionHandlerRegistry();
  registry.register('default', defaultQuestCompletionHandler);
  registry.register('generic_task', defaultQuestCompletionHandler);
  for (const entry of entries) {
    if (!entry) continue;
    const id = entry.id || entry.questKind || entry.kind;
    const handler = entry.handler || entry;
    if (id) registry.register(id, handler);
  }
  return registry;
}
