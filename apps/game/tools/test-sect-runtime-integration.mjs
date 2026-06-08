#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { loadGameConfigsFromManifest } = await imp('js/core/data-manifest-loader.js');
const { WorldEngine } = await imp('js/engine/world-engine.js');

let failed = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

function positiveInventoryEntries(profile = {}) {
  return Object.entries(profile)
    .filter(([, amount]) => Number(amount) > 0);
}

function resolveExpectedInventoryProfile(configs, factionConfig, seedProfileId) {
  if (!seedProfileId) return null;
  const baseProfile = configs.sectSeedProfiles?.inventoryProfiles?.[seedProfileId];
  if (!baseProfile) return null;
  return {
    ...baseProfile,
    ...(factionConfig?.inventoryOverrides || {}),
  };
}

const configs = await loadGameConfigsFromManifest(load('data/config/data-manifest.json'), {
  basePath: GAME_ROOT,
  loadJson: load,
});
configs.seed = 20260607;

const configuredSect = (configs.factions || [])
  .find(f => f.isSect === true && f.sectSeedProfileId);
const daysToRun = Number(configs.balanceSectOperation?.monthlyIntervalDays);
const stipendLedgerType = configs.balanceSectOperation?.treasury?.stipendScenarioId;
const stoneResourceId = configs.balanceSectOperation?.treasury?.stoneResourceId;
const stockPressureRules = configs.balanceSectOperation?.stockPressure || [];
const forcedStockRule = stockPressureRules.find(rule => rule.kind === 'item')
  || stockPressureRules.find(rule => rule.kind === 'faction_state_resource');

const engine = new WorldEngine();
engine.init(configs);

const sect = engine.entityRegistry.getByType('faction')
  .find(f => f.id === configuredSect?.id && f.staticData?.get?.('isSect') === true);
const sectSeedProfileId = sect?.staticData?.get?.('sectSeedProfileId') || configuredSect?.sectSeedProfileId;
const expectedInventoryProfile = resolveExpectedInventoryProfile(configs, configuredSect, sectSeedProfileId);
const expectedInventoryItems = positiveInventoryEntries(expectedInventoryProfile || {});

ok(!!engine.tickManager.questBoard, 'TickManager 初始化统一任务列表');
ok(!!engine.tickManager.sectOperationService, 'TickManager 初始化门派运行服务');
ok(!!sect, '可从显式 isSect 配置找到宗门');
ok(
  expectedInventoryItems.length > 0
    && expectedInventoryItems.every(([itemId, amount]) => sect?.inventory?.getAmount(itemId) === Number(amount)),
  '宗门初始背包按 seed profile 全量加载正数实物库存',
);

ok(Number.isFinite(daysToRun) && daysToRun > 0, '从 balanceSectOperation.monthlyIntervalDays 推导运行天数');
if (sect && forcedStockRule?.kind === 'item') {
  sect.inventory?.setAmount?.(forcedStockRule.resourceId, 0);
} else if (sect && forcedStockRule?.kind === 'faction_state_resource') {
  sect.state?.set?.(forcedStockRule.resourceId, 0);
  sect.inventory?.setAmount?.(forcedStockRule.resourceId, 0);
}
engine.multiTick(Number.isFinite(daysToRun) && daysToRun > 0 ? daysToRun : 0);
const monthlyLedger = engine.economicSystem.ledger.all()
  .filter(r => Boolean(stipendLedgerType) && r.type === stipendLedgerType);
const boardOpen = engine.tickManager.questBoard?.openFor?.({ factionId: sect?.id }) || [];
const snapshot = engine.getWorldSnapshot();
ok(monthlyLedger.length > 0, '真实 tick 产生月俸账本');
ok(
  Number.isFinite(daysToRun) && sect?.state?.get('sectLastMonthlyDay') === daysToRun,
  '宗门记录最近月度结算日',
);
ok(
  Boolean(stoneResourceId)
    && snapshot.factions?.[sect?.id]?.resources?.[stoneResourceId] === sect?.state?.get?.(stoneResourceId),
  '月度结算当日快照资源与宗门 state 国库一致',
);
ok(
  Boolean(forcedStockRule) && boardOpen.some(q =>
    q.questKind === forcedStockRule.questKind
    && q.issuerId === forcedStockRule.issuerHall
    && q.issuerType === 'hall'
  ),
  '库存压力可生成配置堂口任务',
);

if (failed > 0) {
  console.error(`\n门派运行集成测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n门派运行集成测试通过');
