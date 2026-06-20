#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryNpcProfile, summarizeNpcRecord } from './query-npc-profile.mjs';
import { PROFILE_SCHEMA_VERSION } from './profiler/npc-execution-profiler-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GAME_ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(GAME_ROOT, 'tools/.tmp-profile-query-test');

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const records = [
  {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    day: 7,
    npc: { id: 'npc_a', name: '甲' },
    state: { cultivation: { qi: 1, totalCultivationComputed: 10 } },
    needs: { cultivationRank: 2, blockersAboveCultivation: [{ id: 'need_x', name: '更急', priority: 80 }] },
    decision: { selected: { id: 'need_x', name: '更急', priority: 80, source: 'need' }, plan: { actions: ['act_x'] } },
    execution: { action: { id: 'act_x', name: '行动X' }, result: { description: '甲行动' } },
    events: [],
  },
  {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    day: 8,
    npc: { id: 'npc_a', name: '甲' },
    state: { cultivation: { qi: 2, totalCultivationComputed: 11 } },
    needs: { cultivationRank: 1, blockersAboveCultivation: [] },
    decision: { selected: { id: 'need_npc_cultivation', name: '修炼', priority: 40, source: 'need' }, plan: { actions: ['act_npc_job_cultivate'] } },
    execution: { action: { id: 'act_npc_job_cultivate', name: '闭关修炼' }, result: { description: '甲闭关' } },
    events: [],
  },
].map(record => JSON.stringify(record)).join('\n') + '\n';

writeFileSync(resolve(OUT_DIR, 'records.jsonl'), records, 'utf-8');
writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify({
  schemaVersion: PROFILE_SCHEMA_VERSION,
  recordsFile: 'records.jsonl',
  lineBase: 1,
  byNpc: {
    npc_a: {
      7: [{ npcId: 'npc_a', day: 7, line: 1, actionId: 'act_x', needId: 'need_x' }],
      8: [{ npcId: 'npc_a', day: 8, line: 2, actionId: 'act_npc_job_cultivate', needId: 'need_npc_cultivation' }],
    },
  },
}, null, 2), 'utf-8');

console.log('1) 查询指定 NPC 指定日期');
{
  const found = queryNpcProfile({ profileDir: OUT_DIR, npcId: 'npc_a', day: 8 });
  assert.equal(found.length, 1);
  assert.equal(found[0].day, 8);
  assert.equal(found[0].execution.action.name, '闭关修炼');
}

console.log('2) 生成查询摘要');
{
  const [record] = queryNpcProfile({ profileDir: OUT_DIR, npcId: 'npc_a', day: 7 });
  const summary = summarizeNpcRecord(record);
  assert.deepEqual(summary, {
    day: 7,
    npcId: 'npc_a',
    npcName: '甲',
    selectedNeed: '更急',
    selectedPriority: 80,
    action: '行动X',
    cultivationRank: 2,
    blockersAboveCultivation: ['更急(80)'],
    result: '甲行动',
  });
}

rmSync(OUT_DIR, { recursive: true, force: true });

console.log('NPC profile query tests passed');
