#!/usr/bin/env node
/**
 * 复仇追击端到端验证（行为精准化 2026-06-02，批次 D）。
 *
 * 验证『同速追逐困局』的修复：NPC 与仇人原本同速 1 格/天，复仇者追仇人旧坐标、
 * 仇人又移走，几乎永远差一步（实测 330 次追踪仅 1 次同格）。修复后复仇者持有
 * 复仇执念时提速（revengePursuitSpeed=2），且击杀阶段持续移动到仇人当前坐标，
 * 应能在有限 tick 内逼近并击杀仇人。
 *
 * 用法：node tools/verify-revenge-pursuit.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const loadJSON = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
function mergeConfigArray(key, files) {
  return { [key]: files.flatMap(file => loadJSON(file)?.[key] || []) };
}

const configs = {
  seed: 20260607,
  factions: loadJSON('data/entities/factions.json'),
  npcs: loadJSON('data/entities/npcs.json'),
  ranks: loadJSON('data/definitions/ranks.json'),
  items: loadJSON('data/definitions/macro-resources.json'),
  terrains: loadJSON('data/definitions/terrains.json'),
  factionNeeds: loadJSON('data/needs/faction-needs.json'),
  npcNeeds: loadJSON('data/needs/npc-needs.json'),
  factionActions: loadJSON('data/actions/faction-actions.json'),
  npcActions: loadJSON('data/actions/npc-actions.json'),
  npcJobActions: loadJSON('data/actions/npc-job-actions.json'),
  npcActionSets: loadJSON('data/actions/npc-action-sets.json'),
  worldRules: loadJSON('data/actions/world-rules.json'),
  jobs: mergeConfigArray('jobs', [
    'data/jobs/npc-dynamic-event-jobs.json',
    'data/jobs/npc-economy-jobs.json',
    'data/jobs/npc-social-jobs.json',
    'data/jobs/npc-quest-jobs.json',
    'data/jobs/npc-combat-jobs.json',
    'data/jobs/npc-cultivation-jobs.json',
  ]),
  toils: mergeConfigArray('toils', [
    'data/toils/core-toils.json',
    'data/toils/npc-dynamic-event-toils.json',
    'data/toils/npc-economy-toils.json',
    'data/toils/npc-social-toils.json',
    'data/toils/npc-quest-toils.json',
    'data/toils/npc-combat-toils.json',
    'data/toils/npc-cultivation-toils.json',
  ]),
  questTemplates: loadJSON('data/quests/quest-templates.json'),
  mapData: loadJSON('data/world/map.json'),
  gameConfig: loadJSON('data/config/game-config.json'),
  aiConfig: loadJSON('data/config/ai-config.json'),
  names: loadJSON('data/definitions/names.json'),
  balanceCombat: loadJSON('data/balance/combat.json'),
  balanceEconomy: loadJSON('data/balance/economy.json'),
  balanceCultivation: loadJSON('data/balance/cultivation.json'),
  balanceSocial: loadJSON('data/balance/social.json'),
  balanceMovement: loadJSON('data/balance/movement.json'),
  balancePersonality: loadJSON('data/balance/personality.json'),
  balanceRisk: loadJSON('data/balance/risk.json'),
  balanceMemory: loadJSON('data/balance/memory.json'),
  balanceObsession: loadJSON('data/balance/obsession.json'),
  balanceEmotion: loadJSON('data/balance/emotion.json'),
  balanceUtility: loadJSON('data/balance/utility.json'),
  balanceReward: loadJSON('data/balance/reward.json'),
  balanceRelationship: loadJSON('data/balance/relationship.json'),
  monsters: loadJSON('data/definitions/monsters.json'),
  monsterAttributeTemplates: loadJSON('data/definitions/monster-attribute-templates.json'),
  monsterSpawn: loadJSON('data/balance/monster-spawn.json'),
  worldNews: loadJSON('data/world/news.json'),
  worldOpportunities: loadJSON('data/world/opportunities.json'),
  balanceCovet: loadJSON('data/balance/covet.json'),
  itemDefs: { items: ['currency','material','pill','artifact','talisman','technique'].flatMap(c => loadJSON(`data/items/${c}.json`).items) },
};

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);
const { Obsession } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/obsession-system.js')).href);

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

const engine = new WorldEngine();
engine.init(configs);
for (let i = 0; i < 5; i++) engine.tick(); // 稳定位置

const terrainIndex = new Map(configs.terrains.map(t => [t.id, t]));
const tileIndex = new Map(configs.mapData.tiles.map(t => [`${t.x},${t.y}`, t]));

function passable(x, y) {
  const tile = tileIndex.get(`${x},${y}`);
  if (!tile) return false;
  const terrain = terrainIndex.get(tile.terrain);
  return terrain?.passable !== false;
}

function nearbyPassableLine(origin, distance = 12) {
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const dir of dirs) {
    let ok = true;
    for (let step = 1; step <= distance; step++) {
      if (!passable(origin.tileX + dir.dx * step, origin.tileY + dir.dy * step)) {
        ok = false;
        break;
      }
    }
    if (ok) return { x: origin.tileX + dir.dx * distance, y: origin.tileY + dir.dy * distance };
  }
  return null;
}

function moveTo(entity, pos) {
  entity.behaviorSystem?.clearPlan?.(entity);
  entity.spatial.x = pos.x;
  entity.spatial.y = pos.y;
  entity.spatial.clearDestination?.();
  entity.state?.set?.('actionStatus', 'idle');
  entity.state?.set?.('actionRemaining', 0);
}

const npcs = engine.entityRegistry.getAliveByType('npc');
function hasRevengeActions(npc) {
  const ids = new Set((npc.behaviorSystem?.availableActions || []).map(a => a.id));
  return ids.has('act_npc_job_hunt_enemy') && ids.has('act_npc_job_kill_enemy');
}
// 选两个有空间组件的 NPC：avenger 修为强、victim 修为弱
const candidates = npcs.filter(n => n.hasSpatial && n.hasSpatial() && hasRevengeActions(n));
assert(candidates.length >= 1, '存在具备复仇 JobAction 的候选 NPC');
if (candidates.length < 1) process.exit(1);
candidates.sort((a, b) => {
  const pa = a.state.get('totalCultivation') || 0;
  const pb = b.state.get('totalCultivation') || 0;
  return pb - pa;
});
const avenger = candidates[0];
// victim 选一个离 avenger 有一定距离、修为较低的
let victim = null;
for (let i = candidates.length - 1; i >= 0; i--) {
  const c = candidates[i];
  if (c.id === avenger.id) continue;
  const d = Math.abs(c.spatial.tileX - avenger.spatial.tileX) + Math.abs(c.spatial.tileY - avenger.spatial.tileY);
  if (d >= 5 && d <= 40) { victim = c; break; }
}
if (!victim) victim = candidates[1];

const scenarioVictimPos = nearbyPassableLine(avenger.spatial, 12);
assert(!!scenarioVictimPos, '能为复仇追击构造一条短距离可通行路线');
if (!scenarioVictimPos) process.exit(1);
avenger.behaviorSystem?.clearPlan?.(avenger);
avenger.spatial.clearDestination?.();
avenger.state?.set?.('actionStatus', 'idle');
avenger.state?.set?.('actionRemaining', 0);
moveTo(victim, scenarioVictimPos);

const startDist = Math.abs(victim.spatial.tileX - avenger.spatial.tileX) + Math.abs(victim.spatial.tileY - avenger.spatial.tileY);
console.log(`复仇追击验证：avenger=${avenger.id} victim=${victim.id} 初始距离=${startDist}`);

// 给 avenger 注入对 victim 的复仇执念
if (Array.isArray(avenger.obsessions?.obsessions)) {
  avenger.obsessions.obsessions = [];
}
avenger.obsessions.add(new Obsession({
  type: 'revenge', name: '复仇', intensity: 100,
  targetId: victim.id,
  goalState: { enemyKilled: { op: 'eq', value: true } },
}));
// 确保 avenger 实力达击杀门槛
avenger.state.set('cultivation', 80);
avenger.state.set('experienceCultivation', 0);
avenger.state.set('totalCultivation', 80);
avenger.state.set('hasRevengeTarget', true);
avenger.state.set('nearRevengeTarget', false);
avenger.state.set('enemyKilled', false);

// 跑若干 tick，记录 avenger 到 victim 的最小距离与是否击杀
let minDist = startDist;
let killed = false;
let avengerSpeedSeen = 0;
for (let t = 0; t < 120 && !killed; t++) {
  engine.tick();
  if (!avenger.alive) break;
  if (avenger.hasSpatial()) avengerSpeedSeen = Math.max(avengerSpeedSeen, avenger.spatial.speed);
  if (!victim.alive) { killed = true; break; }
  const d = Math.abs(victim.spatial.tileX - avenger.spatial.tileX) + Math.abs(victim.spatial.tileY - avenger.spatial.tileY);
  minDist = Math.min(minDist, d);
}

console.log(`  追击中 avenger 最高速度=${avengerSpeedSeen}（提速生效应 >=2），追击最小距离=${minDist}`);
assert(avengerSpeedSeen >= 2, '复仇执念在身时 avenger 提速到 >=2 格/天');
assert(killed || minDist < startDist, '追击有效逼近仇人或直接击杀仇人');
assert(minDist <= 2 || killed, '复仇者能逼近至邻格(<=2)或直接击杀仇人（破解同速追逐困局）');
if (killed) console.log('  （仇人已被手刃，复仇达成）');

if (failed === 0) { console.log('\n复仇追击端到端验证全部通过'); process.exit(0); }
else { console.error(`\n复仇追击验证失败：${failed} 项`); process.exit(1); }
