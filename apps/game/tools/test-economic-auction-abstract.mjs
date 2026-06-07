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
const { AuctionService } = await imp('js/engine/economy/auction-service.js');

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
  const e = { id, name: id, inventory: new Inventory(), state: new RuntimeState(state), alive: true };
  e.inventory.loadFrom(inventory);
  return e;
}

console.log('1) no-player auction resolves by abstract bidding and ledger');
{
  const house = actor('org_auction', { item_breakthrough_pill: 1 });
  const rich = actor('npc_rich', { low_spirit_stone: 1000 }, { ambition: 80 });
  const poor = actor('npc_poor', { low_spirit_stone: 50 }, { ambition: 100 });
  const economy = new EconomicSystem({ config });
  const auction = new AuctionService({ economicSystem: economy, config });
  const result = auction.resolveAbstractAuction({
    day: 30,
    event: { id: 'evt_auction_test', name: '测试拍卖会', type: 'auction' },
    auctionHouse: house,
    lots: [{ itemId: 'item_breakthrough_pill', quantity: 1, reservePrice: 100 }],
    participants: [rich, poor],
    rng: { next: () => 0.2 },
  });
  ok(result.success === true, '抽象拍卖结算成功');
  ok(result.lots[0].status === 'sold', '拍品成交');
  ok(result.lots[0].winnerId === 'npc_rich', '有支付能力的参与者胜出');
  ok(rich.inventory.getAmount('item_breakthrough_pill') === 1, '赢家获得拍品');
  ok(rich.inventory.getAmount('low_spirit_stone') < 1000, '赢家支付灵石');
  ok(economy.ledger.all().some(r => r.type === 'auction_sale'), '账本记录拍卖成交');
  ok(result.wealthExposureEvents.length >= 1, '高价成交产生财富曝光事件');
}

if (failed > 0) {
  console.error(`\n抽象拍卖测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n抽象拍卖测试通过');
