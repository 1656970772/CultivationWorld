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

console.log('3) awareness confidence 支持配置值并保留默认 fallback');
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

console.log('4) WorldEngine 默认配置集成安全：动态事件关闭态保持静默');
{
  const engine = new WorldEngine();
  engine.init(buildGameConfigs());
  assert(engine.worldEventSystem.snapshot().events.length === 0, '当前数据默认 enabled=false，WorldEngine 初始化不播种动态事件');
  for (let i = 0; i < 3; i++) {
    const tickLog = engine.tick();
    assert(Array.isArray(tickLog.dynamicEvents) && tickLog.dynamicEvents.length === 0, `第 ${i + 1} 个 tick dynamicEvents 为空`);
  }
}

console.log('5) worldContext 暴露动态事件快照，避免外部改写系统事件');
{
  const contextSystem = new WorldEventSystem({
    enabled: true,
    events: [
      { id: 'evt_context_snapshot', type: 'auction', name: '坊市拍卖', announceDay: 1, startDay: 2, endDay: 3, scope: 'public' },
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
  const known = ctx.knownDynamicEventsFor({ id: 'npc_1' });
  assert(known.length === 1, 'worldContext 可读取可见动态事件');
  assert(known[0].event !== contextSystem.getById('evt_context_snapshot'), 'worldContext 返回事件快照而非系统内部对象');
  known[0].event.name = '外部改名';
  assert(contextSystem.getById('evt_context_snapshot').name === '坊市拍卖', '修改 worldContext 快照不影响系统内部事件');
}

if (failed === 0) {
  console.log('动态事件系统单测全部通过');
  process.exit(0);
}
console.error(`动态事件系统单测失败：${failed} 项`);
process.exit(1);
