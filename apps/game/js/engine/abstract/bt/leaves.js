/**
 * 叶子节点：Condition / Hook / Always（GOBT 骨架层，ADR-018）。
 *
 * 叶子节点是 BT 与实体世界交互的端点：
 * - ConditionNode：读取实体状态/世界上下文做布尔判断（即时反应的触发条件）。
 * - HookNode：调用实体上注册的钩子方法（承接旧 onPreTick/onPostTick/即时反应执行）。
 * - AlwaysNode：恒定返回某状态（占位/兜底用）。
 */
import { BTNode, BTStatus } from './bt-node.js';

/** 条件操作符（与 need.js 的 ConfigurableEvaluator 保持一致语义）。 */
function compare(actual, op, value) {
  switch (op) {
    case 'lt': return actual < value;
    case 'lte': return actual <= value;
    case 'gt': return actual > value;
    case 'gte': return actual >= value;
    case 'eq': return actual === value;
    case 'neq': return actual !== value;
    case 'true': return actual === true;
    case 'false': return actual === false;
    case 'exists': return actual != null;
    default: return false;
  }
}

/**
 * ConditionNode：满足条件返回 SUCCESS，否则 FAILURE。
 * condition: { key, op, value, source('entity'|'world') }
 */
export class ConditionNode extends BTNode {
  constructor(config = {}) {
    super(config);
    this.condition = config.condition || null;
  }

  tick(entity, blackboard, worldContext) {
    const c = this.condition;
    if (!c) return BTStatus.SUCCESS;
    let actual;
    if (c.source === 'world') {
      actual = worldContext ? worldContext[c.key] : undefined;
    } else {
      actual = entity.state && entity.state.get ? entity.state.get(c.key) : undefined;
    }
    return compare(actual, c.op, c.value) ? BTStatus.SUCCESS : BTStatus.FAILURE;
  }

  toJSON() {
    return { ...super.toJSON(), condition: this.condition };
  }
}

/**
 * HookNode：调用实体上的方法 entity[hook](worldContext, blackboard)。
 * 方法可返回 BTStatus；返回 undefined 时按 defaultStatus（默认 SUCCESS）处理。
 * 用于承接 onPreTick/onPostTick 这类"维护性副作用"，以及即时反应的具体执行。
 */
export class HookNode extends BTNode {
  constructor(config = {}) {
    super(config);
    this.hook = config.hook;
    this.defaultStatus = config.defaultStatus === 'failure' ? BTStatus.FAILURE
      : config.defaultStatus === 'running' ? BTStatus.RUNNING
        : BTStatus.SUCCESS;
  }

  tick(entity, blackboard, worldContext) {
    const fn = this.hook && entity[this.hook];
    if (typeof fn !== 'function') return this.defaultStatus;
    const ret = fn.call(entity, worldContext, blackboard);
    if (ret === BTStatus.SUCCESS || ret === BTStatus.FAILURE || ret === BTStatus.RUNNING) {
      return ret;
    }
    return this.defaultStatus;
  }

  toJSON() {
    return { ...super.toJSON(), hook: this.hook };
  }
}

/** AlwaysNode：恒定返回配置的状态枚举值。 */
export class AlwaysNode extends BTNode {
  constructor(config = {}) {
    super(config);
    this.status = config.status === 'failure' ? BTStatus.FAILURE
      : config.status === 'running' ? BTStatus.RUNNING
        : BTStatus.SUCCESS;
  }

  tick() {
    return this.status;
  }
}
