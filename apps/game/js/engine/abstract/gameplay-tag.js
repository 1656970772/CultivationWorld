/**
 * GameplayTag - 层级字符串标签系统（ADR-042，参考 UE GAS GameplayTag）
 *
 * 标签为 `.` 分隔的层级字符串（如 `State.Dying`、`Ability.Escape`）。
 * 父标签匹配：持有 `State.Dying` 时查询父标签 `State` 命中（hasTag('State') === true）。
 *
 * - GameplayTagRegistry（单例）：登记所有合法 Tag，加载期校验未登记 Tag（ConfigErrors，
 *   对齐 docs/architecture/reference-acs-rimworld.md §5.5）。
 * - TagContainer：实体持有的标签集合，支持父标签匹配与查询。
 *
 * 不引入随机，纯结构逻辑，确定性无关。
 */

/** 把一个 Tag 展开为其自身 + 所有祖先（`A.B.C` → [`A.B.C`, `A.B`, `A`]）。 */
function expandTagWithAncestors(tag) {
  const parts = tag.split('.');
  const out = [];
  for (let i = parts.length; i >= 1; i--) {
    out.push(parts.slice(0, i).join('.'));
  }
  return out;
}

class GameplayTagRegistryClass {
  constructor() {
    /** @type {Set<string>} 已登记的精确 Tag */
    this._tags = new Set();
    /** @type {boolean} 是否启用严格校验（未登记 Tag 抛错） */
    this._strict = false;
  }

  /**
   * 从 tags.json 批量登记。
   * @param {Object} data { strict?:boolean, tags:[{id, description}] }
   */
  loadFromConfig(data) {
    if (!data) return;
    this._strict = data.strict === true;
    const tags = Array.isArray(data.tags) ? data.tags : [];
    for (const t of tags) {
      const id = typeof t === 'string' ? t : t?.id;
      if (id) this._tags.add(id);
    }
  }

  register(tag) {
    if (tag) this._tags.add(tag);
  }

  isRegistered(tag) {
    return this._tags.has(tag);
  }

  /**
   * 加载期校验：返回引用了未登记 Tag 的错误列表（不抛错，由调用方决定如何处理）。
   * @param {string[]} referencedTags
   * @returns {string[]} 错误信息
   */
  validateReferences(referencedTags) {
    const errors = [];
    for (const tag of referencedTags) {
      if (!this._tags.has(tag)) {
        errors.push(`未登记的 GameplayTag: "${tag}"（请在 data/tags/tags.json 中登记）`);
      }
    }
    return errors;
  }

  get strict() { return this._strict; }
  get count() { return this._tags.size; }
  getAll() { return Array.from(this._tags); }
  clear() { this._tags.clear(); this._strict = false; }
}

export const GameplayTagRegistry = new GameplayTagRegistryClass();

/**
 * TagContainer - 实体持有的标签集合。
 *
 * 内部维护「带计数的精确 Tag」+「展开后的可查询索引」，支持同一 Tag 被多来源叠加授予，
 * 移除一次仅减一次计数，全部移除后该 Tag 才真正消失（对齐 GAS 标签计数语义）。
 */
export class TagContainer {
  constructor() {
    /** @type {Map<string, number>} 精确 Tag → 计数 */
    this._counts = new Map();
    /** @type {Map<string, number>} 展开 Tag（含祖先）→ 计数，供 hasTag 父匹配 */
    this._index = new Map();
  }

  /** 增加一个 Tag（计数 +1）。 */
  add(tag) {
    if (!tag) return;
    this._counts.set(tag, (this._counts.get(tag) || 0) + 1);
    for (const t of expandTagWithAncestors(tag)) {
      this._index.set(t, (this._index.get(t) || 0) + 1);
    }
  }

  /** 移除一个 Tag（计数 -1，归零则删除）。 */
  remove(tag) {
    if (!tag) return;
    const c = this._counts.get(tag);
    if (!c) return;
    if (c <= 1) this._counts.delete(tag);
    else this._counts.set(tag, c - 1);
    for (const t of expandTagWithAncestors(tag)) {
      const ic = this._index.get(t);
      if (!ic) continue;
      if (ic <= 1) this._index.delete(t);
      else this._index.set(t, ic - 1);
    }
  }

  /**
   * 是否持有某 Tag（支持父标签匹配：持有 `State.Dying` 时 hasTag('State') 为 true）。
   * @param {string} tag
   * @returns {boolean}
   */
  hasTag(tag) {
    return (this._index.get(tag) || 0) > 0;
  }

  /** 是否持有列表中任一 Tag。 */
  hasAny(tags) {
    if (!Array.isArray(tags)) return false;
    return tags.some(t => this.hasTag(t));
  }

  /** 是否持有列表中全部 Tag。 */
  hasAll(tags) {
    if (!Array.isArray(tags)) return true;
    return tags.every(t => this.hasTag(t));
  }

  /** 返回当前精确持有的 Tag 列表（不含展开祖先）。 */
  list() {
    return Array.from(this._counts.keys());
  }

  snapshot() {
    return { counts: Object.fromEntries(this._counts) };
  }

  restore(snap) {
    this._counts.clear();
    this._index.clear();
    const counts = snap?.counts || {};
    for (const [tag, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) this.add(tag);
    }
  }
}
