/**
 * GameplayEffect - 对属性/标签的修改（ADR-042，参考 UE GAS GameplayEffect）
 *
 * 三类生命周期（durationType）：
 * - instant：一次性，立即结算（伤害、回血、锁血 override）。不进活跃列表，无对称撤销。
 * - duration：限时 buff/debuff，倒计时到期对称撤销（护体、丹毒、加速）。
 * - infinite：常驻直到移除条件命中（先天特质、灵根/体质加成、境界压制）。
 *
 * EffectEngine 是无状态工具：
 * - applyEffect(target, effectDef, ctx)：施加一个 Effect 到目标的 AbilityComponent。
 *   instant 立即结算并丢弃；duration/infinite 创建 ActiveEffect 入活跃列表（enter）。
 * - tickActiveEffects(component)：推进所有活跃 Effect 倒计时，到期 leave 撤销。
 *
 * 数据驱动：data/effects/*.json，字段见 docs/systems/gameplay-ability-system.md §4。
 * 不引入随机（magnitude 为确定值），确定性无关。
 */

/** Effect 定义模板（不可变）。 */
export class GameplayEffectDef {
  constructor(config) {
    this.id = config.id;
    this.name = config.name || config.id;
    this.assetTags = config.assetTags || [];
    this.durationType = config.durationType || 'instant';
    this.durationDays = config.durationDays ?? 0;
    /** @type {Array<{attribute, op, magnitudeType, magnitude}>} */
    this.modifiers = config.modifiers || [];
    this.grantsTags = config.grantsTags || [];
    this.removalTags = config.removalTags || [];
    this.stacking = config.stacking || 'none';
  }
}

/** 活跃 Effect 实例（duration/infinite 期间存在于 AbilityComponent）。 */
export class ActiveEffect {
  /**
   * @param {GameplayEffectDef} def
   * @param {string} instanceId 唯一来源标识（供 AttributeSet 对称撤销）
   */
  constructor(def, instanceId) {
    this.def = def;
    this.instanceId = instanceId;
    this.remainingDays = def.durationType === 'duration' ? def.durationDays : Infinity;
    /** @type {string[]} 本实例授予目标的 Tag（leave 时移除） */
    this.grantedTags = [];
    /** @type {boolean} 是否已把属性修正叠加进 AttributeSet（leave 时撤销） */
    this.appliedAttributeModifiers = false;
  }
}

/**
 * 把来源声明 spec 覆盖到 Effect 的 modifier 上，得到本次实际生效的 modifier。
 *
 * 通用 Effect 原语只声明 attribute/op（机制），具体数值与量纲参数（magnitude/magnitudeType/
 * decay/baseRankId/minMagnitude/clamp）由"挂载来源"（丹药/灵草/精血在 items.json 的 effects 项）
 * 提供。spec 同名字段优先覆盖 modifier 默认值。通用原语通常单 modifier，spec 覆盖其全部 modifier。
 * @param {Object} mod Effect 定义里的 modifier
 * @param {Object} spec 来源声明（可含 attribute/op/magnitude/magnitudeType/decay/baseRankId/minMagnitude/clamp）
 * @returns {Object} 合并后的 modifier
 */
function mergeModifierWithSpec(mod, spec) {
  if (!spec) return mod;
  const merged = { ...mod };
  const keys = ['attribute', 'op', 'magnitude', 'magnitudeType', 'decay', 'baseRankId', 'minMagnitude', 'clamp'];
  for (const k of keys) {
    if (spec[k] !== undefined) merged[k] = spec[k];
  }
  return merged;
}

/**
 * 解析单条 modifier 的数值大小。
 * @param {Object} mod { attribute, op, magnitudeType, magnitude }
 * @param {Object} target 目标实体（用于 ratioOfMaxHp 等动态量纲）
 * @returns {number}
 */
function resolveMagnitude(mod, target, ctx = {}) {
  const m = mod.magnitude ?? 0;
  switch (mod.magnitudeType) {
    case 'flat':
    case undefined:
    case null:
      return m;
    case 'ratioOfMaxHp': {
      const maxHp = target?.attributes?.getEffective
        ? target.attributes.getEffective('maxHp')
        : (target?.state?.get('maxHp') || 0);
      return maxHp * m;
    }
    case 'rankDecay': {
      // 低阶丹对高境界递减（ADR-040）：m × decay^max(0, 当前order - baseOrder)，夹 minMagnitude。
      // 参数取 mod.decay / mod.baseRankId / mod.minMagnitude；缺省或 decay>=1 退回固定量。
      const decay = mod.decay;
      const baseRankId = mod.baseRankId;
      const minMag = mod.minMagnitude ?? 1;
      if (!decay || decay >= 1 || !baseRankId) return m;
      const ranks = target?._ranksData || ctx.ranks || [];
      if (!ranks.length) return m;
      const curRank = ranks.find(r => r.id === (target?.state?.get('rankId') || 'mortal'));
      const baseRank = ranks.find(r => r.id === baseRankId);
      if (!curRank || !baseRank) return m;
      const step = Math.max(0, (curRank.order ?? 0) - (baseRank.order ?? 0));
      return Math.max(minMag, m * Math.pow(decay, step));
    }
    case 'ratioOfCultivationRequired': {
      const ranks = target?._ranksData || ctx.ranks || [];
      if (!ranks.length) return m;
      const rankId = target?.state?.get('rankId') || 'mortal';
      const current = ranks.find(r => r.id === rankId);
      const currentOrder = Number(current?.order ?? 0);
      const next = [...ranks]
        .filter(r => r?.category === 'cultivation' || Number(r?.cultivationRequired ?? r?.qiRequired ?? 0) > 0)
        .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0))
        .find(r => Number(r?.order ?? 0) > currentOrder);
      const required = Number(next?.cultivationRequired ?? next?.qiRequired ?? 0);
      return required > 0 ? required * m : m;
    }
    default:
      return m;
  }
}

/**
 * 把 clamp 端点解析为数值。支持动态键字符串 "maxHp"（从目标读 maxHp），
 * null/undefined 表示该端不限，数字直接用。
 */
function resolveClampBound(bound, target) {
  if (bound == null) return null;
  if (typeof bound === 'number') return bound;
  if (bound === 'maxHp') {
    return target?.attributes?.getEffective
      ? target.attributes.getEffective('maxHp')
      : (target?.state?.get('maxHp') ?? null);
  }
  return null;
}

/** 按 mod.clamp [min,max] 夹取（端点可为数字、null=不限、或动态键 "maxHp"）。 */
function applyClamp(value, mod, target) {
  const c = mod.clamp;
  if (!Array.isArray(c)) return value;
  const lo = resolveClampBound(c[0], target);
  const hi = resolveClampBound(c[1], target);
  let v = value;
  if (lo != null) v = Math.max(lo, v);
  if (hi != null) v = Math.min(hi, v);
  return v;
}

export const EffectEngine = {
  /**
   * 施加一个 Effect 到目标。
   * @param {Object} target 目标实体（须有 abilityComponent / attributes / state）
   * @param {GameplayEffectDef} def
   * @param {Object} [ctx] { source?: 施加来源实体, instanceId?: string, spec?: 来源数值声明 }
   *   ctx.spec：通用 Effect 原语的数值来源（覆盖 modifier 的 magnitude/量纲/clamp 等，见 mergeModifierWithSpec）。
   * @returns {{ applied:boolean, instant:boolean, results:Object, mods:Array<{attribute,op,delta,newValue}> }}
   */
  applyEffect(target, def, ctx = {}) {
    if (!target || !def) return { applied: false, instant: false, results: {}, mods: [] };
    const component = target.abilityComponent;
    const attributes = target.attributes;
    const tags = component?.tags;

    if (def.durationType === 'instant') {
      const { results, mods } = this._applyInstantModifiers(target, def, ctx);
      // instant 的 grantsTags 在 GAS 中通常无意义；本项目用于"瞬时标记"（如 State.Dying 由锁血 Effect 授予后常驻）。
      // 约定：instant Effect 的 grantsTags 直接持久授予（计入 TagContainer），由后续逻辑移除。
      if (tags) for (const t of def.grantsTags) tags.add(t);
      return { applied: true, instant: true, results, mods };
    }

    // duration / infinite：创建活跃实例并 enter。
    if (!component) return { applied: false, instant: false, results: {}, mods: [] };
    const instanceId = ctx.instanceId || `${def.id}#${component.nextInstanceSeq()}`;
    const active = new ActiveEffect(def, instanceId);

    // 叠加属性修正到 AttributeSet（来源化，可对称撤销）。spec 覆盖 modifier 数值。
    if (attributes) {
      for (const baseMod of def.modifiers) {
        const mod = mergeModifierWithSpec(baseMod, ctx.spec);
        const value = resolveMagnitude(mod, target, ctx);
        attributes.addModifier(mod.attribute, instanceId, mod.op || 'add', value);
      }
      active.appliedAttributeModifiers = true;
    }
    // 授予 Tag。
    if (tags) {
      for (const t of def.grantsTags) { tags.add(t); active.grantedTags.push(t); }
    }
    component.activeEffects.push(active);
    return { applied: true, instant: false, results: {}, mods: [] };
  },

  /**
   * instant Effect：直接结算属性变化到 state（不进修正层）。spec 覆盖 modifier 数值。
   * @returns {{ results: Object, mods: Array<{attribute,op,delta,newValue}> }}
   */
  _applyInstantModifiers(target, def, ctx = {}) {
    const results = {};
    const mods = [];
    const state = target.state;
    const attributes = target.attributes;
    for (const baseMod of def.modifiers) {
      const mod = mergeModifierWithSpec(baseMod, ctx.spec);
      const value = resolveMagnitude(mod, target, ctx);
      const key = mod.attribute;
      const base = attributes?.getEffective ? attributes.getEffective(key) : (state?.get(key) || 0);
      let next;
      switch (mod.op) {
        case 'add': next = base + value; break;
        case 'multiply': next = base * value; break;
        case 'override': next = value; break;
        default: next = base; break;
      }
      next = applyClamp(next, mod, target);
      if (state) state.set(key, next);
      results[key] = next;
      mods.push({ attribute: key, op: mod.op, delta: next - base, newValue: next });
    }
    return { results, mods };
  },

  /**
   * 推进活跃 Effect 倒计时，到期对称撤销（leave）。
   * @param {Object} component AbilityComponent
   */
  tickActiveEffects(component) {
    if (!component || !Array.isArray(component.activeEffects)) return;
    const remaining = [];
    for (const active of component.activeEffects) {
      if (active.remainingDays !== Infinity) active.remainingDays -= 1;
      if (active.remainingDays <= 0) {
        this._leave(component, active);
      } else {
        remaining.push(active);
      }
    }
    component.activeEffects = remaining;
  },

  /** 对称撤销一个活跃 Effect：移除属性修正 + 移除授予的 Tag。 */
  _leave(component, active) {
    if (active.appliedAttributeModifiers && component.attributes) {
      component.attributes.removeModifiersFrom(active.instanceId);
    }
    if (component.tags) {
      for (const t of active.grantedTags) component.tags.remove(t);
    }
  },

  /** 立即移除某活跃 Effect（按 instanceId）。 */
  removeActiveEffect(component, instanceId) {
    if (!component || !Array.isArray(component.activeEffects)) return;
    const remaining = [];
    for (const active of component.activeEffects) {
      if (active.instanceId === instanceId) this._leave(component, active);
      else remaining.push(active);
    }
    component.activeEffects = remaining;
  },
};
