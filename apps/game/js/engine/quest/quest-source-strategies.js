export class QuestSourceStrategyRegistry {
  constructor(entries = []) {
    this.strategies = new Map();
    for (const entry of entries) {
      if (!entry) continue;
      const id = entry.id || entry.questKind || entry.kind;
      if (id) this.register(id, entry);
    }
  }

  register(id, strategy) {
    if (!id || !strategy) throw new Error('QuestSourceStrategyRegistry.register requires id and strategy');
    this.strategies.set(id, strategy);
    return this;
  }

  get(id) {
    return this.strategies.get(id) || null;
  }

  has(id) {
    return this.strategies.has(id);
  }

  list() {
    return [...this.strategies.entries()].map(([id, strategy]) => ({ id, strategy }));
  }
}

export function createQuestSourceStrategyRegistry(entries = []) {
  return new QuestSourceStrategyRegistry(entries);
}
