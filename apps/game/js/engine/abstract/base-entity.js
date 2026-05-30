/**
 * BaseEntity - 实体基类
 *
 * 组合模式：实体 = 静态数据 + 运行时状态 + 需求系统 + 行为系统 + 物品容器。
 * 模板方法模式：tick() 定义处理流程骨架，子类可覆写各步骤。
 */
import { StaticData } from './static-data.js';
import { RuntimeState } from './runtime-state.js';
import { NeedSystem } from './need-system.js';
import { BehaviorSystem } from './behavior-system.js';
import { GOAPPlanner } from './goap-planner.js';
import { Inventory } from './inventory.js';
import { SpatialComponent } from './spatial-component.js';
import { BTRunner } from './bt/bt-runner.js';

export class BaseEntity {
  /**
   * @param {string} id    实体唯一 ID
   * @param {string} type  实体类型 'faction' | 'npc' | 'world'
   */
  constructor(id, type) {
    this.id = id;
    this.type = type;
    this.alive = true;

    /** @type {StaticData} */
    this.staticData = null;
    /** @type {RuntimeState} */
    this.state = null;
    /** @type {NeedSystem} */
    this.needSystem = new NeedSystem();
    /** @type {BehaviorSystem} */
    this.behaviorSystem = null;
    /** @type {Inventory} */
    this.inventory = new Inventory();
    /** @type {SpatialComponent|null} 空间组件（仅 NPC/妖兽等可移动实体持有） */
    this.spatial = null;

    /** @type {BTRunner|null} 行为树驱动器（GOBT 骨架层，ADR-018）。为空时回退旧四段式 tick。 */
    this.btRunner = null;

    this._tickLog = null;
  }

  /**
   * 安装行为树（GOBT，ADR-018）。安装后 tick() 改由 BTRunner 驱动。
   * @param {import('./bt/bt-node.js').BTNode} rootNode
   */
  initBT(rootNode) {
    this.btRunner = new BTRunner(rootNode);
  }

  /**
   * 初始化静态数据
   * @param {Object} config
   */
  initStaticData(config) {
    this.staticData = new StaticData(config);
  }

  /**
   * 初始化运行时状态
   * @param {Object} initialValues
   */
  initState(initialValues) {
    this.state = new RuntimeState(initialValues);
  }

  /**
   * 初始化行为系统
   * @param {import('./action.js').Action[]} actions 可用行为列表
   * @param {Object} [plannerOptions]
   */
  initBehaviorSystem(actions = [], plannerOptions = {}) {
    const planner = new GOAPPlanner(plannerOptions);
    this.behaviorSystem = new BehaviorSystem(planner, actions);
  }

  /**
   * 初始化空间组件（坐标 + 速度），使实体可在地图上移动
   * @param {Object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} [opts.speed=1]
   */
  initSpatial({ x = 0, y = 0, speed = 1 } = {}) {
    this.spatial = new SpatialComponent({ x, y, speed });
  }

  /** 是否持有空间组件 */
  hasSpatial() {
    return this.spatial != null;
  }

  /**
   * 每 Tick 的处理流程（模板方法）
   * @param {Object} worldContext
   * @returns {Object} tick 结果
   */
  tick(worldContext) {
    if (!this.alive) return { entityId: this.id, skipped: true, reason: 'dead' };

    this._tickLog = {
      entityId: this.id,
      entityType: this.type,
      needs: null,
      plan: null,
      execution: null,
    };

    // GOBT 驱动（ADR-018）：安装了行为树则由 BTRunner 编排"反应/规划/执行"。
    // 未安装 BT 的实体（如妖兽/世界覆写了 tick，或尚未迁移）回退旧四段式。
    if (this.btRunner) {
      const { blackboard } = this.btRunner.run(this, worldContext);
      this._tickLog.execution = blackboard.execution || { status: 'idle' };
      // 调试看板可视化（ADR-018/019）：记录 BT 选中目标来源、命中反应与心智摘要。
      this._tickLog.btTrace = {
        selectedGoal: blackboard.selectedGoal || null,
        reactedPath: blackboard.reactedPath || null,
      };
      if (typeof this.getMindSummary === 'function') {
        this._tickLog.mind = this.getMindSummary();
      }
      this.onPostTick(worldContext);
      return this._tickLog;
    }

    this.onPreTick(worldContext);
    this._evaluateNeeds(worldContext);
    this._planBehavior(worldContext);
    const execResult = this._executeBehavior(worldContext);
    this.onPostTick(worldContext);

    this._tickLog.execution = execResult;
    return this._tickLog;
  }

  /**
   * BT 编排钩子：评估需求（供 HookNode 调用，等价旧 _evaluateNeeds）。
   * @returns {void}
   */
  btEvaluateNeeds(worldContext) {
    this._evaluateNeeds(worldContext);
  }

  /**
   * 构建本次决策的固定 step cost 函数（价值-风险，ADR-017）。
   * 基类默认无 costFn（按 weight 规划）；NPC 覆写为价值-风险代价表。
   * @returns {?(action: import('./action.js').Action) => number}
   */
  buildDecisionCostFn(worldContext) {
    return null;
  }

  /**
   * 收集额外目标（执念等，ADR-019），与需求目标合并参与 Utility 选择。
   * 基类默认无额外目标；NPC 在执念阶段覆写。
   * @returns {import('./goal.js').Goal[]}
   */
  collectExtraGoals(worldContext) {
    return [];
  }

  /** 规划完成后的回调（如标记 headstrong）。基类空实现。 */
  onPlanChosen() {}

  /**
   * 需求评估
   */
  _evaluateNeeds(worldContext) {
    this.needSystem.evaluate(this.state, worldContext);
    this._tickLog.needs = this.needSystem.getLastEvaluation();
  }

  /**
   * 行为规划
   */
  _planBehavior(worldContext) {
    if (!this.behaviorSystem) return;

    if (!this.behaviorSystem.hasPlan()) {
      const goapState = this.state.toGOAPState();
      this.behaviorSystem.plan(this.needSystem, goapState, worldContext);
    }
    this._tickLog.plan = this.behaviorSystem.getLastPlanResult();
  }

  /**
   * 行为执行
   */
  _executeBehavior(worldContext) {
    if (!this.behaviorSystem || !this.behaviorSystem.hasPlan()) {
      return { status: 'idle' };
    }

    const result = this.behaviorSystem.executeStep(this, worldContext);

    if (result?.status === 'replan') {
      this.behaviorSystem.clearPlan();
      const goapState = this.state.toGOAPState();
      this.behaviorSystem.plan(this.needSystem, goapState, worldContext);
      if (this.behaviorSystem.hasPlan()) {
        return this.behaviorSystem.executeStep(this, worldContext);
      }
    }

    return result || { status: 'idle' };
  }

  /** 子类可覆写的前置处理钩子 */
  onPreTick(worldContext) {}

  /** 子类可覆写的后置处理钩子 */
  onPostTick(worldContext) {}

  /** 标记死亡 */
  kill() {
    this.alive = false;
  }

  /** 获取上次 Tick 的日志 */
  getLastTickLog() {
    return this._tickLog;
  }

  /** 序列化为可存储格式 */
  snapshot() {
    return {
      id: this.id,
      type: this.type,
      alive: this.alive,
      staticData: this.staticData?.toJSON() || null,
      state: this.state?.snapshot() || null,
      inventory: this.inventory?.snapshot() || null,
      needSystem: this.needSystem?.toJSON() || null,
      behaviorSystem: this.behaviorSystem?.toJSON() || null,
      spatial: this.spatial?.snapshot() || null,
      // 长期心智（ADR-019）：仅在实体持有时序列化，避免对未装配实体产生空字段。
      memory: this.memory?.snapshot ? this.memory.snapshot() : undefined,
      relationships: this.relationships?.snapshot ? this.relationships.snapshot() : undefined,
      obsessions: this.obsessions?.snapshot ? this.obsessions.snapshot() : undefined,
      emotions: this.emotions?.snapshot ? this.emotions.snapshot() : undefined,
    };
  }

  toJSON() {
    return this.snapshot();
  }
}
