#!/usr/bin/env node
/**
 * V1 NPC 消费链 GOAP 验证。
 *
 * 目标：在没有聚气丹、但有可捐材料的宗门 NPC 状态下，GOAP 能串出
 * 捐材料 -> 兑换聚气丹 -> 使用聚气丹 的闭环。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Action } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/action.js')).href);
const { GOAPPlanner } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/goap-planner.js')).href);

let failures = 0;
function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
}

const actionConfigs = [
  ...load('data/actions/npc-actions.json'),
  ...load('data/actions/npc-job-actions.json'),
];
const wanted = [
  'act_npc_donate_materials',
  'act_npc_job_redeem_qi_pill',
  'act_npc_job_use_qi_pill',
];
const actions = actionConfigs
  .filter(a => wanted.includes(a.id))
  .map(a => new Action(a));

console.log('1) 行为配置存在');
for (const id of wanted) {
  ok(actions.some(a => a.id === id), `${id} 已进入 NPC 行为配置`);
}

console.log('2) GOAP 串联捐献、兑换、使用');
{
  const planner = new GOAPPlanner({ maxDepth: 6, maxIterations: 400 });
  const state = {
    alive: true,
    hasFaction: true,
    contribution: 0,
    monthlyContribution: 0,
    lowSpiritStone: 100,
    donatableMaterialCount: 1,
    factionHasQiPillMaterial: false,
    qiPillCount: 0,
    cultivationProgress: 0,
    totalProgress: 0,
  };
  const goal = { totalProgress: { op: 'gte', value: 0.01 } };
  const result = planner.plan(state, goal, actions);
  const ids = result.plan.map(a => a.id);
  ok(result.success, `GOAP 可以规划到修炼进度目标，实际计划：${ids.join(' -> ') || '(空)'}`);
  ok(ids.includes('act_npc_donate_materials'), '计划包含材料捐献');
  ok(ids.includes('act_npc_job_redeem_qi_pill'), '计划包含兑换聚气丹');
  ok(ids.includes('act_npc_job_use_qi_pill'), '计划包含使用聚气丹');
  ok(ids.indexOf('act_npc_donate_materials') < ids.indexOf('act_npc_job_redeem_qi_pill'), '捐献发生在兑换之前');
  ok(ids.indexOf('act_npc_job_redeem_qi_pill') < ids.indexOf('act_npc_job_use_qi_pill'), '兑换发生在使用之前');
}

console.log('3) 有贡献时可直接兑换并使用');
{
  const planner = new GOAPPlanner({ maxDepth: 4, maxIterations: 200 });
  const state = {
    alive: true,
    hasFaction: true,
    contribution: 8,
    lowSpiritStone: 100,
    donatableMaterialCount: 0,
    factionHasQiPillMaterial: true,
    qiPillCount: 0,
    cultivationProgress: 0,
    totalProgress: 0,
  };
  const goal = { totalProgress: { op: 'gte', value: 0.01 } };
  const result = planner.plan(state, goal, actions);
  const ids = result.plan.map(a => a.id);
  ok(result.success, `已有贡献时 GOAP 可以规划兑换和使用，实际计划：${ids.join(' -> ') || '(空)'}`);
  ok(!ids.includes('act_npc_donate_materials'), '没有可捐材料时不会选择捐献');
  ok(ids.includes('act_npc_job_redeem_qi_pill') && ids.includes('act_npc_job_use_qi_pill'), '计划包含兑换与使用聚气丹');
}

if (failures > 0) {
  console.error(`\n失败 ${failures} 项`);
  process.exit(1);
}

console.log('\nV1 NPC 消费链 GOAP 测试通过');
