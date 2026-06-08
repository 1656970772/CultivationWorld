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
const { createQuestCompletionHandlerRegistry } = await imp('js/engine/quest/quest-completion-handlers.js');
const { SectEscrowHolderRepository } = await imp('js/engine/sect/sect-escrow-holder-repository.js');
const { SectBountyService } = await imp('js/engine/sect/sect-bounty-service.js');
const { TickManager } = await imp('js/engine/world/tick-manager.js');

const manifest = load('data/config/data-manifest.json');
const configs = await loadGameConfigsFromManifest(manifest, { basePath: GAME_ROOT, loadJson: load });
const operation = configs.balanceSectOperation;
const bountyConfig = operation.personalBounty;
const currencyItemId = configs.economicTransactionConfig.currencyItemId;
const questTemplateId = bountyConfig.allowedQuestTemplateIds[0];
const eligibleRankId = configs.ranks.find(rank => rank.order >= bountyConfig.minRankOrder)?.id;
if (!eligibleRankId) throw new Error('测试需要满足个人悬赏发布条件的境界');

let failed = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
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

function worldPieces() {
  const economicSystem = new EconomicSystem({ config: configs.economicTransactionConfig });
  const questBoard = QuestBoard.fromConfig(operation.questBoard);
  const escrowHolders = new SectEscrowHolderRepository({
    holderType: bountyConfig.escrowHolderType,
  });
  const bounty = new SectBountyService({
    config: bountyConfig,
    treasuryConfig: operation.treasury,
    ranksData: configs.ranks,
    economicSystem,
    questBoard,
    escrowHolders,
  });
  return { economicSystem, questBoard, escrowHolders, bounty };
}

function bountyActors({ issuerStones = 1000, factionStones = 100 } = {}) {
  const faction = entity('sect_bounty_test', 'faction', {}, { [currencyItemId]: factionStones }, {
    get(key) { return this[key]; },
    isSect: true,
  });
  const issuer = entity('npc_bounty_issuer', 'npc', { [currencyItemId]: issuerStones }, {
    factionId: faction.id,
    rankId: eligibleRankId,
  });
  const completer = entity('npc_bounty_worker', 'npc', {}, {
    factionId: faction.id,
    rankId: eligibleRankId,
  });
  const stranger = entity('npc_bounty_stranger', 'npc', {}, {
    factionId: faction.id,
    rankId: eligibleRankId,
  });
  return { faction, issuer, completer, stranger };
}

function createBounty(bounty, { faction, issuer, reward = 100, dedupeKey = null, day = 1 } = {}) {
  return bounty.createPersonalBounty({
    day,
    faction,
    issuer,
    questTemplateId,
    rewardAssets: [{ kind: 'item', itemId: currencyItemId, quantity: reward }],
    dedupeKey,
  });
}

console.log('1) QuestBoard generic defaults and terminal guards stay domain-neutral');
{
  const board = QuestBoard.fromConfig({});
  const quest = board.publish({ questTemplateId: 'qt_test_generic' });
  ok(quest.questBoard === 'general', '通用 QuestBoard 默认 board 不带门派语义');
  ok(quest.questKind === 'generic_task', '通用 QuestBoard 默认 kind 不带门派语义');
  board.accept(quest.id, { id: 'npc_a' }, 1);
  board.complete(quest.id, { id: 'npc_a' }, 2);
  board.turnIn(quest.id, { id: 'npc_a' }, 3);
  const failedTurnedIn = board.fail(quest.id, 'late_failure', 4);
  ok(failedTurnedIn.success === false, '已交付任务不能再被 fail 改写终态');
}

console.log('2) duplicate personal bounty does not leak fee or reward escrow');
{
  const { bounty } = worldPieces();
  const actors = bountyActors();
  const first = createBounty(bounty, { ...actors, reward: 100, dedupeKey: 'same_bounty' });
  ok(first.success === true, '首次悬赏发布成功');
  actors.issuer.inventory.add(currencyItemId, 105);
  const beforeIssuer = actors.issuer.inventory.getAmount(currencyItemId);
  const beforeFaction = actors.faction.state.get(currencyItemId);
  const duplicate = createBounty(bounty, { ...actors, reward: 100, dedupeKey: 'same_bounty', day: 2 });
  ok(duplicate.success === false && duplicate.reason === 'quest_deduped', '重复悬赏被任务板去重拒绝');
  ok(actors.issuer.inventory.getAmount(currencyItemId) === beforeIssuer, '重复发布失败不会扣发布者手续费或奖励');
  ok(actors.faction.state.get(currencyItemId) === beforeFaction, '重复发布失败不会让宗门多收手续费');
}

console.log('3) expired bounty cannot release reward to completer');
{
  const { bounty, questBoard } = worldPieces();
  const actors = bountyActors();
  const created = createBounty(bounty, { ...actors, reward: 80 });
  questBoard.expire(created.questId, 5, 'timeout');
  const done = bounty.completePersonalBounty({ day: 6, questId: created.questId, completer: actors.completer });
  ok(done.success === false, '过期悬赏完成失败');
  ok(actors.completer.inventory.getAmount(currencyItemId) === 0, '过期悬赏不会释放托管奖励');
}

console.log('4) only original issuer can cancel and receive refund');
{
  const { bounty } = worldPieces();
  const actors = bountyActors();
  const created = createBounty(bounty, { ...actors, reward: 90 });
  const strangerCancel = bounty.cancelPersonalBounty({ day: 3, questId: created.questId, issuer: actors.stranger });
  ok(strangerCancel.success === false && strangerCancel.reason === 'issuer_mismatch', '非发布者不能取消悬赏');
  ok(actors.stranger.inventory.getAmount(currencyItemId) === 0, '非发布者取消不会拿到退款');
  const issuerBefore = actors.issuer.inventory.getAmount(currencyItemId);
  const issuerCancel = bounty.cancelPersonalBounty({ day: 4, questId: created.questId, issuer: actors.issuer });
  ok(issuerCancel.success === true, '原发布者可以取消悬赏');
  ok(actors.issuer.inventory.getAmount(currencyItemId) === issuerBefore + 90, '取消退款回到原发布者');
}

console.log('5) personal bounty completion handler is registered by TickManager');
{
  const tm = new TickManager({
    entityRegistry: { getByType: () => [], getAliveByType: () => [] },
    worldEntity: { currentDay: 0 },
    ranksData: configs.ranks,
    balanceConfig: { sectOperation: operation },
    economicSystem: new EconomicSystem({ config: configs.economicTransactionConfig }),
    economicTransactionConfig: configs.economicTransactionConfig,
  });
  ok(tm.questCompletionHandlerRegistry.has('personal_bounty'), 'TickManager 注册个人悬赏完成处理器');
}

console.log('6) default completion handler refuses escrowed quests');
{
  const board = QuestBoard.fromConfig(operation.questBoard);
  const quest = board.publish({
    state: 'accepted',
    questKind: 'personal_bounty',
    questBoard: 'bounty',
    questTemplateId,
    escrowId: 'escrow_test',
    escrowRefs: ['escrow_test'],
  });
  const registry = createQuestCompletionHandlerRegistry();
  const result = registry.get('default')({
    questBoard: board,
    questId: quest.id,
    npc: { id: 'npc_default_worker' },
    day: 9,
  });
  ok(result.success === false && result.reason === 'quest_completion_handler_required', '默认完成处理器不直接完成托管任务');
}

console.log('7) personal bounty rewards stay privately transferable items');
{
  ok(
    bountyConfig.allowedRewardKinds.every(kind => kind === 'item'),
    '个人悬赏奖励配置只允许 item，避免把 NPC state 当作势力资源写入',
  );
  const { bounty } = worldPieces();
  const actors = bountyActors();
  const result = bounty.createPersonalBounty({
    day: 1,
    faction: actors.faction,
    issuer: actors.issuer,
    questTemplateId,
    rewardAssets: [{ kind: 'faction_state_resource', itemId: currencyItemId, quantity: 10 }],
  });
  ok(result.success === false && result.reason === 'reward_kind_not_allowed', '非 item 托管奖励会被拒绝');
}

if (failed > 0) {
  console.error(`\n门派个人悬赏托管测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n门派个人悬赏托管测试通过');
