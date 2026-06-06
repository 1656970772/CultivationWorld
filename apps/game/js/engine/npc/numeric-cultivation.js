function readState(entity, key, fallback = null) {
  const value = typeof entity?.state?.get === 'function'
    ? entity.state.get(key)
    : entity?.state?.[key];
  return value ?? fallback;
}

function writeState(entity, key, value) {
  if (typeof entity?.state?.set === 'function') {
    entity.state.set(key, value);
    return;
  }
  if (entity?.state) entity.state[key] = value;
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function nextCultivationRank(entityOrRankId, ranks = []) {
  const rankId = typeof entityOrRankId === 'string'
    ? entityOrRankId
    : entityOrRankId?.state?.get?.('rankId');
  const current = ranks.find(r => r.id === rankId);
  const currentOrder = current?.order ?? 0;
  return ranks
    .filter(r => r.category === 'cultivation' || Number.isFinite(r.cultivationRequired))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .find(r => (r.order || 0) > currentOrder) || null;
}

export function nextCultivationRequired(entityOrRankId, ranks = []) {
  return nextCultivationRank(entityOrRankId, ranks)?.cultivationRequired ?? 100;
}

export function syncTotalCultivation(entity, ranks = []) {
  const cultivation = numeric(readState(entity, 'cultivation', 0));
  const experience = numeric(readState(entity, 'experienceCultivation', 0));
  const total = cultivation + experience;
  writeState(entity, 'totalCultivation', total);
  const required = nextCultivationRequired(entity, ranks);
  const ratio = required > 0 ? total / required : 0;
  writeState(entity, 'cultivationProgressRatio', ratio);
  writeState(entity, 'totalProgress', ratio);
  return total;
}

export function syncNumericCultivationFromRatios(entity, ranks = []) {
  const required = nextCultivationRequired(entity, ranks);
  const progress = numeric(readState(entity, 'cultivationProgress', 0));
  const insight = numeric(readState(entity, 'insight', 0));
  writeState(entity, 'cultivation', progress * required);
  writeState(entity, 'experienceCultivation', insight * required);
  return syncTotalCultivation(entity, ranks);
}

export function syncProgressRatiosFromNumeric(entity, ranks = []) {
  const required = nextCultivationRequired(entity, ranks);
  const cultivation = numeric(readState(entity, 'cultivation', 0));
  const experience = numeric(readState(entity, 'experienceCultivation', 0));
  writeState(entity, 'cultivationProgress', required > 0 ? cultivation / required : 0);
  writeState(entity, 'insight', required > 0 ? experience / required : 0);
  return syncTotalCultivation(entity, ranks);
}

export function migrateProgressToNumericCultivation(entity, ranks = []) {
  const required = nextCultivationRequired(entity, ranks);
  const progress = numeric(readState(entity, 'cultivationProgress', 0));
  const insight = numeric(readState(entity, 'insight', 0));
  if (readState(entity, 'cultivation') == null) {
    writeState(entity, 'cultivation', progress * required);
  }
  if (readState(entity, 'experienceCultivation') == null) {
    writeState(entity, 'experienceCultivation', insight * required);
  }
  return syncTotalCultivation(entity, ranks);
}

export function addCultivation(entity, ranks = [], gain = 0) {
  const amount = numeric(gain);
  if (amount <= 0) return syncTotalCultivation(entity, ranks);
  const current = numeric(readState(entity, 'cultivation', 0));
  writeState(entity, 'cultivation', current + amount);
  return syncProgressRatiosFromNumeric(entity, ranks);
}

export function addExperienceCultivation(entity, ranks = [], gain = 0) {
  const amount = numeric(gain);
  if (amount <= 0) return syncTotalCultivation(entity, ranks);
  const current = numeric(readState(entity, 'experienceCultivation', 0));
  writeState(entity, 'experienceCultivation', current + amount);
  return syncProgressRatiosFromNumeric(entity, ranks);
}

export function canAttemptBreakthrough(entity, ranks = [], cultivationConfig = {}) {
  const next = nextCultivationRank(entity, ranks);
  if (!next) return false;
  const required = numeric(next.cultivationRequired, 0);
  const total = numeric(readState(entity, 'totalCultivation', 0));
  const cultivation = numeric(readState(entity, 'cultivation', 0));
  const qi = numeric(readState(entity, 'qi', 0));
  const minRatio = cultivationConfig.minCultivationRatio ?? 0.3;
  return total >= required
    && cultivation >= required * minRatio
    && qi >= numeric(next.qiRequired, 0);
}
