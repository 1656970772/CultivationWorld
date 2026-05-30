/**
 * WorldEntity - 世界实体
 *
 * 世界本身也是一个实体，有状态和行为（世界规则），暂无需求。
 */
import { BaseEntity } from '../abstract/base-entity.js';
import { WorldState } from './world-state.js';
import { ActionPool } from '../pools/action-pool.js';

export class WorldEntity extends BaseEntity {
  constructor() {
    super('world', 'world');
    this.state = new WorldState();
    this._initWorldActions();
  }

  _initWorldActions() {
    const ruleIds = [
      'rule_modifier_decay',
      'rule_modifier_spawn',
      'rule_natural_disaster',
      'rule_resource_regen',
    ];

    const actions = [];
    for (const ruleId of ruleIds) {
      if (ActionPool.has(ruleId)) {
        actions.push(ActionPool.create(ruleId));
      }
    }
    this.initBehaviorSystem(actions);
  }

  /**
   * 世界 Tick：直接执行所有规则，不走 GOAP
   * @override
   */
  tick(worldContext) {
    this._tickLog = {
      entityId: this.id,
      entityType: this.type,
      rules: [],
    };

    worldContext.worldState = this.state;

    for (const action of this.behaviorSystem.availableActions) {
      const result = action.execute(this, worldContext);
      this._tickLog.rules.push({
        ruleId: action.id,
        ruleName: action.name,
        result,
      });
    }

    this.state.advanceDay();
    return this._tickLog;
  }

  get currentDay() {
    return this.state.get('currentDay');
  }

  get activeModifiers() {
    return this.state.get('activeModifiers') || [];
  }
}
