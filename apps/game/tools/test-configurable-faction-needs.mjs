#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { NeedPool } = await imp('js/engine/pools/need-pool.js');
const { registerFactionEvaluators } = await imp('js/engine/faction/faction-needs.js');
const { FactionAIService } = await imp('js/engine/world/services/faction-ai-service.js');

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    console.error('  FAIL:', message);
    failed++;
  } else {
    console.log('  OK:', message);
  }
}

console.log('1) faction evaluator consumes evaluatorConfig rules, weights and goal state');
{
  NeedPool.clear();
  registerFactionEvaluators();
  NeedPool.loadFromArray([{
    id: 'need_survival_config_probe',
    name: '配置化生存探针',
    evaluatorType: 'faction_survival',
    basePriority: 2,
    evaluatorConfig: {
      basePriority: 2,
      baseUrgency: 1,
      rules: [
        { condition: { key: 'stability', op: 'lt', value: 90 }, priorityBoost: 7, urgencyBoost: 3 },
        {
          condition: {
            all: [
              { key: 'food', op: 'lt', value: 50 },
              { key: 'disciples', op: 'gte', value: 5 },
            ],
          },
          priorityBoost: 4,
          urgencyBoost: 2,
          goalStateOverride: { food: { op: 'gte', value: 200 } },
        },
        {
          condition: { source: 'leaderPersonality', key: 'caution', op: 'gte', value: 80 },
          priorityBoost: { source: 'leaderPersonality', key: 'caution', scale: 0.1 },
        },
      ],
      satisfiedCondition: {
        all: [
          { key: 'stability', op: 'gte', value: 70 },
          { key: 'food', op: 'gte', value: 20 },
        ],
      },
    },
    goalState: {
      stability: { op: 'gte', value: 88 },
      food: { op: 'gte', value: 80 },
    },
  }]);

  const need = NeedPool.create('need_survival_config_probe');
  const state = new RuntimeState({
    stability: 80,
    disciples: 12,
    food: 10,
    leaderNpcId: 'leader_a',
    isDestroyed: false,
  });
  const result = need.evaluate(state, {
    getLeaderPersonality(id) {
      return id === 'leader_a' ? { caution: 80, ambition: 20, diplomacy: 30 } : null;
    },
  });

  assert(result.priority === 21, `priority 按配置计算为 21（实得 ${result.priority}）`);
  assert(result.urgency === 6, `urgency 按配置计算为 6（实得 ${result.urgency}）`);
  assert(result.goalState.food?.value === 200, 'goalStateOverride 覆盖配置目标态');
  assert(result.goalState.stability?.value === 88, '保留模板中的配置目标态');
  assert(result.satisfied === false, 'satisfiedCondition 支持 all 条件组合');
}

console.log('2) faction AI hostility is driven by configured strategy matrix');
{
  const self = {
    id: 'sect_merchant',
    alive: true,
    factionType: 'merchant',
    state: new RuntimeState({ relations: { sect_raider: 5 } }),
  };
  const raider = {
    id: 'sect_raider',
    alive: true,
    factionType: 'raider',
    state: new RuntimeState({ disciples: 20, stability: 80 }),
  };
  const registry = new Map([[self.id, self], [raider.id, raider]]);
  const host = {
    entityRegistry: {
      getById(id) { return registry.get(id) || null; },
      getByType(type) { return type === 'faction' ? [self, raider] : []; },
    },
    _factionsGeographicallyClose() { return true; },
  };
  const service = new FactionAIService({
    host,
    combatConfig: {
      diplomacy: {
        hostileThreshold: -80,
        alignmentHostileThreshold: -80,
        hostileMatrix: [
          { selfTypes: ['merchant'], targetTypes: ['raider'], relationLte: 10 },
        ],
      },
    },
  });

  assert(
    service.checkAdjacentEnemy(['0,0'], { sect_raider: 5 }, 'sect_merchant') === true,
    '自定义势力类型敌对矩阵可判定相邻敌人',
  );
  assert(
    service.strategyRegistry.selectAttackTarget({
      relations: { sect_raider: 5 },
      selfType: 'merchant',
      getFaction(id) { return registry.get(id) || null; },
      isClose() { return true; },
    }) === 'sect_raider',
    'attackEnemy/selectAttackTarget 同样可选择 hostileMatrix 判定的敌对目标',
  );
}

console.log('3) faction AI trade uses configured resource ids');
{
  const buyer = {
    id: 'sect_trade_custom_a',
    alive: true,
    name: '灵玉商会',
    state: new RuntimeState({ spirit_jade: 1000, grain: 10, relations: { sect_trade_custom_b: 50 } }),
  };
  const seller = {
    id: 'sect_trade_custom_b',
    alive: true,
    name: '灵谷坊',
    state: new RuntimeState({ spirit_jade: 200, grain: 500, relations: {} }),
  };
  const registry = new Map([[buyer.id, buyer], [seller.id, seller]]);
  const service = new FactionAIService({
    host: {
      entityRegistry: {
        getById(id) { return registry.get(id) || null; },
        getByType(type) { return type === 'faction' ? [buyer, seller] : []; },
      },
      worldEntity: { currentDay: 12 },
      economicTransactionConfig: {
        factionTrade: {
          scenarioId: 'formal_market',
          payResourceId: 'spirit_jade',
          receiveResourceId: 'grain',
          receiveExchangeRate: 2,
        },
      },
    },
    combatConfig: {
      trade: {
        stoneRatio: 0.1,
        maxTradeAmount: 200,
        receiveExchangeRate: 2,
        minRelation: 20,
        relationGain: 3,
      },
    },
  });
  const result = service.conductTrade(buyer.id);
  assert(result.success === true, '自定义资源配置下势力贸易成功');
  assert(result.payResourceId === 'spirit_jade', '贸易付款资源来自 transaction-scenarios 配置');
  assert(result.receiveResourceId === 'grain', '贸易收取资源来自 transaction-scenarios 配置');
  assert(buyer.state.get('spirit_jade') === 900, '买方扣除配置付款资源');
  assert(buyer.state.get('grain') === 210, '买方获得配置收取资源');
  assert(seller.state.get('spirit_jade') === 300, '卖方获得配置付款资源');
  assert(seller.state.get('grain') === 300, '卖方扣除配置收取资源');
}

if (failed > 0) {
  console.error(`\n配置化势力 Need/AI 测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n配置化势力 Need/AI 测试通过');
