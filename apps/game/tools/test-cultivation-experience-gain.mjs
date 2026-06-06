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
const { NPCGotoOpportunityExecutor, NPCTeachDiscipleExecutor, NPCVisitMasterExecutor } = await imp('js/engine/npc/actions/relationship-actions.js');
const { NPCKillEnemyToilExecutor } = await imp('js/engine/npc/toils/combat-toils.js');
const { NPCTeachDiscipleToilExecutor, NPCVisitMasterToilExecutor } = await imp('js/engine/npc/toils/social-toils.js');

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
        teachDisciple: { insightGain: 0.12 },
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
  assert(entity.state.get('insight') > 0, 'legacy insight ratio is synced from experience cultivation');
  assert(entity.state.get('totalProgress') > 0.1, 'legacy totalProgress ratio is synced from numeric cultivation');
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
  const disciple = npc('npc_disciple', '徒弟', { insight: 0 });
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
  const disciple = npc('npc_action_disciple', '行动徒弟', { insight: 0 });
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
