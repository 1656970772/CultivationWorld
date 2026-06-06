#!/usr/bin/env node
/**
 * 斩妖 Job / 任务与修炼 Toil 验证。
 *
 * 覆盖 Task 3：
 * 1) quest/cultivation Toil executor 已注册；
 * 2) 多日斩妖任务第一天保持 Job/Toil running，不提前完成或击杀；
 * 3) 最后一天通过 settleMonsterHunt 真实击杀妖兽并发放 drops；
 * 4) 修炼、修炼场、疗伤 Toil 可调用旧逻辑抽出的服务运行。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Inventory } = await imp('js/engine/abstract/inventory.js');
const { JobResultStatus } = await imp('js/engine/abstract/job.js');
const { JobSystem } = await imp('js/engine/abstract/job-system.js');
const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { ItemRegistry } = await imp('js/engine/items/item-registry.js');
const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { registerNPCToilExecutors } = await imp('js/engine/npc/toils/npc-toils.js');
const { bindMonsterHuntTarget, executeQuestDay } = await imp('js/engine/npc/services/quest-service.js');
const { settleMonsterHunt } = await imp('js/engine/monster/monster-resources.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
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

function setupPools() {
  ToilPool.clear();
  JobPool.clear();
  ToilPool.loadFromConfig(load('data/toils/core-toils.json'));
  ToilPool.loadFromConfig(load('data/toils/npc-combat-toils.json'));
  ToilPool.loadFromConfig(load('data/toils/npc-quest-toils.json'));
  ToilPool.loadFromConfig(load('data/toils/npc-cultivation-toils.json'));
  JobPool.loadFromConfig(load('data/jobs/npc-quest-jobs.json'));
  JobPool.loadFromConfig(load('data/jobs/npc-cultivation-jobs.json'));
  registerNPCToilExecutors();
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
      cultivationProgress: 0,
      contribution: 20,
      qi: 0,
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
    spatial: overrides.spatial || {
      tileX: 16,
      tileY: 18,
      setDestination(x, y) {
        this.tileX = x;
        this.tileY = y;
      },
    },
  };
  npc.inventory.loadFrom(overrides.inventory || {});
  return npc;
}

function mkMonster(overrides = {}) {
  const drops = [
    { itemId: 'monster_core', chance: 1, coreGrade: 3 },
    { itemId: 'beast_material', chance: 1, material: '熊胆、寒毛' },
  ];
  const grade = overrides.grade ?? 3;
  const power = overrides.power ?? 10;
  const alive = overrides.alive ?? true;
  return {
    id: overrides.id || 'monster_test_3',
    name: overrides.name || '雪爪熊王',
    grade,
    alive,
    staticData: {
      name: overrides.name || '雪爪熊王',
      grade,
      get(key) {
        if (key === 'drops') return drops;
        if (key === 'grade') return grade;
        if (key === 'attributes') return { strength: 40, speed: 10, defense: 20 };
        return null;
      },
    },
    state: new RuntimeState({ alive, power }),
    spatial: { tileX: overrides.x ?? 16, tileY: overrides.y ?? 18, clearDestination() {} },
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

function mkWorld(monsterOrMonsters) {
  const monsters = Array.isArray(monsterOrMonsters) ? monsterOrMonsters : [monsterOrMonsters].filter(Boolean);
  return {
    rng: { next: () => 0, fn: () => 0 },
    questTemplates: {
      difficulties: [{ level: 3, name: '三阶', durationDays: 2, dangerInjury: 0, dangerDeath: 0 }],
      questTypes: [
        {
          id: 'qt_slay_monster',
          name: '斩妖',
          repeatable: true,
          category: 'combat',
          difficultyRange: [3, 3],
          locationTarget: 'monster',
        },
      ],
      randomQuestSpawnChance: { 3: 1 },
    },
    balanceConfig: {
      cultivation: {
        cultivationSpeed: { foundation_building: 0.01 },
        spiritStoneCost: { foundation_building: 1 },
        qiBaseGain: { foundation_building: 1 },
        qiPerProgress: { foundation_building: 10 },
        cultivationCap: { foundation_building: 1 },
        rankMaxDifficulty: { foundation_building: 3 },
        speedVariance: { min: 1, max: 1 },
        actions: {
          trainChamber: { contributionCost: 10, speedBonusMultiplier: 2 },
        },
      },
      economy: {
        monsterResources: {
          huntQuestTypeIds: ['qt_slay_monster', 'qt_exterminate', 'qt_hunt_beast'],
          huntPowerBias: 100,
        },
      },
    },
    entityRegistry: {
      getById(id) {
        return monsters.find(monster => monster?.id === id) || null;
      },
      getAliveByType(type) {
        return type === 'monster' ? monsters.filter(monster => monster?.alive !== false && monster?.state?.get?.('alive') !== false) : [];
      },
    },
    npcCombatPower() { return 999; },
    currentDay: 1,
  };
}

function runStep(jobSystem, entity, worldContext, message) {
  const result = withRandom(0, () => jobSystem.executeStep(entity, worldContext));
  assert(result.status === JobResultStatus.RUNNING || result.status === JobResultStatus.SUCCESS, message);
  return result;
}

ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/definitions/macro-resources.json'));
ItemRegistry.loadFromArray(['currency', 'material', 'pill', 'artifact', 'talisman', 'technique']
  .flatMap(category => load(`data/items/${category}.json`).items));

setupPools();

console.log('1) quest/cultivation Toil executor 注册');
const requiredToils = [
  'toil_accept_quest',
  'toil_bind_monster_hunt_quest',
  'toil_assess_monster_hunt_risk',
  'toil_prepare_monster_hunt',
  'toil_plan_safe_hunt_route',
  'toil_wait_for_hunt_companion',
  'toil_move_to_quest_target',
  'toil_hunt_monster_target',
  'toil_update_quest_progress',
  'toil_turn_in_quest',
  'toil_cultivate',
  'toil_train_chamber',
  'toil_heal',
];
for (const id of requiredToils) {
  assert(ToilPool.getExecutor(id), `${id} executor registered`);
}

console.log('2) 多日斩妖 Job 不提前结算');
{
  const npc = mkNpc({
    inventory: { pill_rejuvenation: 1, artifact_green_sword: 1 },
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questDaysRemaining: 2,
      questTargetX: 16,
      questTargetY: 18,
      questTargetMonsterId: 'monster_test_3',
      equippedArtifactId: 'artifact_green_sword',
    },
  });
  const monster = mkMonster();
  const worldContext = mkWorld(monster);
  const jobSystem = new JobSystem();
  jobSystem.start('job_npc_monster_hunt', {});

  runStep(jobSystem, npc, worldContext, '绑定斩妖目标 Toil 可运行');
  runStep(jobSystem, npc, worldContext, '评估斩妖风险 Toil 可运行');
  runStep(jobSystem, npc, worldContext, '准备斩妖补给 Toil 可运行');
  runStep(jobSystem, npc, worldContext, '规划安全斩妖路线 Toil 可运行');
  runStep(jobSystem, npc, worldContext, '前往任务目标 Toil 可运行');
  runStep(jobSystem, npc, worldContext, '击杀目标 Toil 可运行并推进到进度 Toil');
  assert(monster.alive === true, 'hunt Toil 不提前击杀妖兽，交由 progress Toil 按天结算');

  const firstDay = runStep(jobSystem, npc, worldContext, '多日斩妖第一天保持 Job running');
  assert(firstDay.status === JobResultStatus.RUNNING, '第一天 executeQuestDay 返回 running');
  assert(jobSystem.snapshot().currentToilId === 'progress', '第一天仍停留在 progress Toil');
  assert(npc.state.get('questDaysRemaining') === 1, '第一天只递减 questDaysRemaining');
  assert(npc.state.get('questComplete') === false, '第一天不设置 questComplete');
  assert(monster.alive === true, '第一天不击杀妖兽');

  const secondDay = withRandom(0, () => jobSystem.executeStep(npc, worldContext));
  assert(secondDay.status === JobResultStatus.SUCCESS, '多日斩妖最后一天完成 Job');
  assert(npc.state.get('questComplete') === true, '最后一天才设置 questComplete');
  assert(monster.alive === false && monster._deathInfo?.cause === 'quest_hunt', '最后一天通过 settleMonsterHunt 击杀目标妖兽');
  assert(npc.inventory.getAmount('monster_core_g3') === 1, '斩妖 Job 发放三阶妖兽内丹');
  assert(npc.inventory.getAmount('beast_material_g3') === 1, '斩妖 Job 发放三阶灵兽材料');
}

console.log('3) 斩妖任务写入结构化字段');
{
  const monster = mkMonster();
  const worldContext = mkWorld(monster);
  const npc = mkNpc({ state: { hasActiveQuest: false } });
  const accept = ToilPool.getExecutor('toil_accept_quest')?.run(npc, worldContext, { context: { forceMonsterHunt: true } }, { params: {} });
  assert(accept?.status === 'success', '强制接取斩妖任务成功');
  const bind = ToilPool.getExecutor('toil_bind_monster_hunt_quest')?.run(npc, worldContext, { context: {} }, { params: {} });
  assert(bind?.status === 'success', '斩妖任务绑定具体妖兽成功');
  assert(npc.state.get('activeQuestCategory') === 'combat', '任务类型写入 combat');
  assert(npc.state.get('activeQuestValue') > 0, '任务价值写入数值');
  assert(npc.state.get('activeQuestRiskScore') > 0, '任务风险写入数值');
  assert(typeof npc.state.get('questTargetX') === 'number' && typeof npc.state.get('questTargetY') === 'number', '任务坐标写入');
  assert(npc.state.get('questTargetMonsterName') === '雪爪熊王', '妖兽名字写入任务');
  assert(npc.state.get('questTargetMonsterGrade') === 3, '妖兽阶位写入任务');
  assert(npc.state.get('questTargetMonsterCount') === 1, '妖兽数量写入任务');
  const instance = npc.state.get('activeQuestInstance');
  assert(instance?.id === 'quest_1_npc_hunter_1', 'activeQuestInstance 使用 currentDay/NPC/count 生成确定性 id');
  assert(instance?.templateId === 'qt_slay_monster', 'activeQuestInstance 写入 templateId');
  assert(instance?.state === 'accepted', 'activeQuestInstance 初始 state=accepted');
  assert(instance?.target?.kind === 'monster', 'activeQuestInstance target.kind=monster');
  assert(instance?.target?.monsterIds?.includes(monster.id), '绑定目标同步 activeQuestInstance.target.monsterIds');
  assert(instance?.target?.requiredKills === 1, 'activeQuestInstance target.requiredKills 默认 1');
  assert(instance?.target?.killedCount === 0, 'activeQuestInstance target.killedCount 初始 0');
}

console.log('4) 斩妖目标会避开排除列表并重定向');
{
  const excluded = mkMonster({ id: 'monster_excluded', name: '过强妖兽', x: 16, y: 18, power: 10 });
  const safe = mkMonster({ id: 'monster_safe', name: '可斩妖兽', x: 17, y: 18, power: 10 });
  const npc = mkNpc({
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questTargetMonsterId: 'monster_excluded',
      questTargetX: 16,
      questTargetY: 18,
      excludedHuntMonsterIds: ['monster_excluded'],
    },
  });
  const result = bindMonsterHuntTarget(npc, mkWorld([excluded, safe]));
  assert(result.success === true, '排除目标存在时仍能重定向到安全目标');
  assert(result.monsterId === 'monster_safe', '不会重新绑定 excludedHuntMonsterIds 中的目标');
  assert(npc.state.get('questTargetMonsterId') === 'monster_safe', '重定向目标写回 state');
}

console.log('5) 锁定目标死亡或失踪时重定向同阶附近妖兽');
{
  const dead = mkMonster({ id: 'monster_dead', name: '已死妖兽', alive: false, x: 16, y: 18, power: 10 });
  const replacement = mkMonster({ id: 'monster_replacement', name: '替代妖兽', x: 18, y: 18, power: 10 });
  const npc = mkNpc({
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questTargetMonsterId: 'monster_dead',
      questTargetX: 16,
      questTargetY: 18,
    },
  });
  const result = bindMonsterHuntTarget(npc, mkWorld([dead, replacement]));
  assert(result.success === true, '锁定目标死亡时能重定向');
  assert(result.monsterId === 'monster_replacement', '重定向到同阶附近活体妖兽');
  assert(npc.state.get('questTargetMonsterName') === '替代妖兽', '重定向后写回妖兽名');
}

console.log('6) 找不到安全替代目标时明确失败');
{
  const excluded = mkMonster({ id: 'monster_only', name: '唯一妖兽', x: 16, y: 18, power: 10 });
  const npc = mkNpc({
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questTargetMonsterId: 'monster_only',
      questTargetX: 16,
      questTargetY: 18,
      excludedHuntMonsterIds: ['monster_only'],
    },
  });
  const result = bindMonsterHuntTarget(npc, mkWorld([excluded]));
  assert(result.success === false, '无安全替代目标时不凭空完成');
  assert(['safe_hunt_target_missing', 'target_lost'].includes(result.reason), '无安全替代目标时返回明确失败原因');
}

console.log('7) 多目标斩妖只由真实妖兽死亡推进进度');
{
  const first = mkMonster({ id: 'monster_multi_1', name: '第一头妖兽', x: 16, y: 18, power: 10 });
  const second = mkMonster({ id: 'monster_multi_2', name: '第二头妖兽', x: 17, y: 18, power: 10 });
  const npc = mkNpc({
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questDaysRemaining: 1,
      questTargetMonsterId: first.id,
      questTargetX: 16,
      questTargetY: 18,
      activeQuestInstance: {
        id: 'quest_1_npc_hunter_1',
        templateId: 'qt_slay_monster',
        type: 'qt_slay_monster',
        name: '斩妖',
        category: 'combat',
        difficulty: 3,
        value: 75,
        riskScore: 0.3,
        source: 'test',
        state: 'accepted',
        target: {
          kind: 'monster',
          x: 16,
          y: 18,
          monsterIds: [first.id],
          monsterName: first.name,
          monsterGrade: 3,
          requiredKills: 2,
          killedCount: 0,
        },
        rewards: {},
      },
    },
  });
  const worldContext = mkWorld([first, second]);
  const firstDay = executeQuestDay(npc, worldContext);
  const afterFirst = npc.state.get('activeQuestInstance');
  assert(firstDay.outcome === 'in_progress', '第一头真实死亡后多目标任务继续');
  assert(first.alive === false, '第一头妖兽真实死亡');
  assert(afterFirst.target.killedCount === 1, 'killedCount 只在真实击杀后增加到 1');
  assert(npc.state.get('questComplete') === false, '未达 requiredKills 前 questComplete=false');
  assert(npc.state.get('hasActiveQuest') === true, '未达 requiredKills 前任务仍保持 active');

  const secondDay = executeQuestDay(npc, worldContext);
  const afterSecond = npc.state.get('activeQuestInstance');
  assert(secondDay.outcome === 'complete', '第二头真实死亡后多目标任务完成');
  assert(second.alive === false, '第二头妖兽真实死亡');
  assert(afterSecond.target.killedCount === 2, 'killedCount 达到 requiredKills');
  assert(afterSecond.state === 'completed', 'activeQuestInstance 达成击杀数后 state=completed');
  assert(npc.state.get('questComplete') === true, '达到 requiredKills 后 questComplete=true');
}

console.log('8) 目标失踪失败会写 activeQuestInstance failureReason');
{
  const npc = mkNpc({
    state: {
      hasActiveQuest: true,
      activeQuestTypeId: 'qt_slay_monster',
      activeQuestTypeName: '斩妖',
      activeQuestDifficulty: 3,
      activeQuestDiffName: '三阶',
      questDaysRemaining: 1,
      questTargetMonsterId: 'monster_missing',
      questTargetX: 16,
      questTargetY: 18,
      activeQuestInstance: {
        id: 'quest_1_npc_hunter_1',
        templateId: 'qt_slay_monster',
        type: 'qt_slay_monster',
        name: '斩妖',
        category: 'combat',
        difficulty: 3,
        value: 75,
        riskScore: 0.3,
        source: 'test',
        state: 'accepted',
        target: {
          kind: 'monster',
          x: 16,
          y: 18,
          monsterIds: ['monster_missing'],
          monsterName: '失踪妖兽',
          monsterGrade: 3,
          requiredKills: 1,
          killedCount: 0,
        },
        rewards: {},
      },
    },
  });
  const result = executeQuestDay(npc, mkWorld([]));
  const instance = npc.state.get('activeQuestInstance');
  assert(result.success === false, '目标失踪时 executeQuestDay 失败');
  assert(instance?.state === 'failed', '目标失踪时 activeQuestInstance.state=failed');
  assert(instance?.failureReason === 'target_lost', '目标失踪时 failureReason=target_lost');
}

console.log('9) 组队斩妖使用共同战力并记录助攻收益');
{
  const hunter = mkNpc({
    id: 'npc_party_hunter',
    name: '主猎人',
    state: { cultivation: 0, experienceCultivation: 0, insight: 0, totalCultivation: 0 },
  });
  const companion = mkNpc({
    id: 'npc_party_assist',
    name: '助战同门',
    state: { cultivation: 0, experienceCultivation: 0, insight: 0, totalCultivation: 0 },
  });
  const monster = mkMonster({ id: 'monster_party', name: '铁背妖虎', power: 170 });
  const worldContext = mkWorld(monster);
  worldContext.balanceConfig.economy.monsterResources.huntPowerBias = 0;
  worldContext.balanceConfig.cultivation.experience = {
    enabled: true,
    valueScale: 100,
    riskWeight: 0.2,
    maxValueMultiplier: 3,
    maxRiskMultiplier: 3,
    maxDurationMultiplier: 2,
    baseBySource: { monster_hunt_success: 8 },
    outcomeMultiplier: { success: 1, partial: 0.35 },
  };
  worldContext.npcCombatPower = (entity) => (entity?.id === companion.id ? 100 : 100);

  const result = settleMonsterHunt(hunter, monster, worldContext, () => 0.49, { party: [hunter, companion] });
  assert(result.success === true, 'settleMonsterHunt 用共同战力击杀原本单人难胜的妖兽');
  assert(result.huntPartyPower === 170, '共同战力按主猎人100%和同伴70%计入');
  assert(monster._deathInfo?.assistNpcIds?.includes(companion.id), '妖兽死亡信息记录 assistNpcIds');
  assert(hunter.state.get('experienceCultivation') > 0, '主猎人获得 monster_hunt_success 历练修为');
  assert(companion.state.get('experienceCultivation') > 0, '同伴获得部分 monster_hunt_success 历练修为');
  assert(companion.state.get('experienceCultivation') < hunter.state.get('experienceCultivation'), '同伴历练收益低于主猎人');
}

console.log('10) 修炼与疗伤 Toil 可运行');
{
  const monster = mkMonster();
  const worldContext = mkWorld(monster);

  const cultivateNpc = mkNpc({ inventory: { low_spirit_stone: 10 } });
  const cultivateJob = new JobSystem();
  cultivateJob.start('job_npc_cultivate', {});
  const cultivated = withRandom(0, () => cultivateJob.executeStep(cultivateNpc, worldContext));
  assert(cultivated.status === JobResultStatus.SUCCESS, 'toil_cultivate 可完成 Job');
  assert(cultivateNpc.state.get('cultivationProgress') > 0, 'toil_cultivate 增加修炼进度');
  assert(cultivateNpc.state.get('qi') > 0, 'toil_cultivate 增加真气');

  const trainNpc = mkNpc({ inventory: { low_spirit_stone: 10 }, state: { contribution: 20 } });
  const trainExecutor = ToilPool.getExecutor('toil_train_chamber');
  const trained = withRandom(0, () => trainExecutor?.run(trainNpc, worldContext, { context: {} }, { params: { duration: 1 } }));
  assert(trained?.status === 'success', 'toil_train_chamber 可运行');
  assert(trainNpc.state.get('contribution') === 10, 'toil_train_chamber 扣除贡献');
  assert(trained?.contextPatch?.contributionSpent === 10, 'toil_train_chamber 返回 contributionSpent');

  const healNpc = mkNpc({ state: { injuryLevel: 2 } });
  const healExecutor = ToilPool.getExecutor('toil_heal');
  const healed = healExecutor?.run(healNpc, worldContext, { context: {} }, { params: {} });
  assert(healed?.status === 'success', 'toil_heal 可运行');
  assert(healNpc.state.get('injuryLevel') === 1, 'toil_heal 降低伤势');
}

if (failed > 0) {
  console.error(`\nMonster hunt job tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nMonster hunt job tests passed');
