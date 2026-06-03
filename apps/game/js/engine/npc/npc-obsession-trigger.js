/**
 * NPCObsessionTrigger —— NPC 执念触发器（ADR-019/023，从 npc-entity.js 抽离）。
 *
 * 把三类执念触发逻辑收敛为纯函数（仿 npc-utility.js 范例），NPCEntity 仅保留一行转发：
 *   - rollInnateObsession      先天执念：出生按人格/灵根 roll 一个初始执念（构造时一次）。
 *   - checkAcquiredObsession   后天执念：某类记忆刚写入且强度达阈值时生成（recordMemory 触发）。
 *   - checkConditionalObsession 条件执念：随寿元/境界/野心演化触发养老/传承（onPreTick 每日）。
 *   - matchStateCondition      { key, op, value } 状态条件比较（条件执念依赖）。
 *
 * 全部以 entity 为首参，仅读写 entity 的 obsessions/state/memory/staticData/_obsessionConfig，
 * 不改变任何随机序列或写入顺序。拆分边界见 ADR-030。
 */
import { Obsession } from '../abstract/obsession-system.js';

/**
 * 先天执念抽取（ADR-019）：按 obsession.json innate.rules 顺序匹配人格/灵根条件，
 * 命中且通过 chance 概率检定则赋予该执念。出生即定型，体现"天生的追求"。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {import('../abstract/rng.js').Rng} rng 确定性随机源。
 */
export function rollInnateObsession(entity, rng) {
  const rules = entity._obsessionConfig.innate?.rules;
  if (!Array.isArray(rules)) return;
  const personality = entity.staticData?.personality || {};
  const spiritRootId = entity.state.get('spiritRootId');
  for (const rule of rules) {
    if (rule.requireTrait) {
      const v = personality[rule.requireTrait.trait];
      if (typeof v !== 'number' || v < (rule.requireTrait.min ?? 0)) continue;
    }
    if (rule.requireSpiritRoot && !rule.requireSpiritRoot.includes(spiritRootId)) continue;
    if (rng.next() >= (rule.chance ?? 1)) continue;
    entity.obsessions.add(new Obsession({
      type: rule.type,
      name: rule.name,
      intensity: rule.intensity ?? 70,
      goalState: rule.goalState || {},
    }));
    break;
  }
}

/**
 * 后天执念触发（ADR-019）：某类记忆刚写入且强度达阈值时，生成对应执念。
 * 复仇/复活执念锁定记忆中的仇人/势力，作为未来"追踪/击杀"行为的 targetRef。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {string} memoryType 刚写入的记忆类型
 */
export function checkAcquiredObsession(entity, memoryType) {
  const rules = entity._obsessionConfig.acquired?.rules;
  if (!Array.isArray(rules)) return;
  for (const rule of rules) {
    if (rule.memoryType !== memoryType) continue;
    const strongest = entity.memory.getStrongest(memoryType);
    if (!strongest || strongest.intensity < (rule.minMemoryIntensity ?? 0)) continue;
    entity.obsessions.add(new Obsession({
      type: rule.type,
      name: rule.name,
      intensity: rule.intensity ?? 90,
      targetId: strongest.actorId,
      targetFactionId: strongest.factionId,
      goalState: rule.goalState || {},
    }));
  }
}

/**
 * 条件执念检查（ADR-023）：随 NPC 状态演化（寿元/境界/野心）触发的执念，
 * 区别于先天 roll（rollInnateObsession）与记忆触发（checkAcquiredObsession）。
 * 养老(retire)/传承(legacy) 属此类——人到暮年自然萌生的人生取向。
 * 在 onPreTick 每日调用：按 requireState 全部满足 + requireTrait + chance 概率检定生成。
 * 已有同类型执念则 ObsessionSystem.add 自动去重（保留强度更高者）。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {import('../abstract/rng.js').Rng} rng 确定性随机源。
 */
export function checkConditionalObsession(entity, rng) {
  const rules = entity._obsessionConfig.conditional?.rules;
  if (!Array.isArray(rules)) return;
  const personality = entity.staticData?.personality || {};
  for (const rule of rules) {
    if (entity.obsessions.has(rule.type)) continue;
    if (Array.isArray(rule.requireState)
        && !rule.requireState.every(c => matchStateCondition(entity, c))) continue;
    if (rule.requireTrait) {
      const v = personality[rule.requireTrait.trait];
      if (typeof v !== 'number') continue;
      if (rule.requireTrait.min != null && v < rule.requireTrait.min) continue;
      if (rule.requireTrait.max != null && v > rule.requireTrait.max) continue;
    }
    if (rng.next() >= (rule.chance ?? 1)) continue;
    entity.obsessions.add(new Obsession({
      type: rule.type,
      name: rule.name,
      intensity: rule.intensity ?? 70,
      goalState: rule.goalState || {},
    }));
  }
}

/**
 * 比较一条 { key, op, value } 状态条件（语义同 Need._evaluateCondition）。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {{ key: string, op: string, value: * }} cond
 * @returns {boolean}
 */
export function matchStateCondition(entity, cond) {
  if (!cond) return true;
  const actual = entity.state.get(cond.key);
  switch (cond.op) {
    case 'lt': return actual < cond.value;
    case 'lte': return actual <= cond.value;
    case 'gt': return actual > cond.value;
    case 'gte': return actual >= cond.value;
    case 'eq': return actual === cond.value;
    case 'neq': return actual !== cond.value;
    case 'exists': return actual != null;
    default: return false;
  }
}
