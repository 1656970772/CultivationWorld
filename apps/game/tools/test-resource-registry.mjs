#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Inventory } = await imp('js/engine/abstract/inventory.js');
const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { ItemRegistry } = await imp('js/engine/items/item-registry.js');
const { EffectPool } = await imp('js/engine/pools/effect-pool.js');
const { AssetAdapter } = await imp('js/engine/economy/asset-adapter.js');
const { FactionEntity } = await imp('js/engine/faction/faction-entity.js');
const {
  applyItemEffects,
  factionNeedsMonsterExchangeMaterials,
  missingFactionExchangeItems,
  useQiPill,
} = await imp('js/engine/npc/npc-economy.js');
const { NPCUseHealItemToilExecutor } = await imp('js/engine/npc/toils/combat-toils.js');
const { ResourceRegistry } = await imp('js/engine/economy/resource-registry.js');
const { resolveMonsterDrops } = await imp('js/engine/monster/monster-resources.js');

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    console.error('  FAIL:', message);
    failed++;
  } else {
    console.log('  OK:', message);
  }
}

function entity(id, inventory = {}, state = {}) {
  const e = {
    id,
    name: id,
    inventory: new Inventory(),
    state: new RuntimeState(state),
    abilityComponent: { addModifier() {}, removeModifier() {} },
  };
  e.inventory.loadFrom(inventory);
  return e;
}

function makeResourceRegistry() {
  return ResourceRegistry.fromDefinitions({
    macroResources: [
      { id: 'grain', name: '灵谷', category: 'supply', resourceKind: 'faction_state' },
      { id: 'disciples', name: '弟子', category: 'population', resourceKind: 'faction_state' },
    ],
    itemDefs: {
      items: [
        { id: 'low_spirit_stone', name: '低级灵石', category: 'currency', stackable: true, transferable: true },
        { id: 'spirit_jade', name: '灵玉', category: 'currency', stackable: true, transferable: true },
      ],
    },
    organizationPointKeys: ['contribution'],
  });
}

console.log('1) ResourceRegistry unifies macro resources and currency resources');
{
  const registry = makeResourceRegistry();
  assert(registry.isFactionStateResource('grain') === true, '配置的宏观资源可作为势力 state 资源');
  assert(registry.isFactionStateResource('low_spirit_stone') === true, '货币资源可作为势力 state 资源');
  assert(registry.isFactionStateResource('food') === false, '未配置 food 不再被默认白名单放行');
  assert(registry.isOrganizationPoint('contribution') === true, '组织点数来自配置');
}

console.log('2) AssetAdapter rejects unregistered faction state resources');
{
  const adapter = new AssetAdapter({ resourceRegistry: makeResourceRegistry() });
  const faction = entity('sect_registry', {}, { low_spirit_stone: 100, grain: 50, food: 999 });
  const okWithdraw = adapter.withdraw(faction, { kind: 'faction_state_resource', itemId: 'grain', quantity: 10 });
  assert(okWithdraw.success === true, '配置宏观资源可扣除');
  assert(faction.state.get('grain') === 40, '配置宏观资源扣除写入 state');
  const blocked = adapter.withdraw(faction, { kind: 'faction_state_resource', itemId: 'food', quantity: 1 });
  assert(blocked.success === false, '未登记势力 state 资源失败而不是回退直写 state');
  assert(faction.state.get('food') === 999, '未登记资源失败后 state 不变');
}

console.log('3) FactionEntity initializes state/inventory from configured resource registry');
{
  const faction = new FactionEntity({
    id: 'sect_custom_resource',
    name: '灵谷宗',
    factionType: 'merchant',
    resources: { low_spirit_stone: 12, grain: 34, food: 56 },
  }, { resourceRegistry: makeResourceRegistry() });
  assert(faction.state.get('grain') === 34, '配置资源进入 FactionState');
  assert(faction.inventory.getAmount('grain') === 34, '配置资源同步到兼容 inventory');
  assert(faction.state.get('food') == null, '未配置资源不会初始化到 FactionState');
  faction.onPreTick({});
  assert(faction.inventory.getAmount('grain') === 34, 'onPreTick 按注册表同步配置资源');
}

console.log('4) item effects fail when item/effect config is missing');
{
  ItemRegistry.clear();
  EffectPool.clear();
  ItemRegistry.loadFromArray([
    { id: 'item_qi_pill', name: '无效聚气丹', category: 'pill', stackable: true, effects: [] },
  ]);
  const npc = entity('npc_missing_effect', { item_qi_pill: 1 }, { qi: 0, cultivation: 0 });
  const direct = applyItemEffects(npc, 'item_qi_pill');
  assert(direct.applied === false && direct.reason === 'missing_item_effects', 'applyItemEffects 缺 effects 返回明确失败原因');
  const used = useQiPill(npc, { npcExchange: { useItems: { pillEffects: { enabled: true }, qiPill: { itemId: 'item_qi_pill', qiGain: 120 } } } });
  assert(used.success === false && used.outcome === 'missing_item_effects', 'useQiPill 缺物品 effects 不回退直写 state');
  assert(npc.state.get('qi') === 0, '缺 effects 时不会直接增加 qi');

  const disabledSwitch = useQiPill(npc, {
    npcExchange: {
      useItems: {
        pillEffects: { enabled: false },
        qiPill: { itemId: 'item_qi_pill', qiGain: 120, progressGain: 0.01 },
      },
    },
  });
  assert(disabledSwitch.success === false && disabledSwitch.outcome === 'missing_item_effects', 'pillEffects 关闭时也不启用旧丹药直写回退');
  assert(npc.state.get('qi') === 0, 'pillEffects 关闭且缺 effects 时仍不会直接增加 qi');
}

console.log('5) heal item toil consumes item and applies configured effects');
{
  ItemRegistry.clear();
  EffectPool.clear();
  ItemRegistry.loadFromArray([
    {
      id: 'pill_rejuvenation',
      name: '回春丹',
      category: 'pill',
      stackable: true,
      effects: [{ effect: 'ge_test_add_hp', magnitude: 0.5, magnitudeType: 'ratioOfMaxHp' }],
    },
  ]);
  EffectPool.loadFromConfig([
    {
      id: 'ge_test_add_hp',
      type: 'instant',
      modifiers: [{ attribute: 'hp', op: 'add', magnitude: 0, clamp: [0, 'maxHp'] }],
    },
  ]);
  const npc = entity('npc_heal_effect', { pill_rejuvenation: 1 }, { hp: 20, maxHp: 100, injuryLevel: 3 });
  const result = new NPCUseHealItemToilExecutor().run(npc);
  assert(result.status === 'success', '疗伤 Toil 成功');
  assert(npc.inventory.getAmount('pill_rejuvenation') === 0, '疗伤 Toil 消耗配置物品');
  assert(npc.state.get('hp') === 70, '疗伤 Toil 使用物品 effects 恢复 hp');
  assert(npc.state.get('injuryLevel') === 2, '疗伤 Toil 仍按战斗语义降低伤势层级');
}

console.log('6) monster exchange material recognition uses economy config patterns');
{
  const npc = entity('npc_custom_monster_material', {}, { hasFaction: true, factionId: 'sect_custom' });
  const faction = entity('sect_custom', {}, {});
  const worldContext = {
    monsterResourceRules: {
      exchangeItemPatterns: ['^custom_core_t\\d+$'],
      itemFamilies: [
        { id: 'custom_core', itemIdTemplate: 'custom_core_t{grade}' },
      ],
    },
    balanceConfig: {
      economy: {
        npcExchange: {
          options: {
            breakthrough_pill: {
              requiredFactionItems: [{ family: 'custom_core', grade: 3, qty: 1 }],
            },
          },
        },
      },
    },
    entityRegistry: {
      getById(id) { return id === 'sect_custom' ? faction : null; },
    },
  };
  assert(
    factionNeedsMonsterExchangeMaterials(npc, worldContext, ['breakthrough_pill']) === true,
    '妖兽兑换材料识别来自配置 pattern，而不是固定 itemId 正则',
  );
  const missing = missingFactionExchangeItems(npc, worldContext, 'breakthrough_pill');
  assert(missing[0]?.itemId === 'custom_core_t3', '兑换配方可用资源族+品阶经 monster-resource-rules 解析为具体材料 ID');
}

console.log('7) monster resource item ids are resolved from monster-resource-rules templates');
{
  ItemRegistry.clear();
  ItemRegistry.loadFromArray([
    { id: 'custom_core_t4', name: '四阶自定义妖核', category: 'material', stackable: true },
  ]);
  const drops = resolveMonsterDrops({
    grade: 4,
    drops: [{ itemId: 'custom_core', qty: 1 }],
  }, () => 0, {
    itemFamilies: [
      { id: 'custom_core', itemIdTemplate: 'custom_core_t{grade}' },
    ],
  });
  assert(drops[0]?.itemId === 'custom_core_t4', '妖兽掉落 ID 模板来自 monster-resource-rules，而不是固定 _g{grade} 规则');
}

console.log('8) economy balance no longer stores pill legacy fallback values or monster item families');
{
  const economy = load('data/balance/economy.json');
  const useItems = economy.npcExchange?.useItems || {};
  assert(!Object.prototype.hasOwnProperty.call(useItems, 'pillEffects'), 'economy.json 不再保留 pillEffects 开关');
  assert(!Object.prototype.hasOwnProperty.call(useItems.qiPill || {}, 'qiGain'), '聚气丹真气数值只来自物品 effects');
  assert(!Object.prototype.hasOwnProperty.call(useItems.qiPill || {}, 'progressGain'), '聚气丹修为数值只来自物品 effects');
  assert(!Object.prototype.hasOwnProperty.call(useItems.breakthroughPill || {}, 'qiGain'), '破境丹真气数值只来自物品 effects');
  assert(!Object.prototype.hasOwnProperty.call(useItems.breakthroughPill || {}, 'breakthroughBonus'), '破境丹突破加成只来自物品 effects');
  assert(!Object.prototype.hasOwnProperty.call(economy.monsterResources || {}, 'itemFamilies'), '妖兽材料族不再双写在 economy.json');
  assert(!Object.prototype.hasOwnProperty.call(economy.monsterResources || {}, 'exchangeItemPatterns'), '妖兽材料识别规则不再双写在 economy.json');
  const economyText = readFileSync(resolve(GAME_ROOT, 'data/balance/economy.json'), 'utf-8');
  assert(!economyText.includes('monster_core_g'), 'economy.json 不直接写妖丹分级材料 ID');
  assert(!economyText.includes('beast_material_g'), 'economy.json 不直接写妖材分级材料 ID');
}

if (failed > 0) {
  console.error(`\n资源注册表测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n资源注册表测试通过');
