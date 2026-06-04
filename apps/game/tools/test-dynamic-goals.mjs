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
const { GoalSource } = await imp('js/engine/abstract/goal.js');
const { Action } = await imp('js/engine/abstract/action.js');
const { Need } = await imp('js/engine/abstract/need.js');
const { WorldEventSystem } = await imp('js/engine/world/world-event.js');
const { WorldContextBuilder } = await imp('js/engine/world/services/world-context-builder.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');
const { IntentService } = await imp('js/engine/npc/intent-service.js');
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
  assert(entity.state.get('targetDynamicEventId') === event.id, '产出 Goal 时锁定 targetDynamicEventId');
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

if (failed === 0) {
  console.log('\n动态 Goal 单测全部通过');
  process.exit(0);
} else {
  console.error(`\n动态 Goal 单测失败：${failed} 项`);
  process.exit(1);
}
