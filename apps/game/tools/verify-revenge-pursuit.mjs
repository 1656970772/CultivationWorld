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

const configs = {
  factions: loadJSON('data/entities/factions.json'),
  npcs: loadJSON('data/entities/npcs.json'),
  ranks: loadJSON('data/definitions/ranks.json'),
  items: loadJSON('data/definitions/macro-resources.json'),
  factionNeeds: loadJSON('data/needs/faction-needs.json'),
  npcNeeds: loadJSON('data/needs/npc-needs.json'),
  factionActions: loadJSON('data/actions/faction-actions.json'),
  npcActions: loadJSON('data/actions/npc-actions.json'),
  worldRules: loadJSON('data/actions/world-rules.json'),
  questTemplates: loadJSON('data/quests/quest-templates.json'),
  mapData: loadJSON('data/world/map.json'),
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

const npcs = engine.entityRegistry.getAliveByType('npc');
// 选两个修为足够(totalProgress>=0.3)、有空间组件的 NPC：avenger 强、victim 弱
const candidates = npcs.filter(n => n.hasSpatial && n.hasSpatial());
candidates.sort((a, b) => {
  const pa = (a.state.get('cultivationProgress') || 0) + (a.state.get('insight') || 0);
  const pb = (b.state.get('cultivationProgress') || 0) + (b.state.get('insight') || 0);
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

const startDist = Math.abs(victim.spatial.tileX - avenger.spatial.tileX) + Math.abs(victim.spatial.tileY - avenger.spatial.tileY);
console.log(`复仇追击验证：avenger=${avenger.id} victim=${victim.id} 初始距离=${startDist}`);

// 给 avenger 注入对 victim 的复仇执念
avenger.obsessions.add(new Obsession({
  type: 'revenge', name: '复仇', intensity: 90,
  targetId: victim.id,
  goalState: { enemyKilled: { op: 'eq', value: true } },
}));
// 确保 avenger 实力达击杀门槛
avenger.state.set('cultivationProgress', 0.8);

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
assert(minDist < startDist, '追击有效逼近仇人（最小距离 < 初始距离）');
assert(minDist <= 2 || killed, '复仇者能逼近至邻格(<=2)或直接击杀仇人（破解同速追逐困局）');
if (killed) console.log('  （仇人已被手刃，复仇达成）');

if (failed === 0) { console.log('\n复仇追击端到端验证全部通过'); process.exit(0); }
else { console.error(`\n复仇追击验证失败：${failed} 项`); process.exit(1); }
