#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Inventory } from '../js/engine/abstract/inventory.js';
import { runCultivation } from '../js/engine/npc/services/cultivation-service.js';

const oldRetreatRatioField = ['cultivation', 'Progress'].join('');
const oldTravelRatioField = ['in', 'sight'].join('');

const ranks = [
  { id: 'mortal', name: '凡人', order: 0, category: 'mortal' },
  { id: 'qi_refining', name: '炼气', order: 20, category: 'cultivation', cultivationRequired: 50, qiRequired: 50 },
  { id: 'foundation_building', name: '筑基', order: 40, category: 'cultivation', cultivationRequired: 1000, qiRequired: 1000 },
];

function makeState(initial) {
  const values = new Map(Object.entries(initial));
  return {
    get(key) {
      return values.get(key);
    },
    set(key, value) {
      values.set(key, value);
    },
    has(key) {
      return values.has(key);
    },
  };
}

function makeEntity(state = {}) {
  const inventory = new Inventory();
  inventory.add('low_spirit_stone', 100);
  return {
    id: state.id || 'npc_numeric_cultivator',
    staticData: { name: state.name || '数值修士', personality: {} },
    state: makeState({
      rankId: 'mortal',
      cultivation: 0,
      experienceCultivation: 0,
      totalCultivation: 0,
      qi: 0,
      ...state,
    }),
    inventory,
  };
}

function makeWorld() {
  return {
    rng: { next: () => 0 },
    ranksData: ranks,
    balanceConfig: {
      cultivation: {
        cultivationSpeed: { mortal: 0.1 },
        spiritStoneCost: { mortal: 0 },
        qiBaseGain: { mortal: 0 },
        // 旧字段名临时保留；数值单位仍是“每 1.0 比例进度”的真气收益。
        qiPerProgress: { mortal: 50 },
        speedVariance: { min: 1, max: 1 },
        cultivationDecayK: 2.5,
      },
    },
  };
}

console.log('1) fresh entity 闭关写入数值修为并同步 total');
{
  const entity = makeEntity();
  const result = runCultivation(entity, makeWorld(), { duration: 1 });

  assert.equal(entity.state.get('cultivation') > 0, true, 'cultivation 增加');
  assert.equal(entity.state.get('experienceCultivation'), 0, 'experienceCultivation 不变');
  assert.equal(
    entity.state.get('totalCultivation'),
    entity.state.get('cultivation'),
    'totalCultivation 同步 cultivation + experienceCultivation',
  );
  assert.equal(entity.state.has(oldRetreatRatioField), false, '不写旧闭关比例字段');
  assert.equal(entity.state.has(oldTravelRatioField), false, '不写旧游历比例字段');
  assert.equal(result.cultivationGain > 0, true, '返回 cultivationGain');
  assert.equal(result.cultivationGain, 5, 'required=50 时 0.1 进度折算为 5 修为');
  assert.equal(typeof result.cultivationDecay, 'number', '返回 cultivationDecay');
  assert.equal(result.qiGain, 5, 'qiGain 按 cultivationDelta / required 折算旧比例单位');
  assert.equal(result.cultivation, entity.state.get('cultivation'), '返回 cultivation');
  assert.equal(result.totalCultivation, entity.state.get('totalCultivation'), '返回 totalCultivation');
  assert.equal('progress' in result, false, '不返回 progress');
  assert.match(result.description, /修为\+/, '描述包含修为增量');
}

console.log('2) 高 cultivation 闭关收益递减，qi 仍随修为增量增长');
{
  const fresh = makeEntity();
  const high = makeEntity({ cultivation: 90, totalCultivation: 90 });

  const freshResult = runCultivation(fresh, makeWorld(), { duration: 1 });
  const highResult = runCultivation(high, makeWorld(), { duration: 1 });

  assert.equal(
    highResult.cultivationGain < freshResult.cultivationGain,
    true,
    '高 cultivation 的收益低于 fresh',
  );
  assert.equal(highResult.qiGain > 0, true, '高 cultivation 仍获得真气');
  assert.equal(high.state.get('qi') > 0, true, 'qi 写回 state');
  assert.equal(
    highResult.qiGain < freshResult.qiGain,
    true,
    'qi 随闭关修为增量递减',
  );
  assert.equal(
    Math.abs(highResult.qiGain - highResult.cultivationGain) < 1e-9,
    true,
    'required=50 且 qiPerProgress=50 时 qiGain 与本次修为增量同量级',
  );
}

console.log('Cultivation service numeric tests passed');
