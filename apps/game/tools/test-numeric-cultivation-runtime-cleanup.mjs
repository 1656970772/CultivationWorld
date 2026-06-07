#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const files = {
  npcState: 'js/engine/npc/npc-state.js',
  worldEngine: 'js/engine/world-engine.js',
  numericCultivation: 'js/engine/npc/numeric-cultivation.js',
};

const sources = Object.fromEntries(
  Object.entries(files).map(([name, file]) => [
    name,
    readFileSync(resolve(GAME_ROOT, file), 'utf-8'),
  ]),
);

const combinedRuntime = `${sources.npcState}\n${sources.worldEngine}\n${sources.numericCultivation}`;
const oldRatioTerms = [
  ['cultivation', 'Progress'].join(''),
  ['in', 'sight'].join(''),
  ['total', 'Progress'].join(''),
  ['cultivation', 'Progress', 'Ratio'].join(''),
  ['cultivation', 'Cap'].join(''),
  ['sync', 'Numeric', 'Cultivation', 'From', 'Ratios'].join(''),
  ['sync', 'Progress', 'Ratios', 'From', 'Numeric'].join(''),
  ['migrate', 'Progress', 'To', 'Numeric', 'Cultivation'].join(''),
];

console.log('1) runtime 数值修为模块不再包含旧比例字段/同步函数');
for (const legacyTerm of oldRatioTerms) {
  assert.equal(
    combinedRuntime.includes(legacyTerm),
    false,
    'runtime source should not contain old ratio term',
  );
}

console.log('2) runtime 数值修为模块保留数值字段与突破派生字段');
for (const numericTerm of [
  'cultivation',
  'experienceCultivation',
  'totalCultivation',
  'rankStage',
  'nextCultivationRequired',
  'cultivationShortfall',
  'cultivationRootShortfall',
  'canBreakthroughByCultivation',
]) {
  assert.equal(
    combinedRuntime.includes(numericTerm),
    true,
    `runtime source should contain numeric term: ${numericTerm}`,
  );
}

const ranks = [
  {
    id: 'mortal',
    name: '凡人',
    order: 0,
    category: 'mortal',
    lifespan: { baseYears: 100, varianceYears: 0 },
  },
  {
    id: 'qi_refining',
    name: '炼气',
    order: 20,
    category: 'cultivation',
    cultivationRequired: 50,
    qiRequired: 50,
    lifespan: { baseYears: 150, varianceYears: 0 },
  },
  {
    id: 'foundation_building',
    name: '筑基',
    order: 40,
    category: 'cultivation',
    cultivationRequired: 500,
    qiRequired: 500,
    lifespan: { baseYears: 300, varianceYears: 0 },
  },
  {
    id: 'spirit_transformation',
    name: '化神',
    order: 100,
    category: 'cultivation',
    cultivationRequired: 5000,
    qiRequired: 5000,
    lifespan: { baseYears: 1200, varianceYears: 0 },
  },
];

const { NPCState } = await imp('js/engine/npc/npc-state.js');
const { tryBreakthrough } = await imp('js/engine/npc/npc-lifecycle.js');

function mapState(initial) {
  const data = new Map(Object.entries(initial));
  const entity = {
    state: {
      get: (key) => data.get(key),
      set: (key, value) => data.set(key, value),
    },
  };
  return {
    data,
    entity,
  };
}

console.log('3) NPCState 本体 set/setMany 会同步数值修为与小层');
{
  const state = new NPCState(
    { id: 'npc_numeric_state', rankId: 'mortal', role: 'disciple' },
    ranks,
    {},
    { next: () => 0 },
  );

  state.set('cultivation', 40);
  state.set('experienceCultivation', 10);
  assert.equal(state.get('totalCultivation'), 50, 'set 后同步 totalCultivation');
  assert.equal(state.get('rankStage'), 'perfection', '50/50 刷新为 perfection');

  state.setMany({ cultivation: 10, experienceCultivation: 5 });
  assert.equal(state.get('totalCultivation'), 15, 'setMany 后同步 totalCultivation');
  assert.equal(state.get('rankStage'), 'middle', '15/50 刷新为 middle');
}

console.log('4) 顶级境界 GOAP 派生字段不制造假突破');
{
  const state = new NPCState(
    { id: 'npc_top_rank', rankId: 'spirit_transformation', role: 'elder' },
    ranks,
    {},
    { next: () => 0 },
  );
  state.setMany({ cultivation: 1000, experienceCultivation: 1000 });
  const flat = state.toGOAPState();
  assert.equal(flat.nextCultivationRequired, 0, '顶级境界 nextCultivationRequired=0');
  assert.equal(flat.cultivationShortfall, 0, '顶级境界 cultivationShortfall=0');
  assert.equal(flat.cultivationRootShortfall, 0, '顶级境界 cultivationRootShortfall=0');
  assert.equal(flat.canBreakthroughByCultivation, false, '顶级境界不能按假 required 突破');
}

console.log('5) 突破失败回退修为后刷新小层');
{
  const { entity, data } = mapState({
    rankId: 'mortal',
    rankName: '凡人',
    rankStage: 'perfection',
    cultivation: 50,
    experienceCultivation: 0,
    totalCultivation: 50,
    qi: 50,
    breakthroughAidBonus: 0,
    ageDays: 0,
    maxAgeDays: 36000,
  });
  Object.assign(entity, {
    id: 'npc_breakthrough_failure',
    name: '破境失败者',
    _ranksData: ranks,
    _cultivationConfig: {
      minCultivationRatio: 0.3,
      breakthrough: {
        failureCultivationRetention: 0.3,
        failureQiRetention: 0.7,
        successRates: { mortal_to_qi_refining: 0 },
      },
    },
    _rng: { next: () => 0.99 },
  });

  tryBreakthrough(entity);
  assert.equal(data.get('cultivation'), 15, '失败后 cultivation 按保留比例回退');
  assert.equal(data.get('totalCultivation'), 15, '失败后同步 totalCultivation');
  assert.equal(data.get('rankStage'), 'middle', '失败后刷新 rankStage');
}

console.log('Numeric cultivation runtime cleanup tests passed');
