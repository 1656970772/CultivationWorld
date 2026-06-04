#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { WorldEventSystem, WorldEventPhase } = await imp('js/engine/world/world-event.js');
const { WorldEngine } = await imp('js/engine/world-engine.js');
const { WorldContextBuilder } = await imp('js/engine/world/services/world-context-builder.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

function buildGameConfigs() {
  const combatEffects = load('data/effects/combat-effects.json');
  const coreEffects = load('data/effects/core-effects.json');
  return {
    factions: load('data/entities/factions.json'),
    npcs: load('data/entities/npcs.json'),
    ranks: load('data/definitions/ranks.json'),
    items: load('data/definitions/macro-resources.json'),
    terrains: load('data/definitions/terrains.json'),
    factionNeeds: load('data/needs/faction-needs.json'),
    npcNeeds: load('data/needs/npc-needs.json'),
    factionActions: load('data/actions/faction-actions.json'),
    npcActions: load('data/actions/npc-actions.json'),
    reactionActions: load('data/actions/reaction-actions.json'),
    worldRules: load('data/actions/world-rules.json'),
    questTemplates: load('data/quests/quest-templates.json'),
    mapData: load('data/world/map.json'),
    modifierTemplates: load('data/world/modifiers.json'),
    balanceCombat: load('data/balance/combat.json'),
    balanceEconomy: load('data/balance/economy.json'),
    balanceCultivation: load('data/balance/cultivation.json'),
    balanceSocial: load('data/balance/social.json'),
    balanceMovement: load('data/balance/movement.json'),
    balancePersonality: load('data/balance/personality.json'),
    balanceRisk: load('data/balance/risk.json'),
    balanceMemory: load('data/balance/memory.json'),
    balanceObsession: load('data/balance/obsession.json'),
    balanceEmotion: load('data/balance/emotion.json'),
    balanceUtility: load('data/balance/utility.json'),
    balanceReward: load('data/balance/reward.json'),
    balanceRelationship: load('data/balance/relationship.json'),
    balanceReaction: load('data/balance/reaction.json'),
    gameConfig: load('data/config/game-config.json'),
    aiConfig: load('data/config/ai-config.json'),
    names: load('data/definitions/names.json'),
    monsters: load('data/definitions/monsters.json'),
    monsterSpawn: load('data/balance/monster-spawn.json'),
    worldNews: load('data/world/news.json'),
    worldOpportunities: load('data/world/opportunities.json'),
    dynamicEvents: load('data/world/dynamic-events.json'),
    balanceCovet: load('data/balance/covet.json'),
    itemDefs: { items: ['currency', 'material', 'pill', 'artifact', 'talisman', 'technique'].flatMap(c => load(`data/items/${c}.json`).items) },
    tags: load('data/tags/tags.json'),
    effects: { effects: [...(combatEffects?.effects || []), ...(coreEffects?.effects || [])] },
    abilities: load('data/abilities/combat-abilities.json'),
  };
}

const cfg = {
  enabled: true,
  events: [
    {
      id: 'evt_secret_realm_test',
      type: 'secret_realm',
      name: '青冥秘境',
      announceDay: 10,
      startDay: 20,
      endDay: 25,
      expireDay: 30,
      value: 1000,
      riskKey: 'plunder',
      scope: 'public',
      pos: { x: 50, y: 60 }
    }
  ]
};

console.log('1) WorldEventSystem 生命周期');
const system = new WorldEventSystem(cfg);
system.seedScheduledEvents(0);

system.tick(9);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.SCHEDULED, '预告日前仍为 scheduled');

system.tick(10);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.ANNOUNCED, 'announceDay 进入 announced');

system.tick(20);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.ACTIVE, 'startDay 进入 active');

system.markPrepared('evt_secret_realm_test', 'npc_1');
system.markParticipant('evt_secret_realm_test', 'npc_1');
const snap = system.snapshot().events.find(e => e.id === 'evt_secret_realm_test');
assert(snap.preparedBy.includes('npc_1'), '准备记录进入 snapshot');
assert(snap.participants.includes('npc_1'), '参与记录进入 snapshot');

system.tick(26);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.RESOLVED, 'endDay 后进入 resolved');
const expiredChanges = system.tick(31);
assert(expiredChanges.some(change =>
  change.eventId === 'evt_secret_realm_test' && change.phase === WorldEventPhase.EXPIRED
), 'expireDay 后 tick 记录 expired phase change');
assert(system.phaseChanges().some(change =>
  change.eventId === 'evt_secret_realm_test' && change.phase === WorldEventPhase.EXPIRED
), 'phaseChanges() 可读取 expired phase change');
assert(!system.snapshot().events.some(e => e.id === 'evt_secret_realm_test'), 'expired 事件从 snapshot 移除');
assert(system.getById('evt_secret_realm_test') === null, 'expired 后 _byId 重建，getById 返回 null');

console.log('2) 默认关闭时不播种、不推进、不暴露事件');
{
  const disabled = new WorldEventSystem({
    enabled: false,
    events: [{
      id: 'evt_disabled_test',
      type: 'secret_realm',
      name: '关闭态秘境',
      announceDay: 1,
      startDay: 2,
      endDay: 3,
      scope: 'public',
    }],
  });
  assert(disabled.seedScheduledEvents(0).length === 0, 'enabled=false 不播种配置事件');
  assert(disabled.tick(10).length === 0, 'enabled=false tick 不产生 phaseChanges');
  assert(disabled.visibleEventsFor({ id: 'npc_any' }, 10).length === 0, 'enabled=false visibleEventsFor 返回空');
  assert(disabled.snapshot().events.length === 0, 'enabled=false snapshot 保持空事件列表');
}

console.log('3) visibleEventsFor 与 snapshot 不泄漏内部事件或嵌套对象');
{
  const nestedConfig = {
    id: 'evt_snapshot_boundary',
    type: 'secret_realm',
    name: '嵌套秘境',
    announceDay: 1,
    startDay: 2,
    endDay: 3,
    scope: 'public',
    pos: { resolver: 'secret_realm', detail: { x: 7, y: 8 } },
    rewardSource: { table: 'secret_realm', detail: { grade: 2 } },
  };
  const boundary = new WorldEventSystem({ enabled: true, events: [nestedConfig] });
  boundary.seedScheduledEvents(1);
  nestedConfig.pos.detail.x = 999;
  nestedConfig.rewardSource.detail.grade = 99;
  assert(boundary.snapshot().events[0].pos.detail.x === 7, '构造后修改原始 pos 嵌套对象不污染事件');
  assert(boundary.snapshot().events[0].rewardSource.detail.grade === 2, '构造后修改原始 rewardSource 嵌套对象不污染事件');

  const visible = boundary.visibleEventsFor({ id: 'npc_1' }, 1);
  assert(visible.length === 1, 'visibleEventsFor 返回可见事件');
  assert(visible[0] !== boundary.getById('evt_snapshot_boundary'), 'visibleEventsFor 返回快照而非内部 WorldEvent 实例');
  visible[0].phase = WorldEventPhase.EXPIRED;
  visible[0].pos.detail.x = 1234;
  visible[0].rewardSource.detail.grade = 88;
  const afterVisibleMutation = boundary.snapshot().events[0];
  assert(afterVisibleMutation.phase !== WorldEventPhase.EXPIRED, '修改 visibleEventsFor 快照 phase 不污染内部事件');
  assert(afterVisibleMutation.pos.detail.x === 7, '修改 visibleEventsFor 快照 pos 嵌套对象不污染内部事件');
  assert(afterVisibleMutation.rewardSource.detail.grade === 2, '修改 visibleEventsFor 快照 rewardSource 嵌套对象不污染内部事件');

  const snapWithNested = boundary.snapshot();
  snapWithNested.events[0].pos.detail.x = 4321;
  snapWithNested.events[0].rewardSource.detail.grade = 77;
  assert(boundary.snapshot().events[0].pos.detail.x === 7, '修改 snapshot pos 嵌套对象不污染内部事件');
  assert(boundary.snapshot().events[0].rewardSource.detail.grade === 2, '修改 snapshot rewardSource 嵌套对象不污染内部事件');
}

console.log('4) awareness confidence 支持配置值并保留默认 fallback');
{
  const entity = { id: 'npc_1', state: { get: (key) => key === 'factionId' ? 'faction_alpha' : null } };
  const custom = new WorldEventSystem({
    enabled: true,
    awareness: {
      defaultConfidenceByScope: {
        public: 0.66,
        faction: 0.88,
        relationship: 0.99,
      },
    },
    events: [
      { id: 'evt_public_conf', type: 'auction', name: '公开拍卖', announceDay: 1, startDay: 2, endDay: 3, scope: 'public' },
      { id: 'evt_faction_conf', type: 'sect_tournament', name: '宗门内试', announceDay: 1, startDay: 2, endDay: 3, scope: 'faction', subjectId: 'faction_alpha' },
      { id: 'evt_relationship_conf', type: 'relationship_death', name: '故人陨落', announceDay: 1, startDay: 2, endDay: 3, scope: 'relationship', relatedNpcIds: ['npc_1'] },
    ],
  });
  custom.seedScheduledEvents(1);
  assert(custom.awarenessConfidence(custom.getById('evt_public_conf'), entity) === 0.66, 'public confidence 可由配置覆盖');
  assert(custom.awarenessConfidence(custom.getById('evt_faction_conf'), entity) === 0.88, 'faction confidence 可由配置覆盖');
  assert(custom.awarenessConfidence(custom.getById('evt_relationship_conf'), entity) === 0.99, 'relationship confidence 可由配置覆盖');

  const fallback = new WorldEventSystem(cfg);
  fallback.seedScheduledEvents(10);
  assert(fallback.awarenessConfidence(fallback.getById('evt_secret_realm_test'), entity) === 0.55, '未配置时 public confidence 使用默认 0.55');
}

console.log('5) WorldEngine 默认配置集成安全：动态事件关闭态保持静默');
{
  const engine = new WorldEngine();
  engine.init(buildGameConfigs());
  assert(engine.worldEventSystem.snapshot().events.length === 0, '当前数据默认 enabled=false，WorldEngine 初始化不播种动态事件');
  for (let i = 0; i < 3; i++) {
    const tickLog = engine.tick();
    assert(Array.isArray(tickLog.dynamicEvents) && tickLog.dynamicEvents.length === 0, `第 ${i + 1} 个 tick dynamicEvents 为空`);
  }
}

console.log('6) WorldEngine 启用态推进动态事件 phase change');
{
  const configs = buildGameConfigs();
  configs.dynamicEvents = {
    enabled: true,
    events: [
      {
        id: 'evt_engine_enabled',
        type: 'auction',
        name: '首日拍卖',
        announceDay: 1,
        startDay: 2,
        endDay: 3,
        expireDay: 4,
        scope: 'public',
      },
    ],
  };
  const engine = new WorldEngine();
  engine.init(configs);
  const tickLog = engine.tick();
  assert(tickLog.dynamicEvents.some(change =>
    change.eventId === 'evt_engine_enabled' && change.phase === WorldEventPhase.ANNOUNCED
  ), 'enabled=true 时首 tick 产生动态事件 announced phase change');
  assert(engine.worldEventSystem.snapshot().events.find(e => e.id === 'evt_engine_enabled')?.phase === WorldEventPhase.ANNOUNCED,
    'WorldEngine 内 worldEventSystem snapshot 阶段同步为 announced');
}

console.log('7) worldContext 暴露动态事件快照，避免外部改写系统事件');
{
  const contextSystem = new WorldEventSystem({
    enabled: true,
    events: [
      {
        id: 'evt_context_snapshot',
        type: 'auction',
        name: '坊市拍卖',
        announceDay: 1,
        startDay: 2,
        endDay: 3,
        scope: 'public',
        source: 'rumor_board',
        pos: { resolver: 'market', detail: { x: 11, y: 12 } },
        rewardSource: { table: 'auction', detail: { grade: 3 } },
      },
    ],
  });
  contextSystem.seedScheduledEvents(1);
  const host = {
    rng: null,
    worldEntity: { currentDay: 1, state: {} },
    entityRegistry: null,
    tileIndex: new Map(),
    terrainIndex: new Map(),
    _calcFactionVeinOutput: () => new Map(),
    balanceConfig: {},
    modifierTemplates: [],
    techniqueRegistry: new Map(),
    movementSystem: null,
    infoSystem: null,
    opportunitySystem: null,
    worldEventSystem: contextSystem,
    relationshipSystem: null,
    relationshipConfig: {},
  };
  const ctx = new WorldContextBuilder({ host, factionAI: {} }).build();
  assert(!('dynamicEventSystem' in ctx), 'worldContext 不暴露裸 dynamicEventSystem');
  assert(typeof ctx.dynamicEventById === 'function', 'worldContext 暴露 dynamicEventById 窄查询接口');
  const eventSnap = typeof ctx.dynamicEventById === 'function' ? ctx.dynamicEventById('evt_context_snapshot') : null;
  assert(eventSnap && eventSnap !== contextSystem.getById('evt_context_snapshot'), 'dynamicEventById 返回事件快照而非内部对象');
  if (eventSnap) {
    eventSnap.phase = WorldEventPhase.EXPIRED;
    eventSnap.pos.detail.x = 999;
    eventSnap.rewardSource.detail.grade = 99;
  }
  assert(contextSystem.getById('evt_context_snapshot').phase !== WorldEventPhase.EXPIRED, '修改 dynamicEventById 快照不影响系统内部事件');
  assert(contextSystem.snapshot().events[0].pos.detail.x === 11, '修改 dynamicEventById 快照 pos 嵌套对象不污染内部事件');
  assert(contextSystem.snapshot().events[0].rewardSource.detail.grade === 3, '修改 dynamicEventById 快照 rewardSource 嵌套对象不污染内部事件');
  assert(typeof ctx.markDynamicEventPrepared === 'function', 'worldContext 暴露准备记录窄命令接口');
  assert(typeof ctx.markDynamicEventParticipant === 'function', 'worldContext 暴露参与记录窄命令接口');
  if (typeof ctx.markDynamicEventPrepared === 'function') ctx.markDynamicEventPrepared('evt_context_snapshot', 'npc_1');
  if (typeof ctx.markDynamicEventParticipant === 'function') ctx.markDynamicEventParticipant('evt_context_snapshot', 'npc_1');
  const markedSnap = typeof ctx.dynamicEventById === 'function' ? ctx.dynamicEventById('evt_context_snapshot') : null;
  assert(markedSnap?.preparedBy?.includes('npc_1'), 'markDynamicEventPrepared 写入系统并通过快照读取');
  assert(markedSnap?.participants?.includes('npc_1'), 'markDynamicEventParticipant 写入系统并通过快照读取');
  const known = ctx.knownDynamicEventsFor({ id: 'npc_1' });
  assert(known.length === 1, 'worldContext 可读取可见动态事件');
  assert(known[0].event !== contextSystem.getById('evt_context_snapshot'), 'worldContext 返回事件快照而非系统内部对象');
  assert(known[0].source === 'rumor_board', 'knownDynamicEventsFor wrapper.source 表示事件来源');
  assert(known[0].scope === 'public' && known[0].visibilityScope === 'public', 'knownDynamicEventsFor wrapper 暴露可见范围字段');
  known[0].event.name = '外部改名';
  known[0].event.pos.detail.x = 888;
  known[0].event.rewardSource.detail.grade = 88;
  assert(contextSystem.getById('evt_context_snapshot').name === '坊市拍卖', '修改 worldContext 快照不影响系统内部事件');
  assert(contextSystem.snapshot().events[0].pos.detail.x === 11, '修改 knownDynamicEventsFor 快照 pos 嵌套对象不污染内部事件');
  assert(contextSystem.snapshot().events[0].rewardSource.detail.grade === 3, '修改 knownDynamicEventsFor 快照 rewardSource 嵌套对象不污染内部事件');
}

console.log('8) worldContext currentDay 与动态事件 wrapper day 保持一致');
{
  const daySystem = new WorldEventSystem({
    enabled: true,
    events: [
      { id: 'evt_day_sync', type: 'auction', name: '次日拍卖', announceDay: 10, startDay: 11, endDay: 12, scope: 'public' },
    ],
  });
  daySystem.seedScheduledEvents(9);
  const host = {
    rng: null,
    worldEntity: { currentDay: 9, state: {} },
    entityRegistry: null,
    tileIndex: new Map(),
    terrainIndex: new Map(),
    _calcFactionVeinOutput: () => new Map(),
    balanceConfig: {},
    modifierTemplates: [],
    techniqueRegistry: new Map(),
    movementSystem: null,
    infoSystem: null,
    opportunitySystem: null,
    worldEventSystem: daySystem,
    relationshipSystem: null,
    relationshipConfig: {},
  };
  const ctx = new WorldContextBuilder({ host, factionAI: {} }).build();
  host.worldEntity.currentDay = 10;
  daySystem.tick(10);
  const known = ctx.knownDynamicEventsFor({ id: 'npc_1' });
  assert(ctx.currentDay === 10, '同一 worldContext 在世界日推进后读取新 currentDay');
  assert(known.length === 1 && known[0].day === ctx.currentDay, '动态事件 wrapper day 与 worldContext.currentDay 一致');
}

console.log('9) ConfigLoader 加载 dynamic-events.json');
{
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (path) => {
    requested.push(path);
    return { ok: true, status: 200, json: async () => load(path) };
  };
  try {
    const { loadGameConfigs } = await imp('js/core/config-loader.js');
    const loaded = await loadGameConfigs();
    assert(requested.includes('data/world/dynamic-events.json'), 'loadGameConfigs 请求 dynamic-events.json');
    assert(loaded.dynamicEvents?.events?.length === load('data/world/dynamic-events.json').events.length, 'loadGameConfigs 返回 configs.dynamicEvents');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('10) bundled 宗门大比使用真实 faction id 可见');
{
  const dynamicEvents = load('data/world/dynamic-events.json');
  const tournament = dynamicEvents.events.find(e => e.id === 'evt_sect_tournament_001');
  const bundled = new WorldEventSystem({ ...dynamicEvents, enabled: true });
  bundled.seedScheduledEvents(0);
  bundled.tick(tournament.announceDay);

  const sectNpc = { id: 'npc_sect_001_member', state: { get: (key) => key === 'factionId' ? 'sect_001' : null } };
  const outsiderNpc = { id: 'npc_other_sect_member', state: { get: (key) => key === 'factionId' ? 'sect_002' : null } };
  const sectVisible = bundled.visibleEventsFor(sectNpc, tournament.announceDay);
  const outsiderVisible = bundled.visibleEventsFor(outsiderNpc, tournament.announceDay);

  assert(tournament.subjectId === 'sect_001', 'bundled 宗门大比 subjectId 指向真实青云宗 sect_001');
  assert(tournament.pos?.factionId === 'sect_001', 'bundled 宗门大比 pos.factionId 指向真实青云宗 sect_001');
  assert(sectVisible.some(e => e.id === 'evt_sect_tournament_001'), 'sect_001 NPC 可见 bundled faction-scoped 宗门大比');
  assert(!outsiderVisible.some(e => e.id === 'evt_sect_tournament_001'), '非 sect_001 NPC 不可见 bundled faction-scoped 宗门大比');
}

if (failed === 0) {
  console.log('动态事件系统单测全部通过');
  process.exit(0);
}
console.error(`动态事件系统单测失败：${failed} 项`);
process.exit(1);
