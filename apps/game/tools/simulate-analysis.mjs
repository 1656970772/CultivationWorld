#!/usr/bin/env node
/**
 * 世界模拟分析脚本 — 无头运行 WorldEngine，输出 report-data.js
 *
 * 用法: node apps/game/tools/simulate-analysis.mjs [天数]
 * 输出: apps/game/tools/report-data.js  （被 report.html 读取）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const GAME_ROOT  = resolve(__dirname, '..');

function loadJSON(p) { return JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8')); }

const configs = {
  factions:       loadJSON('data/entities/factions.json'),
  npcs:           loadJSON('data/entities/npcs.json'),
  ranks:          loadJSON('data/definitions/ranks.json'),
  items:          loadJSON('data/definitions/resources.json'),
  factionNeeds:   loadJSON('data/needs/faction-needs.json'),
  npcNeeds:       loadJSON('data/needs/npc-needs.json'),
  factionActions: loadJSON('data/actions/faction-actions.json'),
  npcActions:     loadJSON('data/actions/npc-actions.json'),
  worldRules:     loadJSON('data/actions/world-rules.json'),
  questTemplates: loadJSON('data/quests/quest-templates.json'),
  mapData:        loadJSON('data/world/map.json'),
  // 平衡配置：保证分析工具与真实游戏一致（含闭关上限 cultivationCap、游历机缘、风险结算）
  balanceCombat:      loadJSON('data/balance/combat.json'),
  balanceEconomy:     loadJSON('data/balance/economy.json'),
  balanceCultivation: loadJSON('data/balance/cultivation.json'),
  balanceSocial:      loadJSON('data/balance/social.json'),
  balanceMovement:    loadJSON('data/balance/movement.json'),
  balancePersonality: loadJSON('data/balance/personality.json'),
  balanceRisk:        loadJSON('data/balance/risk.json'),
  balanceMemory:      loadJSON('data/balance/memory.json'),
  balanceObsession:   loadJSON('data/balance/obsession.json'),
  balanceEmotion:     loadJSON('data/balance/emotion.json'),
  balanceUtility:     loadJSON('data/balance/utility.json'),
  balanceReward:      loadJSON('data/balance/reward.json'),
  balanceRelationship: loadJSON('data/balance/relationship.json'),
  monsters:           loadJSON('data/definitions/monsters.json'),
  monsterSpawn:       loadJSON('data/balance/monster-spawn.json'),
  // 信息传播 / 机会点 / 怀璧其罪系统（ADR-024/025）。默认 enabled=false 零漂移。
  worldNews:          loadJSON('data/world/news.json'),
  worldOpportunities: loadJSON('data/world/opportunities.json'),
  balanceCovet:       loadJSON('data/balance/covet.json'),
  itemDefs:           loadJSON('data/items/items.json'),
};

// 平衡验证激活态（ADR-021/022/023）：默认配置 enabled=false 保护零漂移；
// 设 UTILITY_ACTIVE=1 时在内存中覆盖开关（不写回 JSON），让 Utility 选目标层 +
// 期望收益 + 执念 goalMult 生效，用于观测流派分布与人口曲线。
const UTILITY_ACTIVE = process.env.UTILITY_ACTIVE === '1';
if (UTILITY_ACTIVE) {
  configs.balanceUtility = { ...configs.balanceUtility, enabled: true };
  configs.balanceReward = { ...configs.balanceReward, enabled: true };
  configs.balanceObsession = {
    ...configs.balanceObsession,
    goalMult: { ...(configs.balanceObsession.goalMult || {}), enabled: true },
  };
  console.log('[激活态] UTILITY_ACTIVE=1：utility/reward/obsession.goalMult enabled=true（仅内存覆盖，不写回数据）');
}

// 信息传播 / 机会点 / 怀璧其罪激活态（ADR-024/025）：默认 enabled=false 保护零漂移；
// 设 INFO_ACTIVE=1 时在内存中把 news/opportunities/reward/covet 开关覆盖为 true，
// 用于观测"群体涌向热点"与"怀璧其罪"涌现现象。
const INFO_ACTIVE = process.env.INFO_ACTIVE === '1';
if (INFO_ACTIVE) {
  configs.worldNews = { ...configs.worldNews, enabled: true };
  configs.worldOpportunities = { ...configs.worldOpportunities, enabled: true };
  configs.balanceReward = { ...configs.balanceReward, enabled: true };
  configs.balanceCovet = { ...configs.balanceCovet, enabled: true };
  console.log('[激活态] INFO_ACTIVE=1：news/opportunities/reward/covet enabled=true（仅内存覆盖，不写回数据）');
}

// 关系驱动 Goal/妖群/领地（ADR-028）：默认随 relationship.json goalsEnabled（默认开）。
// RELATIONSHIP_GOALS_ACTIVE=1 强制开、=0 强制关，用于对照实验（仅内存覆盖，不写回 JSON）。
const REL_GOALS_ENV = process.env.RELATIONSHIP_GOALS_ACTIVE;
if (REL_GOALS_ENV === '1' || REL_GOALS_ENV === '0') {
  const on = REL_GOALS_ENV === '1';
  configs.balanceRelationship = { ...configs.balanceRelationship, enabled: true, goalsEnabled: on };
  console.log(`[对照] RELATIONSHIP_GOALS_ACTIVE=${REL_GOALS_ENV}：relationship.goalsEnabled=${on}（仅内存覆盖，不写回数据）`);
}

const { WorldEngine } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href
);

function parseDaysArg() {
  for (const arg of process.argv.slice(2)) {
    const match = /^--days=(\d+)$/.exec(arg);
    if (match) return parseInt(match[1], 10);
  }
  const positional = parseInt(process.argv[2], 10);
  return Number.isFinite(positional) && positional > 0 ? positional : 500;
}

const TOTAL_DAYS = parseDaysArg();
const SNAPSHOT_EVERY = 50;

const ACTION_MAP = {};
for (const a of [...configs.factionActions, ...configs.npcActions, ...configs.worldRules]) {
  if (a.id && a.name) ACTION_MAP[a.id] = a.name;
}

const initRes = {};
for (const f of configs.factions) {
  initRes[f.id] = {
    name: f.name, type: f.type || 'faction',
    low_spirit_stone: f.resources?.low_spirit_stone ?? 0,
    disciples: f.resources?.disciples ?? 0,
    food: f.resources?.food ?? 0,
    stability: f.stability ?? 50,
  };
}

const engine = new WorldEngine();
const initResult = engine.init(configs);
console.log(`引擎初始化: ${initResult.totalFactions} 势力, ${initResult.totalNPCs} NPC`);

// tuning-v2 2026-06-01: 调试钩子已清理（所有钩子功能已稳定，进入回归模式）

// ── 统计容器 ───────────────────────
const snapshots = [];
const factionActMap = {};
const npcActMap = {};
const factionDeaths = [];
const breakthroughLog = [];
const npcDeathLog = [];
let npcActTotal = 0, attacks = 0, alliances = 0;
let worldMod = 0, disasters = 0;
const obsessionCounts = {};
let maxAnger = 0, maxInnerDemon = 0, npcsWithObsession = 0;
// tuning-v2 2026-06-01: 跟踪"历史最大情绪值"——之前只取末 tick 瞬时值，
// 但 emotion.json 中 anger/fear/inner_demon 都有 dailyRegress（衰减），3000 天后无新触发
// 会衰减回 0，无法反映 v1/v2 调优效果。改为每 tick 跟踪 max(history)。
let maxAngerHistory = 0, maxInnerDemonHistory = 0;
let fGoapOk = 0, fFallback = 0, nGoapOk = 0, nFallback = 0;
let companionPairs = 0, totalBirths = 0;
// 复仇/PvP 统计（ADR-020）
let huntTriggers = 0, killTriggers = 0, pvpSlain = 0, pvpEnemySlain = 0, pvpWounded = 0;
// 关系驱动行为统计（ADR-028）
let assistTriggers = 0, visitTriggers = 0;
// 师徒互动行为统计（ADR-029）
let teachTriggers = 0, protectDiscipleTriggers = 0, visitMasterTriggers = 0;
const economyActionCounts = {
  material_donate: 0,
  redeem_qi_pill: 0,
  use_qi_pill: 0,
  redeem_breakthrough_pill: 0,
  use_breakthrough_pill: 0,
  redeem_artifact: 0,
  quest_item_reward: 0,
};
const huntQuestIds = new Set(configs.balanceEconomy.monsterResources?.huntQuestTypeIds || [
  'qt_slay_monster',
  'qt_exterminate',
  'qt_hunt_beast',
]);
const monsterResourceStats = {
  deaths: 0,
  questHuntDeaths: 0,
  deathsByCause: {},
  huntQuestActionTicks: 0,
  huntQuestAccepted: 0,
  huntQuestCompleted: 0,
  huntQuestFailed: 0,
  huntQuestFailureOutcomes: {},
  drops: {},
};
const eventTypeCounts = {};

function addCount(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function addDrops(drops) {
  for (const drop of drops || []) {
    addCount(monsterResourceStats.drops, drop.itemId, drop.qty || 1);
  }
}

function collectMonsterMaterialInventory(entities) {
  const totals = {};
  for (const entity of entities) {
    const all = entity.inventory?.getAll?.() || {};
    for (const [itemId, qty] of Object.entries(all)) {
      if (/^(monster_core|beast_material)(_g\d+)?$/.test(itemId) && qty > 0) {
        addCount(totals, itemId, qty);
      }
    }
  }
  return totals;
}

function actName(raw) {
  if (!raw || raw === 'idle') return '空闲';
  return raw.startsWith('act_') ? (ACTION_MAP[raw] || raw) : raw;
}

// ── 主循环 ─────────────────────────
const t0 = performance.now();
for (let day = 1; day <= TOTAL_DAYS; day++) {
  const tick = engine.tick();

  for (const md of tick.monsterDeaths || []) {
    monsterResourceStats.deaths++;
    addCount(monsterResourceStats.deathsByCause, md.cause || 'unknown');
    if (md.cause === 'quest_hunt') monsterResourceStats.questHuntDeaths++;
    addDrops(md.dropItems);
  }

  for (const fd of tick.factionDecisions) {
    const n = fd.execution?.status === 'idle' ? '空闲'
      : actName(fd.execution?.action?.name || fd.execution?.result?.actionName || '空闲');
    factionActMap[n] = (factionActMap[n] || 0) + 1;

    const desc = fd.execution?.result?.description || '';
    const aid = fd.execution?.result?.actionId || fd.execution?.action?.id || '';
    if (aid.includes('attack') || desc.includes('攻击')) attacks++;
    if (fd.execution?.result?.allyId || desc.includes('结盟')) alliances++;
    if (fd.plan?.fallback) fFallback++; else if (fd.execution?.status !== 'idle') fGoapOk++;

    if (!fd.state.alive && !factionDeaths.find(d => d.id === fd.factionId)) {
      factionDeaths.push({ id: fd.factionId, name: fd.factionName, day });
    }
  }

  for (const r of tick.worldRules?.rules || []) {
    if (r.result?.spawned) worldMod++;
    if (r.result?.disaster) disasters++;
  }

  for (const nl of tick.npcUpdates) {
    if (nl.skipped && nl.reason === 'dead') continue;
    const ent = engine.entityRegistry.getById(nl.entityId);
    if (!ent) continue;

    const n = nl.execution?.status === 'idle' ? '空闲'
      : actName(nl.execution?.action?.name || nl.execution?.result?.actionName || '空闲');
    npcActMap[n] = (npcActMap[n] || 0) + 1;
    npcActTotal++;

    if (nl.plan?.fallback) nFallback++; else if (nl.execution?.status !== 'idle') nGoapOk++;

    // 复仇行为链统计（ADR-020）：按本 tick 执行结算的行为/结果累计。
    const exAid = nl.execution?.action?.id || nl.execution?.result?.actionId || '';
    const outcome = nl.execution?.result?.outcome;
    const result = nl.execution?.result || {};
    if (result.eventType) eventTypeCounts[result.eventType] = (eventTypeCounts[result.eventType] || 0) + 1;
    if (exAid === 'act_npc_donate_materials' || result.eventType === 'material_donate') economyActionCounts.material_donate++;
    if (exAid === 'act_npc_redeem_qi_pill' || result.eventType === 'redeem_qi_pill') economyActionCounts.redeem_qi_pill++;
    if (exAid === 'act_npc_use_qi_pill' || result.eventType === 'use_qi_pill') economyActionCounts.use_qi_pill++;
    if (exAid === 'act_npc_redeem_breakthrough_pill' || result.eventType === 'redeem_breakthrough_pill') economyActionCounts.redeem_breakthrough_pill++;
    if (exAid === 'act_npc_use_breakthrough_pill' || result.eventType === 'use_breakthrough_pill') economyActionCounts.use_breakthrough_pill++;
    if (exAid === 'act_npc_redeem_artifact' || result.eventType === 'redeem_artifact_low') economyActionCounts.redeem_artifact++;
    if (result.eventType === 'quest_item_reward' || (result.extraRewards?.questItemReward || 0) > 0) economyActionCounts.quest_item_reward++;
    if (exAid === 'act_npc_accept_hunt_quest') {
      monsterResourceStats.huntQuestActionTicks++;
    }
    if ((result.actionId === 'act_npc_accept_hunt_quest' || result.actionId === 'act_npc_accept_quest')
        && result.success
        && huntQuestIds.has(result.questTypeId)) {
      monsterResourceStats.huntQuestAccepted++;
    }
    if (exAid === 'act_npc_do_quest' && huntQuestIds.has(result.questTypeId)) {
      if (result.outcome === 'complete') monsterResourceStats.huntQuestCompleted++;
      else if (result.success === false) {
        monsterResourceStats.huntQuestFailed++;
        addCount(monsterResourceStats.huntQuestFailureOutcomes, result.outcome || 'unknown');
      }
    }
    if (exAid === 'act_npc_hunt_enemy') huntTriggers++;
    if (exAid === 'act_npc_kill_enemy') killTriggers++;
    if (outcome === 'enemy_slain') pvpEnemySlain++;
    else if (outcome === 'slain_by_enemy') pvpSlain++;
    else if (outcome === 'wounded') pvpWounded++;
    // 关系驱动行为（ADR-028）
    if (exAid === 'act_npc_assist_ally') assistTriggers++;
    if (exAid === 'act_npc_visit_benefactor') visitTriggers++;
    // 师徒互动行为（ADR-029）
    if (exAid === 'act_npc_teach_disciple') teachTriggers++;
    if (exAid === 'act_npc_protect_disciple') protectDiscipleTriggers++;
    if (exAid === 'act_npc_visit_master') visitMasterTriggers++;

    if (ent._deathInfo) {
      const fId = ent._deathInfo.factionId;
      npcDeathLog.push({
        day, ...ent._deathInfo,
        factionName: fId ? (initRes[fId]?.name || fId) : '散修',
      });
      ent._deathInfo = null;
    }
    if (ent._breakthroughInfo) {
      breakthroughLog.push({ day, ...ent._breakthroughInfo });
      ent._breakthroughInfo = null;
    }
  }

  for (const evt of tick.events || []) {
    if (evt.type) eventTypeCounts[evt.type] = (eventTypeCounts[evt.type] || 0) + 1;
    if (evt.type === 'dao_companion') companionPairs++;
    if (evt.type === 'birth') totalBirths++;
  }

  // tuning-v2 2026-06-01: 从 tick.deaths 收集 faction 路径触发的死亡（_collectDeaths 已写 _deathInfo），
  // 否则 attackEnemy 杀死的 NPC（cause='slain'）只进 tickLog.deaths 不进 npcUpdates，分析脚本看不到。
  for (const d of tick.deaths || []) {
    npcDeathLog.push({ day: tick.day, ...d, factionName: d.factionId ? (initRes[d.factionId]?.name || d.factionId) : '散修' });
  }

  if (day % SNAPSHOT_EVERY === 0 || day === TOTAL_DAYS) {
    snapshots.push(engine.getWorldSnapshot());
  }

  // tuning-v2 2026-06-01: 跟踪历史最大情绪。每 tick 扫一遍存活 NPC 情绪快照。
  // 性能护栏：每 10 天扫一次（heartbeat 一天扫描 < 0.1ms，3000 天也无压力，但保留稀疏采样以防 NPC 数爆炸）。
  if (day % 10 === 0 || day === TOTAL_DAYS) {
    for (const npc of engine.entityRegistry.getAliveByType('npc')) {
      if (!npc.emotions) continue;
      const e = npc.emotions.snapshot().values || {};
      maxAngerHistory = Math.max(maxAngerHistory, e.anger || 0);
      maxInnerDemonHistory = Math.max(maxInnerDemonHistory, e.inner_demon || 0);
    }
  }

  if (day % 100 === 0) console.log(`  进度: ${day}/${TOTAL_DAYS}`);
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`模拟完成: ${TOTAL_DAYS} 天, 用时 ${elapsed}s`);

// ── GOBT 心智统计（ADR-019）：观察执念/情绪是否在世界中真实涌现 ──
for (const npc of engine.entityRegistry.getAliveByType('npc')) {
  if (typeof npc.getMindSummary !== 'function') continue;
  const mind = npc.getMindSummary();
  if (mind.obsessions.length > 0) {
    npcsWithObsession++;
    for (const o of mind.obsessions) obsessionCounts[o.type] = (obsessionCounts[o.type] || 0) + 1;
  }
  maxAnger = Math.max(maxAnger, mind.emotions.anger || 0);
  maxInnerDemon = Math.max(maxInnerDemon, mind.emotions.inner_demon || 0);
}
console.log(`[GOBT心智] 持有执念的存活NPC: ${npcsWithObsession}，执念分布: ${JSON.stringify(obsessionCounts)}`);
console.log(`[GOBT心智] 峰值愤怒(末tick): ${maxAnger.toFixed(0)}，峰值心魔(末tick): ${maxInnerDemon.toFixed(0)}`);
console.log(`[GOBT心智] 历史最大愤怒: ${maxAngerHistory.toFixed(0)}，历史最大心魔: ${maxInnerDemonHistory.toFixed(0)}`);

// ── 复仇/PvP 统计（ADR-020）：观察恩怨叙事闭环是否涌现 ──
const slainDeaths = npcDeathLog.filter(d => d.cause === 'slain').length;
const revengeObsessionsAlive = obsessionCounts['revenge'] || 0;
console.log(`[复仇PvP] 追踪触发: ${huntTriggers}，击杀触发: ${killTriggers}`);
console.log(`[复仇PvP] 手刃仇人: ${pvpEnemySlain}，寻仇被反杀: ${pvpSlain}，寻仇负伤: ${pvpWounded}`);
console.log(`[复仇PvP] PvP 致死总数(cause=slain): ${slainDeaths}，存活NPC持有复仇执念: ${revengeObsessionsAlive}`);

// ── 关系网/关系驱动统计（ADR-028）：观察关系 Goal 与妖群/领地边是否涌现 ──
const relSys = engine.relationshipSystem;
const relStats = relSys && typeof relSys.stats === 'function' ? relSys.stats() : { total: 0, byType: {} };
const relGoalsOn = (configs.balanceRelationship?.enabled !== false) && (configs.balanceRelationship?.goalsEnabled !== false);
const bt = relStats.byType || {};
console.log(`[关系网] goalsEnabled=${relGoalsOn}，关系边总数: ${relStats.total}`);
console.log(`[关系网] 人际边: same_sect=${bt.same_sect || 0}, master=${bt.master || 0}, enemy=${bt.enemy || 0}, grudge=${bt.grudge || 0}, dao_companion=${bt.dao_companion || 0}, kin=${bt.kin || 0}`);
console.log(`[关系网] 妖群/领地边: pack_member=${bt.pack_member || 0}, pack_leader=${bt.pack_leader || 0}, territory_threat=${bt.territory_threat || 0}, beast_grudge=${bt.beast_grudge || 0}`);
console.log(`[关系驱动] 驰援同门触发: ${assistTriggers}，探望恩人触发: ${visitTriggers}`);
console.log(`[师徒互动] 传功点化: ${teachTriggers}，护徒驰援: ${protectDiscipleTriggers}，探望恩师: ${visitMasterTriggers}`);

console.log(`[妖兽资源] 猎妖接取: ${monsterResourceStats.huntQuestAccepted}，完成: ${monsterResourceStats.huntQuestCompleted}，失败: ${monsterResourceStats.huntQuestFailed}`);
console.log(`[妖兽资源] 妖兽死亡: ${monsterResourceStats.deaths}，任务击杀: ${monsterResourceStats.questHuntDeaths}，掉落: ${JSON.stringify(monsterResourceStats.drops)}`);

// ── 构建数据 ───────────────────────
const finalSnap = snapshots[snapshots.length - 1];
const allNPCs = Object.entries(finalSnap.npcs);
const allFactions = Object.entries(finalSnap.factions);
const monsterResourceInventory = {
  npc: collectMonsterMaterialInventory(engine.entityRegistry.getByType('npc').filter(e => e.alive !== false)),
  faction: collectMonsterMaterialInventory(engine.entityRegistry.getByType('faction').filter(e => e.alive !== false)),
};

const aliveNPCs = allNPCs.filter(([, n]) => n.alive);
const aliveQi = aliveNPCs.map(([, n]) => n.qi || 0);
const avgQi = aliveQi.length > 0 ? aliveQi.reduce((a, b) => a + b, 0) / aliveQi.length : 0;

const timeline = snapshots.map(snap => {
  const ns = Object.values(snap.npcs);
  const alive = ns.filter(n => n.alive);
  const qi = alive.map(n => n.qi || 0);
  const prog = alive.map(n => n.cultivationProgress || 0);
  const fs = Object.values(snap.factions).filter(f => !f.isDestroyed);
  return {
    day: snap.day,
    aliveNPC: alive.length, deadNPC: ns.length - alive.length,
    aliveFaction: fs.length,
    avgQi: qi.length > 0 ? +(qi.reduce((a, b) => a + b, 0) / qi.length).toFixed(2) : 0,
    maxQi: qi.length > 0 ? +Math.max(...qi).toFixed(2) : 0,
    avgProgress: prog.length > 0 ? +(prog.reduce((a, b) => a + b, 0) / prog.length).toFixed(4) : 0,
    avgStone: fs.length > 0 ? Math.round(fs.reduce((s, f) => s + (f.resources?.low_spirit_stone || 0), 0) / fs.length) : 0,
    avgDisciples: fs.length > 0 ? Math.round(fs.reduce((s, f) => s + (f.resources?.disciples || 0), 0) / fs.length) : 0,
    breakthroughs: breakthroughLog.filter(b => b.success && b.day <= snap.day).length,
    deaths: npcDeathLog.filter(d => d.day <= snap.day).length,
  };
});

const factions = allFactions.map(([fId, fData]) => {
  const ir = initRes[fId] || {};
  return {
    id: fId, name: fData.name || fId,
    isNeutral: fId.startsWith('org_'),
    destroyed: !!fData.isDestroyed,
    initStone: ir.low_spirit_stone ?? 0, finalStone: fData.resources?.low_spirit_stone ?? 0,
    initDisc: ir.disciples ?? 0, finalDisc: fData.resources?.disciples ?? 0,
    initFood: ir.food ?? 0, finalFood: fData.resources?.food ?? 0,
    stability: Math.round(fData.stability ?? 0),
    territory: fData.territoryCount ?? 0,
  };
});

const factionActions = Object.entries(factionActMap).sort(([, a], [, b]) => b - a).map(([name, count]) => ({ name, count }));
const npcActions = Object.entries(npcActMap).sort(([, a], [, b]) => b - a).map(([name, count]) => ({ name, count }));

// NPC 花名册按势力分组
const npcByFaction = {};
for (const [nId, nData] of allNPCs) {
  const key = nData.factionId || '__wanderer__';
  if (!npcByFaction[key]) npcByFaction[key] = [];
  npcByFaction[key].push({ id: nId, ...nData });
}

const factionOrder = allFactions.map(([id]) => id);
const rosterKeys = [...factionOrder.filter(k => npcByFaction[k]), ...(npcByFaction['__wanderer__'] ? ['__wanderer__'] : [])];

const npcRoster = rosterKeys.map(fKey => {
  const members = npcByFaction[fKey] || [];
  const fName = fKey === '__wanderer__' ? '散修（无门派）' : (finalSnap.factions[fKey]?.name || fKey);
  const sorted = [...members].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return (b.qi || 0) - (a.qi || 0);
  });
  return {
    factionId: fKey, factionName: fName,
    members: sorted.map(m => ({
      name: m.name, rankName: m.rankName || '?', role: m.role || '-',
      age: m.ageYears ?? '?', maxAge: m.maxAgeYears ?? '?',
      qi: m.qi || 0, progress: m.cultivationProgress || 0,
      stone: m.inventory?.low_spirit_stone ?? 0,
      contribution: m.contribution || 0, quests: m.totalQuestsCompleted || 0,
      gender: m.gender || 'male',
      daoCompanionId: m.daoCompanionId || null,
      childrenCount: m.childrenCount || 0,
      alive: m.alive,
    })),
  };
});

// 诊断
const totalFA = Object.values(factionActMap).reduce((a, b) => a + b, 0);
const diagnostics = [];
for (const [name, count] of Object.entries(factionActMap).sort(([, a], [, b]) => b - a)) {
  if (count / totalFA > 0.5) diagnostics.push(`势力行为单一: "${name}" 占 ${(count / totalFA * 100).toFixed(1)}%`);
}
if (factionDeaths.length === 0) diagnostics.push('无势力覆灭，缺乏淘汰机制');
if (breakthroughLog.filter(b => b.success).length === 0) diagnostics.push('无 NPC 完成突破，修炼节奏可能偏慢');
if (npcDeathLog.length === 0) diagnostics.push('无 NPC 死亡，寿命系统可能未生效');
const aliveFs = allFactions.filter(([, f]) => !f.isDestroyed);
const allGrow = aliveFs.length > 0 && aliveFs.every(([fId, f]) => {
  const ir = initRes[fId]; return ir && (f.resources?.low_spirit_stone || 0) > ir.low_spirit_stone;
});
if (allGrow) diagnostics.push('所有存活势力灵石持续增长，经济缺乏消耗平衡');

const reportData = {
  totalDays: TOTAL_DAYS,
  elapsed,
  totalFactions: allFactions.length,
  totalNPCs: allNPCs.length,
  generatedAt: new Date().toLocaleString('zh-CN'),
  summary: {
    aliveFactions: aliveFs.length,
    aliveNPCs: aliveNPCs.length,
    breakthroughSuccess: breakthroughLog.filter(b => b.success).length,
    breakthroughFail: breakthroughLog.filter(b => !b.success).length,
    totalDeaths: npcDeathLog.length,
    avgQi: +avgQi.toFixed(2),
    attacks,
    alliances,
    companionPairs,
    totalBirths,
    genderMale: aliveNPCs.filter(([, n]) => n.gender === 'male').length,
    genderFemale: aliveNPCs.filter(([, n]) => n.gender === 'female').length,
  },
  timeline,
  factions,
  factionActions,
  npcActions,
  goap: { factionOk: fGoapOk, factionFb: fFallback, npcOk: nGoapOk, npcFb: nFallback },
  npcRoster,
  breakthroughs: breakthroughLog,
  deaths: npcDeathLog.slice(-300),
  companionLog: engine.tickManager.companionLog || [],
  birthLog: engine.tickManager.birthLog || [],
  worldEvents: { modifiers: worldMod, disasters, attacks, alliances, factionDeaths: factionDeaths.length, companionPairs, totalBirths },
  economyActionCounts,
  monsterResourceStats: {
    ...monsterResourceStats,
    inventory: monsterResourceInventory,
  },
  eventTypeCounts,
  revengePvp: {
    huntTriggers, killTriggers,
    enemySlain: pvpEnemySlain, slainByEnemy: pvpSlain, wounded: pvpWounded,
    slainDeaths, revengeObsessionsAlive,
  },
  mindHistory: {
    peakAnger: Number(maxAngerHistory.toFixed(2)),
    peakInnerDemon: Number(maxInnerDemonHistory.toFixed(2)),
  },
  diagnostics,
};

const outPath = resolve(__dirname, 'report-data.js');
writeFileSync(outPath, `window.REPORT_DATA = ${JSON.stringify(reportData, null, 2)};`, 'utf-8');
console.log(`数据已写入: ${outPath}`);
console.log(`打开 report.html 查看可视化报告`);
