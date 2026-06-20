export const PROFILE_SCHEMA_VERSION = 'npc_execution_profile.v1';

const DEFAULT_CULTIVATION_CONFIG = {
  minCultivationRatio: 0.3,
  maxExperienceCultivationRatio: 0.7,
};

export function sanitizeForJson(value, seen = new WeakSet()) {
  if (value === null) return null;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const out = value.map(item => {
      const sanitized = sanitizeForJson(item, seen);
      return sanitized === undefined ? null : sanitized;
    });
    seen.delete(value);
    return out;
  }

  if (value instanceof Map) {
    const out = {};
    for (const [key, item] of value.entries()) {
      const sanitized = sanitizeForJson(item, seen);
      if (sanitized !== undefined) out[String(key)] = sanitized;
    }
    seen.delete(value);
    return out;
  }

  if (value instanceof Set) {
    const out = Array.from(value).map(item => {
      const sanitized = sanitizeForJson(item, seen);
      return sanitized === undefined ? null : sanitized;
    });
    seen.delete(value);
    return out;
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeForJson(item, seen);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  seen.delete(value);
  return out;
}

export function buildProfilerMeta({
  seed,
  days,
  targetIds = [],
  includeAllNpcs = false,
  recordCount = 0,
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    format: {
      records: 'jsonl',
      index: 'json',
      lineBase: 1,
    },
    engineAdapter: {
      name: 'worlddynamic-js',
      boundary: 'WorldEngine.tick + entity snapshots',
      unityPortability: 'Unity should emit the same JSON schema from its simulation adapter.',
    },
    seed,
    days,
    targets: {
      includeAllNpcs: includeAllNpcs === true,
      ids: [...targetIds],
    },
    recordCount,
    generatedAt,
  };
}

export function buildProfilerIndexEntry({
  npcId,
  day,
  line,
  actionId = null,
  needId = null,
} = {}) {
  return { npcId, day, line, actionId, needId };
}

export function buildNpcExecutionRecord({
  day,
  seed = null,
  npc,
  npcLog = null,
  tickLog = {},
  configs = {},
} = {}) {
  const state = snapshotState(npc);
  const cultivation = buildCultivationSnapshot(npc, state, configs);
  const needs = buildNeedsSnapshot(npcLog?.needs);
  const execution = buildExecutionSnapshot(npcLog?.execution);
  const decision = buildDecisionSnapshot(npcLog?.plan);
  const events = collectNpcEvents(npc?.id, tickLog, state);

  return sanitizeForJson({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    day,
    seed,
    npc: buildNpcIdentity(npc, state),
    state: {
      raw: state,
      cultivation,
      inventory: snapshotInventory(npc),
      spatial: snapshotSpatial(npc),
    },
    needs,
    decision,
    execution,
    events,
    tick: {
      dynamicEvents: tickLog?.dynamicEvents || [],
      deaths: filterNpcEvents(npc?.id, tickLog?.deaths || []),
      infoEvents: filterNpcEvents(npc?.id, tickLog?.infoEvents || []),
    },
  });
}

function buildNpcIdentity(npc, state) {
  return {
    id: npc?.id || null,
    type: npc?.type || 'npc',
    name: npc?.name || npc?.staticData?.name || npc?.id || null,
    alive: npc?.alive !== false,
    factionId: state.factionId ?? npc?.staticData?.factionId ?? null,
    role: state.currentRole ?? npc?.staticData?.role ?? null,
    rankId: state.rankId ?? null,
    rankName: state.rankName ?? null,
  };
}

function snapshotState(npc) {
  if (typeof npc?.state?.snapshot === 'function') return npc.state.snapshot();
  const keys = typeof npc?.state?.keys === 'function' ? npc.state.keys() : [];
  const out = {};
  for (const key of keys) out[key] = npc.state.get(key);
  return out;
}

function snapshotInventory(npc) {
  if (typeof npc?.inventory?.getAll === 'function') return npc.inventory.getAll();
  return null;
}

function snapshotSpatial(npc) {
  if (typeof npc?.spatial?.snapshot === 'function') return npc.spatial.snapshot();
  return null;
}

function buildCultivationSnapshot(npc, state, configs) {
  const cultivationConfig = {
    ...DEFAULT_CULTIVATION_CONFIG,
    ...(configs?.balanceCultivation || configs?.balance?.cultivation || {}),
  };
  const ranks = Array.isArray(configs?.ranks) ? configs.ranks : [];
  const nextRank = nextCultivationRank(state.rankId, ranks);
  const required = numberOf(nextRank?.cultivationRequired ?? nextRank?.qiRequired, 0);
  const qiRequired = numberOf(nextRank?.qiRequired, required);
  const cultivation = numberOf(state.cultivation, 0);
  const experienceCultivation = numberOf(state.experienceCultivation, 0);
  const minRatio = numberOf(cultivationConfig.minCultivationRatio, 0.3);
  const maxExpRatio = numberOf(cultivationConfig.maxExperienceCultivationRatio, Math.max(0, 1 - minRatio));
  const effectiveExperienceCultivation = required > 0
    ? Math.min(experienceCultivation, required * maxExpRatio)
    : experienceCultivation;
  const totalCultivationComputed = cultivation + effectiveExperienceCultivation;
  const rootRequired = required * minRatio;
  const qi = numberOf(state.qi, 0);

  return {
    rankId: state.rankId || null,
    rankName: state.rankName || null,
    nextRankId: nextRank?.id || null,
    nextRankName: nextRank?.name || null,
    qi,
    qiRequired,
    cultivation,
    experienceCultivation,
    effectiveExperienceCultivation,
    totalCultivationState: numberOf(state.totalCultivation, totalCultivationComputed),
    totalCultivationComputed,
    nextCultivationRequired: required,
    minCultivationRatio: minRatio,
    maxExperienceCultivationRatio: maxExpRatio,
    rootRequired,
    rootShortfall: Math.max(0, rootRequired - cultivation),
    totalShortfall: Math.max(0, required - totalCultivationComputed),
    qiShortfall: Math.max(0, qiRequired - qi),
    canAttemptBreakthrough: required > 0
      && totalCultivationComputed >= required
      && cultivation >= rootRequired
      && qi >= qiRequired,
  };
}

function nextCultivationRank(currentRankId, ranks) {
  const cultivationRanks = ranks
    .filter(rank => rank?.category === 'cultivation'
      || numberOf(rank?.cultivationRequired, NaN) > 0
      || numberOf(rank?.qiRequired, NaN) > 0)
    .sort((a, b) => numberOf(a?.order, 0) - numberOf(b?.order, 0));
  if (cultivationRanks.length === 0) return null;
  const current = ranks.find(rank => rank?.id === currentRankId) || null;
  const currentOrder = numberOf(current?.order, -Infinity);
  return cultivationRanks.find(rank => numberOf(rank?.order, 0) > currentOrder) || null;
}

function buildNeedsSnapshot(needsLog) {
  const results = Array.isArray(needsLog?.results) ? needsLog.results : [];
  const ranking = [...results]
    .filter(need => need && need.satisfied !== true && numberOf(need.priority, 0) > 0)
    .sort((a, b) => {
      const p = numberOf(b.priority, 0) - numberOf(a.priority, 0);
      if (p !== 0) return p;
      return numberOf(b.urgency, 0) - numberOf(a.urgency, 0);
    })
    .map((need, index) => ({
      rank: index + 1,
      id: need.id,
      name: need.name,
      priority: numberOf(need.priority, 0),
      urgency: numberOf(need.urgency, 0),
      satisfied: need.satisfied === true,
    }));
  const cultivationIndex = ranking.findIndex(need => need.id === 'need_npc_cultivation');
  const blockersAboveCultivation = cultivationIndex >= 0
    ? ranking.slice(0, cultivationIndex)
    : ranking;

  return {
    timestamp: needsLog?.timestamp ?? null,
    results,
    ranking,
    cultivationRank: cultivationIndex >= 0 ? cultivationIndex + 1 : null,
    blockersAboveCultivation,
  };
}

function buildDecisionSnapshot(plan) {
  return {
    selected: {
      id: plan?.needId ?? null,
      name: plan?.needName ?? null,
      priority: plan?.needPriority ?? null,
      source: plan?.goalSource ?? null,
    },
    dynamic: {
      eventId: plan?.dynamicEventId ?? null,
      eventType: plan?.dynamicEventType ?? null,
    },
    plan: {
      length: plan?.planLength ?? null,
      cost: plan?.planCost ?? null,
      iterations: plan?.iterations ?? null,
      actions: Array.isArray(plan?.actions) ? [...plan.actions] : [],
      failed: plan?.failed === true,
      fallback: plan?.fallback === true,
    },
    raw: plan || null,
  };
}

function buildExecutionSnapshot(execution) {
  return {
    status: execution?.status ?? null,
    phase: execution?.phase ?? null,
    action: execution?.action ? {
      id: execution.action.id ?? null,
      name: execution.action.name ?? null,
    } : null,
    job: execution?.job || null,
    result: execution?.result || null,
    raw: execution || null,
  };
}

function collectNpcEvents(npcId, tickLog, state) {
  if (!npcId) return [];
  const combined = [
    ...(tickLog?.events || []),
    ...(tickLog?.infoEvents || []),
    ...(tickLog?.deaths || []),
    ...(tickLog?.monsterDeaths || []),
  ];
  const events = filterNpcEvents(npcId, combined);
  const targetDynamicEventId = state?.targetDynamicEventId;
  if (targetDynamicEventId) {
    for (const evt of tickLog?.dynamicEvents || []) {
      if (evt?.id === targetDynamicEventId || evt?.eventId === targetDynamicEventId) {
        events.push({ ...evt, type: evt.type || 'dynamic_event' });
      }
    }
  }
  return events;
}

function filterNpcEvents(npcId, events) {
  if (!npcId || !Array.isArray(events)) return [];
  return events.filter(evt =>
    evt?.npcId === npcId
    || evt?.entityId === npcId
    || evt?.actorId === npcId
    || evt?.targetId === npcId
    || evt?.childId === npcId
    || evt?.id === npcId
  );
}

function numberOf(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
