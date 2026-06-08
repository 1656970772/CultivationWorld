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
const { SectConfigRegistry } = await imp('js/engine/sect/sect-config-registry.js');
const { defaultSectOperationRules, SectOperationRuleRegistry } = await imp('js/engine/sect/sect-operation-rules.js');
const { SectOperationService } = await imp('js/engine/sect/sect-operation-service.js');
const { SectEscrowHolderRepository } = await imp('js/engine/sect/sect-escrow-holder-repository.js');
const { SectBountyService } = await imp('js/engine/sect/sect-bounty-service.js');

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
const bountyQuestTemplateId = operation.personalBounty?.allowedQuestTemplateIds?.[0]
  || stockItemRule?.questTemplateId;

must(firstSectConfig, '测试需要至少一个显式 isSect 且配置 seed profile 的宗门');
must(stockItemRule && stockResourceRule, '测试需要 item 与 faction_state_resource 两类库存压力配置');
must(operation.personalBounty, '测试需要 personalBounty 配置');
must(operation.decline, '测试需要 decline 配置');
must(operation.stipends?.roleStones, '测试需要 stipends.roleStones 配置');
must(operation.questBoard, '测试需要 questBoard 配置');
must(bountyQuestTemplateId, '测试需要个人悬赏任务模板配置');

function worldPieces() {
  const economicSystem = new EconomicSystem({ config: configs.economicTransactionConfig });
  const questBoard = QuestBoard.fromConfig(operation.questBoard);
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
  return { economicSystem, questBoard, service, bounty };
}

// 断言必须从 operation / organization / seed profile 推导，不写固定月俸、固定堂口、
// 固定物品或固定门派 ID。sect_test / npc_worker 只作为内存 fixture ID。

console.log('1) stock pressure publishes hall quests only once');
{
  const faction = entity(
    'sect_test',
    'faction',
    { [stockItemRule.resourceId]: 0 },
    { [stockResourceRule.resourceId]: 0, stability: 70 },
    { name: '测试宗门' },
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

console.log('2) personal bounty escrows reward and releases to completer');
{
  const feeItemId = operation.personalBounty.feeItemId;
  const feeAmount = operation.personalBounty.feeAmount;
  const rewardAmount = feeAmount * 12;
  const eligibleRankId = ranksData.find(r => r.order >= operation.personalBounty.minRankOrder)?.id;
  const workerRankId = ranksData.find(r => r.order < operation.personalBounty.minRankOrder)?.id || eligibleRankId;
  const faction = entity('sect_test', 'faction', {}, { [currencyItemId]: 1000 }, { name: '测试宗门' });
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

console.log('3) repeated shortfall and low stability make disciple leave sect');
{
  const faction = entity('sect_test', 'faction', {}, {
    [currencyItemId]: 0,
    stability: operation.decline.stabilityForDeparture - 1,
    sectSalaryShortfallStreak: operation.decline.shortfallStreakForDeparture,
    sectPillShortfallStreak: operation.decline.shortfallStreakForDeparture,
  }, { name: '测试宗门' });
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

if (failed > 0) {
  console.error(`\n门派运行平台测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n门派运行平台测试通过');
