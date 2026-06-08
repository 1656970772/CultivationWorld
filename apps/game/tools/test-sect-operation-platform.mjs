#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { loadGameConfigsFromManifest } = await imp('js/core/data-manifest-loader.js');
const { Inventory } = await imp('js/engine/abstract/inventory.js');
const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { EconomicSystem } = await imp('js/engine/economy/transaction-engine.js');
const { QuestBoard } = await imp('js/engine/quest/quest-board.js');
const { ResourceRegenExecutor } = await imp('js/engine/world/world-rules.js');
const { TickManager } = await imp('js/engine/world/tick-manager.js');
const { SectConfigRegistry } = await imp('js/engine/sect/sect-config-registry.js');
const { defaultSectOperationRules, SectOperationRuleRegistry } = await imp('js/engine/sect/sect-operation-rules.js');
const { SectOperationService } = await imp('js/engine/sect/sect-operation-service.js');
const { SectEscrowHolderRepository } = await imp('js/engine/sect/sect-escrow-holder-repository.js');
const { SectBountyService } = await imp('js/engine/sect/sect-bounty-service.js');
const { acceptBoardQuest, acceptQuest, executeQuestDay, turnInQuest } = await imp('js/engine/npc/services/quest-service.js');
const { createQuestCompletionHandlerRegistry, defaultQuestCompletionHandler } = await imp('js/engine/quest/quest-completion-handlers.js');

const manifest = load('data/config/data-manifest.json');
const configs = await loadGameConfigsFromManifest(manifest, { basePath: GAME_ROOT, loadJson: load });
const sectRegistry = new SectConfigRegistry(configs);
sectRegistry.assertValid();

let failed = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

function must(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function entity(id, type, inventory = {}, state = {}, staticData = {}) {
  const e = {
    id,
    type,
    name: staticData.name || id,
    alive: true,
    inventory: new Inventory(),
    state: new RuntimeState(state),
    staticData,
  };
  e.inventory.loadFrom(inventory);
  return e;
}

const organization = must(configs.sectOrganization, '测试需要 manifest 输出 sectOrganization');
const operation = must(configs.balanceSectOperation, '测试需要 manifest 输出 balanceSectOperation');
const ranksData = must(configs.ranks, '测试需要 ranks 配置');
const currencyItemId = must(configs.economicTransactionConfig?.currencyItemId, '测试需要经济货币配置');
const firstSectConfig = (configs.factions || []).find(f => f.isSect === true && f.sectSeedProfileId);
const stockItemRule = (operation.stockPressure || []).find(r => r.kind === 'item');
const stockResourceRule = (operation.stockPressure || []).find(r => r.kind === 'faction_state_resource');
const bountyQuestTemplateId = operation.personalBounty?.allowedQuestTemplateIds?.[0];

must(firstSectConfig, '测试需要至少一个显式 isSect 且配置 seed profile 的宗门');
must(stockItemRule && stockResourceRule, '测试需要 item 与 faction_state_resource 两类库存压力配置');
must(operation.personalBounty, '测试需要 personalBounty 配置');
must(operation.decline, '测试需要 decline 配置');
must(operation.stipends?.roleStones, '测试需要 stipends.roleStones 配置');
must(operation.questBoard, '测试需要 questBoard 配置');
must(bountyQuestTemplateId, '测试需要 personalBounty.allowedQuestTemplateIds[0]');

function number(value, message) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(message || `测试需要有效数值: ${value}`);
  return n;
}

function getState(entity, key) {
  return Number(entity?.state?.get?.(key) || 0);
}

function sectStaticData(overrides = {}) {
  const data = {
    name: '测试宗门',
    isSect: true,
    sectTemplateId: firstSectConfig.sectTemplateId,
    sectSeedProfileId: firstSectConfig.sectSeedProfileId,
    ...overrides,
  };
  return {
    ...data,
    get(key) {
      return this[key];
    },
  };
}

function firstNonExemptRole() {
  return must(
    Object.keys(operation.stipends.roleStones)
      .find(role => !(operation.decline.exemptRoles || []).includes(role)),
    '测试需要至少一个非豁免身份月俸配置',
  );
}

function memberStoneDue(npc) {
  const role = must(npc.state.get('currentRole'), `NPC ${npc.id} 缺少 currentRole`);
  const roleStones = number(operation.stipends.roleStones[role], `缺少身份月俸配置: ${role}`);
  const extras = operation.stipends.hallExtraStones || {};
  const hallExtra = npc.state.get('hallId')
    ? (npc.state.get('isHallChief') === true
      ? number(extras.chief, '测试需要 hallExtraStones.chief')
      : number(extras.member, '测试需要 hallExtraStones.member'))
    : 0;
  return roleStones + hallExtra;
}

function memberPillDue(npc) {
  const rankId = must(npc.state.get('rankId'), `NPC ${npc.id} 缺少 rankId`);
  const rule = operation.stipends.rankPills?.[rankId];
  if (!rule?.itemId || !(Number(rule.quantity) > 0)) return null;
  return { itemId: rule.itemId, quantity: number(rule.quantity, `缺少 ${rankId} 丹药俸禄数量`) };
}

function worldPieces() {
  const economicSystem = new EconomicSystem({ config: configs.economicTransactionConfig });
  const questBoard = QuestBoard.fromConfig(operation.questBoard);
  const questCompletionHandlerRegistry = createQuestCompletionHandlerRegistry();
  for (const kind of new Set((operation.stockPressure || []).map(rule => rule.questKind).filter(Boolean))) {
    questCompletionHandlerRegistry.register(kind, defaultQuestCompletionHandler);
  }
  const ruleRegistry = new SectOperationRuleRegistry(defaultSectOperationRules({ config: operation }));
  const memberProvider = { aliveSectFactions: () => [], membersOf: () => [] };
  const service = new SectOperationService({
    config: operation,
    organization,
    ranksData,
    economicSystem,
    questBoard,
    ruleRegistry,
    memberProvider,
  });
  const escrowHolders = new SectEscrowHolderRepository({
    holderType: operation.personalBounty.escrowHolderType,
  });
  const bounty = new SectBountyService({
    config: operation.personalBounty,
    treasuryConfig: operation.treasury,
    ranksData,
    economicSystem,
    questBoard,
    escrowHolders,
  });
  questCompletionHandlerRegistry.register('personal_bounty', ({ questId, npc, completer, day } = {}) =>
    bounty.completePersonalBounty({
      day,
      questId,
      completer: completer || npc,
    }));
  return { economicSystem, questBoard, questCompletionHandlerRegistry, service, bounty };
}

function questWorldContext({ economicSystem, questBoard, questCompletionHandlerRegistry, bounty }, extra = {}) {
  return {
    rng: { next: () => 0, fn: () => 0 },
    currentDay: extra.currentDay ?? 71,
    questTemplates: configs.questTemplates,
    balanceConfig: {
      cultivation: {
        rankMaxDifficulty: Object.fromEntries(ranksData.map(rank => [rank.id, 9])),
      },
      economy: configs.balanceEconomy || {},
      sectOperation: operation,
    },
    economicSystem,
    questBoard,
    questCompletionHandlerRegistry,
    sectBountyService: bounty,
    entityRegistry: extra.entityRegistry || {
      getById(id) {
        return extra.entities?.[id] || null;
      },
      getAliveByType() {
        return [];
      },
    },
    resolveQuestLocation: extra.resolveQuestLocation || (() => null),
    ...extra,
  };
}

// 断言必须从 operation / organization / seed profile 推导，不写固定月俸、固定堂口、
// 固定物品或固定门派 ID。sect_test / npc_worker 只作为内存 fixture ID。

console.log('1) monthly stipend pays stones, pills and maintenance from config');
{
  const stoneResourceId = must(operation.treasury?.stoneResourceId, '测试需要 treasury.stoneResourceId');
  const pillRankEntry = must(
    Object.entries(operation.stipends.rankPills || {})
      .find(([, rule]) => rule?.itemId && Number(rule.quantity) > 0),
    '测试需要至少一条 rankPills 丹药俸禄配置',
  );
  const [pillRankId, pillRule] = pillRankEntry;
  const role = firstNonExemptRole();
  const hallId = must((organization.halls || [])[0]?.id || stockItemRule.issuerHall, '测试需要堂口配置');
  const territoryCount = Math.max(1, number(firstSectConfig.territoryCount || 1, '测试需要宗门 territoryCount'));
  const members = [
    entity('npc_chief', 'npc', {}, {
      factionId: 'sect_test',
      hasFaction: true,
      currentRole: role,
      rankId: pillRankId,
      hallId,
      isHallChief: true,
    }, { name: '堂主' }),
    entity('npc_member', 'npc', {}, {
      factionId: 'sect_test',
      hasFaction: true,
      currentRole: role,
      rankId: pillRankId,
      hallId,
      isHallChief: false,
    }, { name: '堂众' }),
  ];
  const expectedMemberStones = Object.fromEntries(members.map(npc => [npc.id, memberStoneDue(npc)]));
  const expectedMemberPills = Object.fromEntries(members.map(npc => [npc.id, must(
    memberPillDue(npc),
    `NPC ${npc.id} 需要 rankPills 丹药俸禄配置`,
  )]));
  const maintenanceDue = number(operation.maintenance?.baseStones, '测试需要 maintenance.baseStones')
    + territoryCount * number(operation.maintenance?.perTerritoryStones, '测试需要 maintenance.perTerritoryStones');
  const expectedStoneDue = Object.values(expectedMemberStones).reduce((sum, amount) => sum + amount, 0)
    + maintenanceDue;
  const expectedPillDue = Object.values(expectedMemberPills).reduce((sum, rule) => sum + rule.quantity, 0);
  const initialStone = expectedStoneDue + Math.max(1, expectedStoneDue);
  const faction = entity(
    'sect_test',
    'faction',
    { [pillRule.itemId]: expectedPillDue },
    { [stoneResourceId]: initialStone, stability: 80, territoryCount },
    sectStaticData(),
  );
  const { economicSystem, service } = worldPieces();
  const result = service.processMonthly({
    day: operation.monthlyIntervalDays,
    faction,
    members,
    rng: { next: () => 0 },
  }).monthly_stipend;
  ok(result.totalStoneDue === expectedStoneDue, '月俸和维护费应从配置合计应付灵石');
  ok(result.totalPillDue === expectedPillDue, '丹药俸禄应从 rankPills 配置合计');
  ok(faction.state.get(stoneResourceId) === initialStone - expectedStoneDue, '宗门 state 货币扣除月俸与维护费');
  ok(faction.inventory.getAmount(pillRule.itemId) === 0, '宗门 inventory 扣除丹药俸禄');
  for (const npc of members) {
    ok(npc.inventory.getAmount(stoneResourceId) === expectedMemberStones[npc.id], `${npc.id} 收到可消费 inventory 灵石俸禄`);
    ok(getState(npc, stoneResourceId) === 0, `${npc.id} 不把私人灵石俸禄写入 state 资源口径`);
    ok(npc.inventory.getAmount(expectedMemberPills[npc.id].itemId) === expectedMemberPills[npc.id].quantity, `${npc.id} 收到配置推导的丹药俸禄`);
  }
  ok(faction.state.get('sectSalaryShortfallStreak') === 0, '足额发放后灵石欠发 streak 清零');
  ok(faction.state.get('sectPillShortfallStreak') === 0, '足额发放后丹药欠发 streak 清零');
  ok(economicSystem.ledger.all().some(r => r.type === operation.treasury.stipendScenarioId && r.status === 'settled'), '月俸写入 settled 经济账本');
  ok(economicSystem.ledger.all().some(r => r.type === operation.treasury.pillScenarioId && r.status === 'settled'), '丹药俸禄写入 settled 经济账本');

  const shortFaction = entity(
    'sect_test_shortfall',
    'faction',
    { [pillRule.itemId]: 0 },
    { [stoneResourceId]: 0, stability: 80, territoryCount },
    sectStaticData({ name: '短缺宗门' }),
  );
  const shortMember = entity('npc_shortfall', 'npc', {}, {
    factionId: 'sect_test_shortfall',
    hasFaction: true,
    currentRole: role,
    rankId: pillRankId,
    hallId,
    isHallChief: false,
  }, { name: '欠发弟子' });
  const short = service.processMonthly({
    day: operation.monthlyIntervalDays * 2,
    faction: shortFaction,
    members: [shortMember],
    rng: { next: () => 0 },
  }).monthly_stipend;
  ok(short.stoneShort === true || short.pillShort === true, '资源不足时月度结果记录欠发');
  ok(
    shortFaction.state.get('sectSalaryShortfallStreak') > 0
      || shortFaction.state.get('sectPillShortfallStreak') > 0,
    '资源不足时欠发 streak 增长',
  );
  ok(
    economicSystem.ledger.all().some(r =>
      [operation.treasury.stipendScenarioId, operation.treasury.pillScenarioId].includes(r.type)
      && r.status === 'failed'
    ),
    '欠发时至少写入失败经济账本',
  );

  const invalidFaction = entity(
    'sect_test_invalid_member',
    'faction',
    { [pillRule.itemId]: expectedPillDue },
    { [stoneResourceId]: initialStone, stability: 80, territoryCount },
    sectStaticData({ name: '坏成员宗门' }),
  );
  const invalidMember = entity('npc_invalid_member', 'npc', {}, {
    factionId: 'sect_test_invalid_member',
    hasFaction: true,
    rankId: pillRankId,
  }, { name: '坏成员' });
  const invalidPieces = worldPieces();
  let invalidError = null;
  try {
    invalidPieces.service.processMonthly({
      day: operation.monthlyIntervalDays * 3,
      faction: invalidFaction,
      members: [invalidMember],
      rng: { next: () => 0 },
    });
  } catch (err) {
    invalidError = err;
  }
  ok(invalidError && invalidError.message.includes('currentRole'), '成员状态缺失时月俸规则先报配置/状态错误');
  ok(invalidFaction.state.get(stoneResourceId) === initialStone, '成员预校验失败不会先扣维护费或月俸');
  ok(invalidPieces.economicSystem.ledger.all().length === 0, '成员预校验失败不会留下半截经济账本');
}

console.log('2) stock pressure publishes hall quests only once');
{
  const faction = entity(
    'sect_test',
    'faction',
    { [stockItemRule.resourceId]: 0 },
    { [stockResourceRule.resourceId]: 0, stability: 70 },
    sectStaticData(),
  );
  const { service, questBoard } = worldPieces();
  const first = service.processMonthly({
    day: operation.monthlyIntervalDays,
    faction,
    members: [],
  }).stock_pressure;
  const second = service.processMonthly({
    day: operation.monthlyIntervalDays * 2,
    faction,
    members: [],
  }).stock_pressure;
  const open = questBoard.openFor({ factionId: 'sect_test' });
  ok(first.created.length >= 2, '配置中的库存安全线生成任务需求');
  ok(second.created.length === 0, '同一库存压力已有开放任务时不重复刷屏');
  ok(open.every(q => q.questKind === stockItemRule.questKind || q.questKind === stockResourceRule.questKind), '库存压力任务使用配置任务类型');
  ok(open.some(q => q.issuerId === stockItemRule.issuerHall), '物品压力由配置的堂口发布');
}

console.log('3) personal bounty escrows reward and releases to completer');
{
  const feeItemId = operation.personalBounty.feeItemId;
  const feeAmount = operation.personalBounty.feeAmount;
  const rewardAmount = feeAmount * 12;
  const eligibleRankId = ranksData.find(r => r.order >= operation.personalBounty.minRankOrder)?.id;
  const workerRankId = ranksData.find(r => r.order < operation.personalBounty.minRankOrder)?.id || eligibleRankId;
  const faction = entity('sect_test', 'faction', {}, { [currencyItemId]: 1000 }, sectStaticData());
  const issuer = entity(
    'npc_issuer',
    'npc',
    { [feeItemId]: rewardAmount + feeAmount },
    { factionId: 'sect_test', rankId: eligibleRankId },
    { name: '发布者' },
  );
  const worker = entity(
    'npc_worker',
    'npc',
    {},
    { factionId: 'sect_test', rankId: workerRankId },
    { name: '完成者' },
  );
  const { bounty, questBoard } = worldPieces();
  const created = bounty.createPersonalBounty({
    day: 40,
    faction,
    issuer,
    questTemplateId: bountyQuestTemplateId,
    difficulty: operation.personalBounty.defaultDifficulty,
    rewardAssets: [{ kind: 'item', itemId: feeItemId, quantity: rewardAmount }],
  });
  ok(created.success === true, '满足配置境界的修士可发布个人悬赏');
  ok(issuer.inventory.getAmount(feeItemId) === 0, '发布者支付手续费并托管奖励');
  ok(faction.state.get(currencyItemId) === 1000 + feeAmount, '手续费进入宗门货币 state');
  const boardQuest = questBoard.byId(created.questId);
  ok(boardQuest.questKind === 'personal_bounty', '个人悬赏进入统一任务列表');
  const done = bounty.completePersonalBounty({ day: 41, questId: created.questId, completer: worker });
  ok(done.success === true, '悬赏完成可释放托管奖励');
  ok(worker.inventory.getAmount(feeItemId) === rewardAmount, '完成者获得托管奖励');
}

console.log('4) repeated shortfall and low stability make disciple leave sect');
{
  const faction = entity('sect_test', 'faction', {}, {
    [currencyItemId]: 0,
    stability: operation.decline.stabilityForDeparture - 1,
    sectSalaryShortfallStreak: operation.decline.shortfallStreakForDeparture,
    sectPillShortfallStreak: operation.decline.shortfallStreakForDeparture,
  }, sectStaticData());
  const disciple = entity('npc_disciple', 'npc', {}, {
    factionId: 'sect_test',
    hasFaction: true,
    isWanderer: false,
    currentRole: Object.keys(operation.stipends.roleStones)
      .find(role => !(operation.decline.exemptRoles || []).includes(role)),
    rankId: ranksData[0].id,
  }, { name: '离宗弟子' });
  const { service } = worldPieces();
  const result = service.processMonthly({
    day: operation.monthlyIntervalDays,
    faction,
    members: [disciple],
    rng: { next: () => 0 },
  }).departure;
  ok(result.leftNpcIds.includes('npc_disciple'), '欠发且低稳定度触发弟子离宗');
  ok(disciple.state.get('factionId') === null, '离宗后清空 factionId');
  ok(disciple.state.get('isWanderer') === true, '离宗后转为散修');
}

console.log('5) QuestService accepts and turns in board quests');
{
  const faction = entity(
    'sect_test',
    'faction',
    { [stockItemRule.resourceId]: 0 },
    { [currencyItemId]: 1000, stability: 80 },
    sectStaticData(),
  );
  const workerRole = firstNonExemptRole();
  const workerRankId = ranksData.find(r => r.order >= organization.hallMembership.minRankOrder)?.id || ranksData[0].id;
  const npc = entity('npc_worker', 'npc', {}, {
    factionId: 'sect_test',
    hasFaction: true,
    currentRole: workerRole,
    rankId: workerRankId,
  }, { name: '接单弟子' });
  const pieces = worldPieces();
  pieces.service.processMonthly({ day: operation.monthlyIntervalDays, faction, members: [npc] });
  const bountyBoardName = operation.personalBounty.defaultQuestBoard || 'bounty';
  const highPriorityBountyBoardQuest = pieces.questBoard.publish({
    day: 31,
    factionId: 'sect_test',
    issuerType: 'hall',
    issuerId: 'bounty_hall',
    issuerName: '悬赏堂',
    questBoard: bountyBoardName,
    questKind: 'generic_task',
    questTemplateId: bountyQuestTemplateId,
    difficulty: 1,
    priority: 999,
    rewardContribution: 1,
    dedupeKey: 'test:high_priority_bounty_board',
  });
  const open = pieces.questBoard.openFor({ factionId: 'sect_test' });
  ok(open.length > 0, '任务板存在开放任务');
  const expectedQuest = open.find(q => q.questBoard !== bountyBoardName);
  ok(highPriorityBountyBoardQuest?.id && expectedQuest?.id, '测试同时存在高优先级悬赏板任务与宗门任务');
  const invalidDifficultyQuest = pieces.questBoard.publish({
    day: 32,
    factionId: 'sect_test',
    issuerType: 'hall',
    issuerId: 'test_hall',
    issuerName: '测试堂',
    questKind: stockItemRule.questKind,
    questTemplateId: stockItemRule.questTemplateId,
    difficulty: 99,
    priority: 1000,
    rewardContribution: 99,
    dedupeKey: 'test:invalid_board_difficulty',
  });
  ok(invalidDifficultyQuest?.id, '测试存在超出模板范围的高优先级任务');
  const directInvalid = acceptBoardQuest(npc, questWorldContext(pieces), invalidDifficultyQuest);
  ok(directInvalid.success === false && directInvalid.reason === 'board_quest_difficulty_out_of_range', '直接接取超出模板范围的任务会失败');
  const expectedBoardContribution = Number(expectedQuest.rewardContribution || 0);
  const accepted = acceptQuest(npc, questWorldContext(pieces));
  ok(accepted.success === true, 'QuestService 可从任务板接取任务');
  ok(accepted.boardQuestId === expectedQuest.id, 'QuestService 按配置来源顺序接取宗门任务，跳过高优先级悬赏板和非法难度任务');
  ok(npc.state.get('activeBoardQuestId') === expectedQuest.id, '接取后写入 activeBoardQuestId');
  npc.state.set('questDaysRemaining', 1);
  const executed = executeQuestDay(npc, questWorldContext(pieces, {
    currentDay: 72,
    rng: { next: () => 0.99, fn: () => 0.99 },
  }));
  ok(executed.success === true && executed.outcome === 'complete', 'QuestService 可执行任务板任务到完成');
  const turnedIn = turnInQuest(npc, questWorldContext(pieces, {
    currentDay: 73,
    entities: { sect_test: faction },
  }));
  const boardAfter = pieces.questBoard.byId(expectedQuest.id);
  ok(turnedIn.success === true, 'QuestService 可交付任务板任务');
  ok(turnedIn.boardQuestId === expectedQuest.id, 'turnInQuest 返回任务板 ID');
  ok(expectedBoardContribution > 0 && npc.state.get('contribution') === expectedBoardContribution, '任务板贡献奖励覆盖模板默认贡献');
  ok(npc.state.get('monthlyContribution') === expectedBoardContribution, '任务板贡献奖励同步月贡献');
  ok(boardAfter.state === 'turned_in', '交付后任务板任务进入已交付状态');

  const blockedNpc = entity('npc_missing_handler', 'npc', {}, {
    factionId: 'sect_test',
    hasFaction: true,
    currentRole: workerRole,
    rankId: workerRankId,
  }, { name: '缺处理器弟子' });
  const blockedPieces = worldPieces();
  const missingHandlerQuest = blockedPieces.questBoard.publish({
    day: 74,
    factionId: 'sect_test',
    issuerType: 'hall',
    issuerId: 'test_hall',
    issuerName: '测试堂',
    questKind: 'unregistered_task',
    questTemplateId: stockItemRule.questTemplateId,
    difficulty: stockItemRule.difficultyBySeverity?.safe || 1,
    priority: 999,
    rewardContribution: 1,
    dedupeKey: 'test:missing_completion_handler',
  });
  ok(missingHandlerQuest?.id, '真实 registry 缺处理器场景发布未注册 kind 任务');
  const blockedAccepted = acceptQuest(blockedNpc, questWorldContext(blockedPieces));
  ok(blockedAccepted.success === true && blockedAccepted.boardQuestId === missingHandlerQuest.id, '缺处理器场景先成功接取未注册 kind 任务');
  blockedNpc.state.set('questDaysRemaining', 1);
  executeQuestDay(blockedNpc, questWorldContext(blockedPieces, {
    currentDay: 72,
    rng: { next: () => 0.99, fn: () => 0.99 },
  }));
  const blockedTurnIn = turnInQuest(blockedNpc, questWorldContext(blockedPieces, {
    currentDay: 73,
  }));
  ok(blockedTurnIn.success === false && String(blockedTurnIn.reason).startsWith('quest_completion_handler_missing'), '缺少任务板交付处理器时明确失败');
  ok(blockedNpc.state.get('activeBoardQuestId') === missingHandlerQuest.id && blockedNpc.state.get('hasActiveQuest') === true, '缺处理器失败不会重置任务状态');
}

console.log('6) personal bounty turn-in only releases escrow reward');
{
  const feeItemId = operation.personalBounty.feeItemId;
  const feeAmount = operation.personalBounty.feeAmount;
  const rewardAmount = feeAmount * 9;
  const eligibleRankId = ranksData.find(r => r.order >= operation.personalBounty.minRankOrder)?.id;
  const faction = entity('sect_test', 'faction', {}, { [currencyItemId]: 1000 }, sectStaticData());
  const issuer = entity(
    'npc_issuer_service',
    'npc',
    { [feeItemId]: rewardAmount + feeAmount },
    { factionId: 'sect_test', rankId: eligibleRankId },
    { name: '悬赏发布者' },
  );
  const worker = entity(
    'npc_bounty_worker',
    'npc',
    {},
    { factionId: 'sect_test', rankId: eligibleRankId, contribution: 0, monthlyContribution: 0 },
    { name: '悬赏完成者' },
  );
  const pieces = worldPieces();
  const created = pieces.bounty.createPersonalBounty({
    day: 80,
    faction,
    issuer,
    questTemplateId: bountyQuestTemplateId,
    difficulty: operation.personalBounty.defaultDifficulty,
    rewardAssets: [{ kind: 'item', itemId: feeItemId, quantity: rewardAmount }],
  });
  ok(created.success === true, '个人悬赏可发布到任务板');
  const accepted = acceptQuest(worker, questWorldContext(pieces, {
    currentDay: 81,
    entities: { sect_test: faction },
  }));
  ok(accepted.success === true && accepted.boardQuestId === created.questId, 'QuestService 可接取个人悬赏');
  worker.state.set('questDaysRemaining', 1);
  executeQuestDay(worker, questWorldContext(pieces, { currentDay: 82 }));
  const beforeInventory = worker.inventory.getAmount(feeItemId);
  const turnedIn = turnInQuest(worker, questWorldContext(pieces, {
    currentDay: 83,
    entities: { sect_test: faction },
  }));
  ok(turnedIn.success === true, 'QuestService 可交付个人悬赏');
  ok(worker.inventory.getAmount(feeItemId) - beforeInventory === rewardAmount, '个人悬赏只释放托管奖励');
  ok(turnedIn.rewardStones === 0 && turnedIn.rewardContribution === 0 && turnedIn.factionStones === 0, '个人悬赏不叠加普通模板奖励或贡献');
  ok(worker.state.get('contribution') === 0 && worker.state.get('monthlyContribution') === 0, '个人悬赏不写普通贡献点');
}

console.log('7) world resource regen uses faction state as the single resource source');
{
  const faction = entity(
    'sect_state_source',
    'faction',
    { low_spirit_stone: 100, food: 50, disciples: 10 },
    { low_spirit_stone: 100, food: 50, disciples: 10, territoryCount: 1, stability: 60 },
    sectStaticData({ name: '资源口径宗门' }),
  );
  const member = entity('npc_state_source', 'npc', {}, { factionId: faction.id }, { name: '资源口径弟子' });
  const executor = new ResourceRegenExecutor();
  executor.run(null, {
    entityRegistry: {
      getAliveByType(type) {
        if (type === 'faction') return [faction];
        if (type === 'npc') return [member];
        return [];
      },
    },
    balanceConfig: {
      economy: {
        resourceRegen: {
          foodPerTerritory: 2,
          stonePerTerritory: 3,
          disciplesPerDay: 4,
          maxDisciplesBase: 100,
          maxDisciplesPerTerritory: 100,
          discipleNpcRatio: 100,
          discipleRegressRate: 3,
          discipleFloor: 0,
        },
        dailyCosts: {
          foodPerDisciple: 0,
          foodPerTerritory: 0,
          stonePerDisciple: 0,
          stonePerTerritory: 0,
          minDisciplesForFoodCost: 999,
        },
        stability: {
          naturalRecoveryMax: 80,
          naturalRecoveryRate: 0,
          decayThreshold: 100,
          decayRate: 0,
        },
      },
    },
    factionVeinOutput: new Map(),
    worldState: null,
  }, {});
  ok(faction.state.get('low_spirit_stone') === 103, '世界灵石再生写入 faction state');
  ok(faction.state.get('food') === 52, '世界粮食再生写入 faction state');
  ok(faction.state.get('disciples') === 14, '纸面弟子增长写入 faction state');
}

console.log('8) tick manager without sect config keeps non-sect test worlds runnable');
{
  const worldState = new RuntimeState({ currentDay: 0 });
  const worldEntity = {
    state: worldState,
    get currentDay() {
      return this.state.get('currentDay') || 0;
    },
    tick() {
      this.state.set('currentDay', this.currentDay + 1);
      return { rules: [] };
    },
  };
  const emptyRegistry = {
    getAliveByType() {
      return [];
    },
    getByType() {
      return [];
    },
    getById() {
      return null;
    },
  };
  const tickManager = new TickManager({
    entityRegistry: emptyRegistry,
    worldEntity,
    balanceConfig: {},
  });
  let tickError = null;
  try {
    tickManager.tick();
  } catch (err) {
    tickError = err;
  }
  ok(tickError === null, '缺少 sectOperation 配置且没有门派时 tick 不应抛错');
}

if (failed > 0) {
  console.error(`\n门派运行平台测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n门派运行平台测试通过');
