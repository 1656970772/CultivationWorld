#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Inventory } = await imp('js/engine/abstract/inventory.js');
const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { AssetAdapter } = await imp('js/engine/economy/asset-adapter.js');

let failed = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

function entity(id, inventory = {}, state = {}) {
  const e = {
    id,
    name: id,
    inventory: new Inventory(),
    state: new RuntimeState(state),
    alive: true,
  };
  e.inventory.loadFrom(inventory);
  return e;
}

console.log('1) NPC inventory item asset');
{
  const npc = entity('npc_a', { low_spirit_stone: 100, mat_century_ginseng: 2 });
  const adapter = new AssetAdapter();
  ok(adapter.amountOf(npc, { kind: 'item', itemId: 'low_spirit_stone' }) === 100, '读取 NPC 背包灵石');
  const delta = adapter.withdraw(npc, { kind: 'item', itemId: 'low_spirit_stone', quantity: 30 }, { reason: 'test' });
  ok(delta.success === true, 'NPC 背包可扣除资产');
  ok(npc.inventory.getAmount('low_spirit_stone') === 70, '扣除后数量减少');
  adapter.rollback(delta);
  ok(npc.inventory.getAmount('low_spirit_stone') === 100, 'rollback 恢复 NPC 背包');
}

console.log('2) faction state resource uses state as truth source');
{
  const faction = entity('sect_a', { low_spirit_stone: 5000 }, { low_spirit_stone: 4200, food: 800, disciples: 100 });
  const adapter = new AssetAdapter();
  ok(adapter.amountOf(faction, { kind: 'faction_state_resource', itemId: 'low_spirit_stone' }) === 4200, '势力灵石读取 state');
  const delta = adapter.withdraw(faction, { kind: 'faction_state_resource', itemId: 'low_spirit_stone', quantity: 300 }, { reason: 'trade' });
  ok(delta.success === true, '势力 state 资源可扣除');
  ok(faction.state.get('low_spirit_stone') === 3900, '扣除写 state');
  ok(faction.inventory.getAmount('low_spirit_stone') === 5000, '扣除不直接改 inventory，避免双轨');
  adapter.deposit(faction, { kind: 'faction_state_resource', itemId: 'food', quantity: 120 }, { reason: 'trade' });
  ok(faction.state.get('food') === 920, '势力粮食收入写 state');
  adapter.rollback(delta);
  ok(faction.state.get('low_spirit_stone') === 4200, 'rollback 恢复势力 state');
}

console.log('3) organization point cannot be transferred privately');
{
  const npc = entity('npc_b', {}, { contribution: 20 });
  const adapter = new AssetAdapter();
  ok(adapter.amountOf(npc, { kind: 'organization_point', pointKey: 'contribution' }) === 20, '读取贡献点');
  ok(adapter.isPrivatelyTransferable({ kind: 'organization_point', pointKey: 'contribution' }) === false, '贡献点不可私下转让');
}

if (failed > 0) {
  console.error(`\n经济资产适配器测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n经济资产适配器测试通过');
