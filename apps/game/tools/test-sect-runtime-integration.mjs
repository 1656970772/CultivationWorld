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

const configs = await loadGameConfigsFromManifest(load('data/config/data-manifest.json'), {
  basePath: GAME_ROOT,
  loadJson: load,
});
configs.seed = 20260607;

const configuredSect = (configs.factions || [])
  .find(f => f.isSect === true && f.sectSeedProfileId);
const expectedInventoryProfile = configuredSect
  ? configs.sectSeedProfiles?.inventoryProfiles?.[configuredSect.sectSeedProfileId] || {}
  : {};
const monthlyIntervalDays = configs.balanceSectOperation?.monthlyIntervalDays;
const stipendLedgerType = configs.balanceSectOperation?.treasury?.stipendScenarioId;
const stockPressureRules = configs.balanceSectOperation?.stockPressure || [];

const engine = new WorldEngine();
engine.init(configs);

const sect = engine.entityRegistry.getByType('faction')
  .find(f => f.id === configuredSect?.id && f.staticData?.get?.('isSect') === true);

ok(!!engine.tickManager.questBoard, 'TickManager 初始化统一任务列表');
ok(!!engine.tickManager.sectOperationService, 'TickManager 初始化门派运行服务');
ok(!!sect, '可从显式 isSect 配置找到宗门');
ok(
  Object.entries(expectedInventoryProfile)
    .some(([itemId, amount]) => amount > 0 && (sect?.inventory?.getAmount(itemId) || 0) > 0),
  '宗门初始背包按 seed profile 加载实物库存',
);

engine.multiTick(35);
const monthlyLedger = engine.economicSystem.ledger.all()
  .filter(r => Boolean(stipendLedgerType) && r.type === stipendLedgerType);
const boardOpen = engine.tickManager.questBoard?.openFor?.({ factionId: sect?.id }) || [];
ok(monthlyLedger.length > 0, '真实 tick 产生月俸账本');
ok(
  Number.isFinite(monthlyIntervalDays) && sect?.state?.get('sectLastMonthlyDay') === monthlyIntervalDays,
  '宗门记录最近月度结算日',
);
ok(
  stockPressureRules.some(rule => boardOpen.some(q =>
    q.questKind === rule.questKind
    && q.issuerId === rule.issuerHall
    && q.issuerType === 'hall'
  )),
  '库存压力可生成配置堂口任务',
);

if (failed > 0) {
  console.error(`\n门派运行集成测试失败：${failed} 项`);
  process.exit(1);
}
console.log('\n门派运行集成测试通过');
