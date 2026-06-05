#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { JobPool } = await imp('js/engine/pools/job-pool.js');
const { ToilPool } = await imp('js/engine/pools/toil-pool.js');
const { JobSystem } = await imp('js/engine/abstract/job-system.js');
const { registerNPCToilExecutors } = await imp('js/engine/npc/toils/npc-toils.js');
const { ToilResultStatus } = await imp('js/engine/abstract/toil.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

class TestState {
  constructor(values = {}) { this._values = { ...values }; }
  get(key) { return this._values[key]; }
  set(key, value) { this._values[key] = value; }
}

class TestInventory {
  constructor(values = {}) { this._values = { ...values }; }
  getAmount(id) { return this._values[id] || 0; }
  add(id, amount = 1) { this._values[id] = this.getAmount(id) + amount; }
  remove(id, amount = 1) {
    if (this.getAmount(id) < amount) return false;
    this._values[id] = this.getAmount(id) - amount;
    return true;
  }
  has(id, amount = 1) { return this.getAmount(id) >= amount; }
}

function makeEntity(id, { inventory = {}, state = {} } = {}) {
  return {
    id,
    inventory: new TestInventory(inventory),
    state: new TestState(state),
  };
}

function resetPools() {
  JobPool.clear();
  ToilPool.clear();
  ToilPool.loadFromConfig({ toils: [
    { id: 'toil_check_inventory_item', name: '检查物品' },
    { id: 'toil_ensure_item', name: '确保物品' },
    { id: 'toil_check_currency', name: '检查货币' },
    { id: 'toil_buy_item', name: '购买物品' },
    { id: 'toil_exchange_faction_item', name: '兑换宗门物品' },
    { id: 'toil_ensure_artifact', name: '确保法器' },
    { id: 'toil_check_equipped_artifact', name: '检查装备法器' },
    { id: 'toil_equip_artifact', name: '装备法器' },
    { id: 'toil_select_companion', name: '选择同行者' },
    { id: 'toil_request_companion', name: '请求同行' },
  ] });
  registerNPCToilExecutors();
}

function runJob(jobId, entity, worldContext = {}, input = {}) {
  const system = new JobSystem();
  system.start(jobId, input);
  return system.executeStep(entity, worldContext);
}

resetPools();

console.log('1) ensure item 会购买缺失回血丹并在 Job 完成后应用 successEffects');
JobPool.loadFromConfig({ jobs: [{
  id: 'job_test_ensure_heal_pill',
  name: '确保回血丹',
  successEffects: { hasHealPill: { op: 'set', value: true } },
  toils: [{
    id: 'ensure_pill',
    type: 'toil_ensure_item',
    params: { itemId: 'pill_rejuvenation', minAmount: 1, priceItemId: 'low_spirit_stone', priceAmount: 3 },
  }],
}] });
let entity = makeEntity('npc_buyer', { inventory: { low_spirit_stone: 5 }, state: { hasHealPill: false } });
let result = runJob('job_test_ensure_heal_pill', entity);
assert(result.status === 'success', '确保物品 Job 成功完成');
assert(result.reason === 'job_completed', 'JobSystem 报告完成原因');
assert(entity.inventory.getAmount('pill_rejuvenation') === 1, '背包新增 1 个回血丹');
assert(entity.inventory.getAmount('low_spirit_stone') === 2, '扣除 3 个下品灵石');
assert(entity.state.get('hasHealPill') === true, 'Job successEffects 生效');

console.log('2) 已有物品时 ensure item 不购买也不扣灵石');
entity = makeEntity('npc_has_item', { inventory: { pill_rejuvenation: 1, low_spirit_stone: 5 }, state: {} });
result = runJob('job_test_ensure_heal_pill', entity);
assert(result.status === 'success', '已有物品也能成功完成');
assert(entity.inventory.getAmount('pill_rejuvenation') === 1, '回血丹数量保持不变');
assert(entity.inventory.getAmount('low_spirit_stone') === 5, '灵石没有被扣除');

console.log('3) 购买并装备法器分两步推进，最终写 equippedArtifactId 和 successEffects');
JobPool.loadFromConfig({ jobs: [{
  id: 'job_test_buy_and_equip_artifact',
  name: '购买并装备法器',
  successEffects: { artifactReady: { op: 'set', value: true } },
  toils: [
    {
      id: 'ensure_artifact',
      type: 'toil_ensure_artifact',
      params: { itemId: 'artifact_green_sword', minAmount: 1, priceItemId: 'low_spirit_stone', priceAmount: 4 },
    },
    { id: 'equip_artifact', type: 'toil_equip_artifact', params: { itemId: 'artifact_green_sword' } },
  ],
}] });
entity = makeEntity('npc_artifact', { inventory: { low_spirit_stone: 4 }, state: { artifactReady: false } });
const system = new JobSystem();
system.start('job_test_buy_and_equip_artifact');
result = system.executeStep(entity, {});
assert(result.status === 'running', '第一步购买完成后进入装备步骤');
assert(system.snapshot().currentToilId === 'equip_artifact', '当前 Toil 推进到 equip');
assert(entity.inventory.getAmount('artifact_green_sword') === 1, '背包获得法器');
result = system.executeStep(entity, {});
assert(result.status === 'success', '第二步装备后 Job 成功');
assert(entity.state.get('equippedArtifactId') === 'artifact_green_sword', '写入 equippedArtifactId');
assert(entity.state.get('artifactReady') === true, '装备 Job successEffects 生效');

console.log('4) 货币不足时 ensure/buy 失败并报告 insufficient_currency');
entity = makeEntity('npc_poor_ensure', { inventory: { low_spirit_stone: 2 }, state: {} });
result = runJob('job_test_ensure_heal_pill', entity);
assert(result.status === 'failed', 'ensure item 货币不足时失败');
assert(result.reason === 'insufficient_currency', 'ensure item 失败原因为 insufficient_currency');
JobPool.loadFromConfig({ jobs: [{
  id: 'job_test_buy_pill',
  name: '直接买药',
  toils: [{
    id: 'buy_pill',
    type: 'toil_buy_item',
    params: { itemId: 'pill_rejuvenation', amount: 1, priceItemId: 'low_spirit_stone', priceAmount: 4 },
  }],
}] });
entity = makeEntity('npc_poor_buy', { inventory: { low_spirit_stone: 1 }, state: {} });
result = runJob('job_test_buy_pill', entity);
assert(result.status === 'failed', 'buy item 货币不足时失败');
assert(result.reason === 'insufficient_currency', 'buy item 失败原因为 insufficient_currency');

console.log('5) select/request companion 能从 entityRegistry 选择同行者并写 lastCompanionId');
JobPool.loadFromConfig({ jobs: [{
  id: 'job_test_request_companion',
  name: '请求同行',
  toils: [
    { id: 'select_companion', type: 'toil_select_companion' },
    { id: 'request_companion', type: 'toil_request_companion' },
  ],
}] });
entity = makeEntity('npc_main', { state: { factionId: 'faction_a' } });
const companion = makeEntity('npc_companion', { state: { factionId: 'faction_a' } });
const outsider = makeEntity('npc_outsider', { state: { factionId: 'faction_b' } });
const worldContext = {
  entityRegistry: {
    getByType(type) {
      return type === 'npc' ? [entity, companion, outsider] : [];
    },
  },
};
result = runJob('job_test_request_companion', entity, worldContext);
assert(result.status === 'running', '选择同行者后 Job 继续到请求步骤');
result = runJob('job_test_request_companion', entity, worldContext);
assert(entity.state.get('lastCompanionId') == null, '新的 Job 未继承上一次临时上下文');
const companionSystem = new JobSystem();
companionSystem.start('job_test_request_companion');
result = companionSystem.executeStep(entity, worldContext);
assert(result.status === 'running', '第一步选择同行者成功');
assert(companionSystem.snapshot().jobContext.companionId === 'npc_companion', '优先选择同阵营 NPC');
result = companionSystem.executeStep(entity, worldContext);
assert(result.status === 'success', '请求同行 Job 成功完成');
assert(entity.state.get('lastCompanionId') === 'npc_companion', '写入 lastCompanionId');

console.log('6) 没有 companion 时返回 blocked companion_not_found');
JobPool.loadFromConfig({ jobs: [{
  id: 'job_test_select_companion_only',
  name: '只选择同行者',
  toils: [{ id: 'select_companion', type: 'toil_select_companion' }],
}] });
entity = makeEntity('npc_lonely', { state: { factionId: 'faction_a' } });
result = runJob('job_test_select_companion_only', entity, {
  entityRegistry: { getByType: () => [entity, { id: 'npc_dead', alive: false, state: new TestState({ factionId: 'faction_a' }) }] },
});
assert(result.status === 'running', 'blocked Toil 在 JobSystem 中保持 running');
assert(result.reason === 'companion_not_found', '没有同行者时报 companion_not_found');

console.log('7) request companion 缺 companionId 时直接 blocked companion_not_found');
const requestCompanionExecutor = ToilPool.getExecutor('toil_request_companion');
entity = makeEntity('npc_no_context_companion', { state: {} });
result = requestCompanionExecutor.run(entity, {}, { context: {} }, { id: 'request_companion', type: 'toil_request_companion' });
assert(result.status === ToilResultStatus.BLOCKED, '缺 companionId 时 request companion 返回 blocked');
assert(result.reason === 'companion_not_found', '缺 companionId 时 reason 是 companion_not_found');
assert(entity.state.get('lastCompanionId') == null, '缺 companionId 时不写 lastCompanionId');

console.log('8) 明确 faction 无同阵营候选时不退回其他 faction');
const selectCompanionExecutor = ToilPool.getExecutor('toil_select_companion');
entity = makeEntity('npc_strict_faction', { state: { factionId: 'faction_a' } });
const otherFactionNPC = makeEntity('npc_other_faction', { state: { factionId: 'faction_b' } });
const strictJob = { context: {} };
result = selectCompanionExecutor.run(entity, {
  entityRegistry: { getByType: () => [entity, otherFactionNPC] },
}, strictJob, { id: 'select_companion', type: 'toil_select_companion', params: { factionId: 'faction_a' } });
assert(result.status === ToilResultStatus.BLOCKED, '明确 faction 找不到同阵营候选时 blocked');
assert(result.reason === 'companion_not_found', '明确 faction 找不到同阵营候选时报 companion_not_found');
assert(strictJob.context.companionId == null, '明确 faction 找不到候选时不写 companionId');

console.log('9) 未传 params.factionId 时实体 factionId 不会硬过滤候选');
entity = makeEntity('npc_soft_faction', { state: { factionId: 'faction_a' } });
const softJob = { context: {} };
result = selectCompanionExecutor.run(entity, {
  entityRegistry: { getByType: () => [entity, otherFactionNPC] },
}, softJob, { id: 'select_companion', type: 'toil_select_companion' });
assert(result.status === ToilResultStatus.SUCCESS, '未传 params.factionId 时可选择其他阵营 alive NPC');
assert(result.contextPatch?.companionId === 'npc_other_faction', '未传 params.factionId 时写入第一个 alive 非本人候选');
assert(softJob.context.companionId == null, 'select companion 通过 contextPatch 而非直接写 job.context');

console.log('10) negative/NaN/缺价格参数不能购买且库存不变');
JobPool.loadFromConfig({ jobs: [
  {
    id: 'job_test_buy_negative_price',
    name: '负数价格购买',
    toils: [{
      id: 'buy_negative',
      type: 'toil_buy_item',
      params: { itemId: 'pill_rejuvenation', amount: 1, priceItemId: 'low_spirit_stone', priceAmount: -1 },
    }],
  },
  {
    id: 'job_test_buy_nan_amount',
    name: '非法数量购买',
    toils: [{
      id: 'buy_nan',
      type: 'toil_buy_item',
      params: { itemId: 'pill_rejuvenation', amount: Number.NaN, priceItemId: 'low_spirit_stone', priceAmount: 1 },
    }],
  },
  {
    id: 'job_test_buy_missing_price',
    name: '缺价格购买',
    toils: [{
      id: 'buy_missing_price',
      type: 'toil_buy_item',
      params: { itemId: 'pill_rejuvenation', amount: 1, priceItemId: 'low_spirit_stone' },
    }],
  },
] });
for (const jobId of ['job_test_buy_negative_price', 'job_test_buy_nan_amount', 'job_test_buy_missing_price']) {
  entity = makeEntity(`npc_${jobId}`, { inventory: { low_spirit_stone: 5 }, state: {} });
  result = runJob(jobId, entity);
  assert(result.status === 'running', `${jobId} 非法购买参数 blocked 后 Job 保持 running`);
  assert(result.reason === 'invalid_purchase_params', `${jobId} reason 是 invalid_purchase_params`);
  assert(entity.inventory.getAmount('pill_rejuvenation') === 0, `${jobId} 不增加物品`);
  assert(entity.inventory.getAmount('low_spirit_stone') === 5, `${jobId} 不扣灵石`);
}

console.log('11) inventory 缺 add 时购买失败且不会扣灵石');
const noAddInventory = {
  _values: { low_spirit_stone: 5 },
  getAmount(id) { return this._values[id] || 0; },
  remove(id, amount = 1) {
    if (this.getAmount(id) < amount) return false;
    this._values[id] = this.getAmount(id) - amount;
    return true;
  },
  has(id, amount = 1) { return this.getAmount(id) >= amount; },
};
entity = { id: 'npc_no_add_inventory', inventory: noAddInventory, state: new TestState({}) };
result = runJob('job_test_buy_pill', entity);
assert(result.status === 'failed', '缺 add 时购买失败');
assert(result.reason === 'inventory_add_failed', '缺 add 时 reason 是 inventory_add_failed');
assert(entity.inventory.getAmount('low_spirit_stone') === 5, '缺 add 时不会先扣灵石');
assert(entity.inventory.getAmount('pill_rejuvenation') === 0, '缺 add 时不会增加物品');

console.log('12) check equipped artifact 缺 itemId 和上下文时 blocked invalid_artifact_params');
JobPool.loadFromConfig({ jobs: [{
  id: 'job_test_check_artifact_missing_params',
  name: '缺法器参数检查',
  toils: [{ id: 'check_artifact', type: 'toil_check_equipped_artifact' }],
}] });
entity = makeEntity('npc_check_artifact_missing_params', { state: {} });
result = runJob('job_test_check_artifact_missing_params', entity);
assert(result.status === 'running', '缺法器参数 blocked 后 Job 保持 running');
assert(result.reason === 'invalid_artifact_params', '缺法器参数 reason 是 invalid_artifact_params');

console.log('13) check currency 缺金额 blocked，显式 amount 0 可成功');
JobPool.loadFromConfig({ jobs: [
  {
    id: 'job_test_check_currency_missing_amount',
    name: '缺金额检查货币',
    toils: [{
      id: 'check_currency_missing_amount',
      type: 'toil_check_currency',
      params: { priceItemId: 'low_spirit_stone' },
    }],
  },
  {
    id: 'job_test_check_currency_zero_amount',
    name: '零金额检查货币',
    toils: [{
      id: 'check_currency_zero_amount',
      type: 'toil_check_currency',
      params: { currencyItemId: 'low_spirit_stone', amount: 0 },
    }],
  },
] });
entity = makeEntity('npc_check_currency_missing_amount', { inventory: { low_spirit_stone: 0 }, state: {} });
result = runJob('job_test_check_currency_missing_amount', entity);
assert(result.status === 'running', 'check_currency 缺金额 blocked 后 Job 保持 running');
assert(result.reason === 'invalid_currency_params', 'check_currency 缺金额 reason 是 invalid_currency_params');
entity = makeEntity('npc_check_currency_zero_amount', { inventory: { low_spirit_stone: 0 }, state: {} });
result = runJob('job_test_check_currency_zero_amount', entity);
assert(result.status === 'success', 'check_currency 显式 amount 0 成功');
assert(result.reason === 'job_completed', 'check_currency 显式 amount 0 完成 Job');

if (failed > 0) {
  console.error(`\nEconomy/Social Toil tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nEconomy/Social Toil tests passed');
