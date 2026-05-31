#!/usr/bin/env node
/**
 * V1 任务奖励与 NPC 消费闭环验证。
 *
 * 覆盖：任务类型额外奖励、材料捐献、贡献兑换、丹药消耗、破境丹加成、法宝自动装备。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Inventory } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/inventory.js')).href);
const { RuntimeState } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/runtime-state.js')).href);
const { ItemRegistry } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/items/item-registry.js')).href);
const { NPCEntity } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/npc-entity.js')).href);
const { applyQuestRewardProfile } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/quest-rewards.js')).href);
const {
  donateMaterials,
  redeemExchangeItem,
  useQiPill,
  useBreakthroughPill,
  grantItemAndMaybeEquip,
} = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/npc-economy.js')).href);

ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/definitions/resources.json'));
ItemRegistry.loadFromArray(load('data/items/items.json').items);

const questTemplates = load('data/quests/quest-templates.json');
const economyConfig = load('data/balance/economy.json');
const ranks = load('data/definitions/ranks.json');
const cultivationConfig = load('data/balance/cultivation.json');
const gameConfig = load('data/config/game-config.json');

let failures = 0;
function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
}

function mkEntity(overrides = {}) {
  const entity = {
    id: overrides.id || 'npc_test',
    name: overrides.name || '测试弟子',
    staticData: { name: overrides.name || '测试弟子' },
    inventory: new Inventory(),
    state: new RuntimeState({
      alive: true,
      hasFaction: true,
      factionId: 'sect_test',
      contribution: 0,
      monthlyContribution: 0,
      qi: 0,
      cultivationProgress: 0,
      totalProgress: 0,
      breakthroughAidBonus: 0,
      equippedArtifactId: null,
      ...overrides.state,
    }),
  };
  entity.inventory.loadFrom(overrides.inventory || {});
  return entity;
}

function mkFaction() {
  return {
    id: 'sect_test',
    name: '测试宗门',
    alive: true,
    inventory: new Inventory(),
    state: new RuntimeState({ stability: 50 }),
  };
}

function mkWorld(faction) {
  return {
    balanceConfig: { economy: economyConfig },
    entityRegistry: {
      getById(id) {
        return id === faction.id ? faction : null;
      },
    },
  };
}

console.log('1) 任务类型额外奖励');
{
  const npc = mkEntity();
  const faction = mkFaction();
  const result = applyQuestRewardProfile(npc, faction, questTemplates, 3, 'qt_herb', () => 0);
  ok(npc.inventory.getAmount('spirit_herb') > 0, 'qt_herb 交付后 NPC 获得 spirit_herb');
  ok(faction.inventory.getAmount('spirit_herb') > 0, 'qt_herb 交付后宗门库存获得 spirit_herb');
  ok(result.questItemReward > 0, '任务物品奖励计数大于 0');
}

{
  const npc = mkEntity();
  const faction = mkFaction();
  applyQuestRewardProfile(npc, faction, questTemplates, 4, 'qt_slay_monster', () => 0);
  const monsterLoot = npc.inventory.getAmount('monster_core') + npc.inventory.getAmount('beast_material');
  ok(monsterLoot > 0, 'qt_slay_monster 交付后 NPC 获得妖兽相关材料');
}

console.log('2) 材料捐献');
{
  const npc = mkEntity({ inventory: { spirit_herb: 2 } });
  const faction = mkFaction();
  const beforeContribution = npc.state.get('contribution');
  const result = donateMaterials(npc, mkWorld(faction));
  ok(result.success, '有可捐材料的宗门 NPC 可以捐献');
  ok(npc.inventory.getAmount('spirit_herb') === 1, '捐献后 NPC 材料减少');
  ok(npc.state.get('contribution') > beforeContribution, '捐献后贡献增加');
  ok(npc.state.get('monthlyContribution') > 0, '捐献后月贡献增加');
  ok(faction.inventory.getAmount('spirit_herb') === 1, '捐献材料进入宗门库存');
}

console.log('3) 贡献兑换与聚气丹消耗');
{
  const npc = mkEntity({
    state: { contribution: 20 },
    inventory: { low_spirit_stone: 100 },
  });
  const faction = mkFaction();
  faction.inventory.add('spirit_herb', 1);
  const redeem = redeemExchangeItem(npc, mkWorld(faction), 'qi_pill');
  ok(redeem.success, '贡献和灵石足够时可兑换聚气丹');
  ok(npc.inventory.getAmount('item_qi_pill') === 1, '兑换后获得 item_qi_pill');
  ok(npc.state.get('contribution') < 20, '兑换后贡献扣减');
  const beforeQi = npc.state.get('qi');
  const beforeProgress = npc.state.get('cultivationProgress');
  const use = useQiPill(npc, mkWorld(faction));
  ok(use.success, '可使用已兑换的聚气丹');
  ok(npc.inventory.getAmount('item_qi_pill') === 0, '使用后聚气丹被消耗');
  ok(npc.state.get('qi') > beforeQi, '使用聚气丹后 qi 增加');
  ok(npc.state.get('cultivationProgress') > beforeProgress, '使用聚气丹后修炼进度增加');
}

console.log('4) 破境丹加成与突破判定清空');
{
  const npc = mkEntity({ inventory: { item_breakthrough_pill: 1 } });
  const use = useBreakthroughPill(npc, mkWorld(mkFaction()));
  ok(use.success, '可使用破境丹');
  ok(npc.state.get('breakthroughAidBonus') > 0, '使用后写入一次性突破加成');

  const realNpc = new NPCEntity({
    id: 'npc_breakthrough',
    name: '破境测试',
    role: 'disciple',
    factionId: 'sect_test',
    rankId: 'mortal',
  }, ranks, { cultivationConfig, gameConfig, aiConfig: { maxDepth: 4, maxIterations: 100 } });
  realNpc.state.set('cultivationProgress', 1.0);
  realNpc.state.set('insight', 0);
  realNpc.state.set('qi', 999999);
  realNpc.state.set('breakthroughAidBonus', 0.08);
  const oldRandom = Math.random;
  Math.random = () => 0.999;
  try {
    realNpc._tryBreakthrough();
  } finally {
    Math.random = oldRandom;
  }
  ok(realNpc.state.get('breakthroughAidBonus') === 0, '一次突破判定后破境丹加成清零');
}

console.log('5) 法宝自动装备');
{
  const npc = mkEntity();
  grantItemAndMaybeEquip(npc, 'item_artifact_low', 1);
  ok(npc.state.get('equippedArtifactId') === 'item_artifact_low', '获得低阶法器后自动装备');
  grantItemAndMaybeEquip(npc, 'item_artifact_mid', 1);
  ok(npc.state.get('equippedArtifactId') === 'item_artifact_mid', '获得更高 combatBonus 法宝后自动替换');
  ok(npc.inventory.getAmount('item_artifact_low') === 1, '被替换的旧法宝回到背包');
}

if (failures > 0) {
  console.error(`\n失败 ${failures} 项`);
  process.exit(1);
}

console.log('\nV1 任务奖励与 NPC 消费闭环测试通过');
