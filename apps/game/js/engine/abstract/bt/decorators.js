/**
 * 装饰器节点：Inverter / Succeeder / Cooldown / ConditionGuard（GOBT 骨架层，ADR-018）。
 *
 * 装饰器只能有一个子节点，用于修饰子节点的执行结果或执行时机。
 * 其中 CooldownNode 用于承接旧的"决策冷却"语义（npc-entity._decisionCooldown 等价迁移）。
 */
import { BTNode, BTStatus } from './bt-node.js';

/** 单子节点装饰器基类。 */
class DecoratorNode extends BTNode {
  get child() { return this.children[0] || null; }
}

/** Inverter：SUCCESS<->FAILURE 互换，RUNNING 透传。 */
export class InverterNode extends DecoratorNode {
  tick(entity, blackboard, worldContext) {
    if (!this.child) return BTStatus.FAILURE;
    const status = this.child.tick(entity, blackboard, worldContext);
    if (status === BTStatus.SUCCESS) return BTStatus.FAILURE;
    if (status === BTStatus.FAILURE) return BTStatus.SUCCESS;
    return status;
  }
}

/** Succeeder：无论子节点返回什么（除 RUNNING），都返回 SUCCESS。 */
export class SucceederNode extends DecoratorNode {
  tick(entity, blackboard, worldContext) {
    if (!this.child) return BTStatus.SUCCESS;
    const status = this.child.tick(entity, blackboard, worldContext);
    if (status === BTStatus.RUNNING) return BTStatus.RUNNING;
    return BTStatus.SUCCESS;
  }
}

/**
 * Cooldown：在冷却期内直接返回 cooldownStatus（默认 FAILURE，让 Selector 落到下一分支或静候），
 * 冷却到期才 tick 子节点；子节点返回非 RUNNING 时重置一个新的随机冷却。
 *
 * 用于等价迁移 NPC 的"决策周期"：周期内不重新做大决策（返回 FAILURE→上层静候），
 * 到期才允许 PlannerNode 重新规划。随机区间 [minTicks, maxTicks]。
 */
export class CooldownNode extends DecoratorNode {
  /**
   * @param {Object} config
   * @param {number} [config.minTicks=0] 冷却最小天数
   * @param {number} [config.maxTicks=0] 冷却最大天数
   * @param {string} [config.cooldownStatus='failure'] 冷却期内返回的状态枚举值
   * @param {() => number} [config.rng] 注入的随机源（默认 Math.random，便于测试）
   */
  constructor(config = {}) {
    super(config);
    this.minTicks = config.minTicks ?? 0;
    this.maxTicks = config.maxTicks ?? 0;
    this.cooldownStatus = config.cooldownStatus === 'success' ? BTStatus.SUCCESS : BTStatus.FAILURE;
    this._rng = config.rng || Math.random;
    this._remaining = this._roll();
  }

  _roll() {
    const min = this.minTicks, max = this.maxTicks;
    if (max <= min) return min;
    return min + Math.floor(this._rng() * (max - min + 1));
  }

  tick(entity, blackboard, worldContext) {
    if (this._remaining > 0) {
      this._remaining--;
      return this.cooldownStatus;
    }
    if (!this.child) return BTStatus.FAILURE;
    const status = this.child.tick(entity, blackboard, worldContext);
    if (status !== BTStatus.RUNNING) {
      this._remaining = this._roll();
    }
    return status;
  }

  reset() {
    super.reset();
  }

  toJSON() {
    return { ...super.toJSON(), minTicks: this.minTicks, maxTicks: this.maxTicks, remaining: this._remaining };
  }
}
