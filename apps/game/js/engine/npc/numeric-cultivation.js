const DEFAULT_STAGE_THRESHOLDS = {
  early: 0,
  middle: 0.25,
  late: 0.6,
  perfection: 0.9,
};

function readState(entity, key, fallback = null) {
  let value;
  if (typeof entity?.state?.get === 'function') {
    value = entity.state.get(key);
  } else if (typeof entity?.get === 'function') {
    value = entity.get(key);
  } else if (entity?.state && typeof entity.state === 'object') {
    value = entity.state[key];
  } else if (entity && typeof entity === 'object') {
    value = entity[key];
  }
  return value ?? fallback;
}

function writeState(entity, key, value) {
  if (typeof entity?.state?.set === 'function') {
    entity.state.set(key, value);
    return;
  }
  if (typeof entity?.set === 'function') {
    entity.set(key, value);
    return;
  }
  if (entity?.state && typeof entity.state === 'object') {
    entity.state[key] = value;
    return;
  }
  if (entity && typeof entity === 'object') entity[key] = value;
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rankIdOf(entityOrRankId) {
  return typeof entityOrRankId === 'string'
    ? entityOrRankId
    : readState(entityOrRankId, 'rankId', null);
}

function cultivationRanks(ranks) {
  return [...(ranks || [])]
    .filter(r => r?.category === 'cultivation' || numeric(r?.cultivationRequired, NaN) > 0 || numeric(r?.qiRequired, NaN) > 0)
    .sort((a, b) => numeric(a?.order, 0) - numeric(b?.order, 0));
}

function requiredOf(rank, fallback = 100) {
  const cultivationRequired = numeric(rank?.cultivationRequired, NaN);
  if (Number.isFinite(cultivationRequired) && cultivationRequired > 0) return cultivationRequired;
  const qiRequired = numeric(rank?.qiRequired, NaN);
  if (Number.isFinite(qiRequired) && qiRequired > 0) return qiRequired;
  return fallback;
}

function stageThresholdsOf(thresholdsOrConfig = {}) {
  const overrides = thresholdsOrConfig?.stageThresholds || thresholdsOrConfig || {};
  return { ...DEFAULT_STAGE_THRESHOLDS, ...overrides };
}

function currentRank(entityOrRankId, ranks = []) {
  const rankId = rankIdOf(entityOrRankId);
  return (ranks || []).find(r => r?.id === rankId) || null;
}

function isCultivationRank(rank) {
  return !!rank && (
    rank.category === 'cultivation'
    || numeric(rank.cultivationRequired, NaN) > 0
    || numeric(rank.qiRequired, NaN) > 0
  );
}

function validStage(stage) {
  return Object.prototype.hasOwnProperty.call(DEFAULT_STAGE_THRESHOLDS, stage);
}

export function nextCultivationRank(entityOrRankId, ranks = []) {
  const rankId = rankIdOf(entityOrRankId);
  const current = currentRank(entityOrRankId, ranks);
  const currentOrder = numeric(current?.order, 0);
  return cultivationRanks(ranks).find(r => numeric(r?.order, 0) > currentOrder) || null;
}

export function getCultivationRequired(entityOrRankId, ranks = []) {
  const next = nextCultivationRank(entityOrRankId, ranks);
  return next ? requiredOf(next) : 0;
}

export function getTotalCultivation(entity) {
  const cultivation = numeric(readState(entity, 'cultivation', 0));
  const experienceCultivation = numeric(readState(entity, 'experienceCultivation', 0));
  return cultivation + experienceCultivation;
}

export function syncTotalCultivation(entity) {
  const total = getTotalCultivation(entity);
  writeState(entity, 'totalCultivation', total);
  return total;
}

export function addCultivation(entity, ranks = [], gain = 0, config = {}) {
  const amount = numeric(gain);
  if (amount > 0) {
    writeState(entity, 'cultivation', numeric(readState(entity, 'cultivation', 0)) + amount);
  }
  const total = syncTotalCultivation(entity);
  refreshRankStage(entity, ranks, config);
  return total;
}

export function addExperienceCultivation(entity, ranks = [], gain = 0, config = {}) {
  const amount = numeric(gain);
  if (amount > 0) {
    writeState(entity, 'experienceCultivation', numeric(readState(entity, 'experienceCultivation', 0)) + amount);
  }
  const total = syncTotalCultivation(entity);
  refreshRankStage(entity, ranks, config);
  return total;
}

export function computeRankStage(entity, ranks = [], thresholdsOrConfig = {}) {
  if (!nextCultivationRank(entity, ranks)) {
    if (!isCultivationRank(currentRank(entity, ranks))) return null;
    const existing = readState(entity, 'rankStage', null);
    return validStage(existing) ? existing : 'early';
  }

  const required = getCultivationRequired(entity, ranks);
  const totalCultivation = numeric(readState(entity, 'totalCultivation', 0));
  const ratio = required > 0 ? totalCultivation / required : 0;
  const stageThresholds = stageThresholdsOf(thresholdsOrConfig);
  if (ratio >= numeric(stageThresholds.perfection, DEFAULT_STAGE_THRESHOLDS.perfection)) return 'perfection';
  if (ratio >= numeric(stageThresholds.late, DEFAULT_STAGE_THRESHOLDS.late)) return 'late';
  if (ratio >= numeric(stageThresholds.middle, DEFAULT_STAGE_THRESHOLDS.middle)) return 'middle';
  return 'early';
}

export function refreshRankStage(entity, ranks = [], thresholdsOrConfig = {}) {
  syncTotalCultivation(entity);
  const stage = computeRankStage(entity, ranks, thresholdsOrConfig);
  writeState(entity, 'rankStage', stage);
  return stage;
}

export function computeCultivationGain(entity, ranks = [], baseGain = 0, cultivationConfig = {}) {
  const required = getCultivationRequired(entity, ranks);
  if (required <= 0) return 0;
  const cultivation = numeric(readState(entity, 'cultivation', 0));
  const k = numeric(cultivationConfig.cultivationDecayK, 0);
  const ratio = required > 0 ? cultivation / required : 0;
  return numeric(baseGain, 0) * Math.exp(-k * ratio);
}

export function canAttemptBreakthrough(entity, ranks = [], cultivationConfig = {}) {
  const next = nextCultivationRank(entity, ranks);
  if (!next) return false;
  const required = requiredOf(next, 0);
  const total = syncTotalCultivation(entity);
  const cultivation = numeric(readState(entity, 'cultivation', 0));
  const qi = numeric(readState(entity, 'qi', 0));
  const minRatio = numeric(cultivationConfig.minCultivationRatio, 0.3);
  return total >= required
    && cultivation >= required * minRatio
    && qi >= numeric(next.qiRequired, 0);
}

export function applyBreakthroughSuccess(entity, nextRank, opts = {}) {
  if (!nextRank) return null;

  const qi = numeric(readState(entity, 'qi', 0));
  const qiRequired = numeric(opts.qiRequired ?? nextRank.qiRequired, 0);
  writeState(entity, 'rankId', nextRank.id);
  writeState(entity, 'rankName', nextRank.name ?? nextRank.id);
  writeState(entity, 'cultivation', 0);
  writeState(entity, 'experienceCultivation', 0);
  writeState(entity, 'totalCultivation', 0);
  writeState(entity, 'qi', Math.max(0, qi - qiRequired));
  writeState(entity, 'rankStage', 'early');
  return nextRank;
}

export function applyBreakthroughFailure(entity, cultivationConfig = {}) {
  const qiRetention = numeric(cultivationConfig?.breakthrough?.failureQiRetention ?? cultivationConfig?.failureQiRetention, 0.5);
  const cultivationRetention = numeric(
    cultivationConfig?.breakthrough?.failureCultivationRetention ?? cultivationConfig?.failureCultivationRetention,
    0.2
  );
  const injuryLevel = numeric(
    cultivationConfig?.breakthrough?.failureInjuryLevel ?? cultivationConfig?.failureInjuryLevel,
    3
  );

  writeState(entity, 'qi', Math.floor(numeric(readState(entity, 'qi', 0)) * qiRetention));
  writeState(entity, 'cultivation', numeric(readState(entity, 'cultivation', 0)) * cultivationRetention);
  writeState(entity, 'experienceCultivation', numeric(readState(entity, 'experienceCultivation', 0)) * cultivationRetention);
  syncTotalCultivation(entity);
  writeState(entity, 'injuryLevel', Math.max(numeric(readState(entity, 'injuryLevel', 0)), injuryLevel));
}
