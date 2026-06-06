#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { ReactiveNode } = await imp('js/engine/abstract/bt/reactions.js');
const { StimulusType, StimulusQueue } = await imp('js/engine/abstract/stimulus.js');
const {
  NPCReactFleeExecutor,
  NPCReactRetreatExecutor,
  NPCReactHealExecutor,
  NPCReactCounterExecutor,
} = await imp('js/engine/npc/actions/reaction-actions.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

function state(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    get: (key) => data.get(key),
    set: (key, value) => data.set(key, value),
    data,
  };
}

function makeEntity(values) {
  const calls = [];
  return {
    id: 'npc_react',
    state: state(values),
    stimulusQueue: new StimulusQueue({ ttl: 2, capacity: 4 }),
    behaviorSystem: {
      isBusy: () => false,
      suspendPlanForReaction: () => true,
      setSingleActionPlan: (actionId, reason) => {
        calls.push({ actionId, reason });
        return true;
      },
      restoreSuspendedPlan: () => {},
      executeStep: () => ({ status: 'plan_complete' }),
      getLastPlanResult: () => null,
    },
    _calls: calls,
  };
}

function makeActionEntity(values = {}) {
  return {
    id: values.id || 'npc_action_react',
    name: values.name || '测试修士',
    staticData: { name: values.name || '测试修士' },
    state: state({
      hp: 100,
      maxHp: 100,
      injuryLevel: 0,
      shouldRetreat: true,
      combatReady: true,
      needsCombatSupply: false,
      needsCombatRecovery: false,
      ...values.state,
    }),
    inventory: values.inventory || {
      getAmount: () => 0,
      remove: () => {},
    },
    alive: values.alive ?? true,
  };
}

function runReaction(entity, worldContext) {
  entity.stimulusQueue.push(StimulusType.ATTACKED, {
    sourceId: 'monster_1',
    payload: { killerId: 'monster_1', damage: 60, enemyPower: 200, cause: 'monster' },
  });
  const node = new ReactiveNode({ name: 'react-attacked' });
  node.tick(entity, {}, worldContext);
  return entity._calls[0]?.actionId;
}

const cfg = {
  enabled: true,
  combat: {
    criticalHpRatio: 0.25,
    lowHpRatio: 0.45,
    counterAdvantageRatio: 1.3,
    retreatDisadvantageRatio: 1.2,
    heavyDamageHpRatio: 0.4,
  },
  actions: {
    flee: 'act_npc_react_flee',
    retreat: 'act_npc_react_retreat',
    heal: 'act_npc_react_heal',
    counter: 'act_npc_react_counter',
  },
};

assert(
  runReaction(makeEntity({ hp: 20, maxHp: 120, injuryLevel: 3 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 40 }) === 'act_npc_react_flee',
  'critical attacked NPC chooses flee in Reaction layer',
);
assert(
  runReaction(makeEntity({ hp: 40, maxHp: 120, injuryLevel: 1 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 60 }) === 'act_npc_react_heal',
  'low hp attacked NPC chooses heal in Reaction layer',
);
assert(
  runReaction(makeEntity({ hp: 100, maxHp: 120, injuryLevel: 0 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 400 }) === 'act_npc_react_counter',
  'advantaged attacked NPC chooses counter in Reaction layer',
);
assert(
  runReaction(makeEntity({ hp: 100, maxHp: 120, injuryLevel: 0 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 80 }) === 'act_npc_react_retreat',
  'disadvantaged attacked NPC chooses retreat in Reaction layer',
);

const fleeEntity = makeActionEntity();
new NPCReactFleeExecutor().run(fleeEntity, { currentDay: 7, infoEvents: [] }, {});
assert(fleeEntity.state.get('lastCombatReaction') === 'flee', 'flee action records lastCombatReaction');
assert(fleeEntity.state.get('shouldRetreat') === false, 'flee action clears shouldRetreat');
assert(fleeEntity.state.get('combatReady') === false, 'flee action marks combatReady false');
assert(fleeEntity.state.get('needsCombatSupply') === true, 'flee action asks for combat supply');
assert(fleeEntity.state.get('needsCombatRecovery') === true, 'flee action asks for combat recovery');

const retreatEntity = makeActionEntity();
new NPCReactRetreatExecutor().run(retreatEntity, { currentDay: 7, infoEvents: [] }, {});
assert(retreatEntity.state.get('lastCombatReaction') === 'retreat', 'retreat action records lastCombatReaction');
assert(retreatEntity.state.get('shouldRetreat') === false, 'retreat action clears shouldRetreat');
assert(retreatEntity.state.get('combatReady') === false, 'retreat action marks combatReady false');
assert(retreatEntity.state.get('needsCombatSupply') === true, 'retreat action asks for combat supply');
assert(retreatEntity.state.get('needsCombatRecovery') === true, 'retreat action asks for combat recovery');

const healEntity = makeActionEntity({ state: { hp: 20, maxHp: 100, shouldRetreat: true } });
new NPCReactHealExecutor().run(healEntity, {
  balanceConfig: { reaction: { restHealRatio: 0.3, combat: { lowHpRatio: 0.45 } } },
  currentDay: 7,
  infoEvents: [],
}, {});
assert(healEntity.state.get('lastCombatReaction') === 'heal', 'heal action records lastCombatReaction');
assert(healEntity.state.get('hp') >= 45, 'heal action can recover above low hp threshold');
assert(healEntity.state.get('shouldRetreat') === false, 'heal action clears shouldRetreat after recovery');
assert(healEntity.state.get('needsCombatSupply') === true, 'heal action records missing combat supply when no pill remains');

const counterEvents = [];
const counterEntity = makeActionEntity({ state: { _reactCounterTargetId: 'monster_1' } });
const counterTarget = makeActionEntity({
  id: 'monster_1',
  name: '测试妖兽',
  state: { hp: 100, maxHp: 100 },
});
new NPCReactCounterExecutor().run(counterEntity, {
  currentDay: 7,
  infoEvents: counterEvents,
  balanceConfig: { reaction: { counterDamageRatio: 0.5 } },
  entityRegistry: { getById: (id) => (id === 'monster_1' ? counterTarget : null) },
  npcCombatPower: () => 20,
}, {});
assert(counterEntity.state.get('lastCombatReaction') === 'counter', 'counter action records lastCombatReaction');
assert(counterEvents.some((event) => event.type === 'react_counter'), 'counter action writes react_counter infoEvent sample');

if (failed > 0) {
  console.error(`\nReaction combat intelligence tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nReaction combat intelligence tests passed');
