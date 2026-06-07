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
 *   阻挡且道具足够时激活（预解析 grantsEffects → 消耗道具 → 授予 Effect → 跑 executor）。
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
import { ItemRegistry } from '../items/item-registry.js';

const REQUIRED_ITEM_SELECTOR_CONTROL_FIELDS = new Set(['consumeGrantedSourceFirst']);

function normalizeGrantedEffect(entry) {
  if (typeof entry === 'string') return { effectId: entry, spec: {} };
  if (!entry || typeof entry !== 'object') return { effectId: null, spec: {} };
  return {
    effectId: entry.effect || entry.effectId || entry.id || null,
    spec: entry.spec && typeof entry.spec === 'object' ? { ...entry.spec } : {},
  };
}

function resolveContextEffectSpec(effectId, ctx) {
  const out = {};
  if (ctx.effectSpecs && typeof ctx.effectSpecs === 'object') {
    const keyed = ctx.effectSpecs[effectId];
    if (keyed && typeof keyed === 'object') Object.assign(out, keyed);
  }
  if (ctx.effectSpec && typeof ctx.effectSpec === 'object') {
    const keyed = ctx.effectSpec[effectId];
    if (keyed && typeof keyed === 'object') Object.assign(out, keyed);
  }
  return out;
}

function requiredItemAmount(req, fallback = undefined) {
  const raw = req?.amount ?? req?.quantity ?? fallback ?? 1;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : 1;
}

function inventoryAmount(inventory, itemId) {
  return inventory?.getAmount ? Number(inventory.getAmount(itemId) || 0) : 0;
}

function getItemField(item, key) {
  if (!item || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(item, key)) return item[key];
  if (item.properties && Object.prototype.hasOwnProperty.call(item.properties, key)) {
    return item.properties[key];
  }
  return undefined;
}

function selectorMatchesItem(item, selector) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return false;
  for (const [key, expected] of Object.entries(selector)) {
    if (REQUIRED_ITEM_SELECTOR_CONTROL_FIELDS.has(key)) continue;
    const actual = getItemField(item, key);
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function preferredSelectorItemIds(selector, ctx) {
  if (!selector?.consumeGrantedSourceFirst) return [];
  const context = ctx || {};
  return [context.sourceItemId, context.itemId, context.grantedSourceItemId].filter(Boolean);
}

function resolveSelectorItemId(selector, amount, inventory, ctx) {
  const preferred = new Set(preferredSelectorItemIds(selector, ctx));
  const candidates = ItemRegistry.getAll()
    .filter((item) => selectorMatchesItem(item, selector))
    .map((item) => item.id)
    .sort((a, b) => {
      const ap = preferred.has(a) ? 0 : 1;
      const bp = preferred.has(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.localeCompare(b);
    });

  for (const itemId of candidates) {
    if (inventoryAmount(inventory, itemId) >= amount) return itemId;
  }
  return null;
}

function resolveRequiredItemOption(req, inventory, ctx, fallbackAmount) {
  if (!req || typeof req !== 'object') return null;
  const amount = requiredItemAmount(req, fallbackAmount);
  if (req.itemId) {
    return inventoryAmount(inventory, req.itemId) >= amount
      ? { itemId: req.itemId, amount }
      : null;
  }
  if (req.selector) {
    const itemId = resolveSelectorItemId(req.selector, amount, inventory, ctx);
    return itemId ? { itemId, amount } : null;
  }
  return null;
}

function resolveRequiredItemConsume(req, inventory, ctx) {
  if (Array.isArray(req?.anyOf)) {
    const inheritedAmount = requiredItemAmount(req);
    for (const option of req.anyOf) {
      const merged = { ...req, ...option };
      delete merged.anyOf;
      const resolved = resolveRequiredItemOption(merged, inventory, ctx, inheritedAmount);
      if (resolved) return resolved;
    }
    return null;
  }
  return resolveRequiredItemOption(req, inventory, ctx);
}

function resolveRequiredItemConsumes(requiredItems, inventory, ctx) {
  if (!Array.isArray(requiredItems) || requiredItems.length === 0) return [];
  if (!inventory) return null;

  const consumes = [];
  const totals = new Map();
  for (const req of requiredItems) {
    const resolved = resolveRequiredItemConsume(req, inventory, ctx);
    if (!resolved) return null;
    consumes.push(resolved);
    totals.set(resolved.itemId, (totals.get(resolved.itemId) || 0) + resolved.amount);
  }

  for (const [itemId, amount] of totals) {
    if (inventoryAmount(inventory, itemId) < amount) return null;
  }
  return consumes;
}

function consumeResolvedItems(inventory, consumes) {
  const totals = new Map();
  for (const consume of consumes) {
    totals.set(consume.itemId, (totals.get(consume.itemId) || 0) + consume.amount);
  }
  for (const [itemId, amount] of totals) {
    inventory.remove(itemId, amount);
  }
}

function resolveGrantedEffects(def, ctx) {
  if (!Array.isArray(def.grantsEffects)) {
    throw new Error(`AbilityComponent: grantsEffects must be an array for ability "${def.id}"`);
  }

  return def.grantsEffects.map((entry) => {
    const grant = normalizeGrantedEffect(entry);
    if (!grant.effectId) {
      throw new Error(`AbilityComponent: invalid grantsEffects entry for ability "${def.id}"`);
    }
    const effDef = EffectPool.get(grant.effectId);
    if (!effDef) {
      throw new Error(`AbilityComponent: effect "${grant.effectId}" is not registered for ability "${def.id}"`);
    }
    return {
      effectId: grant.effectId,
      def: effDef,
      spec: {
        ...grant.spec,
        ...resolveContextEffectSpec(grant.effectId, ctx),
      },
    };
  });
}

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
    const inv = this.owner?.inventory;
    // 先解析 grantsEffects，避免缺失 Effect 被静默跳过或在道具消耗后才失败。
    const resolvedEffects = resolveGrantedEffects(def, ctx);
    // executor 必须严格存在，避免配置错误被静默吞掉且已消耗道具/施加 Effect。
    let executorFn = null;
    if (def.executor) {
      executorFn = AbilityExecutorRegistry.get(def.executor);
      if (!executorFn) {
        throw new Error(`AbilityComponent: executor "${def.executor}" is not registered for ability "${def.id}"`);
      }
    }
    // 道具不足。
    const consumes = resolveRequiredItemConsumes(def.requiredItems, inv, ctx);
    if (consumes === null) return { activated: false, reason: 'no_item' };
    // 消耗道具。
    if (inv?.remove) consumeResolvedItems(inv, consumes);
    // 授予 Effect。grantsEffects 支持字符串和 { effect, spec } 对象形式。
    const effects = [];
    for (const effect of resolvedEffects) {
      const result = EffectEngine.applyEffect(this.owner, effect.def, {
        source: ctx.source || null,
        spec: effect.spec,
        abilityId: def.id,
      });
      effects.push({ effectId: effect.effectId, applied: result.applied, result });
    }
    // 跑自定义执行器。
    let execResult = null;
    if (executorFn) execResult = executorFn(this.owner, def, worldContext, ctx) || null;
    return { activated: true, effects, executor: execResult };
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
