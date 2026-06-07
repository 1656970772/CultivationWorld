#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));
const imp = (path) => import(pathToFileURL(resolve(GAME_ROOT, path)).href);

let failed = 0;
function assert(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

const combatEffects = load('data/effects/combat-effects.json');
const combatAbilities = load('data/abilities/combat-abilities.json');

console.log('1) 锁血 GE/GA 数据是通用原语 + spec 驱动');
const geLockHp = combatEffects.effects.find((effect) => effect.id === 'ge_lock_hp');
const gaLockHp = combatAbilities.abilities.find((ability) => ability.id === 'ga_lock_hp');
assert(!!geLockHp, '存在 ge_lock_hp');
assert(!!gaLockHp, '存在 ga_lock_hp');
const lockModifier = geLockHp?.modifiers?.[0] || {};
assert(lockModifier.attribute === 'hp' && lockModifier.op === 'override', 'ge_lock_hp 只声明 hp override 机制');
assert(!Object.prototype.hasOwnProperty.call(lockModifier, 'magnitude'), 'ge_lock_hp 不硬编码锁血数值 magnitude');
const lockGrant = gaLockHp?.grantsEffects?.[0];
assert(typeof lockGrant === 'object' && lockGrant !== null, 'ga_lock_hp grantsEffects 使用对象形式');
assert(lockGrant?.effect === 'ge_lock_hp', 'ga_lock_hp 对象形式引用 ge_lock_hp');
assert(lockGrant?.spec?.magnitudeType === 'ratioOfMaxHp', 'ga_lock_hp 通过 spec 声明 ratioOfMaxHp 量纲');

const { RuntimeState } = await imp('js/engine/abstract/runtime-state.js');
const { AbilityComponent } = await imp('js/engine/abstract/ability-component.js');
const { EffectPool } = await imp('js/engine/pools/effect-pool.js');
const { AbilityPool } = await imp('js/engine/pools/ability-pool.js');
const { EffectEngine } = await imp('js/engine/abstract/gameplay-effect.js');
const { applyDamage } = await imp('js/engine/combat/combat-pipeline.js');
const { Inventory } = await imp('js/engine/abstract/inventory.js');
const { ItemRegistry } = await imp('js/engine/items/item-registry.js');

EffectPool.clear();
AbilityPool.clear();
EffectPool.loadFromConfig(combatEffects);
AbilityPool.loadFromConfig(combatAbilities);

function makeTarget() {
  const state = new RuntimeState({
    hp: 100,
    maxHp: 100,
    alive: true,
    injuryLevel: 0,
    currentRole: 'disciple',
  });
  const entity = {
    id: 'npc_lockhp_target',
    name: '锁血测试修士',
    type: 'npc',
    alive: true,
    state,
    inventory: {
      getAmount: () => 0,
      remove: () => false,
    },
  };
  entity.abilityComponent = new AbilityComponent(entity);
  entity.attributes = entity.abilityComponent.attributes;
  entity.abilityComponent.grantAbility('ga_lock_hp');
  return entity;
}

console.log('2) applyDamage 致死锁血只经 GA/GE/EffectEngine 改写 HP');
const target = makeTarget();
const hpWrites = [];
let effectDepth = 0;
const originalSet = target.state.set.bind(target.state);
target.state.set = (key, value) => {
  if (key === 'hp') hpWrites.push({ value, viaEffectEngine: effectDepth > 0 });
  return originalSet(key, value);
};

const appliedEffects = [];
const originalApplyEffect = EffectEngine.applyEffect;
EffectEngine.applyEffect = function wrappedApplyEffect(entity, effectDef, ctx = {}) {
  effectDepth++;
  try {
    appliedEffects.push({
      effectId: effectDef?.id,
      sourceId: ctx.source?.id || null,
      spec: ctx.spec ? { ...ctx.spec } : null,
    });
    return originalApplyEffect.call(this, entity, effectDef, ctx);
  } finally {
    effectDepth--;
  }
};

try {
  const result = applyDamage(target, {
    amount: 150,
    cause: 'test_lethal',
    killer: { id: 'monster_test', name: '测试妖兽' },
    orderGap: 0,
  }, {
    balanceConfig: {
      combat: {
        gas: { enabled: true },
        lockHp: { lockRatio: 0.2, crushOrderGap: 25, crushHpMultiple: 3 },
      },
    },
  });

  const lockEffectCall = appliedEffects.find((effect) => effect.effectId === 'ge_lock_hp');
  assert(result.locked === true && result.died === false, '致死伤害触发锁血而非死亡');
  assert(target.state.get('hp') === 20, '最终 HP 来自 lockRatio=0.2');
  assert(!!lockEffectCall, '锁血通过 EffectEngine.applyEffect 施加 ge_lock_hp');
  assert(lockEffectCall?.sourceId === 'monster_test', 'AbilityComponent 向 EffectEngine 透传来源实体');
  assert(lockEffectCall?.spec?.magnitude === 0.2, 'AbilityComponent 向 ge_lock_hp 透传本次锁血 magnitude');
  assert(lockEffectCall?.spec?.magnitudeType === 'ratioOfMaxHp', 'AbilityComponent 合并 GA spec 的 magnitudeType');
  assert(hpWrites.filter((write) => !write.viaEffectEngine).length === 0, '锁血分支没有绕过 EffectEngine 直接写 hp');
} finally {
  EffectEngine.applyEffect = originalApplyEffect;
}

console.log('3) AbilityComponent 对缺失 executor 严格失败');
AbilityPool.register({
  id: 'ga_missing_executor_test',
  name: '缺失执行器测试',
  abilityTag: 'Ability.MissingExecutorTest',
  triggerTags: ['Trigger.LethalDamage'],
  blockedByTags: [],
  requiredItems: [],
  grantsEffects: [],
  executor: 'missing_executor_for_test',
});
const missingExecutorTarget = makeTarget();
missingExecutorTarget.abilityComponent.grantAbility('ga_missing_executor_test');
let threw = false;
try {
  missingExecutorTarget.abilityComponent.tryActivateByTag('Trigger.LethalDamage', {}, {});
} catch (err) {
  threw = String(err?.message || '').includes('missing_executor_for_test');
}
assert(threw, '配置了 executor 但注册表缺失时抛出错误');

console.log('4) AbilityComponent 对缺失 grantsEffects 严格失败且不预先消耗道具');
EffectPool.clear();
AbilityPool.clear();
AbilityPool.register({
  id: 'ga_missing_effect_preconsume_test',
  name: '缺失 Effect 预检测试',
  abilityTag: 'Ability.MissingEffectPreconsumeTest',
  triggerTags: ['State.Dying'],
  blockedByTags: [],
  requiredItems: [{ itemId: 'item_escape_talisman', amount: 1 }],
  grantsEffects: ['ge_missing_before_consume'],
  executor: null,
});
const missingEffectInventory = new Inventory();
missingEffectInventory.add('item_escape_talisman', 1);
const missingEffectTarget = {
  id: 'npc_missing_effect_target',
  name: '缺失 Effect 测试修士',
  state: new RuntimeState({ hp: 10, maxHp: 100, alive: true }),
  inventory: missingEffectInventory,
};
missingEffectTarget.abilityComponent = new AbilityComponent(missingEffectTarget);
missingEffectTarget.attributes = missingEffectTarget.abilityComponent.attributes;
missingEffectTarget.abilityComponent.grantAbility('ga_missing_effect_preconsume_test');
let missingEffectThrew = false;
try {
  missingEffectTarget.abilityComponent.tryActivateByTag('State.Dying', {}, {});
} catch (err) {
  missingEffectThrew = String(err?.message || '').includes('ge_missing_before_consume');
}
assert(missingEffectThrew, 'grantsEffects 引用缺失 EffectPool 定义时抛出错误');
assert(missingEffectInventory.getAmount('item_escape_talisman') === 1, '缺失 Effect 失败时不消耗 requiredItems');

console.log('5) AbilityComponent requiredItems selector 可消费同类上品遁地符');
EffectPool.clear();
AbilityPool.clear();
ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/items/talisman.json').items);
AbilityPool.register({
  id: 'ga_escape_selector_test',
  name: '遁地符 selector 测试',
  abilityTag: 'Ability.EscapeSelectorTest',
  triggerTags: ['State.Dying'],
  blockedByTags: [],
  requiredItems: [{ selector: { category: 'talisman', subCategory: 'escape' }, quantity: 1 }],
  grantsEffects: [],
  executor: null,
});
const selectorInventory = new Inventory();
selectorInventory.add('item_escape_talisman_high', 1);
const selectorTarget = {
  id: 'npc_selector_target',
  name: 'selector 测试修士',
  state: new RuntimeState({ hp: 10, maxHp: 100, alive: true }),
  inventory: selectorInventory,
};
selectorTarget.abilityComponent = new AbilityComponent(selectorTarget);
selectorTarget.attributes = selectorTarget.abilityComponent.attributes;
selectorTarget.abilityComponent.grantAbility('ga_escape_selector_test');
const selectorResult = selectorTarget.abilityComponent.tryActivateByTag('State.Dying', {}, {});
assert(selectorResult[0]?.activated === true, 'selector requiredItems 命中上品遁地符并激活能力');
assert(selectorInventory.getAmount('item_escape_talisman_high') === 0, 'selector requiredItems 消耗被命中的上品遁地符');
assert(selectorInventory.getAmount('item_escape_talisman') === 0, 'selector requiredItems 不依赖固定普通遁地符 id');

if (failed > 0) {
  console.error(`\nGAS lock HP tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nGAS lock HP tests passed');
