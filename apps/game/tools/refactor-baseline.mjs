#!/usr/bin/env node
/**
 * 重构零漂移基线工具（临时，仅服务核心引擎类重构期间的回归比对）。
 *
 * 跑一段确定性模拟（默认 200 天），把世界终态压成一个紧凑指纹（hash + 关键统计）。
 * 重构前记录基线指纹，重构后重跑必须完全一致，确保 tick 流程行为零漂移。
 *
 * 与 test-goap-golden.mjs 互补：后者只覆盖 GOAP planner，本工具覆盖整个 tick 编排
 * （势力 AI / 晋升 / 婚育 / 死亡 / 信息系统 / 妖兽 等所有子系统）。
 *
 * 用法：
 *   node tools/refactor-baseline.mjs                 打印指纹与统计（默认 200 天）
 *   node tools/refactor-baseline.mjs 300             指定天数
 *   node tools/refactor-baseline.mjs 200 <baseline>  与基线指纹比对，不一致退出码 1
 *
 * 注意：Math.random 在本工具内被替换为确定性 PRNG，使多次运行结果一致。
 *
 * 已固化基线指纹（200 天，核心引擎类重构期间逐步拆分均须与之一致）：
 *   default : 4f9cf473
 *   utility : caf46512   （MODE=utility）
 *   info    : 56720249   （MODE=info）
 *   GOAP golden（test-goap-golden.mjs）: 5740e12a
 * 这些值在 tick-manager 拆分后确立；npc-actions 拆分（纯代码搬移 + re-export 门面）后复测一致。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

// ── 确定性 PRNG：覆盖 Math.random，保证整段模拟可复现 ──
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const _rng = mulberry32(0x9E3779B9);
Math.random = _rng;

const configs = {
  factions:       load('data/entities/factions.json'),
  npcs:           load('data/entities/npcs.json'),
  ranks:          load('data/definitions/ranks.json'),
  items:          load('data/definitions/resources.json'),
  factionNeeds:   load('data/needs/faction-needs.json'),
  npcNeeds:       load('data/needs/npc-needs.json'),
  factionActions: load('data/actions/faction-actions.json'),
  npcActions:     load('data/actions/npc-actions.json'),
  worldRules:     load('data/actions/world-rules.json'),
  questTemplates: load('data/quests/quest-templates.json'),
  mapData:        load('data/world/map.json'),
  balanceCombat:      load('data/balance/combat.json'),
  balanceEconomy:     load('data/balance/economy.json'),
  balanceCultivation: load('data/balance/cultivation.json'),
  balanceSocial:      load('data/balance/social.json'),
  balanceMovement:    load('data/balance/movement.json'),
  balancePersonality: load('data/balance/personality.json'),
  balanceRisk:        load('data/balance/risk.json'),
  balanceMemory:      load('data/balance/memory.json'),
  balanceObsession:   load('data/balance/obsession.json'),
  balanceEmotion:     load('data/balance/emotion.json'),
  balanceUtility:     load('data/balance/utility.json'),
  balanceReward:      load('data/balance/reward.json'),
  balanceRelationship: load('data/balance/relationship.json'),
  monsters:           load('data/definitions/monsters.json'),
  monsterSpawn:       load('data/balance/monster-spawn.json'),
  worldNews:          load('data/world/news.json'),
  worldOpportunities: load('data/world/opportunities.json'),
  balanceCovet:       load('data/balance/covet.json'),
  itemDefs:           load('data/items/items.json'),
};

// 激活态开关（与 simulate-analysis.mjs 对齐），覆盖各系统 enabled 分支。
const MODE = process.env.MODE || 'default';
if (MODE === 'utility' || MODE === 'all') {
  configs.balanceUtility = { ...configs.balanceUtility, enabled: true };
  configs.balanceReward = { ...configs.balanceReward, enabled: true };
  configs.balanceObsession = {
    ...configs.balanceObsession,
    goalMult: { ...(configs.balanceObsession.goalMult || {}), enabled: true },
  };
}
if (MODE === 'info' || MODE === 'all') {
  configs.worldNews = { ...configs.worldNews, enabled: true };
  configs.worldOpportunities = { ...configs.worldOpportunities, enabled: true };
  configs.balanceReward = { ...configs.balanceReward, enabled: true };
  configs.balanceCovet = { ...configs.balanceCovet, enabled: true };
}

const { WorldEngine } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href
);

const DAYS = (() => {
  const n = parseInt(process.argv[2], 10);
  return Number.isFinite(n) && n > 0 ? n : 200;
})();
const baselineArg = process.argv[3];

const engine = new WorldEngine();
engine.init(configs);

// 累计统计（确定性）：行为分布、事件计数、复仇/关系/师徒/经济等。
const npcActMap = {};
const factionActMap = {};
const eventTypeCounts = {};
let attacks = 0, alliances = 0, breakthroughs = 0, deaths = 0, births = 0, companions = 0;
let huntTriggers = 0, killTriggers = 0, pvpSlain = 0, pvpEnemySlain = 0, pvpWounded = 0;
let teachTriggers = 0, protectTriggers = 0, visitMasterTriggers = 0, assistTriggers = 0, visitTriggers = 0;
let monsterDeaths = 0;

function bump(map, k) { if (k) map[k] = (map[k] || 0) + 1; }

for (let day = 1; day <= DAYS; day++) {
  const tick = engine.tick();
  for (const fd of tick.factionDecisions || []) {
    const aid = fd.execution?.result?.actionId || fd.execution?.action?.id || 'idle';
    bump(factionActMap, aid);
    const desc = fd.execution?.result?.description || '';
    if (aid.includes('attack') || desc.includes('攻击')) attacks++;
    if (fd.execution?.result?.allyId || desc.includes('结盟')) alliances++;
  }
  for (const nl of tick.npcUpdates || []) {
    const exAid = nl.execution?.action?.id || nl.execution?.result?.actionId || 'idle';
    bump(npcActMap, exAid);
    const outcome = nl.execution?.result?.outcome;
    if (exAid === 'act_npc_hunt_enemy') huntTriggers++;
    if (exAid === 'act_npc_kill_enemy') killTriggers++;
    if (outcome === 'enemy_slain') pvpEnemySlain++;
    else if (outcome === 'slain_by_enemy') pvpSlain++;
    else if (outcome === 'wounded') pvpWounded++;
    if (exAid === 'act_npc_teach_disciple') teachTriggers++;
    if (exAid === 'act_npc_protect_disciple') protectTriggers++;
    if (exAid === 'act_npc_visit_master') visitMasterTriggers++;
    if (exAid === 'act_npc_assist_ally') assistTriggers++;
    if (exAid === 'act_npc_visit_benefactor') visitTriggers++;
    const ent = engine.entityRegistry.getById(nl.entityId);
    if (ent?._breakthroughInfo) { if (ent._breakthroughInfo.success) breakthroughs++; ent._breakthroughInfo = null; }
  }
  for (const evt of tick.events || []) {
    bump(eventTypeCounts, evt.type);
    if (evt.type === 'dao_companion') companions++;
    if (evt.type === 'birth') births++;
  }
  deaths += (tick.deaths || []).length;
  monsterDeaths += (tick.monsterDeaths || []).length;
}

// 终态快照摘要（只取确定性字段）。
const snap = engine.getWorldSnapshot();
const aliveNpcs = Object.values(snap.npcs).filter(n => n.alive);
const aliveFactions = Object.values(snap.factions).filter(f => !f.isDestroyed);
const sumQi = aliveNpcs.reduce((s, n) => s + (n.qi || 0), 0);

// NPC 终态逐个摘要（id 排序后拼接关键状态），是最敏感的漂移探针。
const npcDigest = Object.entries(snap.npcs)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([id, n]) => `${id}:${n.alive ? 1 : 0}:${n.rankId}:${Math.round(n.qi || 0)}:${n.role}:${n.factionId || '-'}`)
  .join('|');

const factionDigest = Object.entries(snap.factions)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([id, f]) => `${id}:${f.alive ? 1 : 0}:${Math.round(f.stability || 0)}:${f.territoryCount || 0}`)
  .join('|');

const relStats = engine.relationshipSystem ? engine.relationshipSystem.stats() : { total: 0, byType: {} };

const stats = {
  mode: MODE,
  days: DAYS,
  aliveNPCs: aliveNpcs.length,
  aliveFactions: aliveFactions.length,
  sumQi: Math.round(sumQi),
  attacks, alliances, breakthroughs, deaths, births, companions, monsterDeaths,
  huntTriggers, killTriggers, pvpEnemySlain, pvpSlain, pvpWounded,
  teachTriggers, protectTriggers, visitMasterTriggers, assistTriggers, visitTriggers,
  relTotal: relStats.total,
  relByType: relStats.byType,
  npcActMap, factionActMap, eventTypeCounts,
};

const combined = JSON.stringify(stats) + '\n##NPC##\n' + npcDigest + '\n##FAC##\n' + factionDigest;

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const fp = hash(combined);

console.log(`[refactor-baseline] mode=${MODE} days=${DAYS}`);
console.log(`  指纹: ${fp}`);
console.log(`  存活NPC=${stats.aliveNPCs} 存活势力=${stats.aliveFactions} 总Qi=${stats.sumQi}`);
console.log(`  攻伐=${attacks} 结盟=${alliances} 突破=${breakthroughs} 死亡=${deaths} 妖兽死亡=${monsterDeaths} 婚配=${companions} 生育=${births}`);
console.log(`  复仇: 追踪=${huntTriggers} 击杀=${killTriggers} 手刃=${pvpEnemySlain} 被反杀=${pvpSlain} 负伤=${pvpWounded}`);
console.log(`  师徒/关系: 传功=${teachTriggers} 护徒=${protectTriggers} 探师=${visitMasterTriggers} 驰援=${assistTriggers} 探恩=${visitTriggers}`);
console.log(`  关系边总数=${relStats.total}`);

if (baselineArg) {
  if (fp === baselineArg) {
    console.log(`重构基线通过：指纹一致 ${fp}`);
    process.exit(0);
  } else {
    console.error(`重构基线失败：指纹不一致！基线 ${baselineArg} 现在 ${fp}`);
    process.exit(1);
  }
}
