#!/usr/bin/env node
/**
 * 妖兽资源化闭环验证。
 *
 * 覆盖：
 * 1) 品阶化妖丹/妖材资源定义；
 * 2) 斩妖任务锁定具体妖兽；
 * 3) 执行斩妖任务会真实击杀目标妖兽并掉落材料；
 * 4) 宗门兑换丹药/法器会检查并消耗宗门妖兽材料库存。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Inventory } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/inventory.js')).href);
const { Action } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/action.js')).href);
const { RuntimeState } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/runtime-state.js')).href);
const { ItemRegistry } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/items/item-registry.js')).href);
const { NPCState } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/npc-state.js')).href);
const {
  NPCAcceptQuestExecutor,
  NPCDoQuestExecutor,
} = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/npc-actions.js')).href);
const { redeemExchangeItem } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/npc-economy.js')).href);
const { TickManager } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/tick-manager.js')).href);

ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/definitions/resources.json'));
ItemRegistry.loadFromArray(load('data/items/items.json').items);

let failures = 0;
function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
}

function withRandom(value, fn) {
  const old = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = old;
  }
}

function mkNpc(overrides = {}) {
  const npc = {
    id: overrides.id || 'npc_hunter',
    name: overrides.name || '猎妖弟子',
    staticData: { name: overrides.name || '猎妖弟子', personality: {} },
    inventory: new Inventory(),
    state: new RuntimeState({
      alive: true,
      hasFaction: true,
      factionId: 'sect_test',
      rankId: 'foundation_building',
      rankName: '筑基',
      activeQuestTypeId: null,
      activeQuestTypeName: null,
      activeQuestDifficulty: 0,
      activeQuestDiffName: null,
      hasActiveQuest: false,
      questComplete: false,
      questTurnedIn: false,
      questDaysRemaining: 0,
      questTargetX: null,
      questTargetY: null,
      questTargetMonsterId: null,
      injuryLevel: 0,
      ...overrides.state,
    }),
    spatial: overrides.spatial || { tileX: 10, tileY: 10 },
  };
  npc.inventory.loadFrom(overrides.inventory || {});
  return npc;
}

function mkFaction(inventory = {}) {
  const faction = {
    id: 'sect_test',
    name: '测试宗门',
    alive: true,
    inventory: new Inventory(),
    state: new RuntimeState({ stability: 50 }),
  };
  faction.inventory.loadFrom(inventory);
  return faction;
}

function mkMonster() {
  const drops = [
    { itemId: 'monster_core', chance: 1, coreGrade: 3 },
    { itemId: 'beast_material', chance: 1, material: '熊胆、寒毛' },
  ];
  return {
    id: 'monster_test_3',
    name: '雪爪熊王',
    grade: 3,
    alive: true,
    staticData: {
      name: '雪爪熊王',
      grade: 3,
      get(key) {
        if (key === 'drops') return drops;
        if (key === 'grade') return 3;
        if (key === 'attributes') return { strength: 40, speed: 10, defense: 20 };
        return null;
      },
    },
    state: new RuntimeState({ alive: true, power: 10 }),
    spatial: { tileX: 16, tileY: 18, clearDestination() {} },
    _die(cause, killerName) {
      this.alive = false;
      this.state.set('alive', false);
      this._deathInfo = {
        cause,
        monsterId: this.id,
        monsterName: this.name,
        grade: this.grade,
        killerName,
      };
    },
  };
}

console.log('1) 品阶化妖兽资源定义');
{
  const core = ItemRegistry.get('monster_core_g3');
  const material = ItemRegistry.get('beast_material_g3');
  ok(core?.category === 'material' && core.properties.grade === 3, '存在三阶妖兽内丹资源定义');
  ok(material?.category === 'material' && material.properties.grade === 3, '存在三阶灵兽材料资源定义');
  ok((ItemRegistry.get('monster_core_g5')?.properties.value || 0) > (core?.properties.value || 0), '高阶妖丹价值高于低阶妖丹');
  ok(core?.properties.transferable === true && material?.properties.transferable === true, '妖兽材料可转移并进入身家估值');
}

console.log('2) NPCState 与接任务锁定具体妖兽');
{
  const npcActions = load('data/actions/npc-actions.json');
  const huntAcceptAction = npcActions.find(a => a.id === 'act_npc_accept_hunt_quest');
  ok(!!huntAcceptAction, '存在专门的接取猎妖任务行为');
  ok(huntAcceptAction?.preconditions?.factionNeedsHuntMaterials?.op === 'true', '猎妖接取行为只在宗门缺妖兽材料时规划');

  const npcNeeds = load('data/needs/npc-needs.json');
  ok(npcNeeds.some(n => n.id === 'need_npc_hunt_resources'), '存在妖兽材料需求，能把宗门缺料转成猎妖目标');
  ok(npcNeeds.some(n => n.id === 'need_npc_active_quest'), '存在活跃任务收尾需求，避免多日猎妖被其他目标长期打断');
  ok(npcNeeds.some(n => n.id === 'need_npc_donate_materials'), '存在材料上交需求，猎妖掉落不会长期滞留个人背包');
  ok(npcNeeds.some(n => n.id === 'need_npc_breakthrough_aid'), '存在破境辅助需求，三阶妖丹库存能进入破境丹兑换/服用链');
  ok(npcNeeds.some(n => n.id === 'need_npc_combat_gear'), '存在法器装备需求，妖兽材料能进入炼器兑换链');

  const state = new NPCState({
    id: 'npc_state_test',
    name: '状态测试',
    role: 'disciple',
    factionId: 'sect_test',
    rankId: 'foundation_building',
  }, load('data/definitions/ranks.json'), load('data/config/game-config.json'));
  ok(state.get('questTargetMonsterId') === null, 'NPCState 初始化 questTargetMonsterId=null');

  const npc = mkNpc();
  const accept = new NPCAcceptQuestExecutor();
  const result = withRandom(0, () => accept.run(npc, {
    balanceConfig: { cultivation: { rankMaxDifficulty: { foundation_building: 3 } } },
    questTemplates: {
      difficulties: [{ level: 3, name: '三阶', durationDays: 1 }],
      questTypes: [{
        id: 'qt_slay_monster',
        name: '斩妖',
        repeatable: false,
        difficultyRange: [3, 3],
        locationTarget: 'monster',
      }],
      randomQuestSpawnChance: { '3': 1 },
    },
    resolveQuestLocation() {
      return { x: 16, y: 18, monsterId: 'monster_test_3' };
    },
  }, null));
  ok(result.success, '可接取斩妖任务');
  ok(npc.state.get('questTargetMonsterId') === 'monster_test_3', '斩妖任务锁定具体妖兽 id');

  const forcedNpc = mkNpc();
  const forced = withRandom(0, () => accept.run(forcedNpc, {
    balanceConfig: {
      cultivation: { rankMaxDifficulty: { foundation_building: 3 } },
      economy: { monsterResources: { huntQuestTypeIds: ['qt_slay_monster'] } },
    },
    questTemplates: {
      difficulties: [{ level: 3, name: '三阶', durationDays: 1 }],
      questTypes: [
        {
          id: 'qt_gather_herb',
          name: '采药',
          repeatable: false,
          difficultyRange: [3, 3],
          locationTarget: 'terrain:forest',
        },
        {
          id: 'qt_slay_monster',
          name: '斩妖',
          repeatable: false,
          difficultyRange: [3, 3],
          locationTarget: 'monster',
        },
      ],
      randomQuestSpawnChance: { '3': 1 },
    },
    resolveQuestLocation(_entity, quest) {
      if (quest.id === 'qt_slay_monster') return { x: 16, y: 18, monsterId: 'monster_test_3' };
      return { x: 1, y: 1 };
    },
  }, { id: 'act_npc_accept_hunt_quest' }));
  ok(forced.success && forcedNpc.state.get('activeQuestTypeId') === 'qt_slay_monster', '专门猎妖行为会过滤并接取斩妖任务');
  ok(forcedNpc.state.get('questTargetMonsterId') === 'monster_test_3', '专门猎妖行为仍锁定具体妖兽 id');
}

console.log('3) 执行斩妖任务真实击杀并掉落材料');
{
  const npc = mkNpc({
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questDaysRemaining: 1,
      questTargetMonsterId: 'monster_test_3',
    },
  });
  const monster = mkMonster();
  const doQuest = new NPCDoQuestExecutor();
  const result = withRandom(0, () => doQuest.run(npc, {
    questTemplates: {
      difficulties: [{ level: 3, name: '三阶', durationDays: 1, dangerInjury: 0, dangerDeath: 0 }],
    },
    balanceConfig: {
      economy: {
        monsterResources: {
          huntQuestTypeIds: ['qt_slay_monster', 'qt_exterminate', 'qt_hunt_beast'],
          huntPowerBias: 100,
        },
      },
    },
    entityRegistry: {
      getById(id) {
        return id === monster.id ? monster : null;
      },
    },
    npcCombatPower() { return 999; },
    currentDay: 1,
  }, null));
  ok(result.success && result.outcome === 'complete', '斩妖任务执行成功');
  ok(monster.alive === false && monster._deathInfo?.cause === 'quest_hunt', '目标妖兽被任务击杀并记录死因');
  ok(npc.inventory.getAmount('monster_core_g3') === 1, 'NPC 获得三阶妖兽内丹');
  ok(npc.inventory.getAmount('beast_material_g3') === 1, 'NPC 获得三阶灵兽材料');

  const multiDayNpc = mkNpc({
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questDaysRemaining: 2,
      questTargetMonsterId: 'monster_test_3',
    },
  });
  const multiDayMonster = mkMonster();
  const doQuestConfig = load('data/actions/npc-actions.json').find(a => a.id === 'act_npc_do_quest');
  const doQuestAction = new Action({ ...doQuestConfig, executor: new NPCDoQuestExecutor() });
  const worldContext = {
    questTemplates: {
      difficulties: [{ level: 3, name: '三阶', durationDays: 2, dangerInjury: 0, dangerDeath: 0 }],
    },
    balanceConfig: {
      economy: {
        monsterResources: {
          huntQuestTypeIds: ['qt_slay_monster', 'qt_exterminate', 'qt_hunt_beast'],
          huntPowerBias: 100,
        },
      },
    },
    entityRegistry: {
      getById(id) {
        return id === multiDayMonster.id ? multiDayMonster : null;
      },
    },
    npcCombatPower() { return 999; },
    currentDay: 1,
  };
  const firstDay = withRandom(0, () => doQuestAction.execute(multiDayNpc, worldContext));
  ok(firstDay.outcome === 'in_progress', '多日斩妖任务第一天仍处于进行中');
  ok(multiDayNpc.state.get('questComplete') === false, '多日斩妖任务未到最后一天不能被真实 effects 标记完成');
  ok(multiDayMonster.alive === true, '多日斩妖任务未到最后一天不会提前击杀妖兽');
  const secondDay = withRandom(0, () => doQuestAction.execute(multiDayNpc, worldContext));
  ok(secondDay.success && secondDay.outcome === 'complete', '多日斩妖任务最后一天才完成结算');
  ok(multiDayMonster.alive === false && multiDayNpc.inventory.getAmount('monster_core_g3') === 1, '多日斩妖任务最后一天击杀并掉落妖丹');
}

console.log('4) 宗门兑换消耗妖兽材料库存');
{
  const economyConfig = {
    npcExchange: {
      options: {
        qi_pill: {
          itemId: 'item_qi_pill',
          qty: 1,
          contributionCost: 0,
          stoneCost: 0,
          requiredFactionItems: [{ itemId: 'monster_core_g1', qty: 1 }],
        },
      },
    },
  };

  const npc = mkNpc({ state: { contribution: 99 }, inventory: { low_spirit_stone: 99 } });
  const emptyFaction = mkFaction();
  const blocked = redeemExchangeItem(npc, {
    balanceConfig: { economy: economyConfig },
    entityRegistry: { getById: () => emptyFaction },
  }, 'qi_pill');
  ok(blocked.success === false && blocked.outcome === 'not_enough_faction_material', '宗门库存不足时不能兑换聚气丹');

  const stockedFaction = mkFaction({ monster_core_g1: 1 });
  const success = redeemExchangeItem(npc, {
    balanceConfig: { economy: economyConfig },
    entityRegistry: { getById: () => stockedFaction },
  }, 'qi_pill');
  ok(success.success, '宗门库存足够时可以兑换聚气丹');
  ok(stockedFaction.inventory.getAmount('monster_core_g1') === 0, '兑换后消耗宗门妖兽材料库存');
}

console.log('5) 高阶妖兽死亡生成尸骸机会点');
{
  const tickManager = new TickManager({
    balanceConfig: {
      economy: {
        monsterResources: {
          corpseOpportunityMinGrade: 3,
          corpseValueBase: 240,
          corpseValuePerGrade: 180,
        },
      },
    },
    worldNewsConfig: { ...load('data/world/news.json'), enabled: true },
    opportunityConfig: { ...load('data/world/opportunities.json'), enabled: true },
  });
  const log = [];
  tickManager._spawnNewsFromEvents({
    monsterDeaths: [{
      monsterId: 'monster_dead_4',
      monsterName: '金背蛟王',
      grade: 4,
      x: 21,
      y: 22,
      locationName: '青蛟潭',
    }],
  }, 9, log);
  const corpse = tickManager.opportunitySystem.opportunities[0];
  ok(corpse?.type === 'monster_corpse', '高阶妖兽死亡生成妖兽尸骸机会');
  ok(corpse?.rewardSource === 'opportunity_corpse_g4', '尸骸机会绑定品阶化残余材料掉落源');
  ok(corpse?.name === '4阶妖兽尸骸', '尸骸机会名称带品阶');
  ok(corpse?.value === 960, '尸骸机会价值按品阶配置计算');
  ok(tickManager.infoSystem.activeNews[0]?.type === 'monster_king_death', '妖兽尸骸同时生成妖王陨落消息');
  ok(log.some((e) => e.type === 'news_born'), '尸骸消息写入信息事件日志');

  const before = tickManager.opportunitySystem.opportunities.length;
  tickManager._spawnNewsFromEvents({
    monsterDeaths: [{ monsterId: 'monster_dead_1', monsterName: '铁背狼', grade: 1, x: 1, y: 1 }],
  }, 10, log);
  ok(tickManager.opportunitySystem.opportunities.length === before, '低阶妖兽死亡不刷全图尸骸热点');
}

if (failures > 0) {
  console.error(`\n失败 ${failures} 项`);
  process.exit(1);
}

console.log('\n妖兽资源化闭环测试通过');
