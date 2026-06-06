import { addExperienceCultivation } from './numeric-cultivation.js';

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function applyCultivationExperience(entity, worldContext, input = {}) {
  const cfg = worldContext?.balanceConfig?.cultivation?.experience || {};
  if (cfg.enabled === false || !entity?.state) {
    return { gain: 0, reason: 'experience_disabled' };
  }

  const sourceKind = input.sourceKind || 'quest_progress';
  const base = numeric(cfg.baseBySource?.[sourceKind], 0);
  if (base <= 0) {
    return { gain: 0, reason: 'experience_source_unconfigured', sourceKind };
  }

  const valueScale = Math.max(1, numeric(cfg.valueScale, 500));
  const valueMultiplier = Math.min(
    numeric(cfg.maxValueMultiplier, 3),
    1 + Math.log1p(Math.max(0, numeric(input.value, 0))) / Math.log1p(valueScale),
  );
  const riskMultiplier = Math.min(
    numeric(cfg.maxRiskMultiplier, 3),
    1 + Math.max(0, numeric(input.riskScore, 0)) * numeric(cfg.riskWeight, 0),
  );
  const durationMultiplier = Math.min(
    numeric(cfg.maxDurationMultiplier, 2.5),
    1 + Math.log1p(Math.max(1, numeric(input.durationDays, 1))) / Math.log1p(90),
  );
  const outcome = input.outcome || 'success';
  const outcomeMultiplier = numeric(cfg.outcomeMultiplier?.[outcome], 1);
  const gain = Number((base * valueMultiplier * riskMultiplier * durationMultiplier * outcomeMultiplier).toFixed(4));
  const totalCultivation = addExperienceCultivation(entity, worldContext?.ranksData || [], gain);

  return {
    gain,
    sourceKind,
    outcome,
    valueMultiplier,
    riskMultiplier,
    durationMultiplier,
    outcomeMultiplier,
    totalCultivation,
  };
}
