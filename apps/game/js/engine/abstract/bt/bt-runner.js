/**
 * BTRunner - 行为树驱动器（GOBT 骨架层，ADR-018）。
 *
 * 持有根节点，每个实体 tick 调用 run() 驱动整棵树一次。
 * 维护一份"本次 tick 黑板"，供节点间传递临时数据（如选中的 Goal、执行结果）。
 */
import { BTStatus } from './bt-node.js';

export class BTRunner {
  /**
   * @param {import('./bt-node.js').BTNode} root
   */
  constructor(root) {
    this.root = root;
    /** 最近一次 tick 的执行轨迹与黑板快照（调试/可视化用） */
    this._lastTrace = null;
  }

  /**
   * 驱动行为树一次。
   * @param {import('../base-entity.js').BaseEntity} entity
   * @param {Object} worldContext
   * @returns {{ status: import('./bt-node.js').BTStatus, blackboard: Object }}
   */
  run(entity, worldContext) {
    const blackboard = {
      tickLog: entity._tickLog || null,
      selectedGoal: null,
      execution: null,
      reactedPath: null,
    };
    const status = this.root
      ? this.root.tick(entity, blackboard, worldContext)
      : BTStatus.FAILURE;
    this._lastTrace = { status, selectedGoal: blackboard.selectedGoal, reactedPath: blackboard.reactedPath };
    return { status, blackboard };
  }

  getLastTrace() {
    return this._lastTrace;
  }

  toJSON() {
    return { tree: this.root ? this.root.toJSON() : null };
  }
}
