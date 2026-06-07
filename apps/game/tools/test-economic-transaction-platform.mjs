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

ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/definitions/macro-resources.json'));
ItemRegistry.loadFromArray(['currency', 'material', 'pill', 'artifact', 'talisman', 'technique'].flatMap(c => load(`data/items/${c}.json`).items));

const config = load('data/economy/transaction-scenarios.json');
let failed = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

function actor(id, inventory = {}, state = {}) {
  const entity = { id, name: id, inventory: new Inventory(), state: new RuntimeState(state), alive: true };
  entity.inventory.loadFrom(inventory);
  return entity;
}

console.log('1) formal direct sale is atomic and writes ledger');
{
  const buyer = actor('npc_buyer', { low_spirit_stone: 200 });
  const seller = actor('org_market', { item_qi_pill: 2 });
  const economy = new EconomicSystem({ config });
  const result = economy.settle({
    type: 'direct_purchase',
    scenarioId: 'formal_market',
    day: 10,
    parties: [
      { role: 'buyer', entity: buyer },
      { role: 'seller', entity: seller },
    ],
    transfers: [
      { from: 'buyer', to: 'seller', asset: { kind: 'item', itemId: 'low_spirit_stone', quantity: 30 } },
      { from: 'seller', to: 'buyer', asset: { kind: 'item', itemId: 'item_qi_pill', quantity: 1 } },
    ],
    source: { type: 'test', id: 'direct_sale' },
    visibility: 'institution',
  });

  ok(result.success === true, '正式买卖结算成功');
  ok(buyer.inventory.getAmount('low_spirit_stone') === 170, '买方扣灵石');
  ok(buyer.inventory.getAmount('item_qi_pill') === 1, '买方获得丹药');
  ok(seller.inventory.getAmount('low_spirit_stone') === 30, '卖方获得灵石');
  ok(economy.ledger.all().length === 1, '写入一条交易账本');
  ok(economy.ledger.all()[0].status === 'settled', '账本状态 settled');
}

console.log('2) failed settlement rolls back every prior delta');
{
  const buyer = actor('npc_buyer', { low_spirit_stone: 200 });
  const seller = actor('org_market', { item_qi_pill: 0 });
  const economy = new EconomicSystem({ config });
  const result = economy.settle({
    type: 'direct_purchase',
    scenarioId: 'formal_market',
    day: 10,
    parties: [{ role: 'buyer', entity: buyer }, { role: 'seller', entity: seller }],
    transfers: [
      { from: 'buyer', to: 'seller', asset: { kind: 'item', itemId: 'low_spirit_stone', quantity: 30 } },
      { from: 'seller', to: 'buyer', asset: { kind: 'item', itemId: 'item_qi_pill', quantity: 1 } },
    ],
    source: { type: 'test', id: 'rollback' },
  });
  ok(result.success === false, '卖方资产不足时失败');
  ok(buyer.inventory.getAmount('low_spirit_stone') === 200, '失败后买方灵石恢复');
  ok(seller.inventory.getAmount('low_spirit_stone') === 0, '失败后卖方未收到灵石');
  ok(economy.ledger.all()[0].status === 'failed', '失败也写入证据账本');
}

console.log('3) escrow can release, forfeit and generate debt');
{
  const payer = actor('npc_payer', { low_spirit_stone: 100 });
  const receiver = actor('npc_receiver', {});
  const hall = actor('org_quest_hall', {});
  const economy = new EconomicSystem({ config });
  const escrow = economy.openEscrow({
    day: 1,
    purpose: 'quest_reward',
    sourceEntity: payer,
    escrowHolder: hall,
    nominalOwnerId: payer.id,
    assets: [{ kind: 'item', itemId: 'low_spirit_stone', quantity: 60 }],
    source: { type: 'quest', id: 'quest_1' },
  });
  ok(escrow.success === true, '托管创建成功');
  ok(payer.inventory.getAmount('low_spirit_stone') === 40, '托管资产真实移出付款方');
  ok(hall.inventory.getAmount('low_spirit_stone') === 60, '托管资产进入托管方');
  const release = economy.settleEscrow({
    day: 2,
    escrowId: escrow.escrowId,
    destination: receiver,
    status: 'released',
    source: { type: 'quest', id: 'quest_1' },
  });
  ok(release.success === true, '托管释放成功');
  ok(receiver.inventory.getAmount('low_spirit_stone') === 60, '收款方获得托管资产');
  ok(hall.inventory.getAmount('low_spirit_stone') === 0, '托管方资产移出');

  const debt = economy.createDebt({
    day: 3,
    debtorId: payer.id,
    creditorId: receiver.id,
    origin: { type: 'test', id: 'debt_1' },
    dueDay: 5,
    assetsDue: [{ kind: 'item', itemId: 'low_spirit_stone', quantity: 20 }],
    visibility: 'personal',
  });
  ok(debt.status === 'active', '债务创建为 active');
  economy.advanceDay(6);
  ok(economy.debts.byId(debt.id).status === 'overdue', '到期未还变为 overdue');
  ok(economy.signalsFor({ actor: payer }).facts.hasOverdueDebt === true, '逾期债务输出经济信号');
}

console.log('4) private trade rejects organization points at platform level');
{
  const payer = actor('npc_private_a', {}, { contribution: 20 });
  const receiver = actor('npc_private_b', {}, { contribution: 0 });
  const economy = new EconomicSystem({ config });
  const result = economy.settle({
    type: 'private_trade',
    scenarioId: 'private_trade',
    day: 12,
    parties: [{ role: 'payer', entity: payer }, { role: 'receiver', entity: receiver }],
    transfers: [
      { from: 'payer', to: 'receiver', asset: { kind: 'organization_point', pointKey: 'contribution', quantity: 5 } },
    ],
    source: { type: 'test', id: 'private_points' },
    visibility: 'personal',
  });
  ok(result.success === false, '私人交易拒绝组织点数');
  ok(result.reason === 'private_asset_forbidden', '拒绝原因标明私人资产禁止');
  ok(payer.state.get('contribution') === 20, '失败后付款方贡献不变');
  ok(receiver.state.get('contribution') === 0, '失败后收款方贡献不变');
  ok(economy.ledger.all()[0].status === 'failed', '非法私人交易写失败账本');
}

if (failed > 0) {
  console.error(`\n经济交易平台测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n经济交易平台测试通过');
