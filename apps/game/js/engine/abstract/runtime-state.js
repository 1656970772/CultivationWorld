/**
 * RuntimeState - 运行时状态（可观察）
 *
 * 可观察的动态属性容器，状态变更自动触发回调。
 * Observer 模式：通过 onChange 注册变更监听。
 */
export class RuntimeState {
  /**
   * @param {Object} initialValues 初始键值对
   */
  constructor(initialValues = {}) {
    this._values = {};
    this._listeners = new Map();
    this._globalListeners = new Set();

    for (const [key, value] of Object.entries(initialValues)) {
      this._values[key] = this._deepCopy(value);
    }
  }

  get(key) {
    return this._values[key];
  }

  set(key, value) {
    const old = this._values[key];
    this._values[key] = value;
    this._notify(key, value, old);
  }

  /** 批量设置，只触发一次全局通知 */
  setMany(updates) {
    const changes = {};
    for (const [key, value] of Object.entries(updates)) {
      const old = this._values[key];
      this._values[key] = value;
      changes[key] = { newValue: value, oldValue: old };

      const keyListeners = this._listeners.get(key);
      if (keyListeners) {
        for (const cb of keyListeners) {
          cb(value, old, key);
        }
      }
    }

    for (const cb of this._globalListeners) {
      cb(changes);
    }
  }

  has(key) {
    return key in this._values;
  }

  keys() {
    return Object.keys(this._values);
  }

  /**
   * 监听某个键的变更
   * @returns {Function} 取消监听的函数
   */
  onChange(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);
    return () => this._listeners.get(key)?.delete(callback);
  }

  /**
   * 监听任意键的变更
   * @returns {Function} 取消监听的函数
   */
  onAnyChange(callback) {
    this._globalListeners.add(callback);
    return () => this._globalListeners.delete(callback);
  }

  /** 返回当前状态的不可变快照 */
  snapshot() {
    return this._deepCopy(this._values);
  }

  /** 从快照恢复状态（用于读档） */
  restore(snapshot) {
    this._values = this._deepCopy(snapshot);
  }

  /** 转换为 GOAP 使用的扁平键值对 */
  toGOAPState() {
    const flat = {};
    for (const [key, value] of Object.entries(this._values)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [subKey, subValue] of Object.entries(value)) {
          flat[`${key}.${subKey}`] = subValue;
        }
      } else {
        flat[key] = value;
      }
    }
    return flat;
  }

  _notify(key, newValue, oldValue) {
    const keyListeners = this._listeners.get(key);
    if (keyListeners) {
      for (const cb of keyListeners) {
        cb(newValue, oldValue, key);
      }
    }
    for (const cb of this._globalListeners) {
      cb({ [key]: { newValue, oldValue } });
    }
  }

  _deepCopy(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(v => this._deepCopy(v));
    const copy = {};
    for (const [k, v] of Object.entries(obj)) {
      copy[k] = this._deepCopy(v);
    }
    return copy;
  }
}
