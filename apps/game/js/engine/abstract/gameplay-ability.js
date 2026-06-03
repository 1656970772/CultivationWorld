/**
 * GameplayAbility - 由 Tag 触发、消耗道具、授予 Effect 的能力（ADR-042，参考 UE GAS GameplayAbility）
 *
 * 能力声明（数据驱动 data/abilities/*.json）：
 * - abilityTag：拥有此能力时授予实体的 Tag（供其他逻辑查询，如 Ability.LockHP）。
 * - triggerTags：实体持有任一即可激活（被动触发，由 AbilityComponent.tryActivateByTag 检查）。
 * - blockedByTags：实体持有任一则禁用（如锁血被 Immune.Crush 阻挡）。
 * - requiredItems：激活消耗的道具 [{itemId, amount}]。
 * - grantsEffects：激活时授予自身的 Effect id 列表。
 * - executor：自定义执行器名（如瞬移），在 AbilityExecutorRegistry 注册；无则仅授予 Effect。
 *
 * AbilityExecutorRegistry：executor 名 → 执行函数(entity, ability, worldContext, ctx)。
 * 执行器内随机须走 entity._rng / worldContext.rng（ADR-038）。
 */

export class GameplayAbilityDef {
  constructor(config) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.abilityTag = config.abilityTag || null;
    this.triggerTags = config.triggerTags || [];
    this.blockedByTags = config.blockedByTags || [];
    this.requiredItems = config.requiredItems || [];
    this.grantsEffects = config.grantsEffects || [];
    this.executor = config.executor || null;
    this.cooldownDays = config.cooldownDays ?? 0;
  }
}

class AbilityExecutorRegistryClass {
  constructor() {
    /** @type {Map<string, Function>} */
    this._executors = new Map();
  }

  /**
   * 注册自定义能力执行器。
   * @param {string} name
   * @param {(entity:Object, ability:GameplayAbilityDef, worldContext:Object, ctx:Object)=>Object} fn
   */
  register(name, fn) {
    this._executors.set(name, fn);
  }

  get(name) { return this._executors.get(name); }
  has(name) { return this._executors.has(name); }
  clear() { this._executors.clear(); }
}

export const AbilityExecutorRegistry = new AbilityExecutorRegistryClass();
