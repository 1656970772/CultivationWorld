/**
 * FactionNeeds - 势力专用需求评估器注册
 *
 * 势力 Need 不再在类内写死阈值和目标态；所有条件、权重和目标覆盖由
 * data/needs/faction-needs.json 的 evaluatorConfig 提供。
 */
import { ConfigRuleEvaluator } from '../abstract/config-rule-evaluator.js';
import { NeedPool } from '../pools/need-pool.js';

export class FactionNeedEvaluator extends ConfigRuleEvaluator {}

const FACTION_EVALUATOR_TYPES = [
  'faction_survival',
  'faction_expansion',
  'faction_defense',
  'faction_development',
  'faction_diplomacy',
  'faction_military',
];

export function registerFactionEvaluators() {
  for (const type of FACTION_EVALUATOR_TYPES) {
    NeedPool.registerEvaluatorFactory(type, (config) => new FactionNeedEvaluator(config));
  }
}
