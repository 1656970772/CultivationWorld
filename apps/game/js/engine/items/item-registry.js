/**
 * ItemRegistry - 物品注册表（单例）
 *
 * 注册表模式：管理所有物品定义，从 JSON 加载。
 */
import { ItemDefinition } from './item-definition.js';

class ItemRegistryClass {
  constructor() {
    /** @type {Map<string, ItemDefinition>} */
    this._items = new Map();
    /** @type {Map<string, Set<string>>} category -> Set<itemId> */
    this._byCategory = new Map();
  }

  /**
   * 注册单个物品定义
   * @param {Object} config
   */
  register(config) {
    const def = new ItemDefinition(config);
    this._items.set(def.id, def);

    if (!this._byCategory.has(def.category)) {
      this._byCategory.set(def.category, new Set());
    }
    this._byCategory.get(def.category).add(def.id);
  }

  /**
   * 从 JSON 数组批量加载
   * @param {Object[]} items
   */
  loadFromArray(items) {
    for (const item of items) {
      this.register(item);
    }
  }

  /**
   * 获取物品定义
   * @param {string} id
   * @returns {ItemDefinition | undefined}
   */
  get(id) {
    return this._items.get(id);
  }

  /**
   * 根据分类获取
   * @param {string} category
   * @returns {ItemDefinition[]}
   */
  getByCategory(category) {
    const ids = this._byCategory.get(category);
    if (!ids) return [];
    return Array.from(ids).map(id => this._items.get(id)).filter(Boolean);
  }

  /**
   * 获取所有势力宏观资源（粮食/弟子），ADR-043。
   */
  getMacroResources() {
    return this.getAll().filter(def => def.isMacroResource && def.isMacroResource());
  }

  /**
   * 获取所有 NPC 可持有的实物道具（货币/材料/丹药/法宝/符/功法），ADR-043。
   */
  getHoldables() {
    return this.getAll().filter(def => def.isHoldable && def.isHoldable());
  }

  has(id) {
    return this._items.has(id);
  }

  get count() {
    return this._items.size;
  }

  getAll() {
    return Array.from(this._items.values());
  }

  clear() {
    this._items.clear();
    this._byCategory.clear();
  }
}

export const ItemRegistry = new ItemRegistryClass();
