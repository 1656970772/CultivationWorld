/**
 * AbilityPool - GameplayAbility 定义注册表（单例，ADR-042）
 *
 * 从 data/abilities/*.json 加载能力定义，供 AbilityComponent 按 id 查询。
 */
import { GameplayAbilityDef } from '../abstract/gameplay-ability.js';

class AbilityPoolClass {
  constructor() {
    /** @type {Map<string, GameplayAbilityDef>} */
    this._abilities = new Map();
  }

  register(config) {
    const def = new GameplayAbilityDef(config);
    this._abilities.set(def.id, def);
    return def;
  }

  /** 从 JSON 批量加载。接受 { abilities:[...] } 或直接数组。 */
  loadFromConfig(data) {
    const list = Array.isArray(data) ? data : (data?.abilities || []);
    for (const cfg of list) this.register(cfg);
  }

  get(id) { return this._abilities.get(id); }
  has(id) { return this._abilities.has(id); }
  getAll() { return Array.from(this._abilities.values()); }
  get count() { return this._abilities.size; }
  clear() { this._abilities.clear(); }

  /** 收集所有 Ability 引用到的 Tag（供加载期 GameplayTag 校验）。 */
  referencedTags() {
    const tags = new Set();
    for (const def of this._abilities.values()) {
      if (def.abilityTag) tags.add(def.abilityTag);
      for (const t of def.triggerTags) tags.add(t);
      for (const t of def.blockedByTags) tags.add(t);
    }
    return Array.from(tags);
  }
}

export const AbilityPool = new AbilityPoolClass();
