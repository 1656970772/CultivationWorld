#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { JobSystem } = await imp('js/engine/abstract/job-system.js');
const { ToilResultStatus } = await imp('js/engine/abstract/toil.js');
const { registerNPCToilExecutors } = await imp('js/engine/npc/npc-actions.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

class TestState {
  constructor(values = {}) { this._values = { ...values }; }
  get(key) { return this._values[key]; }
  set(key, value) { this._values[key] = value; }
}

function createWorld(eventsById = {}, options = {}) {
  const calls = { prepared: [], participants: [], resolveTarget: [] };
  return {
    calls,
    dynamicEventById(id) {
      return eventsById[id] || null;
    },
    resolveTarget(entity, targetResolver) {
      calls.resolveTarget.push({ entityId: entity?.id, targetResolver });
      if (typeof options.resolveTarget === 'function') {
        return options.resolveTarget(entity, targetResolver);
      }
      if (targetResolver !== 'dynamic_event_target') return null;
      const eventId = entity?.state?.get?.('targetDynamicEventId');
      const event = eventsById[eventId];
      if (event?.pos && typeof event.pos.x === 'number' && typeof event.pos.y === 'number') {
        return { x: event.pos.x, y: event.pos.y };
      }
      if (typeof event?.x === 'number' && typeof event?.y === 'number') {
        return { x: event.x, y: event.y };
      }
      return null;
    },
    markDynamicEventPrepared(eventId, entityId) {
      calls.prepared.push({ eventId, entityId });
      return true;
    },
    markDynamicEventParticipant(eventId, entityId) {
      calls.participants.push({ eventId, entityId });
      return true;
    },
  };
}

function loadDynamicEventJobs() {
  JobPool.loadFromConfig({ jobs: [
    {
      id: 'job_npc_prepare_dynamic_event',
      name: '筹备动态事件',
      category: 'dynamic_event',
      successEffects: { preparedForDynamicEvent: { op: 'set', value: true } },
      toils: [
        { id: 'bind_event', type: 'toil_bind_dynamic_event' },
        { id: 'validate_announced', type: 'toil_validate_dynamic_event_phase', params: { phases: ['announced'] } },
        { id: 'mark_prepared', type: 'toil_mark_dynamic_event_prepared' },
      ],
    },
    {
      id: 'job_npc_join_dynamic_event',
      name: '参与动态事件',
      category: 'dynamic_event',
      successEffects: { joinedDynamicEvent: { op: 'set', value: true } },
      toils: [
        { id: 'bind_event', type: 'toil_bind_dynamic_event' },
        { id: 'move_to_event', type: 'toil_move_to_target', params: { targetResolver: 'dynamic_event_target' } },
        { id: 'wait_active', type: 'toil_wait_until_event_phase', params: { phases: ['active'] } },
        { id: 'mark_participant', type: 'toil_mark_dynamic_event_participant' },
      ],
    },
  ] });
}

JobPool.clear();
ToilPool.clear();
ToilPool.loadFromConfig({ toils: [
  { id: 'toil_bind_dynamic_event', name: '绑定动态事件' },
  { id: 'toil_validate_dynamic_event_phase', name: '校验动态事件阶段' },
  { id: 'toil_mark_dynamic_event_prepared', name: '标记动态事件准备' },
  { id: 'toil_move_to_target', name: '移动到目标' },
  { id: 'toil_wait_until_event_phase', name: '等待动态事件阶段' },
  { id: 'toil_mark_dynamic_event_participant', name: '标记动态事件参与者' },
] });
registerNPCToilExecutors();
loadDynamicEventJobs();

console.log('1) prepare valid dynamic event marks prepared state and event');
{
  const event = { id: 'evt_secret_1', name: '青岚秘境', type: 'secret_realm', phase: 'announced' };
  const entity = { id: 'npc_prepare', state: new TestState({ targetDynamicEventId: event.id }) };
  const world = createWorld({ [event.id]: event });
  const system = new JobSystem();
  system.start('job_npc_prepare_dynamic_event');

  let result = system.executeStep(entity, world);
  assert(result.status === 'running', 'bind_event success advances prepare job');
  result = system.executeStep(entity, world);
  assert(result.status === 'running', 'validate_announced success advances prepare job');
  result = system.executeStep(entity, world);
  assert(result.status === 'success', 'mark_prepared completes prepare job');
  assert(world.calls.prepared.length === 1, 'worldContext.markDynamicEventPrepared was called');
  assert(world.calls.prepared[0].eventId === event.id, 'prepared call uses event id');
  assert(world.calls.prepared[0].entityId === entity.id, 'prepared call uses entity id');
  assert(entity.state.get('preparedForDynamicEvent') === true, 'preparedForDynamicEvent is true after job success');
  assert(entity.state.get('lastPreparedDynamicEventId') === event.id, 'lastPreparedDynamicEventId is written');
}

console.log('2) missing dynamic event aborts without prepared state');
{
  const entity = { id: 'npc_missing', state: new TestState({ targetDynamicEventId: 'evt_missing' }) };
  const world = createWorld({});
  const system = new JobSystem();
  system.start('job_npc_prepare_dynamic_event');

  const result = system.executeStep(entity, world);
  assert(result.status === 'abort', 'bind_event aborts when event is missing');
  assert(result.reason === 'dynamic_event_missing', 'missing event reports dynamic_event_missing');
  assert(entity.state.get('preparedForDynamicEvent') !== true, 'missing event does not write preparedForDynamicEvent true');
  assert(world.calls.prepared.length === 0, 'missing event does not mark prepared');
}

console.log('3) join dynamic event waits for active phase and marks participant');
{
  const event = {
    id: 'evt_secret_2',
    name: '赤霞洞天',
    type: 'secret_realm',
    phase: 'announced',
    x: 7,
    y: 9,
  };
  const entity = {
    id: 'npc_join',
    state: new TestState({ targetDynamicEventId: event.id }),
    spatial: {
      tileX: 1,
      tileY: 2,
      destinations: [],
      setDestination(x, y) { this.destinations.push({ x, y }); },
    },
  };
  const world = createWorld({ [event.id]: event });
  const system = new JobSystem();
  system.start('job_npc_join_dynamic_event');

  let result = system.executeStep(entity, world);
  assert(result.status === 'running', 'bind_event success advances join job');
  result = system.executeStep(entity, world);
  assert(result.status === 'running', 'move_to_event returns running while NPC is traveling');
  assert(result.reason === 'moving_to_target', 'move_to_event reports moving_to_target');
  assert(entity.spatial.destinations.length === 1, 'move_to_event calls setDestination when NPC is away');
  assert(entity.spatial.destinations[0].x === 7 && entity.spatial.destinations[0].y === 9, 'move_to_event sets destination to event coordinates');
  assert(world.calls.resolveTarget.some(c => c.targetResolver === 'dynamic_event_target'), 'move_to_event uses dynamic_event_target resolver');
  entity.spatial.tileX = 7;
  entity.spatial.tileY = 9;
  result = system.executeStep(entity, world);
  assert(result.status === 'running', 'move_to_event success advances join job after arrival');
  result = system.executeStep(entity, world);
  assert(result.status === 'running', 'wait_active returns running while event is announced');
  assert(result.reason === 'waiting_dynamic_event_phase', 'wait_active reports waiting_dynamic_event_phase');
  assert(world.calls.participants.length === 0, 'announced event does not mark participant yet');

  event.phase = 'active';
  result = system.executeStep(entity, world);
  assert(result.status === 'running', 'wait_active success advances to mark participant');
  result = system.executeStep(entity, world);
  assert(result.status === 'success', 'mark participant completes join job');
  assert(world.calls.participants.length === 1, 'worldContext.markDynamicEventParticipant was called');
  assert(world.calls.participants[0].eventId === event.id, 'participant call uses event id');
  assert(world.calls.participants[0].entityId === entity.id, 'participant call uses entity id');
  assert(entity.state.get('joinedDynamicEvent') === true, 'joinedDynamicEvent is true after job success');
  assert(entity.state.get('lastJoinedDynamicEventId') === event.id, 'lastJoinedDynamicEventId is written');
}

console.log('4) resolver based event position is refreshed during move');
{
  const event = {
    id: 'evt_secret_resolver',
    name: '流转秘境',
    type: 'secret_realm',
    phase: 'active',
    pos: { resolver: 'secret_realm' },
  };
  let latestTarget = { x: 12, y: 13 };
  const entity = {
    id: 'npc_resolver_join',
    state: new TestState({ targetDynamicEventId: event.id }),
    spatial: {
      tileX: 3,
      tileY: 4,
      destinations: [],
      setDestination(x, y) { this.destinations.push({ x, y }); },
    },
  };
  const world = createWorld({ [event.id]: event }, {
    resolveTarget(_entity, targetResolver) {
      return targetResolver === 'dynamic_event_target' ? { ...latestTarget } : null;
    },
  });
  const system = new JobSystem();
  system.start('job_npc_join_dynamic_event');

  let result = system.executeStep(entity, world);
  assert(result.status === 'running', 'bind_event succeeds for resolver based event position');
  latestTarget = { x: 20, y: 21 };
  result = system.executeStep(entity, world);
  assert(result.status === 'running', 'move_to_event starts moving to refreshed resolver position');
  assert(entity.spatial.destinations[0].x === 20 && entity.spatial.destinations[0].y === 21, 'move_to_event uses latest worldContext resolver coordinates');
}

console.log('5) move toil blocks invalid spatial instead of reporting running');
{
  const executor = ToilPool.getExecutor('toil_move_to_target');
  const badPositionEntity = {
    id: 'npc_bad_position',
    state: new TestState({}),
    spatial: { destinations: [], setDestination(x, y) { this.destinations.push({ x, y }); } },
  };
  const badPositionResult = executor.run(
    badPositionEntity,
    {},
    { context: { target: { x: 6, y: 8 } } },
    { id: 'move', type: 'toil_move_to_target', params: {} },
  );
  assert(badPositionResult.status === ToilResultStatus.BLOCKED, 'invalid spatial position returns blocked');
  assert(badPositionResult.reason === 'spatial_position_invalid', 'invalid spatial position reports concrete reason');
  assert(badPositionEntity.spatial.destinations.length === 0, 'invalid spatial position does not set destination');

  const missingDestinationApiEntity = {
    id: 'npc_missing_set_destination',
    state: new TestState({}),
    spatial: { tileX: 1, tileY: 1 },
  };
  const missingApiResult = executor.run(
    missingDestinationApiEntity,
    {},
    { context: { target: { x: 6, y: 8 } } },
    { id: 'move', type: 'toil_move_to_target', params: {} },
  );
  assert(missingApiResult.status === ToilResultStatus.BLOCKED, 'missing setDestination returns blocked');
  assert(missingApiResult.reason === 'spatial_destination_unavailable', 'missing setDestination reports concrete reason');
}

if (failed > 0) {
  console.error(`\nDynamic event Job tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nDynamic event Job tests passed');
