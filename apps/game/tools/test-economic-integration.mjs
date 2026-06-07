#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Inventory } = await imp('js/engine/abstract/inventory.js');
const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { ItemRegistry } = await imp('js/engine/items/item-registry.js');
const { EconomicSystem } = await imp('js/engine/economy/transaction-engine.js');
const { donateMaterials, redeemExchangeItem } = await imp('js/engine/npc/npc-economy.js');
const { turnInQuest } = await imp('js/engine/npc/services/quest-service.js');
const { FactionAIService } = await imp('js/engine/world/services/faction-ai-service.js');
const { FactionEntity } = await imp('js/engine/faction/faction-entity.js');
const { FactionTradeExecutor } = await imp('js/engine/faction/faction-actions.js');

ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/definitions/macro-resources.json'));
ItemRegistry.loadFromArray(['currency', 'material', 'pill', 'artifact', 'talisman', 'technique'].flatMap(c => load(`data/items/${c}.json`).items));

const economyConfig = load('data/balance/economy.json');
const economicTransactionConfig = load('data/economy/transaction-scenarios.json');
let failed = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

function entity(id, inventory = {}, state = {}) {
  const e = { id, name: id, inventory: new Inventory(), state: new RuntimeState(state), alive: true };
  e.inventory.loadFrom(inventory);
  return e;
}

function world(faction, economicSystem) {
  return {
    currentDay: 20,
    balanceConfig: { economy: economyConfig },
    economicSystem,
    settleTransaction(input) { return economicSystem.settle(input); },
    economicSignalsFor(input) { return economicSystem.signalsFor(input); },
    entityRegistry: { getById(id) { return id === faction.id ? faction : null; } },
  };
}

console.log('1) material donation writes transaction ledger');
{
  const npc = entity('npc_donor', { mat_century_ginseng: 2 }, { factionId: 'sect_test', hasFaction: true, contribution: 0, monthlyContribution: 0 });
  const faction = entity('sect_test', {}, { low_spirit_stone: 1000, food: 100, disciples: 10 });
  const economicSystem = new EconomicSystem({ config: economicTransactionConfig });
  const result = donateMaterials(npc, world(faction, economicSystem));
  ok(result.success === true, '材料上交成功');
  ok(result.transactionId, '材料上交返回交易记录 id');
  ok(economicSystem.ledger.all().some(r => r.type === 'material_donation'), '账本记录材料上交');
  ok(npc.state.get('contribution') > 0, '贡献由组织发放');
}

console.log('2) faction exchange writes point and item transfer ledger');
{
  const npc = entity('npc_redeem', { low_spirit_stone: 100 }, { factionId: 'sect_test', hasFaction: true, contribution: 20 });
  const faction = entity('sect_test', { mat_century_ginseng: 1 }, {});
  const economicSystem = new EconomicSystem({ config: economicTransactionConfig });
  const result = redeemExchangeItem(npc, world(faction, economicSystem), 'qi_pill');
  ok(result.success === true, '贡献兑换成功');
  ok(result.transactionId, '贡献兑换返回交易记录 id');
  ok(economicSystem.ledger.all().some(r => r.type === 'contribution_exchange'), '账本记录贡献兑换');
  ok(npc.inventory.getAmount('item_qi_pill') === 1, 'NPC 获得兑换物品');
  ok(npc.state.get('contribution') === 12, '贡献点扣除');
}

console.log('3) quest reward creates ledger and debt on payer shortfall');
{
  const npc = entity('npc_quester', {}, {
    factionId: null,
    hasActiveQuest: true,
    activeQuestDifficulty: 1,
    activeQuestTypeId: 'qt_slay_monster',
    activeQuestTypeName: '斩妖',
    activeQuestDiffName: '低阶',
    questComplete: true,
  });
  const bounty = entity('org_bounty', { low_spirit_stone: 0 }, {});
  const economicSystem = new EconomicSystem({ config: economicTransactionConfig });
  const result = turnInQuest(npc, {
    currentDay: 40,
    questTemplates: load('data/quests/quest-templates.json'),
    balanceConfig: {
      economy: economyConfig,
      cultivation: load('data/balance/cultivation.json'),
    },
    economicSystem,
    _resolveBountyOrgFor() { return bounty; },
  });
  ok(result.success === true, '任务交付仍成功');
  ok(result.transactionId, '任务奖励返回经济账本 id');
  ok(economicSystem.ledger.all().some(r => r.type === 'quest_reward' && r.status === 'failed'), '短款任务奖励写入失败账本');
  ok([...economicSystem.debts.records.values()].some(d =>
    d.status === 'active' && d.origin?.type === 'quest_reward_shortfall'
  ), '付款方不足时生成 active 债务');
}

console.log('4) faction trade uses state resources and economic ledger');
{
  const buyer = entity(
    'sect_trade_a',
    { low_spirit_stone: 9999, food: 9999 },
    { low_spirit_stone: 1000, food: 10, disciples: 20, relations: { sect_trade_b: 50 } },
  );
  const seller = entity(
    'sect_trade_b',
    { low_spirit_stone: 1, food: 1 },
    { low_spirit_stone: 200, food: 500, disciples: 20, relations: {} },
  );
  const economicSystem = new EconomicSystem({ config: economicTransactionConfig });
  const registry = {
    getById(id) {
      if (id === buyer.id) return buyer;
      if (id === seller.id) return seller;
      return null;
    },
    getByType(type) {
      return type === 'faction' ? [buyer, seller] : [];
    },
  };
  const factionAI = new FactionAIService({
    host: {
      entityRegistry: registry,
      worldEntity: { currentDay: 50 },
      economicSystem,
    },
    combatConfig: {
      trade: {
        stoneRatio: 0.1,
        maxTradeAmount: 200,
        foodExchangeRate: 2,
        minRelation: 20,
        relationGain: 3,
      },
    },
  });
  const result = factionAI.conductTrade(buyer.id);
  ok(result.success === true, '势力贸易成功');
  ok(result.transactionId, '势力贸易返回经济账本 id');
  ok(economicSystem.ledger.all().some(r => r.type === 'faction_trade'), '账本记录势力贸易');
  ok(buyer.state.get('low_spirit_stone') === 900, '买方灵石从 state 扣除');
  ok(buyer.state.get('food') === 210, '买方粮食收入写 state');
  ok(seller.state.get('low_spirit_stone') === 300, '卖方灵石收入写 state');
  ok(seller.state.get('food') === 300, '卖方粮食从 state 扣除');
  ok(buyer.inventory.getAmount('low_spirit_stone') === 9999, '势力贸易不改买方普通 inventory 灵石');
  ok(seller.inventory.getAmount('food') === 1, '势力贸易不改卖方普通 inventory 粮食');
}

console.log('5) faction pre-tick keeps state resource settlement as truth');
{
  const faction = new FactionEntity({
    id: 'sect_state_truth',
    name: '状态宗',
    factionType: 'righteous',
    resources: { low_spirit_stone: 100, food: 50, disciples: 10 },
    territory: [],
    relations: {},
    needIds: [],
    actionIds: [],
  });
  faction.state.set('low_spirit_stone', 135);
  faction.state.set('food', 70);
  faction.inventory.setAmount('low_spirit_stone', 100);
  faction.inventory.setAmount('food', 50);
  faction.onPreTick({ entityRegistry: { getById() { return null; } } });
  ok(faction.state.get('low_spirit_stone') === 135, 'onPreTick 不用旧 inventory 覆盖灵石 state');
  ok(faction.state.get('food') === 70, 'onPreTick 不用旧 inventory 覆盖粮食 state');
  ok(faction.inventory.getAmount('low_spirit_stone') === 135, 'onPreTick 将灵石 state 同步给兼容 inventory');
  ok(faction.inventory.getAmount('food') === 70, 'onPreTick 将粮食 state 同步给兼容 inventory');
}

console.log('6) faction trade action uses economic ledger instead of runtime effects');
{
  const tradeAction = load('data/actions/faction-actions.json').find(action => action.id === 'act_trade');
  ok(Object.keys(tradeAction.effects || {}).length === 0, 'act_trade 不用 runtime effects 直接改资源');
  ok(tradeAction.plannerEffects?.food?.value === 100, 'act_trade 保留 plannerEffects 供 GOAP 规划');

  const buyer = entity(
    'sect_action_trade_a',
    { low_spirit_stone: 4000, food: 4000 },
    { low_spirit_stone: 1000, food: 10, disciples: 20, relations: { sect_action_trade_b: 50 } },
  );
  const seller = entity(
    'sect_action_trade_b',
    { low_spirit_stone: 1, food: 1 },
    { low_spirit_stone: 200, food: 500, disciples: 20, relations: {} },
  );
  const economicSystem = new EconomicSystem({ config: economicTransactionConfig });
  const registry = {
    getByType(type) {
      return type === 'faction' ? [buyer, seller] : [];
    },
  };
  const result = new FactionTradeExecutor().run(buyer, {
    currentDay: 60,
    entityRegistry: registry,
    settleTransaction(input) {
      return economicSystem.settle({ day: 60, ...input });
    },
  });
  ok(result.success === true, '势力行动贸易成功');
  ok(result.transactionId, '势力行动贸易返回交易 id');
  ok(economicSystem.ledger.all().some(r => r.type === 'faction_trade'), '势力行动贸易写经济账本');
  ok(buyer.state.get('low_spirit_stone') === 900, '势力行动贸易扣买方 state 灵石');
  ok(buyer.state.get('food') === 210, '势力行动贸易给买方 state 粮食');
  ok(seller.state.get('low_spirit_stone') === 300, '势力行动贸易给卖方 state 灵石');
  ok(seller.state.get('food') === 300, '势力行动贸易扣卖方 state 粮食');
}

if (failed > 0) {
  console.error(`\n经济接入测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n经济接入测试通过');
