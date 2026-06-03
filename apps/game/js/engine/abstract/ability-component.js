/**
 * AbilityComponent - 实体的能力系统组件（ADR-042，参考 UE GAS AbilitySystemComponent）
 *
 * 挂在 BaseEntity 上，统管：
 * - tags：TagContainer（实体当前持有的 GameplayTag）。
 * - attributes：AttributeSet（基值 + 修正层，复用实体 state 作基值）。
 * - grantedAbilities：已授予的能力 id 列表。
 * - activeEffects：活跃的 duration/infinite Effect 实例。
 *
 * 职责：
 * - grantAbility / removeAbility：授予/移除能力（并维护 abilityTag）。
 * - tryActivateByTag：被动触发——遍历已授予能力，triggerTags 命中且未被 blockedByTags
 *   阻挡且道具足够时激活（消耗道具 → 授予 grantsEffects → 跑 executor）。
 * - tick：每 tick 推进活跃 Effect 倒计时。
 *
 * 确定性：自身不引入随机；executor 内随机走实体 _rng / worldContext.rng（ADR-038）。
 */
import { TagContainer } from './gameplay-tag.js';
import { AttributeSet } from './attribute-set.js';
import { EffectEngine } from './gameplay-effect.js';
import { AbilityPool } from '../pools/ability-pool.js';
import { EffectPool } from '../pools/effect-pool.js';
import { AbilityExecutorRegistry } from './gameplay-ability.js';

export class AbilityComponent {
  /**
   * @param {Object} owner 宿主实体（须有 state；可有 inventory/spatial）
   */
  constructor(owner) {
    this.owner = owner;
    this.tags = new TagContainer();
    this.attributes = new AttributeSet(owner?.state);
    /** @type {string[]} */
    this.grantedAbilities = [];
    /** @type {import('./gameplay-effect.js').ActiveEffect[]} */
    this.activeEffects = [];
    this._instanceSeq = 0;
  }

  /** 递增的实例序号（供 Effect 实例 id 唯一化，确定性、与随机无关）。 */
  nextInstanceSeq() { return ++this._instanceSeq; }

  /** 授予一个能力（幂等）；维护其 abilityTag。 */
  grantAbility(abilityId) {
    if (!abilityId || this.grantedAbilities.includes(abilityId)) return;
    const def = AbilityPool.get(abilityId);
    if (!def) return;
    this.grantedAbilities.push(abilityId);
    if (def.abilityTag) this.tags.add(def.abilityTag);
  }

  /** 移除一个能力；撤销其 abilityTag。 */
  removeAbility(abilityId) {
    const idx = this.grantedAbilities.indexOf(abilityId);
    if (idx < 0) return;
    this.grantedAbilities.splice(idx, 1);
    const def = AbilityPool.get(abilityId);
    if (def?.abilityTag) this.tags.remove(def.abilityTag);
  }

  hasAbility(abilityId) { return this.grantedAbilities.includes(abilityId); }

  /**
   * 被动触发：尝试激活所有 triggerTags 包含 triggerTag 的已授予能力。
   * 按 grantedAbilities 顺序激活（确定性）。
   * @param {string} triggerTag 触发标签（如 Trigger.LethalDamage / State.Dying）
   * @param {Object} worldContext
   * @param {Object} [ctx] 透传给执行器的上下文（如 { killer, cause }）
   * @returns {Array<{abilityId, activated, result}>}
   */
  tryActivateByTag(triggerTag, worldContext, ctx = {}) {
    const out = [];
    for (const abilityId of [...this.grantedAbilities]) {
      const def = AbilityPool.get(abilityId);
      if (!def) continue;
      if (!def.triggerTags.includes(triggerTag)) continue;
      const res = this._activate(def, worldContext, ctx);
      out.push({ abilityId, activated: res.activated, result: res });
    }
    return out;
  }

  /** 检查并激活单个能力定义。 */
  _activate(def, worldContext, ctx) {
    // 被阻挡。
    if (def.blockedByTags.length > 0 && this.tags.hasAny(def.blockedByTags)) {
      return { activated: false, reason: 'blocked' };
    }
    // 道具不足。
    const inv = this.owner?.inventory;
    if (def.requiredItems.length > 0) {
      for (const req of def.requiredItems) {
        const have = inv?.getAmount ? inv.getAmount(req.itemId) : 0;
        if (have < (req.amount || 1)) return { activated: false, reason: 'no_item' };
      }
    }
    // 消耗道具。
    if (inv?.remove) {
      for (const req of def.requiredItems) inv.remove(req.itemId, req.amount || 1);
    }
    // 授予 Effect。
    for (const effId of def.grantsEffects) {
      const effDef = EffectPool.get(effId);
      if (effDef) EffectEngine.applyEffect(this.owner, effDef, { source: ctx.source });
    }
    // 跑自定义执行器。
    let execResult = null;
    if (def.executor) {
      const fn = AbilityExecutorRegistry.get(def.executor);
      if (fn) execResult = fn(this.owner, def, worldContext, ctx) || null;
    }
    return { activated: true, executor: execResult };
  }

  /** 每 tick 推进活跃 Effect 倒计时。 */
  tick() {
    EffectEngine.tickActiveEffects(this);
  }

  snapshot() {
    return {
      tags: this.tags.snapshot(),
      attributes: this.attributes.snapshot(),
      grantedAbilities: [...this.grantedAbilities],
      // 活跃 Effect 仅存 id/remaining，重建从 EffectPool（阶段1 锁血为 instant，无活跃实例）。
      activeEffects: this.activeEffects.map(a => ({ defId: a.def.id, instanceId: a.instanceId, remainingDays: a.remainingDays })),
      instanceSeq: this._instanceSeq,
    };
  }
}
