/**
 * NeedPool - 需求类型注册表
 *
 * 注册表模式：管理所有可用的需求类型。
 * 实体从 NeedPool 中选择自己需要的需求组合。
 */
import { Need, NeedEvaluator, ConfigurableEvaluator } from '../abstract/need.js';

class NeedPoolClass {
  constructor() {
    /** @type {Map<string, Object>} needId -> need config */
    this._templates = new Map();
    /** @type {Map<string, Function>} evaluatorId -> evaluator factory */
    this._evaluatorFactories = new Map();

    this._registerBuiltinEvaluators();
  }

  /**
   * 注册内置的评估器工厂
   */
  _registerBuiltinEvaluators() {
    this.registerEvaluatorFactory('configurable', (config) => {
      return new ConfigurableEvaluator(config);
    });
  }

  /**
   * 注册评估器工厂
   * @param {string} id
   * @param {Function} factory (config) => NeedEvaluator
   */
  registerEvaluatorFactory(id, factory) {
    this._evaluatorFactories.set(id, factory);
  }

  /**
   * 注册需求模板
   * @param {Object} template
   */
  registerTemplate(template) {
    this._templates.set(template.id, template);
  }

  /**
   * 从 JSON 数组批量加载需求模板
   * @param {Object[]} templates
   */
  loadFromArray(templates) {
    for (const t of templates) {
      this.registerTemplate(t);
    }
  }

  /**
   * 创建需求实例
   * @param {string} needId
   * @param {Object} [overrides] 覆盖参数
   * @returns {Need}
   */
  create(needId, overrides = {}) {
    const template = this._templates.get(needId);
    if (!template) {
      throw new Error(`Need template not found: ${needId}`);
    }

    const merged = { ...template, ...overrides };
    const evaluatorType = merged.evaluatorType || 'configurable';
    const factory = this._evaluatorFactories.get(evaluatorType);
    if (!factory) {
      throw new Error(`Evaluator factory not found: ${evaluatorType}`);
    }

    const evaluator = factory(merged.evaluatorConfig || {});
    return new Need({
      id: merged.id,
      name: merged.name,
      description: merged.description,
      evaluator,
      goalState: merged.goalState,
      basePriority: merged.basePriority,
      selectStrategy: merged.selectStrategy,
    });
  }

  /**
   * 批量创建需求（从 ID 列表）
   * @param {string[]} needIds
   * @returns {Need[]}
   */
  createMany(needIds) {
    return needIds.map(id => this.create(id));
  }

  has(needId) {
    return this._templates.has(needId);
  }

  getTemplate(needId) {
    return this._templates.get(needId);
  }

  getAllTemplateIds() {
    return Array.from(this._templates.keys());
  }

  clear() {
    this._templates.clear();
  }
}

export const NeedPool = new NeedPoolClass();
