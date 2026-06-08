#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { loadGameConfigsFromManifest } = await imp('js/core/data-manifest-loader.js');
const { ResourceRegistry } = await imp('js/engine/economy/resource-registry.js');
const { SectConfigRegistry } = await imp('js/engine/sect/sect-config-registry.js');
const { FactionEntity } = await imp('js/engine/faction/faction-entity.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');
const { NPCState } = await imp('js/engine/npc/npc-state.js');
const { WorldEngine } = await imp('js/engine/world-engine.js');

const manifest = load('data/config/data-manifest.json');
const configs = await loadGameConfigsFromManifest(manifest, { basePath: GAME_ROOT, loadJson: load });
const resourceRegistry = ResourceRegistry.fromDefinitions({
  macroResources: configs.items || [],
  itemDefs: configs.itemDefs || {},
  organizationPointKeys: configs.economicTransactionConfig?.assets?.organizationPointKeys || [],
});
const sectConfigRegistry = new SectConfigRegistry({
  ...configs,
  resourceRegistry,
});
sectConfigRegistry.assertValid();

let failed = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

function must(value, message) {
  if (!value) throw new Error(message);
  return value;
}

const seedProfileId = must(
  Object.keys(configs.sectSeedProfiles?.inventoryProfiles || {})[0],
  '测试需要至少一个 sect inventory profile',
);
const templateId = must(Object.keys(configs.sectOrganization?.templates || {})[0], '测试需要 sect template');
const hallProfileId = must(
  Object.keys(configs.sectSeedProfiles?.hallAssignmentProfiles || {})[0],
  '测试需要 hall assignment profile',
);
const hallId = must((configs.sectOrganization?.halls || [])[0]?.id, '测试需要 hall 配置');
const starterKitId = must(
  Object.keys(configs.sectSeedProfiles?.npcStarterKits || {})[0],
  '测试需要 NPC starter kit profile',
);
const starterItems = configs.sectSeedProfiles.npcStarterKits[starterKitId];
const inventoryProfile = configs.sectSeedProfiles.inventoryProfiles[seedProfileId];
const profileItemId = must(
  Object.keys(inventoryProfile).find((itemId) => itemId !== 'item_qi_pill'),
  '测试需要一个非覆盖宗门库存物品',
);
const rankId = must((configs.ranks || [])[0]?.id, '测试需要 ranks 配置');
const currencyItemId = must(configs.economicTransactionConfig?.currencyItemId, '测试需要经济货币配置');

console.log('1) faction sect metadata and inventory are resolved from profiles');
{
  const factionConfig = {
    id: 'sect_state_fixture',
    name: '状态测试宗门',
    type: 'righteous',
    headquarters: { x: 0, y: 0 },
    stability: 70,
    resources: {
      [currencyItemId]: 1234,
      disciples: 12,
    },
    isSect: true,
    sectTemplateId: templateId,
    sectSeedProfileId: seedProfileId,
    hallAssignmentProfileId: hallProfileId,
    inventoryOverrides: {
      item_qi_pill: 7,
    },
  };
  const faction = new FactionEntity(factionConfig, {
    resourceRegistry,
    sectConfigRegistry,
  });

  ok(faction.staticData.isSect === true, 'FactionStaticData 保存显式 isSect');
  ok(faction.staticData.sectSeedProfileId === seedProfileId, 'FactionStaticData 保存 seed profile');
  ok(faction.state.get(currencyItemId) === 1234, 'FactionState 从宗门资源 profile 与实体覆盖解析货币');
  ok(faction.state.get('sectSalaryShortfallStreak') === 0, 'FactionState 初始化门派欠薪 streak');
  ok(faction.inventory.getAmount('item_qi_pill') === 7, 'FactionEntity 加载 inventoryOverrides 覆盖 profile 实物库存');
  ok(
    faction.inventory.getAmount(profileItemId) === inventoryProfile[profileItemId],
    'FactionEntity 加载 seed profile 中未覆盖的实物库存',
  );
  faction.onPreTick({ entityRegistry: { getById: () => null } });
  faction.onPostTick({});
  ok(faction.inventory.getAmount('item_qi_pill') === 7, 'state resource 同步不清空宗门实物库存');
}

console.log('2) npc hall fields and starter kit are config-driven');
{
  const npcConfig = {
    id: 'npc_state_fixture',
    name: '状态测试弟子',
    factionId: 'sect_state_fixture',
    role: 'disciple',
    rankId,
    hallId,
    isHallChief: false,
    starterKitProfileId: starterKitId,
    spiritStone: 3,
    items: {
      item_qi_pill: 2,
    },
  };
  const npc = new NPCEntity(npcConfig, configs.ranks || [], {
    rng: { next: () => 0.5 },
    gameConfig: configs.gameConfig || {},
    cultivationConfig: configs.balanceCultivation || {},
    sectConfigRegistry,
    economicTransactionConfig: configs.economicTransactionConfig,
  });

  ok(npc.state.get('hallId') === hallId, 'NPCState 保存 hallId');
  ok(npc.state.get('isHallChief') === false, 'NPCState 保存 isHallChief');
  ok(npc.state.get('starterKitProfileId') === starterKitId, 'NPCState 保存 starterKitProfileId');
  ok(npc.inventory.getAmount(currencyItemId) === 3, 'NPCEntity 使用配置货币字段初始化灵石');
  for (const [itemId, amount] of Object.entries(starterItems)) {
    ok(npc.inventory.getAmount(itemId) === amount, `NPCEntity 加载 starter kit 物品 ${itemId}`);
  }
  ok(npc.inventory.getAmount('item_qi_pill') === 2, 'NPCEntity 合并显式 items 覆盖');
  const json = npc.toJSON();
  ok(json.hallId === hallId, 'NPCEntity.toJSON 输出 hallId');
  ok(json.activeBoardQuestId === null, 'NPCEntity.toJSON 输出 activeBoardQuestId');
}

console.log('3) npc role rank comes from injected config');
{
  const state = new NPCState(
    { id: 'npc_role_fixture', role: 'custom_role_for_test', rankId },
    configs.ranks || [],
    configs.gameConfig || {},
    { next: () => 0.5 },
    { custom_role_for_test: 7 },
  );
  ok(state.get('roleRank') === 7, 'NPCState 使用注入 roleRank 配置而非本地硬编码表');
}

console.log('4) real manifest data wires sect profiles into WorldEngine');
{
  const coreFactions = (configs.factions || []).filter(faction => !faction.subtype);
  const publicOrganizations = (configs.factions || []).filter(faction => faction.subtype);
  ok(coreFactions.length > 0, '正式配置包含核心势力');
  ok(coreFactions.every(faction => faction.isSect === true), '核心势力显式声明 isSect=true');
  ok(coreFactions.every(faction => faction.sectTemplateId && faction.sectSeedProfileId && faction.hallAssignmentProfileId), '核心势力显式挂接 sect template、seed profile 和堂口编制 profile');
  ok(publicOrganizations.every(faction => faction.isPublic === true && faction.isSect === false), '功能组织显式声明 isPublic=true / isSect=false');

  const roleRanks = configs.balanceCultivation?.promotion?.roleRankByStep || {};
  ok(Number.isFinite(Number(roleRanks.leader)), '职位等级配置包含 leader');

  const engine = new WorldEngine();
  engine.init({ ...configs, seed: 260608 });
  const sects = engine.entityRegistry.getByType('faction')
    .filter(faction => faction.staticData?.get?.('isSect') === true);
  const firstSect = sects[0];
  const leader = engine.entityRegistry.getByType('npc')
    .find(npc => npc.state?.get?.('currentRole') === 'leader');
  const hallMembers = engine.entityRegistry.getByType('npc')
    .filter(npc => npc.state?.get?.('hallId'));
  const starterKitMembers = engine.entityRegistry.getByType('npc')
    .filter(npc => npc.state?.get?.('starterKitProfileId'));
  const seededInventoryLoaded = sects.some(faction =>
    Object.keys(configs.sectSeedProfiles.inventoryProfiles[faction.staticData.sectSeedProfileId] || {})
      .some(itemId => faction.inventory.getAmount(itemId) > 0),
  );
  const starterKitLoaded = starterKitMembers.some(npc => {
    const kit = configs.sectSeedProfiles.npcStarterKits[npc.state.get('starterKitProfileId')] || {};
    return Object.keys(kit).some(itemId => npc.inventory.getAmount(itemId) >= kit[itemId]);
  });

  ok(sects.length === coreFactions.length, 'WorldEngine 可从显式配置找到全部核心宗门');
  ok(!!firstSect?.staticData?.sectSeedProfileId, '运行时宗门保留 seed profile');
  ok(seededInventoryLoaded, '运行时宗门加载 seed profile 实物库存');
  ok(hallMembers.length > 0, 'WorldEngine 按堂口编制 profile 自动分配 NPC 堂口');
  ok(starterKitMembers.length > 0 && starterKitLoaded, 'WorldEngine 按堂口编制 profile 自动分配 NPC starter kit');
  ok(leader?.state?.get?.('roleRank') === roleRanks.leader, '真实掌门 roleRank 来自 promotion.roleRankByStep.leader');
}

if (failed > 0) {
  console.error(`\n门派运行状态字段测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n门派运行状态字段测试通过');
