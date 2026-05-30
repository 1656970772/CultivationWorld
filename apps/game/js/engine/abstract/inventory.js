/**
 * Inventory - 物品容器
 *
 * 管理实体持有的物品（资源/道具），支持堆叠数量操作。
 */
export class Inventory {
  constructor() {
    /** @type {Map<string, number>} itemId -> amount */
    this._items = new Map();
  }

  /**
   * 增加物品
   * @param {string} itemId
   * @param {number} amount
   */
  add(itemId, amount) {
    if (amount <= 0) return;
    const current = this._items.get(itemId) || 0;
    this._items.set(itemId, current + amount);
  }

  /**
   * 移除物品
   * @param {string} itemId
   * @param {number} amount
   * @returns {boolean} 是否成功（数量足够）
   */
  remove(itemId, amount) {
    if (amount <= 0) return true;
    const current = this._items.get(itemId) || 0;
    if (current < amount) return false;
    const remaining = current - amount;
    if (remaining <= 0) {
      this._items.delete(itemId);
    } else {
      this._items.set(itemId, remaining);
    }
    return true;
  }

  /**
   * 检查是否拥有足够数量
   */
  has(itemId, amount = 1) {
    return (this._items.get(itemId) || 0) >= amount;
  }

  /**
   * 获取物品数量
   */
  getAmount(itemId) {
    return this._items.get(itemId) || 0;
  }

  /**
   * 设置物品数量（直接覆盖）
   */
  setAmount(itemId, amount) {
    if (amount <= 0) {
      this._items.delete(itemId);
    } else {
      this._items.set(itemId, amount);
    }
  }

  /**
   * 获取所有物品
   * @returns {Object} { itemId: amount }
   */
  getAll() {
    const result = {};
    for (const [id, amount] of this._items) {
      result[id] = amount;
    }
    return result;
  }

  /**
   * 批量设置（用于初始化或读档恢复）
   */
  loadFrom(data) {
    this._items.clear();
    for (const [id, amount] of Object.entries(data)) {
      if (amount > 0) {
        this._items.set(id, amount);
      }
    }
  }

  /** 清空所有物品 */
  clear() {
    this._items.clear();
  }

  /** 物品种类数 */
  get size() {
    return this._items.size;
  }

  snapshot() {
    return this.getAll();
  }

  toJSON() {
    return this.getAll();
  }
}
