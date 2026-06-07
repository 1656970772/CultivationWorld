#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Need, ConfigurableEvaluator } = await imp('js/engine/abstract/need.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');

const ranks = load('data/definitions/ranks.json');
const gameConfig = load('data/config/game-config.json');
const cultivationConfig = load('data/balance/cultivation.json');
const npcNeeds = load('data/needs/npc-needs.json');
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

if (failed > 0) {
  console.error(`\n数值 GOAP 需求烟测失败：${failed} 项`);
  process.exit(1);
}

console.log('\n数值 GOAP 需求烟测通过');
