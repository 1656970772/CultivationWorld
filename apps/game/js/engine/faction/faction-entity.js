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

export class FactionEntity extends BaseEntity {
  /**
   * @param {Object} factionConfig 势力原始配置数据
   * @param {Object} [entityConfig] 额外配置
   * @param {Object} [entityConfig.aiConfig] ai-config.json 中 faction 段落
   */
  constructor(factionConfig, entityConfig = {}) {
    super(factionConfig.id, 'faction');

    this._aiConfig = entityConfig.aiConfig || {};
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
    this.state = new FactionState(config);
  }

  _initInventory(config) {
    const resources = config.resources || {};
    this.inventory.loadFrom({
      low_spirit_stone: resources.low_spirit_stone || 0,
      disciples: resources.disciples || 0,
      food: resources.food || 0,
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
   * @override 前置处理：同步 inventory 到 state，更新派生状态
   */
  onPreTick(worldContext) {
    this.state.set('underAttack', false);
    this.state.set('low_spirit_stone', this.inventory.getAmount('low_spirit_stone'));
    this.state.set('disciples', this.inventory.getAmount('disciples'));
    this.state.set('food', this.inventory.getAmount('food'));

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
    const stone = Math.max(0, this.state.get('low_spirit_stone') || 0);
    const disc = Math.max(0, this.state.get('disciples') || 0);
    const food = Math.max(0, this.state.get('food') || 0);
    this.state.set('low_spirit_stone', stone);
    this.state.set('disciples', disc);
    this.state.set('food', food);
    this.inventory.setAmount('low_spirit_stone', stone);
    this.inventory.setAmount('disciples', disc);
    this.inventory.setAmount('food', food);

    if ((this.state.get('stability') || 0) <= 0 || (this.state.get('disciples') || 0) <= 0) {
      this.state.set('isDestroyed', true);
      this.alive = false;
    }
  }

  /** 便捷访问 */
  get name() { return this.staticData.name; }
  get factionType() { return this.staticData.factionType; }

  /** @override */
  toJSON() {
    return {
      ...super.toJSON(),
      name: this.name,
      factionType: this.factionType,
    };
  }
}
