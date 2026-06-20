#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  PROFILE_SCHEMA_VERSION,
  buildNpcExecutionRecord,
  buildProfilerIndexEntry,
  buildProfilerMeta,
  sanitizeForJson,
} from './profiler/npc-execution-profiler-core.mjs';

function makeState(values) {
  return {
    get(key) {
      return values[key];
    },
    snapshot() {
      return { ...values };
    },
  };
}

const npc = {
  id: 'npc_test_001',
  type: 'npc',
  name: '测试修士',
  alive: true,
  staticData: {
    name: '测试修士',
    factionId: 'sect_test',
    role: 'disciple',
    personality: { ambition: 50 },
  },
  state: makeState({
    rankId: 'mortal',
    rankName: '凡人',
    currentRole: 'disciple',
    factionId: 'sect_test',
    qi: 4,
    cultivation: 8,
    experienceCultivation: 70,
    totalCultivation: 43,
    contribution: 3,
    injuryLevel: 0,
    activeQuestTypeName: '采药',
    questDaysRemaining: 5,
    hasActiveQuest: true,
    targetDynamicEventId: 'evt_secret_realm_test',
  }),
  inventory: {
    getAll() {
      return { low_spirit_stone: 2, item_qi_pill: 1 };
    },
    getAmount(id) {
      return this.getAll()[id] || 0;
    },
  },
  spatial: {
    snapshot() {
      return { x: 10, y: 20, targetX: 30, targetY: 40 };
    },
  },
};

const tickLog = {
  seed: 20260619,
  events: [
    { type: 'birth', childId: 'npc_test_001', childName: '测试修士' },
    { type: 'quest_accept', npcId: 'npc_other', npcName: '别人' },
  ],
  deaths: [],
  infoEvents: [
    { type: 'rumor', npcId: 'npc_test_001', message: '听说青冥秘境开启' },
  ],
  dynamicEvents: [
    { id: 'evt_secret_realm_test', type: 'secret_realm', phase: 'announced' },
  ],
};

const npcLog = {
  entityId: 'npc_test_001',
  needs: {
    results: [
      { id: 'need_npc_active_quest', name: '完成当前任务', priority: 96, urgency: 85, satisfied: false },
      { id: 'need_npc_cultivation', name: '修炼', priority: 40, urgency: 5, satisfied: false },
    ],
  },
  plan: {
    needId: 'need_npc_active_quest',
    needName: '完成当前任务',
    needPriority: 96,
    goalSource: 'need',
    planLength: 3,
    planCost: 4,
    iterations: 12,
    actions: ['act_npc_execute_quest_job'],
  },
  execution: {
    status: 'step_done',
    action: { id: 'act_npc_execute_quest_job', name: '执行任务' },
    job: {
      currentJobId: 'job_npc_execute_quest_generic',
      currentToilId: 'progress',
      currentToilIndex: 0,
      jobStatus: 'running',
      jobRemaining: 4,
    },
    result: {
      status: 'success',
      actionId: 'act_npc_execute_quest_job',
      jobId: 'job_npc_execute_quest_generic',
      jobInstanceId: 'job#1',
      description: '测试修士执行采药任务',
      unsafeFunction() {
        return 'must not leak';
      },
    },
  },
};

const configs = {
  seed: 20260619,
  ranks: [
    { id: 'mortal', name: '凡人', order: 0, cultivationRequired: 0, qiRequired: 0 },
    { id: 'qi_refining', name: '炼气', order: 20, category: 'cultivation', cultivationRequired: 50, qiRequired: 50 },
  ],
  balanceCultivation: {
    minCultivationRatio: 0.3,
    maxExperienceCultivationRatio: 0.7,
  },
};

console.log('1) 构建纯 JSON NPC 执行记录');
{
  const record = buildNpcExecutionRecord({
    day: 777,
    seed: 20260619,
    npc,
    npcLog,
    tickLog,
    configs,
  });

  assert.equal(record.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(record.day, 777);
  assert.equal(record.npc.id, 'npc_test_001');
  assert.equal(record.npc.name, '测试修士');
  assert.equal(record.state.cultivation.qi, 4);
  assert.equal(record.state.cultivation.effectiveExperienceCultivation, 35);
  assert.equal(record.state.cultivation.totalCultivationComputed, 43);
  assert.equal(record.state.cultivation.rootShortfall, 7);
  assert.equal(record.state.cultivation.totalShortfall, 7);
  assert.equal(record.state.cultivation.qiShortfall, 46);
  assert.equal(record.needs.results.length, 2);
  assert.equal(record.needs.ranking[0].id, 'need_npc_active_quest');
  assert.equal(record.needs.cultivationRank, 2);
  assert.equal(record.decision.selected.name, '完成当前任务');
  assert.equal(record.execution.action.name, '执行任务');
  assert.equal(record.execution.job.currentJobId, 'job_npc_execute_quest_generic');
  assert.equal(record.events.length, 3);
  assert.equal(record.events.some(evt => evt.id === 'evt_secret_realm_test'), true, '包含当前动态目标事件');

  const json = JSON.stringify(record);
  assert.equal(json.includes('unsafeFunction'), false, '函数不能进入 JSON 输出');
}

console.log('2) 构建元数据和索引项');
{
  const meta = buildProfilerMeta({
    seed: 20260619,
    days: 1000,
    targetIds: ['npc_test_001'],
    includeAllNpcs: false,
    recordCount: 1,
  });
  assert.equal(meta.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(meta.seed, 20260619);
  assert.equal(meta.days, 1000);
  assert.deepEqual(meta.targets.ids, ['npc_test_001']);
  assert.equal(meta.targets.includeAllNpcs, false);

  const entry = buildProfilerIndexEntry({
    npcId: 'npc_test_001',
    day: 777,
    line: 42,
    actionId: 'act_npc_execute_quest_job',
    needId: 'need_npc_active_quest',
  });
  assert.deepEqual(entry, {
    npcId: 'npc_test_001',
    day: 777,
    line: 42,
    actionId: 'act_npc_execute_quest_job',
    needId: 'need_npc_active_quest',
  });
}

console.log('3) sanitizeForJson 移除不可序列化字段');
{
  const shared = { name: '共享对象' };
  const sanitized = sanitizeForJson({
    a: 1,
    b: undefined,
    c() {},
    d: new Map([['x', 2]]),
    e: [1, undefined, () => 3],
    f: [shared, shared],
  });
  assert.deepEqual(sanitized, {
    a: 1,
    d: { x: 2 },
    e: [1, null, null],
    f: [{ name: '共享对象' }, { name: '共享对象' }],
  });
}

console.log('NPC execution profiler core tests passed');
