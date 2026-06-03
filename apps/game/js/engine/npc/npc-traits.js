/**
 * npc-traits - 先天特质（灵根/体质）的 GAS 化承载（ADR-042 阶段2）
 *
 * 把灵根/体质的数值加成（speedMultiplier/breakthroughBonus/lifespanBonus/hpBonusMultiplier）
 * 表达为 AttributeSet 上的 Infinite 修正层，挂在派生属性键上：
 *   - traitSpeedMult        （基值 1.0，multiply）灵根 + 体质 speedMultiplier 连乘
 *   - traitBreakthroughBonus（基值 0，  add）     灵根 + 体质 breakthroughBonus 累加
 *   - traitLifespanBonus    （基值 0，  add）     体质 lifespanBonus
 *   - traitHpMult           （基值 1.0，multiply）体质 hpBonusMultiplier
 *
 * 数值仍以 data/balance/cultivation.json 为单一真相源（本模块只是把同样的数值搬进
 * AttributeSet 的修正层）。
 *
 * 开关：cultivation.json traitEffects.enabled（默认 true）。关闭时不注入修正，
 * 各读取点的 readTrait* 改读 config。
 *
 * 确定性无关（纯数值搬运，不引入随机）。
 */

const SRC_SPIRITROOT = 'trait:spiritRoot';
const SRC_PHYSIQUE = 'trait:physique';

/** 派生属性键及其默认基值（乘法类 1.0，加法类 0）。 */
export const TRAIT_KEYS = {
  speedMult: { key: 'traitSpeedMult', base: 1.0, op: 'multiply' },
  breakthroughBonus: { key: 'traitBreakthroughBonus', base: 0, op: 'add' },
  lifespanBonus: { key: 'traitLifespanBonus', base: 0, op: 'add' },
  hpMult: { key: 'traitHpMult', base: 1.0, op: 'multiply' },
};

/** traitEffects 开关（默认 true）。 */
export function traitEffectsEnabled(cultivationConfig) {
  return cultivationConfig?.traitEffects?.enabled !== false;
}

/**
 * 把灵根/体质加成注入实体的 AttributeSet（Infinite 修正层）。
 * 在 NPCEntity._initAbilities 中调用。开关关闭则不注入。
 * @param {Object} entity NPC 实体（须有 attributes/state/_cultivationConfig）
 */
export function applyTraitEffects(entity) {
  const cult = entity._cultivationConfig || {};
  if (!traitEffectsEnabled(cult)) return;
  const attrs = entity.attributes;
  if (!attrs) return;

  // 登记派生键默认基值（幂等）。
  for (const def of Object.values(TRAIT_KEYS)) attrs.setDefaultBase(def.key, def.base);

  const rootGrade = cult.spiritRoot?.grades?.[entity.state.get('spiritRootId')];
  const physiqueType = cult.physique?.types?.[entity.state.get('physiqueId')];

  // 先撤销旧来源（突破/换体质后可重新注入，对称）。
  attrs.removeModifiersFrom(SRC_SPIRITROOT);
  attrs.removeModifiersFrom(SRC_PHYSIQUE);

  if (rootGrade) {
    attrs.addModifier(TRAIT_KEYS.speedMult.key, SRC_SPIRITROOT, 'multiply', rootGrade.speedMultiplier ?? 1.0);
    attrs.addModifier(TRAIT_KEYS.breakthroughBonus.key, SRC_SPIRITROOT, 'add', rootGrade.breakthroughBonus ?? 0);
  }
  if (physiqueType) {
    attrs.addModifier(TRAIT_KEYS.speedMult.key, SRC_PHYSIQUE, 'multiply', physiqueType.speedMultiplier ?? 1.0);
    attrs.addModifier(TRAIT_KEYS.breakthroughBonus.key, SRC_PHYSIQUE, 'add', physiqueType.breakthroughBonus ?? 0);
    attrs.addModifier(TRAIT_KEYS.lifespanBonus.key, SRC_PHYSIQUE, 'add', physiqueType.lifespanBonus ?? 0);
    attrs.addModifier(TRAIT_KEYS.hpMult.key, SRC_PHYSIQUE, 'multiply', physiqueType.hpBonusMultiplier ?? 1.0);
  }
}

// ── 读取辅助：开关开则读 AttributeSet（机制层），关则读 config ──

/** 灵根+体质修炼速度连乘系数。 */
export function readTraitSpeedMult(entity) {
  const cult = entity._cultivationConfig || {};
  if (traitEffectsEnabled(cult) && entity.attributes) {
    return entity.attributes.getEffective(TRAIT_KEYS.speedMult.key);
  }
  let mult = 1.0;
  const rootGrade = cult.spiritRoot?.grades?.[entity.state.get('spiritRootId')];
  if (rootGrade) mult *= rootGrade.speedMultiplier ?? 1.0;
  const physiqueType = cult.physique?.types?.[entity.state.get('physiqueId')];
  if (physiqueType) mult *= physiqueType.speedMultiplier ?? 1.0;
  return mult;
}

/** 灵根+体质突破成功率加成（累加）。 */
export function readTraitBreakthroughBonus(entity) {
  const cult = entity._cultivationConfig || {};
  if (traitEffectsEnabled(cult) && entity.attributes) {
    return entity.attributes.getEffective(TRAIT_KEYS.breakthroughBonus.key);
  }
  const rootGrade = cult.spiritRoot?.grades?.[entity.state.get('spiritRootId')];
  const physiqueType = cult.physique?.types?.[entity.state.get('physiqueId')];
  return (rootGrade?.breakthroughBonus ?? 0) + (physiqueType?.breakthroughBonus ?? 0);
}

/** 体质寿元加成（比例）。 */
export function readTraitLifespanBonus(entity) {
  const cult = entity._cultivationConfig || {};
  if (traitEffectsEnabled(cult) && entity.attributes) {
    return entity.attributes.getEffective(TRAIT_KEYS.lifespanBonus.key);
  }
  const physiqueType = cult.physique?.types?.[entity.state.get('physiqueId')];
  return physiqueType?.lifespanBonus ?? 0;
}

/** 体质血量上限倍率。 */
export function readTraitHpMult(entity) {
  const cult = entity._cultivationConfig || {};
  if (traitEffectsEnabled(cult) && entity.attributes) {
    return entity.attributes.getEffective(TRAIT_KEYS.hpMult.key);
  }
  const physiqueType = cult.physique?.types?.[entity.state.get('physiqueId')];
  return physiqueType?.hpBonusMultiplier ?? 1.0;
}
