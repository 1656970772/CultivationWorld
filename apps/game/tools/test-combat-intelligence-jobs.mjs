#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { ToilResultStatus } = await imp('js/engine/abstract/toil.js');
const { registerNPCToilExecutors } = await imp('js/engine/npc/toils/npc-toils.js');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

function state(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
    data,
  };
}

console.log('0) 战斗风险 JobAction 注册为默认高层行为');
const jobActions = load('data/actions/npc-job-actions.json');
const actionSets = load('data/actions/npc-action-sets.json');
for (const id of ['act_npc_prepare_combat', 'act_npc_retreat_and_heal', 'act_npc_request_hunt_companion']) {
  assert(jobActions.some(a => a.id === id), `${id} exists as default JobAction`);
  assert(actionSets.defaultNpcJobActionIds.includes(id), `${id} is in defaultNpcJobActionIds`);
}

ToilPool.clear();
ToilPool.loadFromConfig(load('data/toils/npc-combat-toils.json'));
ToilPool.loadFromConfig(load('data/toils/npc-quest-toils.json'));
ToilPool.loadFromConfig(load('data/toils/npc-social-toils.json'));
registerNPCToilExecutors();

console.log('1) 过强斩妖目标会触发重规划');
const npc = {
  id: 'npc_weak',
  name: '弱小弟子',
  state: state({ hp: 20, maxHp: 120, injuryLevel: 3, qi: 5 }),
  inventory: { getAmount: () => 0 },
};
const monster = { id: 'm_g5', grade: 5, state: { get: (k) => ({ power: 500 }[k]) } };
const worldContext = { entityRegistry: { getById: () => monster }, npcCombatPower: () => 10 };
const job = { context: { monster, monsterGrade: 5, monsterId: monster.id } };

const assess = ToilPool.getExecutor('toil_assess_combat_risk')?.run(npc, worldContext, job, { params: {} });
assert(assess?.status === ToilResultStatus.REPLAN || assess?.status === ToilResultStatus.ABORT, 'overdangerous monster does not continue hard fight');
assert(npc.state.get('monsterTooDangerous') === true, 'monsterTooDangerous state is set');
assert(npc.state.get('shouldRetreat') === true, 'low hp or high injury asks for retreat');

console.log('2) 撤退与补给 Toil 可运行');
const retreatNpc = {
  state: state({ shouldRetreat: true }),
  spatial: {
    tileX: 0,
    tileY: 0,
    destination: null,
    setDestination(x, y) { this.destination = { x, y }; },
  },
};
const retreat = ToilPool.getExecutor('toil_retreat_to_safe_place')?.run(retreatNpc, { resolveTarget: () => ({ x: 1, y: 1 }) }, { context: {} }, { params: {} });
assert(retreat?.status === ToilResultStatus.RUNNING, 'retreat toil starts moving toward safe target');
assert(retreatNpc.spatial.destination?.x === 1 && retreatNpc.spatial.destination?.y === 1, 'retreat toil sets destination');

let removed = 0;
const supplyNpc = {
  state: state({ injuryLevel: 2 }),
  inventory: {
    getAmount: (id) => (id === 'pill_rejuvenation' ? 1 : 0),
    remove: (id, qty) => { if (id === 'pill_rejuvenation') removed += qty; },
  },
};
const heal = ToilPool.getExecutor('toil_use_heal_item')?.run(supplyNpc, worldContext, { context: {} }, { params: {} });
assert(heal?.status === ToilResultStatus.SUCCESS, 'heal item toil succeeds');
assert(removed === 1, 'heal item toil consumes one pill');
assert(supplyNpc.state.get('injuryLevel') === 1, 'heal item toil lowers injury');

console.log('3) 斩妖任务风险 Toil 复用战斗评估');
const huntNpc = {
  id: 'npc_hunter',
  name: '谨慎弟子',
  spatial: { tileX: 0, tileY: 0 },
  state: state({
    hp: 120,
    maxHp: 120,
    injuryLevel: 0,
    activeQuestTypeId: 'qt_slay_monster',
    activeQuestDifficulty: 5,
    questTargetMonsterId: monster.id,
  }),
  inventory: { getAmount: () => 1 },
};
const huntMonster = { ...monster, spatial: { tileX: 1, tileY: 0 } };
const huntWorld = {
  balanceConfig: {
    economy: {
      monsterResources: {
        huntQuestTypeIds: ['qt_slay_monster'],
        huntDirectRiskThreshold: 1000,
        huntRouteRiskThreshold: 1000,
      },
    },
  },
  entityRegistry: {
    getById: (id) => (id === monster.id ? huntMonster : null),
    getAliveByType: (type) => (type === 'monster' ? [huntMonster] : []),
  },
  npcCombatPower: () => 10,
};
const huntAssess = ToilPool.getExecutor('toil_assess_monster_hunt_risk')?.run(huntNpc, huntWorld, { context: {} }, { params: {} });
assert(huntAssess?.status === ToilResultStatus.REPLAN, 'monster hunt risk toil replans overdangerous target');
assert(huntNpc.state.get('monsterTooDangerous') === true, 'monster hunt risk marks overdangerous target');
assert(huntNpc.state.get('needsCompanion') === true, 'high value overdangerous target asks for companion');
assert(huntNpc.state.get('needsEasierHuntTarget') === true, 'overdangerous target can request easier target');

const lowRiskNpc = {
  id: 'npc_low_risk_hunter',
  name: '稳健弟子',
  spatial: { tileX: 0, tileY: 0 },
  state: state({
    hp: 120,
    maxHp: 120,
    injuryLevel: 0,
    activeQuestTypeId: 'qt_slay_monster',
    activeQuestDifficulty: 1,
    questTargetMonsterId: 'm_low_risk',
  }),
  inventory: { getAmount: () => 0 },
};
const lowRiskMonster = { id: 'm_low_risk', grade: 1, spatial: { tileX: 1, tileY: 0 }, state: { get: (k) => ({ alive: true, power: 20 }[k]) } };
const lowRiskWorld = {
  ...huntWorld,
  entityRegistry: {
    getById: (id) => (id === lowRiskMonster.id ? lowRiskMonster : null),
    getAliveByType: (type) => (type === 'monster' ? [lowRiskMonster] : []),
  },
  npcCombatPower: () => 80,
};
const lowRiskAssess = ToilPool.getExecutor('toil_assess_monster_hunt_risk')?.run(lowRiskNpc, lowRiskWorld, { context: {} }, { params: {} });
assert(lowRiskAssess?.status === ToilResultStatus.SUCCESS, 'low risk hunt does not require combat supply');
assert(lowRiskNpc.state.get('needsCombatSupply') === false, 'low risk missing supply does not block hunt');

console.log('4) 请求斩妖同伴会写入 party 状态并降低风险');
const hunter = {
  id: 'npc_hunter_party',
  name: '谨慎师兄',
  spatial: {
    tileX: 0,
    tileY: 0,
    destination: null,
    setDestination(x, y) { this.destination = { x, y }; },
  },
  state: state({
    hp: 120,
    maxHp: 120,
    injuryLevel: 0,
    factionId: 'sect_a',
    activeQuestTypeId: 'qt_slay_monster',
    activeQuestDifficulty: 5,
    activeQuestValue: 500,
    questTargetMonsterId: 'm_party',
    questTargetX: 6,
    questTargetY: 0,
  }),
  inventory: { getAmount: () => 1 },
};
const weakOtherSect = {
  id: 'npc_other_sect',
  name: '路过散修',
  spatial: { tileX: 1, tileY: 0 },
  state: state({ alive: true, factionId: 'sect_b' }),
};
const sameSectCompanion = {
  id: 'npc_same_sect_strong',
  name: '强力同门',
  spatial: {
    tileX: 2,
    tileY: 0,
    destination: null,
    setDestination(x, y) { this.destination = { x, y }; },
  },
  state: state({ alive: true, factionId: 'sect_a' }),
};
const deadSameSect = {
  id: 'npc_dead_same_sect',
  name: '受伤同门',
  alive: false,
  spatial: { tileX: 0, tileY: 0 },
  state: state({ alive: false, factionId: 'sect_a' }),
};
const partyMonster = {
  id: 'm_party',
  grade: 5,
  spatial: { tileX: 6, tileY: 0 },
  state: { get: (k) => ({ alive: true, power: 500 }[k]) },
};
const partyWorld = {
  balanceConfig: {
    economy: {
      monsterResources: {
        huntQuestTypeIds: ['qt_slay_monster'],
        huntDirectRiskThreshold: 1000,
        huntRouteRiskThreshold: 1000,
      },
    },
  },
  entityRegistry: {
    getById(id) {
      return [partyMonster, weakOtherSect, sameSectCompanion, deadSameSect].find(item => item.id === id) || null;
    },
    getByType(type) {
      return type === 'npc' ? [weakOtherSect, sameSectCompanion, deadSameSect, hunter] : [];
    },
    getAliveByType(type) {
      if (type === 'monster') return [partyMonster];
      if (type === 'npc') return [weakOtherSect, sameSectCompanion, hunter];
      return [];
    },
  },
  npcCombatPower(entity) {
    return entity?.id === sameSectCompanion.id ? 120 : (entity?.id === weakOtherSect.id ? 5 : 10);
  },
};
const partyJob = { context: {} };
const beforeParty = ToilPool.getExecutor('toil_assess_monster_hunt_risk')?.run(hunter, partyWorld, partyJob, { params: {} });
const beforeRiskScore = hunter.state.get('combatRiskScore');
assert(beforeParty?.reason === 'hunt_companion_required', 'high value hard hunt requests companion before solo fight');

const selected = ToilPool.getExecutor('toil_select_companion')?.run(hunter, partyWorld, partyJob, {
  params: { sameFactionPreferred: true, maxDistance: 60, minPowerRatio: 0.4 },
});
Object.assign(partyJob.context, selected?.contextPatch || {});
assert(selected?.status === ToilResultStatus.SUCCESS, 'needsCompanion=true can select a companion');
assert(selected?.contextPatch?.companionId === sameSectCompanion.id, 'companion selection prefers alive same-faction strong nearby NPC');

const requested = ToilPool.getExecutor('toil_request_companion')?.run(hunter, partyWorld, partyJob, { params: {} });
assert(requested?.status === ToilResultStatus.SUCCESS, 'request companion toil succeeds');
assert(hunter.state.get('huntCompanionId') === sameSectCompanion.id, 'request writes huntCompanionId');
assert(hunter.state.get('hasHuntCompanion') === true, 'request marks hasHuntCompanion=true');
assert(hunter.state.get('needsCompanion') === false, 'request clears needsCompanion');
assert(JSON.stringify(hunter.state.get('huntPartyIds')) === JSON.stringify([hunter.id, sameSectCompanion.id]), 'request writes huntPartyIds');

const wait = ToilPool.getExecutor('toil_wait_for_hunt_companion')?.run(hunter, partyWorld, partyJob, {
  params: { maxDays: 3, targetResolver: 'quest_target' },
});
assert(wait?.status === ToilResultStatus.RUNNING, 'wait companion toil runs while companion moves to quest target');
assert(sameSectCompanion.spatial.destination?.x === 6 && sameSectCompanion.spatial.destination?.y === 0, 'wait companion sends companion to quest target');
sameSectCompanion.spatial.tileX = 6;
sameSectCompanion.spatial.tileY = 0;
const arrived = ToilPool.getExecutor('toil_wait_for_hunt_companion')?.run(hunter, partyWorld, partyJob, {
  params: { maxDays: 3, targetResolver: 'quest_target' },
});
assert(arrived?.status === ToilResultStatus.SUCCESS, 'wait companion succeeds when companion reaches quest target');

const afterParty = ToilPool.getExecutor('toil_assess_monster_hunt_risk')?.run(hunter, partyWorld, partyJob, { params: {} });
assert(afterParty?.contextPatch?.combatRiskScore < beforeRiskScore, 'companion lowers monster hunt combatRiskScore');

sameSectCompanion.spatial.tileX = 0;
sameSectCompanion.spatial.tileY = 0;
hunter.state.set('huntCompanionWaitDays', 3);
const timedOut = ToilPool.getExecutor('toil_wait_for_hunt_companion')?.run(hunter, partyWorld, partyJob, {
  params: { maxDays: 3, targetResolver: 'quest_target' },
});
assert(timedOut?.status === ToilResultStatus.REPLAN, 'wait companion timeout triggers replan');
assert(timedOut?.reason === 'hunt_companion_timeout', 'wait companion timeout returns clear reason');
assert(hunter.state.get('hasHuntCompanion') === false, 'timeout clears hasHuntCompanion so task chain is not blocked');

if (failed > 0) {
  console.error(`\nCombat intelligence tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nCombat intelligence tests passed');
