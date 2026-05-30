/**
 * 行为树节点基类与状态枚举（GOBT 骨架层，ADR-018）。
 *
 * BT 负责"何时反应 / 何时分支 / 何时打断"的高层编排，叶子节点里再挂 PlannerNode
 * （Utility 选目标 + GOAP 规划）。整棵树从 JSON 数据驱动构建，代码只实现节点类型。
 *
 * 约定（遵循项目枚举规则）：节点 tick 一律返回 BTStatus 枚举，不用裸字符串。
 */

/**
 * 行为树节点执行状态。
 * @enum {string}
 */
export const BTStatus = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  RUNNING: 'running',
});

/**
 * 行为树节点抽象基类。
 *
 * tick(entity, blackboard, worldContext) 返回 BTStatus。
 * 复合/装饰节点负责调度子节点；叶子节点（Condition/Action/Planner）实现具体逻辑。
 */
export class BTNode {
  /**
   * @param {Object} [config]
   * @param {string} [config.name] 节点名（调试/可视化用）
   */
  constructor(config = {}) {
    this.name = config.name || this.constructor.name;
    /** @type {BTNode[]} 子节点（复合节点用） */
    this.children = [];
  }

  /**
   * 添加子节点（建造期用）。
   * @param {BTNode} child
   * @returns {this}
   */
  addChild(child) {
    if (child) this.children.push(child);
    return this;
  }

  /**
   * 执行一次节点逻辑。
   * @param {import('../base-entity.js').BaseEntity} entity
   * @param {Object} blackboard 本次 tick 的共享黑板
   * @param {Object} worldContext
   * @returns {BTStatus}
   */
  tick(entity, blackboard, worldContext) {
    throw new Error(`${this.name}.tick() must be overridden`);
  }

  /**
   * 当 RUNNING 的分支被放弃（被更高优先分支抢占）时调用，供子类清理状态。
   */
  reset() {
    for (const c of this.children) c.reset();
  }

  toJSON() {
    return {
      type: this.constructor.name,
      name: this.name,
      children: this.children.map(c => c.toJSON()),
    };
  }
}
