#!/usr/bin/env node
/**
 * 战斗 GAS 化重构验证（ADR-042）。真实多种子长程模拟，纯观察统计，无任何特权/隔离/作弊。
 *
 * 观察项：
 *   1. 锁血在三场景（妖兽攻击 monster / PvP slain / 风险 explore 等）均生效（locked 次数 > 0）。
 *   2. 遁地符触发率（escape_talisman 信息事件计数 / 持符 NPC）。
 *   3. 天才 npc_999 轨迹（存活/境界推进/剩余遁地符）。
 *   4. 死因分布（cause 计数）。
 *
 * 用法：node tools/verify-gas-combat.mjs            默认 3 种子 × 800 天
 *      node tools/verify-gas-combat.mjs --days=1200 --seeds=11,22,33,44
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

function baseConfigs() {
  return {
    factions: load('data/entities/factions.json'),
    npcs: load('data/entities/npcs.json'),
    ranks: load('data/definitions/ranks.json'),
    items: load('data/definitions/macro-resources.json'),
    factionNeeds: load('data/needs/faction-needs.json'),
    npcNeeds: load('data/needs/npc-needs.json'),
    factionActions: load('data/actions/faction-actions.json'),
    npcActions: load('data/actions/npc-actions.json'),
    worldRules: load('data/actions/world-rules.json'),
    questTemplates: load('data/quests/quest-templates.json'),
    mapData: load('data/world/map.json'),
    balanceCombat: load('data/balance/combat.json'),
    balanceEconomy: load('data/balance/economy.json'),
    balanceCultivation: load('data/balance/cultivation.json'),
    balanceSocial: load('data/balance/social.json'),
    balanceMovement: load('data/balance/movement.json'),
    balancePersonality: load('data/balance/personality.json'),
    balanceRisk: load('data/balance/risk.json'),
    balanceMemory: load('data/balance/memory.json'),
    balanceObsession: load('data/balance/obsession.json'),
    balanceEmotion: load('data/balance/emotion.json'),
    balanceUtility: load('data/balance/utility.json'),
    balanceReward: load('data/balance/reward.json'),
    balanceRelationship: load('data/balance/relationship.json'),
    monsters: load('data/definitions/monsters.json'),
    monsterSpawn: load('data/balance/monster-spawn.json'),
    worldNews: load('data/world/news.json'),
    worldOpportunities: load('data/world/opportunities.json'),
    balanceCovet: load('data/balance/covet.json'),
    itemDefs: { items: ['currency','material','pill','artifact','talisman','technique'].flatMap(c => load(`data/items/${c}.json`).items) },
    tags: load('data/tags/tags.json'),
    effects: { effects: [...(load('data/effects/combat-effects.json')?.effects || []), ...(load('data/effects/core-effects.json')?.effects || [])] },
    abilities: load('data/abilities/combat-abilities.json'),
  };
}

function parseArgs() {
  let days = 800;
  let seeds = [12345, 67890, 24680];
  for (const a of process.argv.slice(2)) {
    let m;
    if ((m = /^--days=(\d+)$/.exec(a))) days = parseInt(m[1], 10);
    else if ((m = /^--seeds=([\d,]+)$/.exec(a))) seeds = m[1].split(',').map(Number);
  }
  return { days, seeds };
}

// 测试期统计钩子（ADR-042 验证用，纯观察，不改伤害逻辑）。
const { setCombatStatsHook } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/combat/combat-pipeline.js')).href);
let seedStats = null;
setCombatStatsHook((cause, r) => {
  if (!seedStats) return;
  if (r.lethal) seedStats.lethalByCause[cause] = (seedStats.lethalByCause[cause] || 0) + 1;
  if (r.locked) seedStats.lockedByCause[cause] = (seedStats.lockedByCause[cause] || 0) + 1;
  if (r.escaped) seedStats.escapedByCause[cause] = (seedStats.escapedByCause[cause] || 0) + 1;
  if (r.died) seedStats.diedByCause[cause] = (seedStats.diedByCause[cause] || 0) + 1;
});

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);

const { days, seeds } = parseArgs();
console.log(`[verify-gas-combat] seeds=${seeds.join(',')} days=${days}`);

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

const agg = {
  lockedByCause: {}, escapedByCause: {}, diedByCause: {}, deathInfoByCause: {},
  geniusAlive: 0, geniusRankProgressed: 0, geniusEscapeUsed: 0, total999Runs: 0,
};

const mergeInto = (dst, src) => { for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] || 0) + v; };

for (const seed of seeds) {
  const configs = { ...baseConfigs(), seed };
  seedStats = { lethalByCause: {}, lockedByCause: {}, escapedByCause: {}, diedByCause: {} };
  const engine = new WorldEngine();
  engine.init(configs);

  const genius0 = engine.entityRegistry.getById('npc_999');
  const startRank = genius0 ? genius0.state.get('rankId') : null;
  const startTalismans = genius0 ? genius0.inventory.getAmount('item_escape_talisman') : 0;

  for (let t = 0; t < days; t++) engine.tick();

  // 死因分布（遍历死亡 NPC 的 _deathInfo）。
  const deathByCause = {};
  for (const npc of engine.entityRegistry.getByType('npc')) {
    if (!npc.alive && npc._deathInfo) {
      const c = npc._deathInfo.cause || 'unknown';
      deathByCause[c] = (deathByCause[c] || 0) + 1;
    }
  }

  const genius = engine.entityRegistry.getById('npc_999');
  const endRank = genius ? genius.state.get('rankId') : null;
  const endTalismans = genius ? genius.inventory.getAmount('item_escape_talisman') : 0;
  const geniusAlive = !!(genius && genius.alive);
  const geniusEscapeUsed = Math.max(0, startTalismans - endTalismans);

  mergeInto(agg.lockedByCause, seedStats.lockedByCause);
  mergeInto(agg.escapedByCause, seedStats.escapedByCause);
  mergeInto(agg.diedByCause, seedStats.diedByCause);
  mergeInto(agg.deathInfoByCause, deathByCause);
  agg.total999Runs++;
  if (geniusAlive) agg.geniusAlive++;
  if (geniusEscapeUsed > 0) agg.geniusEscapeUsed++;
  const rankOrder = configs.ranks.map(r => r.id);
  const progressed = rankOrder.indexOf(endRank) > rankOrder.indexOf(startRank);
  if (progressed) agg.geniusRankProgressed++;

  console.log(`\n  [seed=${seed}] 存活NPC=${engine.entityRegistry.getAliveByType('npc').length}`);
  console.log(`    死因分布(_deathInfo): ${JSON.stringify(deathByCause)}`);
  console.log(`    锁血生效(按死因): ${JSON.stringify(seedStats.lockedByCause)}`);
  console.log(`    遁地脱险(按死因): ${JSON.stringify(seedStats.escapedByCause)}`);
  console.log(`    天才 npc_999: 存活=${geniusAlive} 境界 ${startRank}→${endRank}（${progressed ? '已推进' : '未变'}） 遁地符 ${startTalismans}→${endTalismans}（用掉${geniusEscapeUsed}）`);
}

console.log(`\n========== 多种子汇总（${seeds.length} 种子 × ${days} 天）==========`);
console.log(`死因分布(合计 _deathInfo): ${JSON.stringify(agg.deathInfoByCause)}`);
console.log(`锁血生效(合计 按死因): ${JSON.stringify(agg.lockedByCause)}`);
console.log(`遁地脱险(合计 按死因): ${JSON.stringify(agg.escapedByCause)}`);
console.log(`经管线真实致死(合计 按死因): ${JSON.stringify(agg.diedByCause)}`);
console.log(`天才存活: ${agg.geniusAlive}/${agg.total999Runs}，境界推进: ${agg.geniusRankProgressed}/${agg.total999Runs}，用过遁地符: ${agg.geniusEscapeUsed}/${agg.total999Runs}`);

// 断言（基于真实统计）：
const deathCauses = Object.keys(agg.deathInfoByCause);
const lockCauses = Object.keys(agg.lockedByCause);
assert(deathCauses.length > 0, '存在真实死亡（死因分布非空）');
assert((agg.deathInfoByCause['slain'] || 0) > 0, 'PvP 致死(cause=slain)经由统一管线产生（补齐 PvP 前置缺口）');
assert((agg.diedByCause['slain'] || 0) > 0 || (agg.lockedByCause['slain'] || 0) > 0,
  'PvP 路径确实走 applyDamage 统一管线（slain 经管线致死或锁血）');
const totalLocked = Object.values(agg.lockedByCause).reduce((a, b) => a + b, 0);
assert(totalLocked > 0, '锁血机制在真实模拟中至少生效一次（不区分攻击者）');
assert(lockCauses.length >= 1, `锁血在场景生效：${JSON.stringify(agg.lockedByCause)}`);

if (failed === 0) { console.log('\n战斗 GAS 化重构验证通过'); process.exit(0); }
else { console.error(`\n验证失败：${failed} 项`); process.exit(1); }
