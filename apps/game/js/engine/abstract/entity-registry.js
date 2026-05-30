/**
 * EntityRegistry - 全局实体注册表
 *
 * 注册表模式（Registry）：管理所有实体的生命周期和索引。
 */
export class EntityRegistry {
  constructor() {
    /** @type {Map<string, import('./base-entity.js').BaseEntity>} */
    this._entities = new Map();
    /** @type {Map<string, Set<string>>} type -> Set<entityId> */
    this._byType = new Map();
  }

  /**
   * 注册实体
   * @param {import('./base-entity.js').BaseEntity} entity
   */
  register(entity) {
    if (this._entities.has(entity.id)) {
      throw new Error(`Entity already registered: ${entity.id}`);
    }
    this._entities.set(entity.id, entity);

    if (!this._byType.has(entity.type)) {
      this._byType.set(entity.type, new Set());
    }
    this._byType.get(entity.type).add(entity.id);
  }

  /**
   * 注销实体
   */
  unregister(entityId) {
    const entity = this._entities.get(entityId);
    if (!entity) return;
    this._entities.delete(entityId);
    this._byType.get(entity.type)?.delete(entityId);
  }

  /**
   * 根据 ID 获取实体
   * @returns {import('./base-entity.js').BaseEntity | undefined}
   */
  getById(id) {
    return this._entities.get(id);
  }

  /**
   * 根据类型获取所有实体
   * @param {string} type
   * @returns {import('./base-entity.js').BaseEntity[]}
   */
  getByType(type) {
    const ids = this._byType.get(type);
    if (!ids) return [];
    return Array.from(ids).map(id => this._entities.get(id)).filter(Boolean);
  }

  /**
   * 获取所有存活的实体
   */
  getAllAlive() {
    return Array.from(this._entities.values()).filter(e => e.alive);
  }

  /**
   * 获取所有实体
   */
  getAll() {
    return Array.from(this._entities.values());
  }

  /**
   * 获取特定类型中存活的实体
   */
  getAliveByType(type) {
    return this.getByType(type).filter(e => e.alive);
  }

  /**
   * 实体总数
   */
  get count() {
    return this._entities.size;
  }

  /**
   * 清空注册表
   */
  clear() {
    this._entities.clear();
    this._byType.clear();
  }

  /**
   * 条件查询
   * @param {Function} predicate (entity) => boolean
   * @returns {import('./base-entity.js').BaseEntity[]}
   */
  query(predicate) {
    return Array.from(this._entities.values()).filter(predicate);
  }
}
