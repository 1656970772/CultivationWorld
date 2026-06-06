export const COMBAT_ATTRIBUTE_KEYS = Object.freeze(['hp', 'yuan', 'attack', 'defense', 'speed', 'soul']);

export const RANK_STAGE_MULTIPLIERS = Object.freeze({
  early: 1.0,
  middle: 1.15,
  late: 1.45,
  perfection: 2.0,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

export function normalizeRankStage(stage, rankId = 'mortal') {
  if (rankId === 'mortal') return null;
  return Object.prototype.hasOwnProperty.call(RANK_STAGE_MULTIPLIERS, stage) ? stage : 'early';
}

export function rankStageMultiplier(stage, rankId = 'mortal', tables = {}) {
  if (rankId === 'mortal') return 1;
  const normalizedStage = normalizeRankStage(stage, rankId);
  const tableMultipliers = tables.combatBaseTable?.stageMultipliers;
  const multipliers = tableMultipliers || RANK_STAGE_MULTIPLIERS;
  return finiteNumber(
    multipliers?.[normalizedStage],
    RANK_STAGE_MULTIPLIERS[normalizedStage] ?? 1,
  );
}

export function calculateCultivatorCombatAttributes({
  rankId = 'mortal',
  rankStage = null,
  tables = {},
} = {}) {
  const ranks = tables.cultivatorCombat?.ranks || tables.ranks || {};
  const row = ranks[rankId] || ranks.mortal || {};
  const multiplier = rankStageMultiplier(rankStage, rankId, tables);
  const scaled = {};

  for (const key of COMBAT_ATTRIBUTE_KEYS) {
    scaled[key] = Math.round(finiteNumber(row[key], 0) * multiplier);
  }

  const hp = Math.max(1, scaled.hp);
  const yuan = Math.max(0, scaled.yuan);

  return {
    rankId,
    rankStage: normalizeRankStage(rankStage, rankId),
    hp,
    maxHp: hp,
    yuan,
    maxYuan: yuan,
    attack: Math.max(0, scaled.attack),
    defense: Math.max(0, scaled.defense),
    speed: Math.max(0, scaled.speed),
    soul: Math.max(0, scaled.soul),
  };
}

export function readEffectiveCombatAttribute(entity, key, fallback = 0) {
  const effectiveValue = entity?.attributes?.getEffective?.(key);
  const effectiveNumber = Number(effectiveValue);
  if (Number.isFinite(effectiveNumber)) return effectiveNumber;

  const stateValue = typeof entity?.state?.get === 'function'
    ? entity.state.get(key)
    : entity?.state?.[key];
  const stateNumber = Number(stateValue);
  if (Number.isFinite(stateNumber)) return stateNumber;

  return fallback;
}

export function calculateNumericArmorDamage({
  attack = 0,
  defense = 0,
  skillMultiplier = 1,
  sceneMultiplier = 1,
  randomMultiplier = 1,
  extraReductionMultiplier = 1,
} = {}) {
  const atk = nonNegative(attack);
  const def = nonNegative(defense);
  const skill = nonNegative(skillMultiplier);
  const scene = nonNegative(sceneMultiplier);
  const random = nonNegative(randomMultiplier);
  const extraReduction = nonNegative(extraReductionMultiplier);
  const baseDamage = atk
    * skill
    * scene;
  const armorCoefficient = atk > 0 ? atk / (atk + def) : 0;
  const damage = baseDamage
    * armorCoefficient
    * random
    * extraReduction;
  return Math.max(1, damage);
}
