#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { scoreRouteRisk, chooseSafeHuntTarget } = await imp('js/engine/npc/services/combat-route-risk.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

function state(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    get: (key) => data.get(key),
    set: (key, value) => data.set(key, value),
  };
}

function monster(id, x, y, power, grade = 3) {
  return {
    id,
    name: id,
    grade,
    alive: true,
    state: state({ alive: true, power }),
    spatial: { tileX: x, tileY: y },
  };
}

const npc = {
  id: 'npc_route',
  state: state({ excludedHuntMonsterIds: ['monster_excluded'] }),
  spatial: { tileX: 0, tileY: 0 },
};
const routeThreat = monster('monster_threat', 5, 1, 500, 7);
const dangerousTarget = monster('monster_dangerous_target', 8, 0, 900, 7);
const riskyRouteTarget = monster('monster_risky_route_target', 10, 0, 50, 3);
const safeTarget = monster('monster_safe_target', 0, 8, 60, 3);
const excludedTarget = monster('monster_excluded', 0, 6, 40, 3);
const monsters = [routeThreat, dangerousTarget, riskyRouteTarget, safeTarget, excludedTarget];

const worldContext = {
  entityRegistry: {
    getAliveByType(type) {
      return type === 'monster' ? monsters.filter(m => m.alive !== false) : [];
    },
  },
  npcCombatPower(entity) {
    return entity.id === 'npc_route' ? 100 : (entity.state?.get?.('power') || 1);
  },
  computePath(from, to) {
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
  },
};

console.log('1) 路径附近高阶妖兽提高 routeRiskScore');
const riskyRoute = scoreRouteRisk(npc, { x: 10, y: 0 }, worldContext, { radius: 2 });
assert(riskyRoute.routeRiskScore > 1, 'routeRiskScore increases when strong monster is near path');
assert(riskyRoute.nearbyThreatIds.includes('monster_threat'), 'nearbyThreatIds records threatening monster id');

console.log('2) 安全目标选择避开过强、路线危险和排除目标');
const chosen = chooseSafeHuntTarget(npc, [dangerousTarget, riskyRouteTarget, excludedTarget, safeTarget], worldContext, {
  desiredGrade: 3,
  routeRiskThreshold: 1,
  directRiskThreshold: 4,
  radius: 2,
});
assert(chosen?.monster?.id === 'monster_safe_target', 'chooseSafeHuntTarget chooses safe nearby target');
assert(!chosen?.rejected?.some(item => item.monsterId === 'monster_safe_target'), 'safe target is not rejected');
assert(chosen?.rejected?.some(item => item.monsterId === 'monster_excluded' && item.reason === 'excluded'), 'excluded target is rejected');
assert(chosen?.rejected?.some(item => item.monsterId === 'monster_dangerous_target' && item.reason === 'target_too_dangerous'), 'overpowered target is rejected');
assert(chosen?.rejected?.some(item => item.monsterId === 'monster_risky_route_target' && item.reason === 'route_too_dangerous'), 'route-dangerous target is rejected');

if (failed > 0) {
  console.error(`\nCombat route risk tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nCombat route risk tests passed');
