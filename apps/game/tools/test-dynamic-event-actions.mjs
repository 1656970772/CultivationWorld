#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { ActionPool } = await imp('js/engine/pools/action-pool.js');
const { registerNPCExecutors } = await imp('js/engine/npc/npc-actions.js');
const { WorldContextBuilder } = await imp('js/engine/world/services/world-context-builder.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

class TestState {
  constructor(values = {}) {
    this._values = { ...values };
  }
  get(key) { return this._values[key]; }
  set(key, value) { this._values[key] = value; }
}

ActionPool.clear();
registerNPCExecutors();
ActionPool.registerTemplate({
  id: 'act_npc_prepare_dynamic_event',
  name: '筹备动态事件',
  category: 'npc',
  preconditions: {},
  effects: {},
  plannerEffects: {
    preparedForDynamicEvent: { op: 'set', value: true },
  },
  duration: 3,
  requiresTravel: false,
  targetResolver: 'self',
  executorId: 'npc_prepare_dynamic_event',
});
ActionPool.registerTemplate({
  id: 'act_npc_join_dynamic_event',
  name: '参与动态事件',
  category: 'npc',
  preconditions: {},
  effects: {},
  plannerEffects: {
    joinedDynamicEvent: { op: 'set', value: true },
  },
  duration: 5,
  requiresTravel: true,
  targetResolver: 'dynamic_event_target',
  distanceCostPerTile: 0.02,
  executorId: 'npc_join_dynamic_event',
});

console.log('1) NPC 可通过动态事件准备动作标记事件和自身状态');
{
  const event = {
    id: 'evt_x',
    name: '青冥秘境',
    type: 'secret_realm',
    pos: { x: 12, y: 18 },
  };
  const prepared = [];
  const entity = {
    id: 'npc_dynamic_prepare',
    state: new TestState({
      targetDynamicEventId: event.id,
      preparedForDynamicEvent: false,
    }),
  };
  const worldContext = {
    dynamicEventById: (id) => (id === event.id ? event : null),
    markDynamicEventPrepared: (eventId, npcId) => {
      prepared.push({ eventId, npcId });
      return true;
    },
  };

  const action = ActionPool.create('act_npc_prepare_dynamic_event');
  const result = action.execute(entity, worldContext);

  assert(result.dynamicEventId === event.id, '执行结果携带 dynamicEventId');
  assert(result.dynamicEventName === event.name, '执行结果携带 dynamicEventName');
  assert(result.prepared === true, '执行结果标记 prepared=true');
  assert(prepared.some(p => p.eventId === event.id && p.npcId === entity.id), 'worldContext 记录事件已准备');
  assert(entity.state.get('preparedForDynamicEvent') === true, 'Action effects 写入 preparedForDynamicEvent=true');
  assert(entity.state.get('lastPreparedDynamicEventId') === event.id, 'executor 写入 lastPreparedDynamicEventId');
}

console.log('2) NPC 可通过动态事件加入动作标记参与者和自身状态');
{
  const event = {
    id: 'evt_join',
    name: '青冥秘境开启',
    type: 'secret_realm',
    pos: { x: 12, y: 18 },
  };
  const participants = [];
  const entity = {
    id: 'npc_dynamic_join',
    state: new TestState({
      targetDynamicEventId: event.id,
      joinedDynamicEvent: false,
    }),
  };
  const worldContext = {
    dynamicEventById: (id) => (id === event.id ? event : null),
    markDynamicEventParticipant: (eventId, npcId) => {
      participants.push({ eventId, npcId });
      return true;
    },
  };

  const action = ActionPool.create('act_npc_join_dynamic_event');
  const result = action.execute(entity, worldContext);

  assert(result.dynamicEventId === event.id, '加入结果携带 dynamicEventId');
  assert(result.dynamicEventName === event.name, '加入结果携带 dynamicEventName');
  assert(result.joined === true, '加入结果标记 joined=true');
  assert(participants.some(p => p.eventId === event.id && p.npcId === entity.id), 'worldContext 记录事件参与者');
  assert(entity.state.get('joinedDynamicEvent') === true, 'Action effects 写入 joinedDynamicEvent=true');
  assert(entity.state.get('lastJoinedDynamicEventId') === event.id, 'executor 写入 lastJoinedDynamicEventId');
}

console.log('3) 缺失事件或标记失败不会伪完成动态事件状态');
{
  const missingEntity = {
    id: 'npc_missing_dynamic_event',
    state: new TestState({
      targetDynamicEventId: 'evt_missing',
      preparedForDynamicEvent: false,
      joinedDynamicEvent: false,
    }),
  };
  const missingContext = {
    dynamicEventById: () => null,
    markDynamicEventPrepared: () => true,
    markDynamicEventParticipant: () => true,
  };
  let result = ActionPool.create('act_npc_prepare_dynamic_event').execute(missingEntity, missingContext);
  assert(result.prepared === false, '缺失事件时准备行为返回 prepared=false');
  assert(missingEntity.state.get('preparedForDynamicEvent') === false, '缺失事件时不写 preparedForDynamicEvent');
  result = ActionPool.create('act_npc_join_dynamic_event').execute(missingEntity, missingContext);
  assert(result.joined === false, '缺失事件时参与行为返回 joined=false');
  assert(missingEntity.state.get('joinedDynamicEvent') === false, '缺失事件时不写 joinedDynamicEvent');

  const event = { id: 'evt_mark_fail', name: '标记失败事件', pos: { x: 1, y: 2 } };
  const markFailEntity = {
    id: 'npc_mark_fail',
    state: new TestState({
      targetDynamicEventId: event.id,
      preparedForDynamicEvent: false,
      joinedDynamicEvent: false,
    }),
  };
  const markFailContext = {
    dynamicEventById: (id) => (id === event.id ? event : null),
    markDynamicEventPrepared: () => false,
    markDynamicEventParticipant: () => false,
  };
  result = ActionPool.create('act_npc_prepare_dynamic_event').execute(markFailEntity, markFailContext);
  assert(result.prepared === false, '标记失败时准备行为返回 prepared=false');
  assert(markFailEntity.state.get('preparedForDynamicEvent') === false, '标记失败时不写 preparedForDynamicEvent');
  result = ActionPool.create('act_npc_join_dynamic_event').execute(markFailEntity, markFailContext);
  assert(result.joined === false, '标记失败时参与行为返回 joined=false');
  assert(markFailEntity.state.get('joinedDynamicEvent') === false, '标记失败时不写 joinedDynamicEvent');
}

console.log('4) 真实 action JSON 使用 plannerEffects 而非运行期 effects');
{
  ActionPool.clear();
  registerNPCExecutors();
  ActionPool.loadFromArray(load('data/actions/npc-actions.json'));
  const prepare = ActionPool.create('act_npc_prepare_dynamic_event');
  const join = ActionPool.create('act_npc_join_dynamic_event');
  assert(Object.keys(prepare.effects || {}).length === 0, '真实准备 action 运行期 effects 为空');
  assert(prepare.getEffects().preparedForDynamicEvent?.value === true, '真实准备 action plannerEffects 可推进 preparedForDynamicEvent');
  assert(Object.keys(join.effects || {}).length === 0, '真实参与 action 运行期 effects 为空');
  assert(join.getEffects().joinedDynamicEvent?.value === true, '真实参与 action plannerEffects 可推进 joinedDynamicEvent');
  assert(join.targetResolver === 'dynamic_event_target', '真实参与 action 使用 dynamic_event_target resolver');
}

console.log('5) worldContext 可解析 dynamic_event_target 坐标');
{
  const here = { x: 1, y: 2 };
  const events = new Map([
    ['evt_pos', { id: 'evt_pos', name: '固定坐标事件', pos: { x: 21, y: 34 } }],
    ['evt_secret', { id: 'evt_secret', name: '秘境入口', pos: { resolver: 'secret_realm' } }],
    ['evt_hq', { id: 'evt_hq', name: '宗门大比', pos: { resolver: 'faction_hq', factionId: 'sect_001' } }],
    ['evt_hq_without_faction', { id: 'evt_hq_without_faction', name: '缺失势力大比', pos: { resolver: 'faction_hq' }, subjectId: 'sect_001' }],
    ['evt_live', {
      toJSON: () => ({ id: 'evt_live', name: '实例快照事件', pos: { x: 55, y: 66 } }),
    }],
  ]);
  const host = {
    rng: null,
    worldEntity: { currentDay: 1, state: {}, activeModifiers: [] },
    entityRegistry: {
      getById: (id) => (id === 'sect_001'
        ? { id, alive: true, staticData: { headquarters: { x: 88, y: 99 } } }
        : null),
      getByType: () => [],
      getAliveByType: () => [],
    },
    tileIndex: new Map(),
    terrainIndex: new Map(),
    _calcFactionVeinOutput: () => new Map(),
    balanceConfig: {},
    modifierTemplates: [],
    techniqueRegistry: new Map(),
    movementSystem: null,
    infoSystem: null,
    opportunitySystem: null,
    relationshipSystem: null,
    relationshipConfig: {},
    dynamicGoalsConfig: {},
    worldEventSystem: { getById: (id) => events.get(id) || null },
    infoCoordinator: { secretRealmPos: () => ({ x: 44, y: 45 }) },
    getFactionBuilding: () => null,
    _nearestBountyOrg: () => null,
    _nearestHq: () => null,
    _bestOpportunityFor: () => null,
  };
  const worldContext = new WorldContextBuilder({ host, factionAI: {} }).build();
  const entity = {
    spatial: { tileX: here.x, tileY: here.y },
    state: new TestState({ targetDynamicEventId: 'evt_pos', factionId: 'sect_001' }),
  };

  let pos = worldContext.resolveTarget(entity, 'dynamic_event_target');
  assert(pos?.x === 21 && pos?.y === 34, 'dynamic_event_target 使用事件 pos 数字坐标');

  entity.state.set('targetDynamicEventId', 'evt_secret');
  pos = worldContext.resolveTarget(entity, 'dynamic_event_target');
  assert(pos?.x === 44 && pos?.y === 45, 'secret_realm resolver 使用 infoCoordinator.secretRealmPos');

  entity.state.set('targetDynamicEventId', 'evt_hq');
  pos = worldContext.resolveTarget(entity, 'dynamic_event_target');
  assert(pos?.x === 88 && pos?.y === 99, 'faction_hq resolver 使用事件 factionId 的总部');

  entity.state.set('targetDynamicEventId', 'evt_hq_without_faction');
  pos = worldContext.resolveTarget(entity, 'dynamic_event_target');
  assert(pos?.x === here.x && pos?.y === here.y, 'faction_hq resolver 缺少事件 factionId 时回退当前位置');

  entity.state.set('targetDynamicEventId', 'evt_live');
  pos = worldContext.resolveTarget(entity, 'dynamic_event_target');
  assert(pos?.x === 55 && pos?.y === 66, 'WorldEvent 实例通过 toJSON 快照解析 pos');

  entity.state.set('targetDynamicEventId', 'evt_missing');
  pos = worldContext.resolveTarget(entity, 'dynamic_event_target');
  assert(pos?.x === here.x && pos?.y === here.y, '缺失事件时回退当前位置');
}

if (failed === 0) {
  console.log('\n动态事件行为单测全部通过');
  process.exit(0);
}
console.error(`\n动态事件行为单测失败：${failed} 项`);
process.exit(1);
