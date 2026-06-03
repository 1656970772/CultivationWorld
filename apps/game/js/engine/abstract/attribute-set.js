/**
 * AttributeSet - 属性的「基值 + Σ修正层」（ADR-042，参考 UE GAS AttributeSet）
 *
 * 把属性读取从「直接覆写基值」改为「基值 + 来源化修正层」，杜绝加了 buff 忘了减
 * （对齐 ACS ModifierBase Enter/Leave 对称、reference-acs-rimworld §5.1）。
 *
 * 设计：
 * - 基值来源 = 实体的 RuntimeState（如 _initHp 写入的 maxHp）。AttributeSet 不复制基值，
 *   读基值时实时从 state 读，保证与现有 state.set 兼容（向后兼容：未挂修正的属性 getEffective == state.get）。
 * - 修正层 = 以 source（Effect 实例 id）为键的修正记录，支持对称增删。
 * - getEffective(key) = 基值依次叠加 add → multiply → override 后的有效值。
 *
 * 阶段1 仅 hp 相关走管线；maxHp/atk/def 的修正在阶段2 接入灵根/体质/丹药时启用。
 * 纯结构逻辑，不引入随机。
 */

const OP_ORDER = { add: 0, multiply: 1, override: 2 };

export class AttributeSet {
  /**
   * @param {import('./runtime-state.js').RuntimeState} state 基值来源（实体 state）
   */
  constructor(state) {
    this._state = state;
    /**
     * @type {Map<string, Array<{source:string, op:string, value:number}>>}
     * attribute → 修正记录列表
     */
    this._modifiers = new Map();
    /**
     * @type {Map<string, number>}
     * 派生属性键的默认基值（不在 state 上的纯机制属性，如 traitSpeedMult 基值 1.0）。
     * state 上存在的属性（hp/maxHp 等）仍以 state 为基值源，不需登记此处。
     */
    this._defaultBases = new Map();
  }

  /**
   * 登记派生属性键的默认基值（用于不存在于 state 的纯机制属性）。
   * @param {string} key
   * @param {number} value 默认基值（乘法类用 1.0，加法类用 0）
   */
  setDefaultBase(key, value) {
    this._defaultBases.set(key, value);
  }

  /** 基值（state 上有则取 state，否则取登记的默认基值，再否则 0）。 */
  getBase(key) {
    const v = this._state?.get(key);
    if (typeof v === 'number') return v;
    if (this._defaultBases.has(key)) return this._defaultBases.get(key);
    return 0;
  }

  /**
   * 添加一条修正。
   * @param {string} key 属性键
   * @param {string} source 来源标识（同一来源可一并 removeModifiersFrom）
   * @param {string} op 'add' | 'multiply' | 'override'
   * @param {number} value
   */
  addModifier(key, source, op, value) {
    if (!this._modifiers.has(key)) this._modifiers.set(key, []);
    this._modifiers.get(key).push({ source, op, value });
  }

  /** 移除某来源在所有属性上的修正（对称撤销）。 */
  removeModifiersFrom(source) {
    for (const [key, list] of this._modifiers) {
      const filtered = list.filter(m => m.source !== source);
      if (filtered.length === 0) this._modifiers.delete(key);
      else this._modifiers.set(key, filtered);
    }
  }

  /** 某属性是否有任何修正。 */
  hasModifiers(key) {
    const list = this._modifiers.get(key);
    return !!list && list.length > 0;
  }

  /**
   * 有效值 = 基值依次叠加 add → multiply → override。
   * 无修正时等于基值（向后兼容）。
   * @param {string} key
   * @returns {number}
   */
  getEffective(key) {
    const base = this.getBase(key);
    const list = this._modifiers.get(key);
    if (!list || list.length === 0) return base;

    const sorted = [...list].sort((a, b) => (OP_ORDER[a.op] ?? 0) - (OP_ORDER[b.op] ?? 0));
    let value = base;
    let overrideValue = null;
    for (const m of sorted) {
      switch (m.op) {
        case 'add': value += m.value; break;
        case 'multiply': value *= m.value; break;
        case 'override': overrideValue = m.value; break;
        default: break;
      }
    }
    return overrideValue !== null ? overrideValue : value;
  }

  snapshot() {
    return { modifiers: Object.fromEntries(this._modifiers) };
  }

  restore(snap) {
    this._modifiers.clear();
    const mods = snap?.modifiers || {};
    for (const [key, list] of Object.entries(mods)) {
      this._modifiers.set(key, Array.isArray(list) ? list.map(m => ({ ...m })) : []);
    }
  }
}
