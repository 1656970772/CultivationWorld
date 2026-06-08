const CANONICAL_STATES = [
  'draft',
  'available',
  'accepted',
  'in_progress',
  'completed',
  'turned_in',
  'failed',
  'expired',
];

const OPEN_STATES = new Set(['available', 'open']);
const ACTIVE_DEMAND_STATES = new Set(['available', 'open', 'accepted', 'in_progress']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeState(state) {
  if (state === 'open') return 'available';
  if (state === 'cancelled') return 'expired';
  return state;
}

function dayOf(input, fallback = 0) {
  return Number.isFinite(Number(input)) ? Number(input) : fallback;
}

export class QuestRepository {
  constructor({ snapshot = [], nextId = 1 } = {}) {
    this.quests = new Map();
    this.nextId = Math.max(1, Number(nextId) || 1);
    for (const quest of snapshot) this.save(quest);
  }

  _reserveId(id) {
    const match = String(id || '').match(/^board_quest_(\d+)$/);
    if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
  }

  save(input = {}) {
    const id = input.id || `board_quest_${this.nextId++}`;
    this._reserveId(id);
    const quest = { ...clone(input), id };
    this.quests.set(id, quest);
    return clone(quest);
  }

  byId(id) {
    const quest = this.quests.get(id);
    return quest ? clone(quest) : null;
  }

  update(id, patch = {}) {
    const quest = this.quests.get(id);
    if (!quest) return null;
    Object.assign(quest, clone(patch));
    return clone(quest);
  }

  all() {
    return [...this.quests.values()].map(clone);
  }

  snapshot() {
    return {
      nextId: this.nextId,
      quests: this.all(),
    };
  }
}

export class QuestStateMachine {
  constructor({ allowed = CANONICAL_STATES } = {}) {
    if (!Array.isArray(allowed) || allowed.length === 0) {
      throw new Error('QuestStateMachine requires allowed states');
    }
    this.allowed = new Set(allowed.map(normalizeState));
  }

  allows(state) {
    return this.allowed.has(normalizeState(state));
  }

  transition(quest, state, patch = {}) {
    const nextState = normalizeState(state);
    if (!quest) return { success: false, reason: 'quest_missing' };
    if (!this.allows(nextState)) {
      return { success: false, reason: 'quest_state_invalid', state: nextState };
    }
    return { success: true, patch: { ...patch, state: nextState } };
  }
}

export class QuestVisibilityPolicy {
  constructor({ publicBoards = [] } = {}) {
    this.publicBoards = new Set(Array.isArray(publicBoards) ? publicBoards : []);
  }

  canSee(quest, { factionId = null, questBoard = null } = {}) {
    if (!quest || !OPEN_STATES.has(quest.state)) return false;
    if (questBoard && quest.questBoard !== questBoard) return false;
    if (quest.visibility === 'public') return true;
    if (this.publicBoards.has(quest.questBoard)) return true;
    if (!factionId) return !quest.factionId;
    return quest.factionId === factionId;
  }
}

export class QuestDedupSpecification {
  constructor({ mode = 'by_dedupe_key' } = {}) {
    this.mode = mode || 'by_dedupe_key';
  }

  hasOpen(repository, dedupeKey) {
    if (this.mode === 'none' || !dedupeKey) return false;
    return repository.all().some(q =>
      q.dedupeKey === dedupeKey && ACTIVE_DEMAND_STATES.has(q.state),
    );
  }

  findOpen(repository, dedupeKey) {
    if (this.mode === 'none' || !dedupeKey) return null;
    return repository.all().find(q =>
      q.dedupeKey === dedupeKey && ACTIVE_DEMAND_STATES.has(q.state),
    ) || null;
  }
}

export class QuestBoard {
  static fromConfig(config = {}) {
    const visibilityPolicy = config.visibilityPolicy || {};
    return new QuestBoard({
      repository: new QuestRepository(config.repository || {}),
      stateMachine: new QuestStateMachine({ allowed: config.stateMachine || CANONICAL_STATES }),
      visibilityPolicy: new QuestVisibilityPolicy(visibilityPolicy),
      dedupeSpec: new QuestDedupSpecification({ mode: config.dedupePolicy || 'by_dedupe_key' }),
    });
  }

  constructor({ repository, stateMachine, visibilityPolicy, dedupeSpec } = {}) {
    if (!repository || !stateMachine || !visibilityPolicy || !dedupeSpec) {
      throw new Error('QuestBoard requires repository, stateMachine, visibilityPolicy and dedupeSpec');
    }
    this.repository = repository;
    this.stateMachine = stateMachine;
    this.visibilityPolicy = visibilityPolicy;
    this.dedupeSpec = dedupeSpec;
  }

  publish(input = {}) {
    const state = normalizeState(input.state || 'available');
    if (!this.stateMachine.allows(state)) {
      return { success: false, reason: 'quest_state_invalid', state };
    }

    const dedupeKey = input.dedupeKey || null;
    const existing = this.dedupeSpec.findOpen(this.repository, dedupeKey);
    if (existing) {
      return {
        success: false,
        reason: 'quest_deduped',
        dedupeKey,
        existingQuestId: existing.id,
        quest: existing,
      };
    }

    const day = dayOf(input.day ?? input.createdDay, 0);
    const quest = {
      success: true,
      state,
      createdDay: day,
      acceptedDay: input.acceptedDay ?? null,
      completedDay: input.completedDay ?? null,
      turnedInDay: input.turnedInDay ?? null,
      expiredDay: input.expiredDay ?? null,
      failedDay: input.failedDay ?? null,
      factionId: input.factionId || null,
      issuerType: input.issuerType || 'faction',
      issuerId: input.issuerId || input.factionId || null,
      issuerName: input.issuerName || input.issuerId || input.factionId || 'quest_issuer',
      issuerNpcId: input.issuerNpcId || null,
      questBoard: input.questBoard || 'sect',
      questKind: input.questKind || 'sect_task',
      questTemplateId: input.questTemplateId || input.questTypeId || null,
      questTypeId: input.questTypeId || input.questTemplateId || null,
      difficulty: input.difficulty ?? null,
      priority: input.priority ?? 0,
      requiredResourceId: input.requiredResourceId || null,
      dedupeKey,
      rewardContribution: input.rewardContribution ?? 0,
      rewardAssets: clone(input.rewardAssets || []),
      escrowId: input.escrowId || null,
      escrowRefs: clone(input.escrowRefs || (input.escrowId ? [input.escrowId] : [])),
      acceptedByNpcId: input.acceptedByNpcId || null,
      completedByNpcId: input.completedByNpcId || null,
      metadata: clone(input.metadata || {}),
    };

    for (const [key, value] of Object.entries(input)) {
      if (!(key in quest)) quest[key] = clone(value);
    }

    return this.repository.save(quest);
  }

  byId(id) {
    return this.repository.byId(id);
  }

  openFor({ factionId = null, questBoard = null } = {}) {
    return this.repository.all()
      .filter(q => this.visibilityPolicy.canSee(q, { factionId, questBoard }))
      .sort((a, b) =>
        (Number(b.priority || 0) - Number(a.priority || 0))
        || (Number(a.createdDay || 0) - Number(b.createdDay || 0))
        || String(a.id).localeCompare(String(b.id)),
      )
      .map(clone);
  }

  hasOpenDemand(dedupeKey) {
    return this.dedupeSpec.hasOpen(this.repository, dedupeKey);
  }

  accept(questId, npc, day = 0) {
    const quest = this.repository.byId(questId);
    if (!quest) return { success: false, reason: 'quest_missing' };
    if (!OPEN_STATES.has(quest.state)) {
      return { success: false, reason: 'quest_not_available', quest };
    }
    const transition = this.stateMachine.transition(quest, 'accepted', {
      acceptedDay: dayOf(day, quest.createdDay || 0),
      acceptedByNpcId: npc?.id || null,
      acceptedByNpcName: npc?.name || null,
    });
    if (!transition.success) return transition;
    return { success: true, quest: this.repository.update(questId, transition.patch) };
  }

  complete(questId, npc, day = 0) {
    const quest = this.repository.byId(questId);
    if (!quest) return { success: false, reason: 'quest_missing' };
    if (!['accepted', 'in_progress'].includes(quest.state)) {
      return { success: false, reason: 'quest_not_active', quest };
    }
    const transition = this.stateMachine.transition(quest, 'completed', {
      completedDay: dayOf(day, quest.acceptedDay || quest.createdDay || 0),
      completedByNpcId: npc?.id || null,
      completedByNpcName: npc?.name || null,
    });
    if (!transition.success) return transition;
    return { success: true, quest: this.repository.update(questId, transition.patch) };
  }

  markInProgress(questId, npc, day = 0) {
    const quest = this.repository.byId(questId);
    if (!quest) return { success: false, reason: 'quest_missing' };
    if (!['accepted', 'in_progress'].includes(quest.state)) {
      return { success: false, reason: 'quest_not_accepted', quest };
    }
    const transition = this.stateMachine.transition(quest, 'in_progress', {
      startedDay: quest.startedDay ?? dayOf(day, quest.acceptedDay || quest.createdDay || 0),
      activeNpcId: npc?.id || quest.acceptedByNpcId || null,
    });
    if (!transition.success) return transition;
    return { success: true, quest: this.repository.update(questId, transition.patch) };
  }

  turnIn(questId, npc, day = 0) {
    const quest = this.repository.byId(questId);
    if (!quest) return { success: false, reason: 'quest_missing' };
    if (quest.state !== 'completed') return { success: false, reason: 'quest_not_completed', quest };
    const transition = this.stateMachine.transition(quest, 'turned_in', {
      turnedInDay: dayOf(day, quest.completedDay || quest.createdDay || 0),
      turnedInByNpcId: npc?.id || quest.completedByNpcId || null,
    });
    if (!transition.success) return transition;
    return { success: true, quest: this.repository.update(questId, transition.patch) };
  }

  fail(questId, reason = 'failed', day = 0) {
    const quest = this.repository.byId(questId);
    if (!quest) return { success: false, reason: 'quest_missing' };
    const transition = this.stateMachine.transition(quest, 'failed', {
      failedDay: dayOf(day, quest.createdDay || 0),
      failureReason: reason,
    });
    if (!transition.success) return transition;
    return { success: true, quest: this.repository.update(questId, transition.patch) };
  }

  expire(questId, day = 0, reason = 'expired') {
    const quest = this.repository.byId(questId);
    if (!quest) return { success: false, reason: 'quest_missing' };
    if (['completed', 'turned_in', 'failed', 'expired'].includes(quest.state)) {
      return { success: false, reason: 'quest_not_expirable', quest };
    }
    const transition = this.stateMachine.transition(quest, 'expired', {
      expiredDay: dayOf(day, quest.createdDay || 0),
      expiredReason: reason,
      cancelledDay: dayOf(day, quest.createdDay || 0),
    });
    if (!transition.success) return transition;
    return { success: true, quest: this.repository.update(questId, transition.patch) };
  }

  cancel(questId, day = 0, reason = 'cancelled') {
    return this.expire(questId, day, reason);
  }

  snapshot() {
    return this.repository.all();
  }
}
