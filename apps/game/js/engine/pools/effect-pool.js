/**
 * EffectPool - GameplayEffect 定义注册表（单例，ADR-042）
 *
 * 从 data/effects/*.json 加载 Effect 定义，供 AbilityComponent/EffectEngine 按 id 查询。
 * 注册表模式，与 ItemRegistry / ActionPool 风格一致。
 */
import { GameplayEffectDef } from '../abstract/gameplay-effect.js';

class EffectPoolClass {
  constructor() {
    /** @type {Map<string, GameplayEffectDef>} */
    this._effects = new Map();
  }

  register(config) {
    const def = new GameplayEffectDef(config);
    this._effects.set(def.id, def);
    return def;
  }

  /**
   * 从 JSON 批量加载。接受 { effects:[...] } 或直接数组。
   * @param {Object|Array} data
   */
  loadFromConfig(data) {
    const list = Array.isArray(data) ? data : (data?.effects || []);
    for (const cfg of list) this.register(cfg);
  }

  get(id) { return this._effects.get(id); }
  has(id) { return this._effects.has(id); }
  getAll() { return Array.from(this._effects.values()); }
  get count() { return this._effects.size; }
  clear() { this._effects.clear(); }

  /** 收集所有 Effect 引用到的 Tag（供加载期 GameplayTag 校验）。 */
  referencedTags() {
    const tags = new Set();
    for (const def of this._effects.values()) {
      for (const t of def.assetTags) tags.add(t);
      for (const t of def.grantsTags) tags.add(t);
      for (const t of def.removalTags) tags.add(t);
    }
    return Array.from(tags);
  }
}

export const EffectPool = new EffectPoolClass();
