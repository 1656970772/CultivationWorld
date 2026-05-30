/**
 * ActionPool - 行为类型注册表
 *
 * 注册表模式：管理所有可用的行为模板。
 * 实体从 ActionPool 中选择自己可用的行为组合。
 */
import { Action, ActionExecutor } from '../abstract/action.js';

class ActionPoolClass {
  constructor() {
    /** @type {Map<string, Object>} actionId -> action config */
    this._templates = new Map();
    /** @type {Map<string, ActionExecutor>} executorId -> executor instance */
    this._executors = new Map();
    /** @type {Map<string, Set<string>>} category -> Set<actionId> */
    this._byCategory = new Map();
  }

  /**
   * 注册行为执行器
   * @param {string} id
   * @param {ActionExecutor} executor
   */
  registerExecutor(id, executor) {
    this._executors.set(id, executor);
  }

  /**
   * 注册行为模板
   * @param {Object} template
   */
  registerTemplate(template) {
    this._templates.set(template.id, template);

    const category = template.category || 'general';
    if (!this._byCategory.has(category)) {
      this._byCategory.set(category, new Set());
    }
    this._byCategory.get(category).add(template.id);
  }

  /**
   * 从 JSON 数组批量加载行为模板
   * @param {Object[]} templates
   */
  loadFromArray(templates) {
    for (const t of templates) {
      this.registerTemplate(t);
    }
  }

  /**
   * 创建行为实例
   * @param {string} actionId
   * @param {Object} [overrides]
   * @returns {Action}
   */
  create(actionId, overrides = {}) {
    const template = this._templates.get(actionId);
    if (!template) {
      throw new Error(`Action template not found: ${actionId}`);
    }

    const merged = { ...template, ...overrides };
    const executorId = merged.executorId || merged.id;
    const executor = this._executors.get(executorId) || null;

    return new Action({
      ...merged,
      executor,
    });
  }

  /**
   * 批量创建行为（从 ID 列表）
   * @param {string[]} actionIds
   * @returns {Action[]}
   */
  createMany(actionIds) {
    return actionIds.map(id => this.create(id));
  }

  /**
   * 创建某个分类的所有行为
   * @param {string} category
   * @returns {Action[]}
   */
  createByCategory(category) {
    const ids = this._byCategory.get(category);
    if (!ids) return [];
    return Array.from(ids).map(id => this.create(id));
  }

  has(actionId) {
    return this._templates.has(actionId);
  }

  getTemplate(actionId) {
    return this._templates.get(actionId);
  }

  getAllTemplateIds() {
    return Array.from(this._templates.keys());
  }

  getCategories() {
    return Array.from(this._byCategory.keys());
  }

  clear() {
    this._templates.clear();
    this._byCategory.clear();
  }
}

export const ActionPool = new ActionPoolClass();
