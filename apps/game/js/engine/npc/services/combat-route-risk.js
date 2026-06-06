function readState(entity, key, fallback = null) {
  const value = typeof entity?.state?.get === 'function' ? entity.state.get(key) : entity?.state?.[key];
  return value ?? fallback;
}

function coordOf(target) {
  const x = target?.x ?? target?.tileX ?? target?.spatial?.tileX ?? target?.spatial?.x;
  const y = target?.y ?? target?.tileY ?? target?.spatial?.tileY ?? target?.spatial?.y;
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

function aliveMonster(monster) {
  return !!monster && monster.alive !== false && monster.state?.get?.('alive') !== false;
}

function monsterGrade(monster) {
  return Number(monster?.grade ?? monster?.staticData?.get?.('grade') ?? 1) || 1;
}

function monsterPower(monster) {
  return Number(monster?.state?.get?.('power') ?? monster?.power ?? monsterGrade(monster) * 30) || 1;
}

function npcPower(entity, worldContext) {
  const power = typeof worldContext?.npcCombatPower === 'function' ? worldContext.npcCombatPower(entity) : 1;
  return Math.max(1, Number(power) || 1);
}

function getMonsters(worldContext) {
  const registry = worldContext?.entityRegistry;
  const list = typeof registry?.getAliveByType === 'function'
    ? registry.getAliveByType('monster')
    : (typeof registry?.getByType === 'function' ? registry.getByType('monster') : []);
  return Array.isArray(list) ? list.filter(aliveMonster) : [];
}

function excludedIds(entity, opts = {}) {
  const fromOpts = opts.excludedIds;
  if (Array.isArray(fromOpts)) return new Set(fromOpts);
  const fromState = readState(entity, 'excludedHuntMonsterIds', []);
  return new Set(Array.isArray(fromState) ? fromState : []);
}

function straightPath(from, to) {
  const path = [];
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  while (x !== to.x || y !== to.y) {
    if (x !== to.x) x += dx;
    if (y !== to.y) y += dy;
    path.push({ x, y });
  }
  return path;
}

function computePath(from, to, worldContext) {
  if (typeof worldContext?.computePath === 'function') {
    try {
      const result = worldContext.computePath(from, to);
      if (Array.isArray(result)) return result;
      if (Array.isArray(result?.path)) return result.path;
    } catch {
      try {
        const result = worldContext.computePath(from.x, from.y, to.x, to.y);
        if (Array.isArray(result)) return result;
        if (Array.isArray(result?.path)) return result.path;
      } catch {
        // Fall through to the deterministic straight-line fallback.
      }
    }
  }
  return straightPath(from, to);
}

function routeRiskCache(worldContext) {
  if (!worldContext || typeof worldContext !== 'object') return null;
  if (!worldContext._combatRouteRiskCache) {
    Object.defineProperty(worldContext, '_combatRouteRiskCache', {
      value: new Map(),
      enumerable: false,
      configurable: true,
    });
  }
  return worldContext._combatRouteRiskCache;
}

function pathDistanceIndex(path, radius) {
  const maxRadius = Math.ceil(Math.max(0, Number(radius) || 0));
  const index = new Map();
  for (const step of path) {
    const x = step.x ?? step.tileX;
    const y = step.y ?? step.tileY;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      for (let dy = -maxRadius; dy <= maxRadius; dy++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > radius) continue;
        const key = `${x + dx},${y + dy}`;
        const prev = index.get(key);
        if (prev == null || dist < prev) index.set(key, dist);
      }
    }
  }
  return index;
}

export function scoreRouteRisk(entity, target, worldContext, opts = {}) {
  const from = coordOf(entity);
  const to = coordOf(target);
  if (!from || !to) {
    return { routeRiskScore: 0, nearbyThreatIds: [], path: [] };
  }

  const radius = Math.max(0, Number(opts.radius ?? 2) || 0);
  const ignoreMonsterId = opts.ignoreMonsterId || opts.targetMonsterId || null;
  const cache = routeRiskCache(worldContext);
  const cacheKey = cache
    ? `${entity?.id || '__entity__'}|${from.x},${from.y}|${to.x},${to.y}|r${radius}|i${ignoreMonsterId || ''}|d${worldContext?.currentDay ?? ''}`
    : null;
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);

  const path = computePath(from, to, worldContext);
  const distanceIndex = pathDistanceIndex(path, radius);
  const myPower = npcPower(entity, worldContext);
  let routeRiskScore = 0;
  const nearbyThreatIds = [];

  for (const monster of getMonsters(worldContext)) {
    if (monster.id === ignoreMonsterId) continue;
    const point = coordOf(monster);
    if (!point) continue;
    const dist = distanceIndex.get(`${point.x},${point.y}`);
    if (dist == null) continue;
    const risk = monsterPower(monster) / myPower;
    if (risk <= 1) continue;
    routeRiskScore += risk / Math.max(1, dist + 1);
    nearbyThreatIds.push(monster.id);
  }

  const result = {
    routeRiskScore: Number(routeRiskScore.toFixed(4)),
    nearbyThreatIds,
    path,
  };
  if (cacheKey) cache.set(cacheKey, result);
  return result;
}

export function chooseSafeHuntTarget(entity, monsters, worldContext, opts = {}) {
  const desiredGrade = Number(opts.desiredGrade ?? readState(entity, 'activeQuestDifficulty', 1)) || 1;
  const routeRiskThreshold = Number(opts.routeRiskThreshold ?? 4);
  const directRiskThreshold = Number(opts.directRiskThreshold ?? 8);
  const excluded = excludedIds(entity, opts);
  const myPower = npcPower(entity, worldContext);
  const from = coordOf(entity) || { x: 0, y: 0 };
  const stopAtFirstSafe = opts.stopAtFirstSafe === true;
  const maxDistance = Number.isFinite(Number(opts.maxDistance)) ? Number(opts.maxDistance) : Infinity;
  const safe = [];
  const rejected = [];
  const routeCandidates = [];

  for (const monster of (Array.isArray(monsters) ? monsters : [])) {
    if (!aliveMonster(monster)) continue;
    if (excluded.has(monster.id)) {
      rejected.push({ monsterId: monster.id, reason: 'excluded' });
      continue;
    }
    const target = coordOf(monster);
    if (!target) {
      rejected.push({ monsterId: monster.id, reason: 'missing_position' });
      continue;
    }
    const directRisk = monsterPower(monster) / myPower;
    if (directRisk > directRiskThreshold) {
      rejected.push({ monsterId: monster.id, reason: 'target_too_dangerous', directRisk });
      continue;
    }
    const grade = monsterGrade(monster);
    const distance = Math.abs(from.x - target.x) + Math.abs(from.y - target.y);
    if (distance > maxDistance) {
      rejected.push({ monsterId: monster.id, reason: 'target_too_far', distance });
      continue;
    }
    routeCandidates.push({
      monster,
      target,
      directRisk,
      grade,
      distance,
      approxScore: Math.abs(grade - desiredGrade) * 100 + Math.max(0, grade - desiredGrade) * 20 + distance + directRisk,
    });
  }

  routeCandidates.sort((a, b) => a.approxScore - b.approxScore);
  for (const candidate of routeCandidates) {
    const route = scoreRouteRisk(entity, candidate.target, worldContext, { ...opts, ignoreMonsterId: candidate.monster.id });
    if (route.routeRiskScore > routeRiskThreshold) {
      rejected.push({ monsterId: candidate.monster.id, reason: 'route_too_dangerous', routeRiskScore: route.routeRiskScore });
      continue;
    }
    safe.push({
      monster: candidate.monster,
      routeRisk: route,
      directRisk: candidate.directRisk,
      sortScore: Math.abs(candidate.grade - desiredGrade) * 100
        + Math.max(0, candidate.grade - desiredGrade) * 20
        + route.routeRiskScore * 10
        + candidate.distance,
    });
    if (stopAtFirstSafe) break;
  }

  safe.sort((a, b) => a.sortScore - b.sortScore);
  const picked = safe[0] || null;
  return {
    monster: picked?.monster || null,
    routeRisk: picked?.routeRisk || null,
    rejected,
  };
}
