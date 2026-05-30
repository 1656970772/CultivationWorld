/**
 * ItemTransaction - 物品事务
 *
 * 封装一次行为的物品消耗/产出，支持预检查与原子执行。
 */
export class ItemTransaction {
  /**
   * @param {import('../abstract/inventory.js').Inventory} inventory
   */
  constructor(inventory) {
    this.inventory = inventory;
    this._costs = [];
    this._yields = [];
    this._executed = false;
  }

  /**
   * 添加消耗
   */
  addCost(itemId, amount) {
    this._costs.push({ itemId, amount });
    return this;
  }

  /**
   * 添加产出
   */
  addYield(itemId, amount) {
    this._yields.push({ itemId, amount });
    return this;
  }

  /**
   * 检查消耗是否可承受
   */
  canAfford() {
    for (const cost of this._costs) {
      if (!this.inventory.has(cost.itemId, cost.amount)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 执行事务（消耗 + 产出）
   * @returns {boolean} 是否成功
   */
  execute() {
    if (this._executed) return false;
    if (!this.canAfford()) return false;

    for (const cost of this._costs) {
      this.inventory.remove(cost.itemId, cost.amount);
    }
    for (const item of this._yields) {
      this.inventory.add(item.itemId, item.amount);
    }

    this._executed = true;
    return true;
  }

  /**
   * 获取事务摘要
   */
  toJSON() {
    return {
      costs: [...this._costs],
      yields: [...this._yields],
      executed: this._executed,
    };
  }

  /**
   * 工厂方法：从 Action 的 costs/yields 创建事务
   * @param {import('../abstract/inventory.js').Inventory} inventory
   * @param {Array} costs
   * @param {Array} yields
   */
  static fromAction(inventory, costs, yields) {
    const tx = new ItemTransaction(inventory);
    for (const c of costs || []) {
      tx.addCost(c.itemId, c.amount);
    }
    for (const y of yields || []) {
      tx.addYield(y.itemId, y.amount);
    }
    return tx;
  }
}
