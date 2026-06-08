/**
 * FactionEntity - 势力实体
 *
 * 继承 BaseEntity，组合势力专用的静态数据、运行时状态。
 */
import { BaseEntity } from '../abstract/base-entity.js';
import { FactionStaticData } from './faction-static-data.js';
import { FactionState } from './faction-state.js';
import { NeedPool } from '../pools/need-pool.js';
import { ActionPool } from '../pools/action-pool.js';
import { ResourceRegistry } from '../economy/resource-registry.js';

export class FactionEntity extends BaseEntity {
  /**
   * @param {Object} factionConfig 势力原始配置数据
   * @param {Object} [entityConfig] 额外配置
   * @param {Object} [entityConfig.aiConfig] ai-config.json 中 faction 段落
   */
  constructor(factionConfig, entityConfig = {}) {
    super(factionConfig.id, 'faction');

    this._aiConfig = entityConfig.aiConfig || {};
    this.entityConfig = entityConfig;
    this.resourceRegistry = entityConfig.resourceRegistry
      || ResourceRegistry.fromResourceIds(Object.keys(factionConfig.resources || {}));
    this.initStaticData(factionConfig);
    this._initFactionState(factionConfig);
    this._initInventory(factionConfig);
    this._initNeeds(factionConfig);
    this._initActions(factionConfig);
  }

  /** @override */
  initStaticData(config) {
    this.staticData = new FactionStaticData(config);
  }

  _initFactionState(config) {
    this.state = new FactionState(config, {
      resourceRegistry: this.resourceRegistry,
      sectConfigRegistry: this.entityConfig.sectConfigRegistry,
    });
  }

  _initInventory(config) {
    const isSect = this.entityConfig.sectConfigRegistry?.isSectFactionConfig?.(config) === true;
    const resources = isSect
      ? this.entityConfig.sectConfigRegistry.resolveFactionResources(config)
      : (config.resources || {});
    const inventoryItems = isSect
      ? this.entityConfig.sectConfigRegistry.resolveFactionInventory(config)
      : {};
    this.inventory.loadFrom({
      ...this.resourceRegistry.initialStateFrom(resources),
      ...inventoryItems,
    });
  }

  _initNeeds(config) {
    const needIds = config.needIds || [
      'need_survival', 'need_defense', 'need_expansion',
      'need_development', 'need_diplomacy', 'need_military',
      'need_prestige', 'need_cultivation_support',
    ];

    for (const needId of needIds) {
      if (NeedPool.has(needId)) {
        this.needSystem.addNeed(NeedPool.create(needId));
      }
    }
  }

  _initActions(config) {
    const actionIds = config.actionIds || [
      'act_develop', 'act_recruit', 'act_expand', 'act_defend',
      'act_attack', 'act_ally', 'act_trade', 'act_stabilize',
      'act_host_conference', 'act_build_formation', 'act_open_secret_realm',
    ];

    const actions = [];
    for (const actionId of actionIds) {
      if (ActionPool.has(actionId)) {
        actions.push(ActionPool.create(actionId));
      }
    }
    const maxDepth = this._aiConfig.maxDepth ?? 10;
    const maxIterations = this._aiConfig.maxIterations ?? 800;
    this.initBehaviorSystem(actions, { maxDepth, maxIterations });
  }

  /**
   * @override 前置处理：以 state 为资源真相源，同步给兼容 inventory，再更新派生状态
   */
  onPreTick(worldContext) {
    this.state.set('underAttack', false);
    this._syncStateResourcesToInventory();

    if (this.state instanceof FactionState) {
      this.state.updateDerived(worldContext);
    }
  }

  /**
   * @override 后置处理：同步 state 回 inventory
   */
  onPostTick(worldContext) {
    // 资源以 state 为单一真相源，同步回 inventory；钳制下限为 0，
    // 防止行为 effects 的负向 add（消耗）把资源压到负数。
    this._syncStateResourcesToInventory();

    if ((this.state.get('stability') || 0) <= 0 || (this.state.get('disciples') || 0) <= 0) {
      this.state.set('isDestroyed', true);
      this.alive = false;
    }
  }

  /** 便捷访问 */
  get name() { return this.staticData.name; }
  get factionType() { return this.staticData.factionType; }

  _syncStateResourcesToInventory() {
    for (const resourceId of this.resourceRegistry.factionStateResourceIds()) {
      const amount = Math.max(0, this.state.get(resourceId) || 0);
      this.state.set(resourceId, amount);
      this.inventory.setAmount(resourceId, amount);
    }
  }

  /** @override */
  toJSON() {
    return {
      ...super.toJSON(),
      name: this.name,
      factionType: this.factionType,
    };
  }
}
