import { Goal } from './goal.js';

/**
 * NeedSystem - 实体的需求管理器
 *
 * 管理实体的所有需求，按优先级排序，输出最高优先级需求。
 *
 * GOBT 重构（ADR-018）：除原有 getTopNeeds 外，新增 getTopGoals，将 Need 转为统一的
 * Goal 对象，便于与执念(Obsession)等其他目标来源在 PlannerNode 中统一参与 Utility 选择。
 */
export class NeedSystem {
  constructor() {
    /** @type {import('./need.js').Need[]} */
    this.needs = [];
    this._lastEvaluation = null;
  }

  /**
   * 从需求池注册需求
   * @param {import('./need.js').Need} need
   */
  addNeed(need) {
    if (this.needs.find(n => n.id === need.id)) return;
    this.needs.push(need);
  }

  removeNeed(needId) {
    this.needs = this.needs.filter(n => n.id !== needId);
  }

  getNeed(needId) {
    return this.needs.find(n => n.id === needId) || null;
  }

  /**
   * 评估所有需求的优先级
   * @param {import('./runtime-state.js').RuntimeState} entityState
   * @param {Object} worldContext
   */
  evaluate(entityState, worldContext) {
    for (const need of this.needs) {
      need.evaluate(entityState, worldContext);
    }
    this.needs.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.urgency - a.urgency;
    });
    this._lastEvaluation = {
      timestamp: Date.now(),
      results: this.needs.map(n => n.toJSON()),
    };
  }

  /**
   * 获取优先级最高的 N 个需要行动的需求
   * @param {number} count
   * @returns {import('./need.js').Need[]}
   */
  getTopNeeds(count = 3) {
    return this.needs.filter(n => n.needsAction()).slice(0, count);
  }

  /**
   * 获取所有需要行动的需求
   */
  getActionableNeeds() {
    return this.needs.filter(n => n.needsAction());
  }

  /**
   * 将最高优先级的需求转为统一的 Goal 列表（GOBT 选目标层，ADR-018）。
   * 顺序与 getTopNeeds 完全一致，priority/urgency/goalState 直接沿用 Need 评估结果，
   * 因此在无其他目标来源时与重构前行为零漂移。
   * @param {number} count
   * @returns {import('./goal.js').Goal[]}
   */
  getTopGoals(count = 3) {
    return this.getTopNeeds(count).map(need => Goal.fromNeed(need));
  }

  /** 获取上次评估的调试快照 */
  getLastEvaluation() {
    return this._lastEvaluation;
  }

  toJSON() {
    return this.needs.map(n => n.toJSON());
  }
}
