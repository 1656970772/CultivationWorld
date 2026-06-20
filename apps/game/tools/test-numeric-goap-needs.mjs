#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Need, ConfigurableEvaluator } = await imp('js/engine/abstract/need.js');
const { Action } = await imp('js/engine/abstract/action.js');
const { BehaviorSystem } = await imp('js/engine/abstract/behavior-system.js');
const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');

const ranks = load('data/definitions/ranks.json');
const gameConfig = load('data/config/game-config.json');
const cultivationConfig = load('data/balance/cultivation.json');
const npcNeeds = load('data/needs/npc-needs.json');
const npcJobActions = load('data/actions/npc-job-actions.json');
const oldTotalRatioField = ['total', 'Progress'].join('');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

function cultivationNeed() {
  const config = npcNeeds.find(n => n.id === 'need_npc_cultivation');
  return new Need({
    ...config,
    evaluator: new ConfigurableEvaluator(config.evaluatorConfig),
  });
}

function npcWithCultivation({ cultivation, experienceCultivation, qi }) {
  const npc = new NPCEntity(
    {
      id: `npc_numeric_need_${cultivation}_${experienceCultivation}_${qi}`,
      name: '数值修炼需求测试',
      role: 'disciple',
      rankId: 'mortal',
      cultivation,
      experienceCultivation,
      factionId: 'sect_test',
    },
    ranks,
    {
      gameConfig,
      cultivationConfig,
      aiConfig: { maxDepth: 2, maxIterations: 20 },
      rng: { next: () => 0 },
    },
  );
  npc.state.set('qi', qi);
  return npc;
}

function goapState(npc) {
  const flat = npc.state.toGOAPState();
  return {
    personality: npc.state.personality,
    get(key) { return flat[key]; },
  };
}

console.log('1) 低修为时 configurable 修炼需求只产出 totalCultivation 目标');
{
  const npc = npcWithCultivation({ cultivation: 10, experienceCultivation: 0, qi: 0 });
  const need = cultivationNeed();
  const result = need.evaluate(goapState(npc), { balanceConfig: {} });
  assert(result.goalState.totalCultivation?.op === 'gte', '目标使用 totalCultivation');
  assert(result.goalState[oldTotalRatioField] == null, '目标不产出旧总比例字段');
  assert(result.goalState.qiBelowNextRank?.value === false, '仍保留 qiBelowNextRank=false 硬门槛');
  assert(result.goalState.totalCultivation?.value === 10.5, '目标为当前 totalCultivation + 1% nextCultivationRequired');
}

console.log('2) 修为与 qi 均达标时不再要求旧总比例目标');
{
  const npc = npcWithCultivation({ cultivation: 50, experienceCultivation: 0, qi: 50 });
  const need = cultivationNeed();
  const result = need.evaluate(goapState(npc), { balanceConfig: {} });
  assert(result.goalState[oldTotalRatioField] == null, '达标状态不产出旧总比例字段');
  assert(result.goalState.totalCultivation?.value === 50, '达标状态 totalCultivation 目标夹到 nextCultivationRequired');
}

console.log('3) 超额历练只按 70% 有效贡献进入 GOAP 总修为短板');
{
  const npc = npcWithCultivation({ cultivation: 14, experienceCultivation: 120, qi: 50 });
  const flat = npc.state.toGOAPState();
  assert(npc.state.get('experienceCultivation') === 120, '原始历练修为不被 GOAP 同步截断');
  assert(npc.state.get('totalCultivation') === 49, 'GOAP 同步 totalCultivation 为闭关修为 + 70% 有效历练');
  assert(flat.cultivationShortfall === 1, '超额历练不能把总修为短板误清零');
  assert(flat.cultivationRootShortfall === 1, '闭关根基仍按 minCultivationRatio 单独检查');
}

console.log('4) 修炼派生字段暴露进度比例与缺口比例');
{
  const npc = npcWithCultivation({ cultivation: 10, experienceCultivation: 0, qi: 25 });
  const flat = npc.state.toGOAPState();
  assert(flat.cultivationProgress === 0.2, `总修为进度为 0.2（实得 ${flat.cultivationProgress}）`);
  assert(flat.cultivationShortfallRatio === 0.8, `总修为缺口比例为 0.8（实得 ${flat.cultivationShortfallRatio}）`);
  assert(flat.cultivationRootProgress === 10 / 15, `根基进度为 10/15（实得 ${flat.cultivationRootProgress}）`);
  assert(Math.abs(flat.cultivationRootShortfallRatio - 5 / 15) < 1e-9, `根基缺口比例为 5/15（实得 ${flat.cultivationRootShortfallRatio}）`);
  assert(flat.qiProgress === 0.5, `真气进度为 0.5（实得 ${flat.qiProgress}）`);
  assert(flat.qiShortfallRatio === 0.5, `真气缺口比例为 0.5（实得 ${flat.qiShortfallRatio}）`);
  assert(flat.cultivationBreakthroughSprint === 0, `低进度时临门冲刺为 0（实得 ${flat.cultivationBreakthroughSprint}）`);
}

console.log('5) configurable 修炼需求可按比例字段动态加分');
{
  const need = new Need({
    id: 'need_ratio_probe',
    name: '比例加分探针',
    evaluator: new ConfigurableEvaluator({
      basePriority: 60,
      rules: [
        { condition: { key: 'cultivationShortfallRatio', op: 'gt', value: 0 }, priorityBoost: { key: 'cultivationShortfallRatio', scale: 20 } },
        { condition: { key: 'cultivationBreakthroughSprint', op: 'gt', value: 0 }, priorityBoost: { key: 'cultivationBreakthroughSprint', scale: 25 } },
      ],
    }),
  });
  const low = need.evaluate({
    get(key) {
      return { cultivationShortfallRatio: 0.8, cultivationBreakthroughSprint: 0 }[key];
    },
  }, { balanceConfig: {} });
  const near = need.evaluate({
    get(key) {
      return { cultivationShortfallRatio: 0.1, cultivationBreakthroughSprint: 0.7 }[key];
    },
  }, { balanceConfig: {} });
  assert(low.priority === 76, `缺口压力按 0.8 * 20 计入（实得 ${low.priority}）`);
  assert(near.priority === 79.5, `临门冲刺按 0.7 * 25 计入（实得 ${near.priority}）`);
}

console.log('6) 只缺真气且有灵石时 GOAP 可规划炼化灵石');
{
  const npc = npcWithCultivation({ cultivation: 50, experienceCultivation: 0, qi: 6 });
  npc.inventory.add('low_spirit_stone', 20);
  const need = cultivationNeed();
  need.evaluate(goapState(npc), { balanceConfig: {} });

  const actions = npcJobActions
    .filter(a => [
      'act_npc_job_cultivate',
      'act_npc_job_train_chamber',
      'act_npc_job_explore',
      'act_npc_job_use_qi_pill',
      'act_npc_job_absorb_spirit_stone',
    ].includes(a.id))
    .map(a => new Action(a));
  const planner = new BehaviorSystem(new GOAPPlanner({ maxDepth: 4, maxIterations: 50 }), actions);
  const plan = planner.plan(
    { getTopGoals: () => [{ ...need, sourceId: need.id, source: 'need' }] },
    npc.buildGOAPState({ balanceConfig: { cultivation: cultivationConfig } }),
    { rng: { next: () => 0 } },
  );

  assert(plan.some(action => action.id === 'act_npc_job_absorb_spirit_stone'), '规划炼化灵石补真气');
}

console.log('7) 有宗门且灵石足够时 GOAP 优先规划修炼场');
{
  const npc = npcWithCultivation({ cultivation: 20, experienceCultivation: 0, qi: 50 });
  npc.inventory.add('low_spirit_stone', 20);
  const need = cultivationNeed();
  need.evaluate(goapState(npc), { balanceConfig: {} });

  const actions = npcJobActions
    .filter(a => [
      'act_npc_job_cultivate',
      'act_npc_job_train_chamber',
    ].includes(a.id))
    .map(a => new Action(a));
  const planner = new BehaviorSystem(new GOAPPlanner({ maxDepth: 4, maxIterations: 50 }), actions);
  const plan = planner.plan(
    { getTopGoals: () => [{ ...need, sourceId: need.id, source: 'need' }] },
    npc.buildGOAPState({ balanceConfig: { cultivation: cultivationConfig } }),
    { rng: { next: () => 0 } },
  );

  assert(plan[0]?.id === 'act_npc_job_train_chamber', '灵石足够时修炼场代价低于普通闭关');
}

console.log('8) 修为和真气都缺且有灵石时 GOAP 先炼化灵石补真气');
{
  const npc = npcWithCultivation({ cultivation: 45, experienceCultivation: 0, qi: 6 });
  npc.state.set('factionId', null);
  npc.state.set('hasFaction', false);
  npc.inventory.add('low_spirit_stone', 20);
  const need = cultivationNeed();
  need.evaluate(goapState(npc), { balanceConfig: {} });

  const actions = npcJobActions
    .filter(a => [
      'act_npc_job_cultivate',
      'act_npc_job_train_chamber',
      'act_npc_job_absorb_spirit_stone',
    ].includes(a.id))
    .map(a => new Action(a));
  const planner = new BehaviorSystem(new GOAPPlanner({ maxDepth: 4, maxIterations: 50 }), actions);
  const plan = planner.plan(
    { getTopGoals: () => [{ ...need, sourceId: need.id, source: 'need' }] },
    npc.buildGOAPState({ balanceConfig: { cultivation: cultivationConfig } }),
    { rng: { next: () => 0.99 } },
  );

  assert(plan[0]?.id === 'act_npc_job_absorb_spirit_stone', '双短板时先用灵石补真气');
}

console.log('9) NPC 每日 Need 评估使用修炼派生进度字段');
{
  const npc = npcWithCultivation({ cultivation: 7.8, experienceCultivation: 65, qi: 2 });
  npc.needSystem.addNeed(cultivationNeed());
  npc._tickLog = {};
  npc._evaluateNeeds({ balanceConfig: {} });
  const need = npc.needSystem.getNeed('need_npc_cultivation');
  assert(need.priority > 80, `临近突破但缺真气时修炼需求应高于 80（实得 ${need.priority}）`);
}

if (failed > 0) {
  console.error(`\n数值 GOAP 需求烟测失败：${failed} 项`);
  process.exit(1);
}

console.log('\n数值 GOAP 需求烟测通过');
