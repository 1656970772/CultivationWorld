/**
 * StaticData - 静态数据基类
 *
 * 出生时设定，运行时不可变。
 * Flyweight 模式：相同类型的元数据共享同一实例。
 */
export class StaticData {
  /** @param {Object} config 原始配置对象，将被冻结 */
  constructor(config) {
    this._data = Object.freeze({ ...config });
  }

  get(key) {
    return this._data[key];
  }

  has(key) {
    return key in this._data;
  }

  /** 返回所有键值的浅拷贝 */
  toJSON() {
    return { ...this._data };
  }

  /** 批量读取多个键 */
  getMany(keys) {
    const result = {};
    for (const key of keys) {
      result[key] = this._data[key];
    }
    return result;
  }
}
