#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { EventAwareness } = await imp('js/engine/npc/event-awareness.js');
const { DynamicGoalProvider } = await imp('js/engine/npc/dynamic-goals.js');
const { Goal, GoalSource } = await imp('js/engine/abstract/goal.js');
const { Action } = await imp('js/engine/abstract/action.js');
const { Need } = await imp('js/engine/abstract/need.js');
const { WorldEventSystem } = await imp('js/engine/world/world-event.js');
const { WorldContextBuilder } = await imp('js/engine/world/services/world-context-builder.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');
const { IntentService } = await imp('js/engine/npc/intent-service.js');
const { EmotionReactionNode } = await imp('js/engine/abstract/bt/reactions.js');
const { BTStatus } = await imp('js/engine/abstract/bt/bt-node.js');
const { Rng } = await imp('js/engine/abstract/rng.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

class TestState {
  constructor(values = {}) {
    this._values = { ...values };
    this.personality = values.personality || {};
  }
  get(key) { return this._values[key]; }
  set(key, value) { this._values[key] = value; }
}

const baseConfig = {
  enabled: true,
  maxGoalsPerNpc: 1,
  rules: [
    {
      id: 'prepare_secret_realm',
      name: '筹备秘境',
      eventType: 'secret_realm',
      phases: ['announced'],
      kind: 'preparation',
      minConfidence: 0.5,
      timeWindowDays: { min: 0, max: 60 },
      goalState: { preparedDynamicEvent: { op: 'eq', value: true } },
      basePriority: 40,
      urgency: 8,
      eventValueWeight: 0,
      motiveWeights: { dao: 1.3, profit: 1.1, survival: 0.9, revenge: 1.0 },
      priorityBounds: [0, 100],
      urgencyBounds: [0, 100],
      selectStrategy: 'astar'
    },
    {
      id: 'join_secret_realm',
      name: '进入秘境',
      eventType: 'secret_realm',
      phases: ['active'],
      kind: 'window',
      minConfidence: 0.5,
      timeWindowDays: { min: -10, max: 20 },
      goalState: { joinedDynamicEvent: { op: 'eq', value: true } },
      basePriority: 70,
      urgency: 35,
      eventValueWeight: 0,
      motiveWeights: { dao: 1.2, profit: 1.25, survival: 0.8, revenge: 1.0 },
      priorityBounds: [0, 100],
      urgencyBounds: [0, 100]
    }
  ]
};

function eventSnapshot(overrides = {}) {
  return {
    id: 'evt_secret_realm_test',
    type: 'secret_realm',
    name: '青冥秘境',
    announceDay: 10,
    startDay: 30,
    endDay: 40,
    expireDay: 50,
    value: 0,
    riskKey: 'plunder',
    scope: 'public',
    source: 'test',
    phase: 'announced',
    pos: { x: 12, y: 18 },
    preparedBy: [],
    participants: [],
    ...overrides,
  };
}

function mkEntity(id = 'npc_dynamic_test', config = baseConfig) {
  const personality = { ambition: 90, caution: 15, loyalty: 55, diplomacy: 50 };
  return {
    id,
    staticData: { personality },
    state: new TestState({
      personality,
      factionId: 'sect_001',
      lifeRatio: 0.4,
      injuryLevel: 0,
      hasRevengeTarget: false,
    }),
    eventAwareness: new EventAwareness(),
    _dynamicGoalConfig: config,
  };
}

function ctx(config = baseConfig, currentDay = 20, byId = null) {
  const context = {
    currentDay,
    dynamicGoalConfig: config,
  };
  if (byId) context.dynamicEventById = (id) => byId.get(id) || null;
  return context;
}

console.log('1) 已知预告事件产出准备 Goal');
{
  const entity = mkEntity();
  const event = eventSnapshot();
  entity.eventAwareness.learn(event, { confidence: 0.9, source: 'announcement', day: 10 });
  const goals = DynamicGoalProvider.collect(entity, ctx(baseConfig, 20));
  const goal = goals[0];
  assert(goals.length === 1, 'dynamicGoals.enabled=true 且知晓预告秘境时产出一个动态 Goal');
  assert(goal?.source === GoalSource.DYNAMIC, 'Goal source=dynamic');
  assert(goal?.sourceId === 'prepare_secret_realm', 'Goal sourceId 使用配置中的动态目标 id');
  assert(entity.state.get('targetDynamicEventId') == null, '候选收集阶段不锁定 targetDynamicEventId');
  assert(goal?.priority > baseConfig.rules[0].basePriority, '道途/收益动机匹配会把优先级抬高到 basePriority 以上');
  assert(goal?.dynamic?.eventId === event.id, 'Goal.dynamic 记录 eventId');
  assert(goal?.dynamic?.daysUntilStart === 10, 'Goal.dynamic 使用 startDay-currentDay 记录剩余天数');
}

console.log('2) 高置信事件快照不被低置信输入覆盖');
{
  const awareness = new EventAwareness();
  const high = eventSnapshot({
    id: 'evt_preserve_high_conf',
    phase: 'announced',
    startDay: 30,
    name: '可信秘境',
  });
  awareness.learn(high, { confidence: 0.9, source: 'announcement', day: 10 });
  awareness.learn(eventSnapshot({
    id: high.id,
    phase: 'scheduled',
    startDay: 999,
    name: '误传秘境',
    scope: 'relationship',
  }), { confidence: 0.2, source: 'rumor', scope: 'relationship', visibilityScope: 'relationship', day: 11 });

  const known = awareness.knownEvents({ currentDay: 12 })[0];
  const snap = awareness.snapshot().known[0];
  assert(known?.confidence === 0.9, '重复学习后保留最高 confidence');
  assert(known?.event?.phase === 'announced', 'knownEvents 保留高置信事件 phase');
  assert(known?.event?.startDay === 30, 'knownEvents 保留高置信事件 startDay');
  assert(snap?.event?.name === '可信秘境', 'snapshot 保留高置信事件内容');
  assert(snap?.source === 'announcement', '低置信输入不覆盖高置信 source');
  assert(snap?.scope === 'public', '低置信输入不覆盖高置信 scope');
  assert(snap?.visibilityScope === 'public', '低置信输入不覆盖高置信 visibilityScope');
  assert(snap?.lastUpdatedDay === 11, '低置信输入仍可更新 lastUpdatedDay 元数据');

  const fromEventSource = new EventAwareness();
  fromEventSource.learn(eventSnapshot({ id: 'evt_event_source_default', source: 'omen_board' }), { confidence: 0.7, day: 12 });
  assert(fromEventSource.snapshot().known[0]?.source === 'omen_board', '未传 source 时保留 event.source');
}

console.log('3) live 查询缺失时不从旧缓存产出 stale 事件');
{
  const entity = mkEntity('npc_stale_event');
  const event = eventSnapshot({ id: 'evt_stale_realm', phase: 'announced', startDay: 30 });
  entity.eventAwareness.learn(event, { confidence: 0.9, source: 'announcement', day: 10 });
  entity.state.set('targetDynamicEventId', event.id);

  const known = entity.eventAwareness.knownEvents({
    currentDay: 20,
    eventById: () => null,
  });
  const goals = DynamicGoalProvider.collect(entity, ctx(baseConfig, 20, new Map()));
  assert(known.length === 0, '提供 eventById 且返回 null 时 knownEvents 跳过旧缓存事件');
  assert(goals.length === 0, 'live 查询缺失的 stale 事件不产出动态 Goal');
  assert(entity.state.get('targetDynamicEventId') === null, 'stale 事件无动态 Goal 时清理 targetDynamicEventId');
}

console.log('4) 置信度门槛与忽略冷却');
{
  const low = mkEntity('npc_low_conf');
  low.eventAwareness.learn(eventSnapshot({ id: 'evt_low_conf' }), { confidence: 0.2, day: 10 });
  assert(DynamicGoalProvider.collect(low, ctx(baseConfig, 20)).length === 0, 'confidence 低于规则门槛时不产出 Goal');

  const ignored = mkEntity('npc_ignore');
  const event = eventSnapshot({ id: 'evt_ignore' });
  ignored.eventAwareness.learn(event, { confidence: 0.9, day: 10 });
  ignored.eventAwareness.ignore(event.id, 25);
  assert(DynamicGoalProvider.collect(ignored, ctx(baseConfig, 20)).length === 0, '事件处于 ignore 冷却期时不产出 Goal');
  assert(DynamicGoalProvider.collect(ignored, ctx(baseConfig, 25)).length === 1, 'ignore 冷却到期后可再次产出 Goal');
}

console.log('5) active 窗口事件产出 join/window Goal');
{
  const entity = mkEntity('npc_active');
  const event = eventSnapshot({ id: 'evt_active_realm', phase: 'active', startDay: 20, endDay: 30 });
  entity.eventAwareness.learn(event, { confidence: 0.95, source: 'scout', day: 20 });
  const goals = DynamicGoalProvider.collect(entity, ctx(baseConfig, 22));
  assert(goals.length === 1, 'active 秘境窗口可产出动态 Goal');
  assert(goals[0]?.sourceId === 'join_secret_realm', 'active 阶段匹配 join_secret_realm 规则');
  assert(goals[0]?.dynamic?.kind === 'window', 'active Goal metadata.kind=window');
}

console.log('6) 默认关闭态不改变旧行为');
{
  const entity = mkEntity('npc_disabled', {});
  entity.state.set('targetDynamicEventId', 'evt_previous_target');
  entity.eventAwareness.learn(eventSnapshot({ id: 'evt_disabled' }), { confidence: 1, day: 10 });
  assert(DynamicGoalProvider.collect(entity, ctx({}, 20)).length === 0, '缺省/关闭配置不产出动态 Goal');
  assert(entity.state.get('targetDynamicEventId') === null, '缺省/关闭配置会清理旧 targetDynamicEventId');
}

console.log('7) NPC 通过 worldContext 安全接口同步事件感知');
{
  const event = eventSnapshot({ id: 'evt_context_realm', announceDay: 1, startDay: 12, endDay: 20 });
  const system = new WorldEventSystem({ enabled: true, events: [event] });
  system.seedScheduledEvents(1);
  const host = {
    rng: new Rng(7),
    worldEntity: { currentDay: 1, state: {}, activeModifiers: [] },
    entityRegistry: { getById: () => null },
    tileIndex: new Map(),
    terrainIndex: new Map(),
    _calcFactionVeinOutput: () => new Map(),
    balanceConfig: {},
    modifierTemplates: [],
    techniqueRegistry: new Map(),
    movementSystem: null,
    infoSystem: null,
    opportunitySystem: null,
    worldEventSystem: system,
    relationshipSystem: null,
    relationshipConfig: {},
    dynamicGoalsConfig: baseConfig,
  };
  const worldContext = new WorldContextBuilder({ host, factionAI: {} }).build();
  const npc = new NPCEntity(
    {
      id: 'npc_context_sync',
      name: '知闻者',
      factionId: 'sect_001',
      role: 'disciple',
      rankId: 'foundation',
      alive: true,
      personality: { ambition: 90, caution: 20, loyalty: 60, diplomacy: 50 },
      needIds: [],
      actionIds: [],
    },
    load('data/definitions/ranks.json'),
    {
      rng: new Rng(11),
      gameConfig: load('data/config/game-config.json'),
      cultivationConfig: { traitEffects: { enabled: false } },
      aiConfig: { decisionPhaseMax: 0 },
      relationshipConfig: { enabled: false, goalsEnabled: false },
      dynamicGoalConfig: {},
    },
  );
  assert(!('dynamicEventSystem' in worldContext), 'worldContext 不向 NPC 暴露裸 dynamicEventSystem');
  npc._syncDynamicEventAwareness(worldContext);
  assert(npc.eventAwareness.snapshot().known.some(k => k.eventId === event.id), 'NPC 从 knownDynamicEventsFor(entity) 学到事件');
  const goals = npc.collectDynamicGoals(worldContext);
  assert(goals.some(g => g.source === GoalSource.DYNAMIC && g.dynamic?.eventId === event.id), '同步后的 NPC 可基于已知事件产出动态 Goal');
  assert(npc.getMindSummary().knownDynamicEvents.some(k => k.eventId === event.id), '心智摘要包含已知动态事件');
}

console.log('8) 不可达动态 Goal 未被实际选中时清理临时 targetDynamicEventId');
{
  const event = eventSnapshot({ id: 'evt_unreachable_dynamic', startDay: 30, phase: 'announced' });
  const cfg = {
    enabled: true,
    maxGoalsPerNpc: 1,
    rules: [{
      id: 'prepare_secret_realm',
      eventType: 'secret_realm',
      phases: ['announced'],
      kind: 'preparation',
      minConfidence: 0.5,
      timeWindowDays: { min: 0, max: 60 },
      goalState: { preparedDynamicEvent: { op: 'eq', value: true } },
      basePriority: 100,
      urgency: 100,
      motiveWeights: { dao: 1.5 },
    }],
  };
  const npc = new NPCEntity(
    {
      id: 'npc_unreachable_dynamic',
      name: '规划测试者',
      factionId: 'sect_001',
      role: 'disciple',
      rankId: 'foundation',
      alive: true,
      personality: { ambition: 90, caution: 20, loyalty: 50, diplomacy: 50 },
      needIds: [],
      actionIds: [],
    },
    load('data/definitions/ranks.json'),
    {
      rng: new Rng(21),
      gameConfig: load('data/config/game-config.json'),
      cultivationConfig: { traitEffects: { enabled: false } },
      aiConfig: { decisionPhaseMax: 0 },
      relationshipConfig: { enabled: false, goalsEnabled: false },
      dynamicGoalConfig: cfg,
    },
  );
  npc.state.set('reachableDone', false);
  npc.eventAwareness.learn(event, { confidence: 0.9, source: 'announcement', day: 10 });
  npc.needSystem.addNeed(new Need({
    id: 'need_reachable_test',
    name: '可达测试需求',
    goalState: { reachableDone: { op: 'eq', value: true } },
    evaluator: {
      calculate: (_state, _world, need) => ({
        priority: 20,
        urgency: 0,
        goalState: need.goalStateTemplate,
        satisfied: false,
      }),
    },
  }));
  npc.behaviorSystem.addAction(new Action({
    id: 'act_reachable_test',
    name: '完成可达测试',
    preconditions: { alive: { op: 'true' } },
    effects: { reachableDone: { op: 'set', value: true } },
    weight: 1,
  }));

  const worldContext = {
    currentDay: 20,
    dynamicGoalConfig: cfg,
    dynamicEventById: (id) => id === event.id ? event : null,
    balanceConfig: {},
    rng: new Rng(22),
  };
  npc.needSystem.evaluate(npc.state, worldContext);
  const selected = IntentService.selectGoal(npc, worldContext);
  assert(selected.planResult?.goalSource === GoalSource.NEED, '规划跳过不可达动态 Goal，实际选中普通可达 Need');
  assert(selected.plan?.[0]?.id === 'act_reachable_test', '实际计划使用普通可达 action');
  assert(npc.state.get('targetDynamicEventId') === null, 'onPlanChosen 后清理未被实际选中的动态事件 target');
}

console.log('9) 实际选中的动态 Goal 会绑定 targetDynamicEventId');
{
  const eventA = eventSnapshot({ id: 'evt_dynamic_high_unreachable', type: 'secret_realm', startDay: 30, phase: 'announced' });
  const eventB = eventSnapshot({ id: 'evt_dynamic_reachable', type: 'fallen_master', startDay: 30, phase: 'announced' });
  const cfg = {
    enabled: true,
    maxGoalsPerNpc: 2,
    rules: [
      {
        id: 'high_unreachable_dynamic',
        eventType: 'secret_realm',
        phases: ['announced'],
        kind: 'preparation',
        minConfidence: 0.5,
        timeWindowDays: { min: 0, max: 60 },
        goalState: { highDynamicDone: { op: 'eq', value: true } },
        basePriority: 100,
        urgency: 100,
      },
      {
        id: 'reachable_dynamic',
        eventType: 'fallen_master',
        phases: ['announced'],
        kind: 'loot',
        minConfidence: 0.5,
        timeWindowDays: { min: 0, max: 60 },
        goalState: { reachableDynamicDone: { op: 'eq', value: true } },
        basePriority: 90,
        urgency: 80,
      },
    ],
  };
  const npc = new NPCEntity(
    {
      id: 'npc_dynamic_selected_event',
      name: '动态绑定测试者',
      factionId: 'sect_001',
      role: 'disciple',
      rankId: 'foundation',
      alive: true,
      personality: { ambition: 80, caution: 20, loyalty: 50, diplomacy: 50 },
      needIds: [],
      actionIds: [],
    },
    load('data/definitions/ranks.json'),
    {
      rng: new Rng(31),
      gameConfig: load('data/config/game-config.json'),
      cultivationConfig: { traitEffects: { enabled: false } },
      aiConfig: { decisionPhaseMax: 0 },
      relationshipConfig: { enabled: false, goalsEnabled: false },
      dynamicGoalConfig: cfg,
    },
  );
  npc.state.set('highDynamicDone', false);
  npc.state.set('reachableDynamicDone', false);
  npc.eventAwareness.learn(eventA, { confidence: 0.9, source: 'announcement', day: 10 });
  npc.eventAwareness.learn(eventB, { confidence: 0.9, source: 'announcement', day: 10 });
  npc.behaviorSystem.addAction(new Action({
    id: 'act_reachable_dynamic',
    name: '完成可达动态目标',
    preconditions: {
      alive: { op: 'true' },
      targetDynamicEventId: { op: 'eq', value: eventB.id },
    },
    effects: { reachableDynamicDone: { op: 'set', value: true } },
    weight: 1,
  }));

  const byId = new Map([[eventA.id, eventA], [eventB.id, eventB]]);
  const worldContext = {
    currentDay: 20,
    dynamicGoalConfig: cfg,
    dynamicEventById: (id) => byId.get(id) || null,
    balanceConfig: {},
    rng: new Rng(32),
  };
  npc.needSystem.evaluate(npc.state, worldContext);
  const selected = IntentService.selectGoal(npc, worldContext);
  assert(selected.planResult?.goalSource === GoalSource.DYNAMIC, '规划跳过高优先不可达动态 Goal 后选中次高可达动态 Goal');
  assert(selected.planResult?.needId === 'reachable_dynamic', '实际选中的动态 Goal sourceId=reachable_dynamic');
  assert(selected.planResult?.dynamicEventId === eventB.id, 'planResult 记录实际选中动态事件 id');
  assert(selected.plan?.[0]?.id === 'act_reachable_dynamic', '实际计划使用读取当前动态事件 id 的可达 action');
  assert(npc.state.get('targetDynamicEventId') === eventB.id, 'onPlanChosen 将 targetDynamicEventId 绑定到实际选中的动态事件');
}

console.log('10) 无目标规划会清理上一轮 dynamic planResult');
{
  const event = eventSnapshot({ id: 'evt_dynamic_previous_result', type: 'fallen_master', startDay: 30, phase: 'announced' });
  const cfg = {
    enabled: true,
    maxGoalsPerNpc: 1,
    rules: [{
      id: 'reachable_dynamic_previous',
      eventType: 'fallen_master',
      phases: ['announced'],
      kind: 'loot',
      minConfidence: 0.5,
      timeWindowDays: { min: 0, max: 60 },
      goalState: { previousDynamicDone: { op: 'eq', value: true } },
      basePriority: 90,
      urgency: 80,
    }],
  };
  const npc = new NPCEntity(
    {
      id: 'npc_clear_stale_dynamic_plan',
      name: '旧结果清理测试者',
      factionId: 'sect_001',
      role: 'disciple',
      rankId: 'foundation',
      alive: true,
      personality: { ambition: 80, caution: 20, loyalty: 50, diplomacy: 50 },
      needIds: [],
      actionIds: [],
    },
    load('data/definitions/ranks.json'),
    {
      rng: new Rng(41),
      gameConfig: load('data/config/game-config.json'),
      cultivationConfig: { traitEffects: { enabled: false } },
      aiConfig: { decisionPhaseMax: 0 },
      relationshipConfig: { enabled: false, goalsEnabled: false },
      dynamicGoalConfig: cfg,
    },
  );
  if (npc.obsessions) npc.obsessions.obsessions = [];
  npc.state.set('previousDynamicDone', false);
  npc.eventAwareness.learn(event, { confidence: 0.9, source: 'announcement', day: 10 });
  npc.behaviorSystem.addAction(new Action({
    id: 'act_previous_dynamic',
    name: '完成旧动态目标',
    preconditions: { alive: { op: 'true' } },
    effects: { previousDynamicDone: { op: 'set', value: true } },
    weight: 1,
  }));

  const firstContext = {
    currentDay: 20,
    dynamicGoalConfig: cfg,
    dynamicEventById: (id) => id === event.id ? event : null,
    balanceConfig: {},
    rng: new Rng(42),
  };
  npc.needSystem.evaluate(npc.state, firstContext);
  const first = IntentService.selectGoal(npc, firstContext);
  assert(first.planResult?.goalSource === GoalSource.DYNAMIC, '第一轮制造 dynamic planResult');
  assert(npc.state.get('targetDynamicEventId') === event.id, '第一轮绑定 dynamic target');

  npc.behaviorSystem.clearPlan();
  const secondContext = {
    currentDay: 21,
    dynamicGoalConfig: { enabled: false },
    balanceConfig: {},
    rng: new Rng(43),
  };
  npc.needSystem.evaluate(npc.state, secondContext);
  const second = IntentService.selectGoal(npc, secondContext);
  assert(second.plan.length === 0, '第二轮没有 need/extra goal 时 plan 为空');
  assert(second.planResult?.failed === true && second.planResult?.reason === 'no_goals', '第二轮记录 no_goals planResult');
  assert(npc.state.get('targetDynamicEventId') === null, '无目标规划后不会复用上一轮 dynamic target');
}

console.log('11) Reaction 强制非动态计划会清理上一轮 dynamic target');
{
  const event = eventSnapshot({ id: 'evt_dynamic_before_reaction', type: 'fallen_master', startDay: 30, phase: 'announced' });
  const cfg = {
    enabled: true,
    maxGoalsPerNpc: 1,
    rules: [{
      id: 'reachable_dynamic_before_reaction',
      eventType: 'fallen_master',
      phases: ['announced'],
      kind: 'loot',
      minConfidence: 0.5,
      timeWindowDays: { min: 0, max: 60 },
      goalState: { beforeReactionDynamicDone: { op: 'eq', value: true } },
      basePriority: 90,
      urgency: 80,
    }],
  };
  const npc = new NPCEntity(
    {
      id: 'npc_reaction_clears_dynamic_target',
      name: '反应清理测试者',
      factionId: 'sect_001',
      role: 'disciple',
      rankId: 'foundation',
      alive: true,
      personality: { ambition: 80, caution: 20, loyalty: 50, diplomacy: 50 },
      needIds: [],
      actionIds: [],
    },
    load('data/definitions/ranks.json'),
    {
      rng: new Rng(51),
      gameConfig: load('data/config/game-config.json'),
      cultivationConfig: { traitEffects: { enabled: false } },
      aiConfig: { decisionPhaseMax: 0 },
      relationshipConfig: { enabled: false, goalsEnabled: false },
      dynamicGoalConfig: cfg,
    },
  );
  npc.state.set('beforeReactionDynamicDone', false);
  npc.state.set('reactionDone', false);
  npc.eventAwareness.learn(event, { confidence: 0.9, source: 'announcement', day: 10 });
  npc.behaviorSystem.addAction(new Action({
    id: 'act_before_reaction_dynamic',
    name: '完成反应前动态目标',
    preconditions: { alive: { op: 'true' } },
    effects: { beforeReactionDynamicDone: { op: 'set', value: true } },
    weight: 1,
  }));
  npc.behaviorSystem.addAction(new Action({
    id: 'act_reaction_clear_dynamic',
    name: '反应清理动态目标',
    preconditions: { alive: { op: 'true' } },
    effects: { reactionDone: { op: 'set', value: true } },
    weight: 1,
  }));

  const worldContext = {
    currentDay: 20,
    dynamicGoalConfig: cfg,
    dynamicEventById: (id) => id === event.id ? event : null,
    balanceConfig: {},
    rng: new Rng(52),
  };
  npc.needSystem.evaluate(npc.state, worldContext);
  const planned = IntentService.selectGoal(npc, worldContext);
  assert(planned.planResult?.goalSource === GoalSource.DYNAMIC, '先制造上一轮 dynamic planResult');
  assert(npc.state.get('targetDynamicEventId') === event.id, '反应前已有 dynamic target');

  npc.emotions.add('fear', 100);
  const node = new EmotionReactionNode({
    emotion: 'fear',
    threshold: 10,
    actionId: 'act_reaction_clear_dynamic',
  });
  const status = node.tick(npc, {}, worldContext);
  assert(status === BTStatus.RUNNING, 'EmotionReactionNode 强制设置并执行非动态单行为');
  assert(npc.behaviorSystem.getLastPlanResult()?.forced === true, 'Reaction 写入 forced 非动态 planResult');
  assert(npc.state.get('targetDynamicEventId') === null, 'Reaction 强制非动态计划后清理旧 dynamic target');
}

console.log('12) 不可达 dynamic extra 不会挤掉所有可达 Need');
{
  const npc = new NPCEntity(
    {
      id: 'npc_dynamic_extra_keeps_need',
      name: '候选保底测试者',
      factionId: 'sect_001',
      role: 'disciple',
      rankId: 'foundation',
      alive: true,
      personality: { ambition: 50, caution: 50, loyalty: 50, diplomacy: 50 },
      needIds: [],
      actionIds: [],
    },
    load('data/definitions/ranks.json'),
    {
      rng: new Rng(61),
      gameConfig: load('data/config/game-config.json'),
      cultivationConfig: { traitEffects: { enabled: false } },
      aiConfig: { decisionPhaseMax: 0 },
      relationshipConfig: { enabled: false, goalsEnabled: false },
      dynamicGoalConfig: { enabled: false },
    },
  );
  npc.state.set('lowNeedDone', false);
  npc.needSystem.addNeed(new Need({
    id: 'need_low_reachable',
    name: '低分可达需求',
    goalState: { lowNeedDone: { op: 'eq', value: true } },
    evaluator: {
      calculate: (_state, _world, need) => ({
        priority: 10,
        urgency: 0,
        goalState: need.goalStateTemplate,
        satisfied: false,
      }),
    },
  }));
  npc.behaviorSystem.addAction(new Action({
    id: 'act_low_need',
    name: '完成低分可达需求',
    preconditions: { alive: { op: 'true' } },
    effects: { lowNeedDone: { op: 'set', value: true } },
    weight: 1,
  }));
  npc.collectExtraGoals = () => [
    new Goal({
      id: 'goal_dynamic_unreachable_a',
      name: '不可达动态目标 A',
      source: GoalSource.DYNAMIC,
      sourceId: 'dynamic_unreachable_a',
      goalState: { unreachableDynamicA: { op: 'eq', value: true } },
      priority: 100,
      urgency: 100,
      dynamic: { eventId: 'evt_unreachable_a' },
    }),
    new Goal({
      id: 'goal_dynamic_unreachable_b',
      name: '不可达动态目标 B',
      source: GoalSource.DYNAMIC,
      sourceId: 'dynamic_unreachable_b',
      goalState: { unreachableDynamicB: { op: 'eq', value: true } },
      priority: 95,
      urgency: 95,
      dynamic: { eventId: 'evt_unreachable_b' },
    }),
    new Goal({
      id: 'goal_other_unreachable',
      name: '不可达非动态额外目标',
      source: GoalSource.OBSESSION,
      sourceId: 'other_unreachable',
      goalState: { unreachableOther: { op: 'eq', value: true } },
      priority: 90,
      urgency: 90,
    }),
  ];

  const worldContext = {
    currentDay: 20,
    dynamicGoalConfig: { enabled: false },
    balanceConfig: {},
    rng: new Rng(62),
  };
  npc.needSystem.evaluate(npc.state, worldContext);
  const selected = IntentService.selectGoal(npc, worldContext);
  assert(selected.planResult?.goalSource === GoalSource.NEED, '不可达 dynamic extra 存在时仍能选中可达 Need');
  assert(selected.planResult?.needId === 'need_low_reachable', '保留的 Need 是最高可达需求');
  assert(selected.plan?.[0]?.id === 'act_low_need', '最终计划使用可达 Need action');
}

console.log('13) dynamic extra 的 Need 保底使用调制后的最高 Need');
{
  const npc = new NPCEntity(
    {
      id: 'npc_dynamic_extra_modulated_need',
      name: '调制保底测试者',
      factionId: 'sect_001',
      role: 'disciple',
      rankId: 'foundation',
      alive: true,
      personality: { ambition: 50, caution: 50, loyalty: 50, diplomacy: 50 },
      needIds: [],
      actionIds: [],
    },
    load('data/definitions/ranks.json'),
    {
      rng: new Rng(71),
      gameConfig: load('data/config/game-config.json'),
      cultivationConfig: { traitEffects: { enabled: false } },
      aiConfig: { decisionPhaseMax: 0 },
      relationshipConfig: { enabled: false, goalsEnabled: false },
      dynamicGoalConfig: { enabled: false },
    },
  );
  npc.state.set('needBDone', false);
  npc.needSystem.addNeed(new Need({
    id: 'need_a_unreachable',
    name: '调制前第一不可达需求',
    goalState: { needADone: { op: 'eq', value: true } },
    evaluator: {
      calculate: (_state, _world, need) => ({
        priority: 60,
        urgency: 0,
        goalState: need.goalStateTemplate,
        satisfied: false,
      }),
    },
  }));
  npc.needSystem.addNeed(new Need({
    id: 'need_b_reachable',
    name: '调制后第一可达需求',
    goalState: { needBDone: { op: 'eq', value: true } },
    evaluator: {
      calculate: (_state, _world, need) => ({
        priority: 50,
        urgency: 0,
        goalState: need.goalStateTemplate,
        satisfied: false,
      }),
    },
  }));
  npc.modulateGoal = (goal) => {
    if (goal.sourceId === 'need_b_reachable') {
      goal.addModulator({ label: 'test_modulated_need', deltaPriority: 25 });
    }
  };
  npc.behaviorSystem.addAction(new Action({
    id: 'act_need_b',
    name: '完成调制后可达需求',
    preconditions: { alive: { op: 'true' } },
    effects: { needBDone: { op: 'set', value: true } },
    weight: 1,
  }));
  npc.collectExtraGoals = () => [
    new Goal({
      id: 'goal_dynamic_modulated_unreachable_a',
      name: '不可达动态调制目标 A',
      source: GoalSource.DYNAMIC,
      sourceId: 'dynamic_modulated_unreachable_a',
      goalState: { unreachableDynamicModA: { op: 'eq', value: true } },
      priority: 300,
      urgency: 100,
      dynamic: { eventId: 'evt_modulated_unreachable_a' },
    }),
    new Goal({
      id: 'goal_dynamic_modulated_unreachable_b',
      name: '不可达动态调制目标 B',
      source: GoalSource.DYNAMIC,
      sourceId: 'dynamic_modulated_unreachable_b',
      goalState: { unreachableDynamicModB: { op: 'eq', value: true } },
      priority: 290,
      urgency: 95,
      dynamic: { eventId: 'evt_modulated_unreachable_b' },
    }),
    new Goal({
      id: 'goal_other_modulated_unreachable',
      name: '不可达非动态调制目标',
      source: GoalSource.OBSESSION,
      sourceId: 'other_modulated_unreachable',
      goalState: { unreachableOtherMod: { op: 'eq', value: true } },
      priority: 280,
      urgency: 90,
    }),
  ];

  const worldContext = {
    currentDay: 20,
    dynamicGoalConfig: { enabled: false },
    balanceConfig: {},
    rng: new Rng(72),
  };
  npc.needSystem.evaluate(npc.state, worldContext);
  const selected = IntentService.selectGoal(npc, worldContext);
  assert(selected.planResult?.goalSource === GoalSource.NEED, 'dynamic extra 保底可选中调制后的 Need');
  assert(selected.planResult?.needId === 'need_b_reachable', '保底 Need 使用调制后分数最高的可达 Need');
  assert(selected.plan?.[0]?.id === 'act_need_b', '最终计划使用调制后可达 Need action');
}

if (failed === 0) {
  console.log('\n动态 Goal 单测全部通过');
  process.exit(0);
} else {
  console.error(`\n动态 Goal 单测失败：${failed} 项`);
  process.exit(1);
}
