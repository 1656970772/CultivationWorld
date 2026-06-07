#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

const { applyCultivationExperience } = await imp('js/engine/npc/cultivation-experience.js');
const { NPCState } = await imp('js/engine/npc/npc-state.js');
const { NPCGotoOpportunityExecutor, NPCTeachDiscipleExecutor, NPCVisitMasterExecutor } = await imp('js/engine/npc/actions/relationship-actions.js');
const { NPCExploreExecutor } = await imp('js/engine/npc/actions/combat-actions.js');
const { NPCExploreToilExecutor } = await imp('js/engine/npc/toils/cultivation-toils.js');
const { NPCKillEnemyToilExecutor } = await imp('js/engine/npc/toils/combat-toils.js');
const { NPCTeachDiscipleToilExecutor, NPCVisitMasterToilExecutor } = await imp('js/engine/npc/toils/social-toils.js');

const oldExpField = ['in', 'sight'].join('');
const oldTotalRatioField = ['total', 'Progress'].join('');

function state(initial = {}) {
  const data = new Map(Object.entries({
    rankId: 'mortal',
    cultivation: 10,
    experienceCultivation: 0,
    totalCultivation: 10,
    hp: 100,
    maxHp: 100,
    alive: true,
    ...initial,
  }));
  return {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
    data,
  };
}

function npc(id, name, initial = {}) {
  return {
    id,
    name,
    staticData: { name },
    alive: initial.alive ?? true,
    state: state(initial),
  };
}

function baseWorld() {
  return {
    currentDay: 7,
    rng: { next: () => 0 },
    ranksData: [
      { id: 'mortal', order: 0 },
      { id: 'qi_refining', order: 20, category: 'cultivation', cultivationRequired: 100, qiRequired: 50 },
    ],
    balanceConfig: {
      cultivation: {
        stageThresholds: { early: 0, middle: 0.8, late: 0.9, perfection: 0.99 },
        experience: {
          enabled: true,
          valueScale: 500,
          riskWeight: 0.75,
          maxValueMultiplier: 3,
          maxRiskMultiplier: 3,
          maxDurationMultiplier: 2.5,
          baseBySource: {
            monster_hunt_success: 8,
            opportunity: 5,
            pvp: 8,
            social_travel: 1,
          },
          outcomeMultiplier: { success: 1, partial: 0.5, failure: 0.35 },
        },
      },
    },
    relationshipConfig: {
      masterDiscipleGoals: {
        teachDisciple: { experienceCultivationGain: 12 },
      },
    },
    relationshipSystem: {
      addEdge() {},
    },
  };
}

function assertExperienceIncreased(entity, before, msg) {
  assert(entity.state.get('experienceCultivation') > before, `${msg}: experienceCultivation increases`);
  assert(entity.state.get('totalCultivation') > 10, `${msg}: totalCultivation syncs`);
  assert(!entity.state.data.has(oldExpField), `${msg}: does not write old travel-ratio field`);
  assert(!entity.state.data.has(oldTotalRatioField), `${msg}: does not write old total-ratio field`);
}

console.log('1) applyCultivationExperience 支持高价值斩妖来源');
{
  const entity = npc('npc_hunt_exp', '历练弟子');
  const worldContext = baseWorld();
  const result = applyCultivationExperience(entity, worldContext, {
    sourceKind: 'monster_hunt_success',
    value: 1000,
    riskScore: 1,
    durationDays: 20,
    outcome: 'success',
  });

  assert(result.gain > 8, 'high value and risk increase cultivation experience');
  assert(entity.state.get('experienceCultivation') === result.gain, 'experienceCultivation increases by gain');
  assert(entity.state.get('totalCultivation') === 10 + result.gain, 'totalCultivation syncs after experience gain');
  assert(entity.state.get('rankStage') === 'early', 'passes cultivation config into rank stage refresh');
  assert(!entity.state.data.has(oldExpField), 'does not sync old travel ratio');
  assert(!entity.state.data.has(oldTotalRatioField), 'does not sync old total ratio');
}

console.log('1a) applyCultivationExperience 缺省 world ranks 时保留真实 NPCState 小层');
{
  const ranksData = [
    { id: 'mortal', name: '凡人', order: 0, category: 'mortal', lifespan: { baseYears: 80, varianceYears: 0 } },
    { id: 'qi_refining', name: '炼气', order: 20, category: 'cultivation', cultivationRequired: 50, qiRequired: 50, lifespan: { baseYears: 120, varianceYears: 0 } },
  ];
  const state = new NPCState(
    { id: 'npc_real_state_exp', rankId: 'mortal', role: 'disciple', cultivation: 15, experienceCultivation: 0 },
    ranksData,
    {},
    { next: () => 0 },
  );
  const entity = { id: 'npc_real_state_exp', name: '真实状态弟子', state, _ranksData: ranksData };
  state.set('rankStage', 'middle');
  const worldWithEmptyRanks = baseWorld();
  worldWithEmptyRanks.ranksData = [];

  const result = applyCultivationExperience(entity, worldWithEmptyRanks, {
    sourceKind: 'monster_hunt_success',
    value: 1000,
    riskScore: 1,
    durationDays: 20,
    outcome: 'success',
  });

  assert(result.gain > 0, 'worldContext ranksData 为空数组时仍获得历练修为');
  assert(state.get('totalCultivation') > 15, '真实 NPCState 同步 totalCultivation');
  assert(state.get('rankStage') !== null, '真实 NPCState 的 rankStage 不被空 ranks 覆盖为 null');
  assert(['middle', 'late', 'perfection'].includes(state.get('rankStage')), 'rankStage 使用 entity._ranksData 刷新');
}

console.log('1b) 游历 Action/Toil 只写历练修为数值');
{
  const entity = npc('npc_explore_action', '游历弟子');
  const before = entity.state.get('experienceCultivation');
  const result = new NPCExploreExecutor().run(entity, baseWorld(), {});
  assert(result.success === true, 'explore action succeeds');
  assert(result.experienceCultivationGain > 0, 'explore action reports experienceCultivationGain');
  assert(result.totalCultivation === entity.state.get('totalCultivation'), 'explore action reports totalCultivation');
  assertExperienceIncreased(entity, before, 'explore action');
}

{
  const entity = npc('npc_explore_toil', '游历 Toil 弟子');
  const before = entity.state.get('experienceCultivation');
  const result = new NPCExploreToilExecutor().run(entity, baseWorld(), {}, { params: {} });
  assert(result.status === 'success', 'explore toil succeeds');
  assert(result.contextPatch.experienceCultivationGain > 0, 'explore toil reports experienceCultivationGain');
  assert(result.contextPatch.totalCultivation === entity.state.get('totalCultivation'), 'explore toil reports totalCultivation');
  assertExperienceIncreased(entity, before, 'explore toil');
}

console.log('2) 机会点成功领取获得 opportunity 历练');
{
  const entity = npc('npc_opp', '寻机弟子', { targetOpportunityId: 'opp_1' });
  const worldContext = {
    ...baseWorld(),
    opportunitySystem: {
      getById: (id) => id === 'opp_1'
        ? {
            id,
            type: 'secret_realm',
            name: '残破洞府',
            rewardSource: null,
            riskKey: null,
            value: 800,
            claim(by) { this.claimedBy = by; },
          }
        : null,
    },
  };
  const before = entity.state.get('experienceCultivation');
  const result = new NPCGotoOpportunityExecutor().run(entity, worldContext, {});
  assert(result.success === true, 'goto opportunity succeeds');
  assertExperienceIncreased(entity, before, 'opportunity');
}

console.log('3) PvP 存活路径获得 pvp 历练');
{
  const attacker = npc('npc_attacker', '复仇者');
  const victim = npc('npc_victim', '仇敌');
  const worldContext = {
    ...baseWorld(),
    resolveRevengeTarget: () => victim,
    npcCombatPower: (entity) => (entity.id === attacker.id ? 100 : 1),
  };
  const before = attacker.state.get('experienceCultivation');
  const result = new NPCKillEnemyToilExecutor().run(attacker, worldContext, { context: {} }, { params: {} });
  assert(result.status === 'success', 'pvp kill enemy toil succeeds');
  assertExperienceIncreased(attacker, before, 'pvp');
}

console.log('4) 社交 Toil 成功获得 social_travel 历练');
{
  const teacher = npc('npc_teacher', '师傅', { targetRelationshipId: 'npc_disciple' });
  const disciple = npc('npc_disciple', '徒弟');
  const worldContext = {
    ...baseWorld(),
    entityRegistry: { getById: (id) => (id === disciple.id ? disciple : null) },
  };
  const before = teacher.state.get('experienceCultivation');
  const result = new NPCTeachDiscipleToilExecutor().run(teacher, worldContext, { context: {} }, { params: {} });
  assert(result.status === 'success', 'teach disciple toil succeeds');
  assertExperienceIncreased(teacher, before, 'social_travel teach toil');
}

{
  const disciple = npc('npc_student', '徒弟', { targetRelationshipId: 'npc_master' });
  const master = npc('npc_master', '恩师');
  const worldContext = {
    ...baseWorld(),
    entityRegistry: { getById: (id) => (id === master.id ? master : null) },
  };
  const before = disciple.state.get('experienceCultivation');
  const result = new NPCVisitMasterToilExecutor().run(disciple, worldContext, { context: {} }, { params: {} });
  assert(result.status === 'success', 'visit master toil succeeds');
  assertExperienceIncreased(disciple, before, 'social_travel visit master toil');
}

console.log('5) 关系 SimpleAction 成功获得 social_travel 历练');
{
  const teacher = npc('npc_action_teacher', '行动师傅', { targetRelationshipId: 'npc_action_disciple' });
  const disciple = npc('npc_action_disciple', '行动徒弟');
  const worldContext = {
    ...baseWorld(),
    entityRegistry: { getById: (id) => (id === disciple.id ? disciple : null) },
  };
  const before = teacher.state.get('experienceCultivation');
  const result = new NPCTeachDiscipleExecutor().run(teacher, worldContext, {});
  assert(result.success === true, 'teach disciple action succeeds');
  assertExperienceIncreased(teacher, before, 'social_travel teach action');
}

{
  const disciple = npc('npc_action_student', '行动徒弟', { targetRelationshipId: 'npc_action_master' });
  const master = npc('npc_action_master', '行动恩师');
  const worldContext = {
    ...baseWorld(),
    entityRegistry: { getById: (id) => (id === master.id ? master : null) },
  };
  const before = disciple.state.get('experienceCultivation');
  const result = new NPCVisitMasterExecutor().run(disciple, worldContext, {});
  assert(result.success === true, 'visit master action succeeds');
  assertExperienceIncreased(disciple, before, 'social_travel visit master action');
}

if (failed > 0) {
  console.error(`\nCultivation experience tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nCultivation experience tests passed');
