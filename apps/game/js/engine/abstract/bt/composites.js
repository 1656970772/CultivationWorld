/**
 * 复合节点：Selector / Sequence / Parallel（GOBT 骨架层，ADR-018）。
 *
 * 复合节点负责子节点调度，是 BT "分支结构"的核心。
 * 即时反应通常用 Selector：把高优先反应（遇袭/续命）放前面，命中即返回，
 * 天然实现"打断低优先规划"的语义。
 */
import { BTNode, BTStatus } from './bt-node.js';

/**
 * Selector（或节点）：依次 tick 子节点，遇到第一个非 FAILURE 即返回该状态。
 * 全部 FAILURE 才返回 FAILURE。用于"优先级选择/即时反应抢占"。
 */
export class SelectorNode extends BTNode {
  tick(entity, blackboard, worldContext) {
    for (let i = 0; i < this.children.length; i++) {
      const status = this.children[i].tick(entity, blackboard, worldContext);
      if (status === BTStatus.RUNNING) {
        this._resetSiblingsAfter(i);
        return BTStatus.RUNNING;
      }
      if (status === BTStatus.SUCCESS) {
        this._resetSiblingsAfter(i);
        return BTStatus.SUCCESS;
      }
    }
    return BTStatus.FAILURE;
  }

  _resetSiblingsAfter(index) {
    for (let j = index + 1; j < this.children.length; j++) {
      this.children[j].reset();
    }
  }
}

/**
 * Sequence（与节点）：依次 tick 子节点，遇到第一个非 SUCCESS 即返回该状态。
 * 全部 SUCCESS 才返回 SUCCESS。用于"必须按序完成的步骤"。
 */
export class SequenceNode extends BTNode {
  tick(entity, blackboard, worldContext) {
    for (const child of this.children) {
      const status = child.tick(entity, blackboard, worldContext);
      if (status !== BTStatus.SUCCESS) {
        return status;
      }
    }
    return BTStatus.SUCCESS;
  }
}

/**
 * Parallel（并行节点）：tick 全部子节点。
 * policy='requireAll' 时全 SUCCESS 才 SUCCESS，任一 FAILURE 即 FAILURE，否则 RUNNING；
 * policy='requireOne' 时任一 SUCCESS 即 SUCCESS。
 * 本模拟器按天 tick，并行主要用于"同时维护多个被动状态 + 一个主决策"。
 */
export class ParallelNode extends BTNode {
  constructor(config = {}) {
    super(config);
    this.policy = config.policy === 'requireOne' ? 'requireOne' : 'requireAll';
  }

  tick(entity, blackboard, worldContext) {
    let successCount = 0;
    let failureCount = 0;
    for (const child of this.children) {
      const status = child.tick(entity, blackboard, worldContext);
      if (status === BTStatus.SUCCESS) successCount++;
      else if (status === BTStatus.FAILURE) failureCount++;
    }
    if (this.policy === 'requireOne') {
      if (successCount > 0) return BTStatus.SUCCESS;
      if (failureCount === this.children.length) return BTStatus.FAILURE;
      return BTStatus.RUNNING;
    }
    if (failureCount > 0) return BTStatus.FAILURE;
    if (successCount === this.children.length) return BTStatus.SUCCESS;
    return BTStatus.RUNNING;
  }

  toJSON() {
    return { ...super.toJSON(), policy: this.policy };
  }
}
