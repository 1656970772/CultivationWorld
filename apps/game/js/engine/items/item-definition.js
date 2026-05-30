/**
 * ItemDefinition - 物品定义
 *
 * 享元模式：不可变的物品元数据，被 ItemRegistry 全局管理。
 */
export class ItemDefinition {
  /**
   * @param {Object} config
   * @param {string} config.id        唯一 ID
   * @param {string} config.name      显示名
   * @param {string} config.category  分类: 'resource' | 'prop'
   * @param {boolean} [config.stackable=true] 是否可堆叠
   * @param {string} [config.description]
   * @param {Object} [config.properties]  附加属性
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.category = config.category;
    this.stackable = config.stackable !== false;
    this.description = config.description || '';
    // properties：合并显式 properties 与配置上的其余领域字段（value/transferable/grade/combatBonus 等），
    // 使物品的经济/可转移/装备元数据可被资产估值、抢夺转移、战力加成等系统统一读取。
    const { id, name, category, stackable, description, properties, source, _comment, ...rest } = config;
    this.properties = Object.freeze({ ...rest, ...(properties || {}) });
    Object.freeze(this);
  }

  isResource() {
    return this.category === 'resource';
  }

  isProp() {
    return this.category === 'prop';
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      stackable: this.stackable,
      description: this.description,
      properties: { ...this.properties },
    };
  }
}
