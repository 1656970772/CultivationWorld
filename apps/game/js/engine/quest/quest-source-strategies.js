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

  pick({ entity, worldContext, opts = {} } = {}) {
    const order = questSourceOrder(worldContext, opts);
    for (const source of order) {
      if (source === 'generated') return null;
      const strategy = this.get(source);
      if (!strategy) continue;
      const input = { entity, worldContext, opts, source };
      const picked = typeof strategy === 'function' ? strategy(input) : strategy.pick?.(input);
      if (picked) return picked;
    }
    return null;
  }
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function readState(entity, key) {
  if (typeof entity?.state?.get === 'function') return entity.state.get(key);
  return entity?.state?.[key];
}

function templateFor(worldContext, quest) {
  return worldContext?.questTemplates?.questTypes?.find(t =>
    t.id === quest?.questTemplateId || t.id === quest?.questTypeId,
  ) || null;
}

function monsterHuntTags(worldContext) {
  return new Set(
    worldContext?.balanceConfig?.sectOperation?.questSelection?.monsterHuntTags || [],
  );
}

function questSourceOrder(worldContext, opts = {}) {
  const configured = opts.sourceOrder
    || worldContext?.balanceConfig?.sectOperation?.questSelection?.boardSourceOrder;
  const order = asList(configured).filter(Boolean);
  return order.length > 0 ? order : ['board', 'generated'];
}

function bountyBoardName(worldContext) {
  return worldContext?.balanceConfig?.sectOperation?.personalBounty?.defaultQuestBoard || 'bounty';
}

function questDifficultyForBoard(boardQuest, quest) {
  const configured = Number(boardQuest?.difficulty);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const range = Array.isArray(quest?.difficultyRange) ? quest.difficultyRange : [];
  return Number(range[0]) || 1;
}

function maxDifficultyFor(entity, worldContext) {
  const rankId = readState(entity, 'rankId') || 'mortal';
  const rankMaxDifficulty = worldContext?.balanceConfig?.cultivation?.rankMaxDifficulty
    || worldContext?.questTemplates?.rankMaxDifficulty
    || {};
  return Number(rankMaxDifficulty[rankId] ?? 2) || 2;
}

export function validateBoardQuestForEntity(entity, worldContext, boardQuest) {
  const quest = templateFor(worldContext, boardQuest);
  if (!quest) return { success: false, reason: 'board_quest_template_missing' };
  const difficulty = questDifficultyForBoard(boardQuest, quest);
  const range = Array.isArray(quest.difficultyRange) ? quest.difficultyRange : [];
  const min = Number(range[0] ?? difficulty);
  const max = Number(range[1] ?? difficulty);
  if ((Number.isFinite(min) && difficulty < min) || (Number.isFinite(max) && difficulty > max)) {
    return { success: false, reason: 'board_quest_difficulty_out_of_range', quest, difficulty, range };
  }
  const maxDiff = maxDifficultyFor(entity, worldContext);
  if (difficulty > maxDiff) {
    return { success: false, reason: 'board_quest_rank_difficulty_exceeded', quest, difficulty, maxDiff };
  }
  return { success: true, quest, difficulty };
}

function hasMonsterHuntTag(worldContext, quest, tags = monsterHuntTags(worldContext)) {
  const template = templateFor(worldContext, quest);
  const templateTags = new Set([
    template?.category,
    ...(Array.isArray(template?.tags) ? template.tags : []),
  ].filter(Boolean));
  return [...tags].some(tag => templateTags.has(tag));
}

export function pickBoardQuest(entity, worldContext, opts = {}) {
  const board = worldContext?.questBoard;
  if (!board) return null;
  if (readState(entity, 'hasActiveQuest') || readState(entity, 'activeBoardQuestId')) return null;

  const factionId = readState(entity, 'factionId') || null;
  let open = typeof board.openFor === 'function' ? board.openFor({ factionId }) : [];
  if (!Array.isArray(open) || open.length === 0) return null;
  if (opts.questBoard) {
    open = open.filter(quest => quest.questBoard === opts.questBoard);
  }
  const excludeBoards = new Set(asList(opts.excludeQuestBoards));
  if (excludeBoards.size > 0) {
    open = open.filter(quest => !excludeBoards.has(quest.questBoard));
  }
  open = open.filter(quest => validateBoardQuestForEntity(entity, worldContext, quest).success);
  if (typeof opts.predicate === 'function') {
    open = open.filter(quest => opts.predicate(quest));
  }
  if (open.length === 0) return null;

  if (opts.forceMonsterHunt) {
    const tags = monsterHuntTags(worldContext);
    if (tags.size === 0) {
      throw new Error('sectOperation.questSelection.monsterHuntTags 缺失，无法强制选择斩妖任务');
    }
    return open.find(quest => hasMonsterHuntTag(worldContext, quest, tags)) || null;
  }
  return open[0] || null;
}

export const defaultBoardQuestSourceStrategy = {
  id: 'board',
  pick({ entity, worldContext, opts } = {}) {
    return pickBoardQuest(entity, worldContext, opts);
  },
};

export const sectBoardQuestSourceStrategy = {
  id: 'sect',
  pick({ entity, worldContext, opts } = {}) {
    return pickBoardQuest(entity, worldContext, {
      ...opts,
      excludeQuestBoards: [...asList(opts?.excludeQuestBoards), bountyBoardName(worldContext)],
    });
  },
};

export const bountyBoardQuestSourceStrategy = {
  id: 'bounty',
  pick({ entity, worldContext, opts } = {}) {
    return pickBoardQuest(entity, worldContext, {
      ...opts,
      questBoard: bountyBoardName(worldContext),
    });
  },
};

export function createQuestSourceStrategyRegistry(entries = []) {
  return new QuestSourceStrategyRegistry([
    sectBoardQuestSourceStrategy,
    bountyBoardQuestSourceStrategy,
    defaultBoardQuestSourceStrategy,
    { ...defaultBoardQuestSourceStrategy, id: 'quest_board' },
    ...entries,
  ]);
}
