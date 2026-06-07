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

const { loadGameConfigsFromManifest } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/core/data-manifest-loader.js')).href
);
const configs = await loadGameConfigsFromManifest(loadJSON('data/config/data-manifest.json'), {
  loadJson: loadJSON,
});

// 平衡验证显式激活态（ADR-021/022/023）：当前 Utility/Reward 默认启用；
// 设 UTILITY_ACTIVE=1 时仍会在内存中强制打开相关开关（不写回 JSON），
// 便于兼容旧配置或临时回退后的对照观测。
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

// 信息传播 / 机会点 / 怀璧其罪显式激活态（ADR-024/025）：当前默认启用；
// 设 INFO_ACTIVE=1 时仍会在内存中把 news/opportunities/reward/covet 开关覆盖为 true，
// 便于兼容旧配置或临时回退后的对照观测。
const INFO_ACTIVE = process.env.INFO_ACTIVE === '1';
if (INFO_ACTIVE) {
  configs.worldNews = { ...configs.worldNews, enabled: true };
  configs.worldOpportunities = { ...configs.worldOpportunities, enabled: true };
  configs.balanceReward = { ...configs.balanceReward, enabled: true };
  configs.balanceCovet = { ...configs.balanceCovet, enabled: true };
  console.log('[激活态] INFO_ACTIVE=1：news/opportunities/reward/covet enabled=true（仅内存覆盖，不写回数据）');
}

// 反应层显式激活态（四层 AI 架构 Reaction 层，ADR-048）：当前默认启用；
// 设 REACTION_ACTIVE=1 时仍会在内存中把 reaction.enabled 与 eventReplan.enabled 覆盖为 true，
// 便于兼容旧配置或临时回退后的对照观测。
const REACTION_ACTIVE = process.env.REACTION_ACTIVE === '1';
if (REACTION_ACTIVE) {
  configs.balanceReaction = {
    ...configs.balanceReaction,
    enabled: true,
    eventReplan: { ...(configs.balanceReaction.eventReplan || {}), enabled: true },
  };
  console.log('[激活态] REACTION_ACTIVE=1：reaction.enabled + eventReplan.enabled=true（仅内存覆盖，不写回数据）');
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

function parseSeedArg() {
  for (const arg of process.argv.slice(2)) {
    const match = /^--seed=(\d+)$/.exec(arg);
    if (match) return parseInt(match[1], 10) >>> 0;
  }
  const envSeed = parseInt(process.env.SIM_SEED || '', 10);
  return Number.isFinite(envSeed) ? (envSeed >>> 0) : null;
}

const TOTAL_DAYS = parseDaysArg();
const SEED_ARG = parseSeedArg();
if (SEED_ARG != null) configs.seed = SEED_ARG;
const SNAPSHOT_EVERY = 50;

const ACTION_MAP = {};
for (const a of [...configs.factionActions, ...configs.npcActions, ...configs.worldRules]) {
  if (a.id && a.name) ACTION_MAP[a.id] = a.name;
}
const ACTION_JOB_MAP = {};
for (const a of configs.npcJobActions || []) {
  if (a.id && a.jobId) ACTION_JOB_MAP[a.id] = a.jobId;
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

// ── 行为画像分类映射（2026-06-02：按类别拆分 NPC/妖兽行为，定位"哪类人没做该做的事"）──
// 势力 id → 势力类型（righteous/evil/demon/neutral/mortal_kingdom）。
const FACTION_TYPE = {};
for (const f of configs.factions) FACTION_TYPE[f.id] = f.type || 'unknown';

// 行为画像容器：每个维度（dim）下，每个类别（cat）维护一张「行为名→次数」表 + 该类活跃 tick 总数。
// dims: role(职位) / rank(境界) / factionType(势力类型) / archetype(流派执念)
const PROFILE_DIMS = ['role', 'rank', 'factionType', 'archetype'];
const archetypeProfile = {};
for (const dim of PROFILE_DIMS) archetypeProfile[dim] = {};

function profileBucket(dim, cat) {
  if (!cat) cat = '__unknown__';
  const dimMap = archetypeProfile[dim];
  if (!dimMap[cat]) dimMap[cat] = { ticks: 0, idle: 0, actions: {}, members: new Set() };
  return dimMap[cat];
}

// 取 NPC 当前主执念类型（流派维度），无执念归 none。
function npcArchetype(ent) {
  const obs = ent.obsessions?.obsessions;
  if (!Array.isArray(obs) || obs.length === 0) return 'none';
  // 取强度最高的执念作为该 NPC 的"流派标签"
  let top = obs[0];
  for (const o of obs) if ((o.intensity || 0) > (top.intensity || 0)) top = o;
  return top.type || 'none';
}

function classifyNPC(ent) {
  const fId = ent.state.get('factionId');
  return {
    role: ent.state.get('currentRole') || 'none',
    rank: ent.state.get('rankId') || 'unknown',
    factionType: fId ? (FACTION_TYPE[fId] || 'wanderer') : 'wanderer',
    archetype: npcArchetype(ent),
  };
}

// 妖兽画像容器：按 grade(阶) / family(族) / type(妖兽/灵兽/上古) 分桶统计 behaviorState 分布。
const monsterProfile = { grade: {}, family: {}, type: {} };
function monsterBucket(dim, cat) {
  if (!cat && cat !== 0) cat = '__unknown__';
  const dimMap = monsterProfile[dim];
  const key = String(cat);
  if (!dimMap[key]) dimMap[key] = { ticks: 0, states: {}, members: new Set() };
  return dimMap[key];
}

const engine = new WorldEngine();
const initResult = engine.init(configs);
console.log(`引擎初始化: ${initResult.totalFactions} 势力, ${initResult.totalNPCs} NPC`);
console.log(`模拟种子: ${engine.seed}`);

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
const jobActionDiagnostics = {
  byActionId: {},
  byJobId: {},
  byToilId: {},
  byReason: {},
  samples: [],
};
const questObservationStats = {
  activeQuestSamples: [],
  reactionSamples: [],
  assistSamples: [],
  questProgressSamples: [],
};
const eventTypeCounts = {};

// ── NPC 一生回放（2026-06-02）─────────────────────────────────────────
// 采样若干"有代表性"的 NPC，逐决策点记录它们的一生日记：
//   每天选了什么行为、什么需求/目标驱动、当时境界/灵气/年龄/位置、发生了什么生平事件。
// 目的：从"上帝视角全局统计"降落到"单个 NPC 的人生叙事"，肉眼判断 NPC 是否生动（重复/无故事/对大事无反应）。
// 轻量护栏：只跟踪 LIFELOG_MAX 个 NPC；每个 NPC 只在"行为发生变化 / 有生平事件"时追加一行（变化点压缩），
// 避免 700 天 × N 人逐天爆量。
// 当前先跟踪 5 个有代表性的 NPC（验证工具好用后，去掉上限即可扩展到"调试所有人"）。
const LIFELOG_MAX = 5;
const lifeTracked = new Map(); // npcId -> { meta, days: [...] }

function rankShort(ent) {
  return ent.state.get('rankName') || ent.state.get('rankId') || '?';
}

function npcPosition(ent) {
  const sp = ent.spatial;
  if (sp && sp.position) return { x: sp.position.x ?? null, y: sp.position.y ?? null };
  return null;
}

// 选定一组要跟踪的 NPC：覆盖不同画像（掌门/长老/外门弟子/散修/复仇者/妖族），保证看点多样。
function pickLifeTrackTargets() {
  const npcs = engine.entityRegistry.getByType('npc');
  const picked = new Map();
  const tryPick = (label, pred) => {
    if (picked.size >= LIFELOG_MAX) return;
    const found = npcs.find(n => !picked.has(n.id) && n.alive !== false && pred(n));
    if (found) picked.set(found.id, label);
  };
  const role = (n) => n.state.get('currentRole') || '';
  const ftype = (n) => FACTION_TYPE[n.state.get('factionId')] || 'wanderer';
  const hasObs = (n, t) => (n.obsessions?.obsessions || []).some(o => o.type === t);

  tryPick('掌门', n => /leader|master|head/.test(role(n)));
  tryPick('长老', n => /elder/.test(role(n)));
  tryPick('散修', n => !n.state.get('factionId'));
  tryPick('复仇者', n => hasObs(n, 'revenge'));
  tryPick('妖族修士', n => ftype(n) === 'demon');
  tryPick('夺权野心家', n => hasObs(n, 'power') || hasObs(n, 'supremacy'));
  tryPick('外门弟子', n => /outer|inner|disciple/.test(role(n)));
  // 兜底：补足到 LIFELOG_MAX，随便挑还没选的存活 NPC。
  for (const n of npcs) {
    if (picked.size >= LIFELOG_MAX) break;
    if (!picked.has(n.id) && n.alive !== false) picked.set(n.id, '其他');
  }
  for (const [id, label] of picked) {
    const ent = engine.entityRegistry.getById(id);
    lifeTracked.set(id, {
      meta: {
        id, label,
        name: ent.name || id,
        factionId: ent.state.get('factionId') || null,
        factionName: ent.state.get('factionId') ? (initRes[ent.state.get('factionId')]?.name || ent.state.get('factionId')) : '散修',
        role: role(ent) || '-',
        gender: ent.state.get('gender') || 'male',
        bornRank: rankShort(ent),
        spiritRoot: ent.state.get('spiritRootGrade') || ent.staticData?.get?.('spiritRoot') || null,
      },
      days: [],
      _lastAction: null,
      _lastObs: '',
    });
  }
}

function obsSignature(ent) {
  const obs = ent.obsessions?.obsessions || [];
  return obs.map(o => `${o.type}:${Math.round(o.intensity || 0)}`).sort().join(',');
}

// 每天对被跟踪 NPC 记一笔（仅在行为变化或有生平事件时落一行，做"变化点压缩"）。
function recordLifeDay(day, ent, nl, lifeEvents) {
  const rec = lifeTracked.get(ent.id);
  if (!rec) return;
  const exec = nl.execution || {};
  const isIdle = exec.status === 'idle';
  const actionName = isIdle ? '空闲' : actName(exec.action?.name || exec.result?.actionName || '空闲');
  const plan = nl.plan || {};
  const obsSig = obsSignature(ent);

  // 执念变化也算"变化点"。
  const obsChanged = obsSig !== rec._lastObs;
  const actionChanged = actionName !== rec._lastAction;
  const hasEvent = lifeEvents && lifeEvents.length > 0;
  if (!actionChanged && !obsChanged && !hasEvent) return; // 无变化，压缩掉

  const mind = typeof ent.getMindSummary === 'function' ? ent.getMindSummary() : { obsessions: [], emotions: {} };
  const totalCultivation = Number(ent.state.get('totalCultivation') || 0);
  const nextCultivationRequired = Number(ent.state.get('nextCultivationRequired') || 0);
  const cultivationCompletion = nextCultivationRequired > 0
    ? totalCultivation / nextCultivationRequired
    : 0;
  rec.days.push({
    day,
    action: actionName,
    needId: plan.needId || nl.execution?.result?.needId || null,
    needName: plan.needName || null,
    needPriority: plan.needPriority != null ? Math.round(plan.needPriority) : null,
    goalSource: plan.goalSource || null,
    fallback: !!plan.fallback,
    rank: rankShort(ent),
    qi: Math.round(ent.state.get('qi') || 0),
    totalCultivation: Number(totalCultivation.toFixed(2)),
    nextCultivationRequired: Number(nextCultivationRequired.toFixed(2)),
    cultivationCompletion: Number(cultivationCompletion.toFixed(4)),
    age: ent.state.get('ageYears') ?? null,
    pos: npcPosition(ent),
    obsessions: mind.obsessions.map(o => ({ type: o.type, intensity: Math.round(o.intensity || 0) })),
    anger: Math.round(mind.emotions?.anger || 0),
    innerDemon: Math.round(mind.emotions?.inner_demon || 0),
    events: lifeEvents || [],
  });
  rec._lastAction = actionName;
  rec._lastObs = obsSig;
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function pushSample(list, sample, limit = 20) {
  if (!Array.isArray(list) || list.length >= limit) return;
  list.push(sample);
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

function topEntries(map, limit = 8) {
  return Object.entries(map || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`)
    .join(', ');
}

// 选定一生回放跟踪对象（初始化后、主循环前）。
pickLifeTrackTargets();
console.log(`[一生回放] 跟踪 ${lifeTracked.size} 个 NPC: ${[...lifeTracked.values()].map(r => `${r.meta.label}·${r.meta.name}`).join('、')}`);

// ── 主循环 ─────────────────────────
const t0 = performance.now();
for (let day = 1; day <= TOTAL_DAYS; day++) {
  const tick = engine.tick();

  for (const md of tick.monsterDeaths || []) {
    monsterResourceStats.deaths++;
    addCount(monsterResourceStats.deathsByCause, md.cause || 'unknown');
    if (md.cause === 'quest_hunt') monsterResourceStats.questHuntDeaths++;
    if (Array.isArray(md.assistNpcIds) && md.assistNpcIds.length > 0) {
      pushSample(questObservationStats.assistSamples, {
        day,
        monsterId: md.monsterId || md.id || null,
        cause: md.cause || 'unknown',
        killerNpcId: md.killerNpcId || null,
        assistNpcIds: md.assistNpcIds,
      });
    }
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

    // 行为画像（2026-06-02）：把本 tick 的行为按 NPC 的 职位/境界/势力类型/流派执念 分桶累计。
    {
      const isIdle = nl.execution?.status === 'idle';
      const cls = classifyNPC(ent);
      for (const dim of PROFILE_DIMS) {
        const b = profileBucket(dim, cls[dim]);
        b.ticks++;
        b.members.add(nl.entityId);
        if (isIdle) b.idle++;
        else b.actions[n] = (b.actions[n] || 0) + 1;
      }
    }

    if (nl.plan?.fallback) nFallback++; else if (nl.execution?.status !== 'idle') nGoapOk++;

    // 复仇行为链统计（ADR-020）：按本 tick 执行结算的行为/结果累计。
    const exAid = nl.execution?.action?.id || nl.execution?.result?.actionId || '';
    const outcome = nl.execution?.result?.outcome;
    const result = nl.execution?.result || {};
    const jobSnapshot = nl.execution?.job || null;
    const jobId = result.jobId || jobSnapshot?.currentJobId || ACTION_JOB_MAP[exAid] || null;
    const toilId = result.failedToilId || result.currentToilId || jobSnapshot?.currentToilId || ent.state.get('currentToilId') || null;
    const reasonKey = result.reason || nl.execution?.reason || result.outcome || nl.execution?.status || 'unknown';
    if (jobId || ACTION_JOB_MAP[exAid]) {
      addCount(jobActionDiagnostics.byActionId, exAid || result.actionId || '__unknown__');
      addCount(jobActionDiagnostics.byJobId, jobId || '__unknown__');
      addCount(jobActionDiagnostics.byToilId, toilId || '__none__');
      addCount(jobActionDiagnostics.byReason, `${nl.execution?.status || 'unknown'}:${reasonKey}`);
      if (nl.execution?.status !== 'in_progress' || jobId === 'job_npc_monster_hunt') {
        pushSample(jobActionDiagnostics.samples, {
          day,
          npcId: nl.entityId,
          actionId: exAid || result.actionId || null,
          jobId,
          toilId,
          executionStatus: nl.execution?.status || null,
          resultStatus: result.status || null,
          reason: reasonKey,
          questTypeId: result.questTypeId || ent.state.get('activeQuestTypeId') || null,
          activeQuestInstance: ent.state.get('activeQuestInstance') || null,
        }, 40);
      }
    }
    if (exAid.startsWith('act_npc_react')) {
      pushSample(questObservationStats.reactionSamples, {
        day,
        npcId: nl.entityId,
        actionId: exAid,
        outcome: result.outcome || null,
        reason: result.reason || null,
        description: result.description || '',
      });
    }
    if (result.activeQuestInstance || result.killedCount != null || result.monsterId) {
      pushSample(questObservationStats.questProgressSamples, {
        day,
        npcId: nl.entityId,
        actionId: exAid || result.actionId || null,
        outcome: result.outcome || null,
        questTypeId: result.questTypeId || ent.state.get('activeQuestTypeId') || null,
        monsterId: result.monsterId || null,
        killedCount: result.killedCount ?? null,
        requiredKills: result.requiredKills ?? null,
        activeQuestInstance: result.activeQuestInstance || ent.state.get('activeQuestInstance') || null,
      });
    }
    const activeQuestInstance = ent.state.get('activeQuestInstance');
    if (activeQuestInstance && huntQuestIds.has(ent.state.get('activeQuestTypeId'))) {
      pushSample(questObservationStats.activeQuestSamples, {
        day,
        npcId: nl.entityId,
        actionId: exAid || result.actionId || null,
        jobId,
        toilId,
        hasActiveQuest: ent.state.get('hasActiveQuest') === true,
        questComplete: ent.state.get('questComplete') === true,
        questDaysRemaining: ent.state.get('questDaysRemaining') ?? null,
        questTargetMonsterId: ent.state.get('questTargetMonsterId') || null,
        needsCombatSupply: ent.state.get('needsCombatSupply') === true,
        needsCompanion: ent.state.get('needsCompanion') === true,
        needsEasierHuntTarget: ent.state.get('needsEasierHuntTarget') === true,
        activeQuestInstance,
      }, 40);
    }
    if (result.eventType) eventTypeCounts[result.eventType] = (eventTypeCounts[result.eventType] || 0) + 1;
    if (exAid === 'act_npc_donate_materials' || result.eventType === 'material_donate') economyActionCounts.material_donate++;
    if (exAid === 'act_npc_job_redeem_qi_pill' || result.eventType === 'redeem_qi_pill') economyActionCounts.redeem_qi_pill++;
    if (exAid === 'act_npc_job_use_qi_pill' || result.eventType === 'use_qi_pill') economyActionCounts.use_qi_pill++;
    if (exAid === 'act_npc_redeem_breakthrough_pill' || result.eventType === 'redeem_breakthrough_pill') economyActionCounts.redeem_breakthrough_pill++;
    if (exAid === 'act_npc_use_breakthrough_pill' || result.eventType === 'use_breakthrough_pill') economyActionCounts.use_breakthrough_pill++;
    if (exAid === 'act_npc_redeem_artifact' || result.eventType === 'redeem_artifact_low') economyActionCounts.redeem_artifact++;
    if (result.eventType === 'quest_item_reward' || (result.extraRewards?.questItemReward || 0) > 0) economyActionCounts.quest_item_reward++;
    const resultSucceeded = result.success === true || result.status === 'success';
    const resultFailed = result.success === false || result.status === 'failed' || result.status === 'abort';
    if (exAid === 'act_npc_accept_monster_hunt_job') {
      monsterResourceStats.huntQuestActionTicks++;
    }
    if ((exAid === 'act_npc_accept_monster_hunt_job' || exAid === 'act_npc_accept_quest_job'
        || result.actionId === 'act_npc_accept_monster_hunt_job' || result.actionId === 'act_npc_accept_quest_job')
        && resultSucceeded
        && huntQuestIds.has(result.questTypeId)) {
      monsterResourceStats.huntQuestAccepted++;
    }
    if ((exAid === 'act_npc_execute_quest_job' || result.actionId === 'act_npc_execute_quest_job')
        && huntQuestIds.has(result.questTypeId)) {
      if (result.outcome === 'complete' && resultSucceeded) monsterResourceStats.huntQuestCompleted++;
      else if (resultFailed) {
        monsterResourceStats.huntQuestFailed++;
        addCount(monsterResourceStats.huntQuestFailureOutcomes, result.outcome || 'unknown');
      }
    }
    if (exAid === 'act_npc_job_hunt_enemy') huntTriggers++;
    if (exAid === 'act_npc_job_kill_enemy') killTriggers++;
    if (outcome === 'enemy_slain') pvpEnemySlain++;
    else if (outcome === 'slain_by_enemy') pvpSlain++;
    else if (outcome === 'wounded') pvpWounded++;
    // 关系驱动行为（ADR-028）
    if (exAid === 'act_npc_assist_ally') assistTriggers++;
    if (exAid === 'act_npc_visit_benefactor') visitTriggers++;
    // 师徒互动行为（ADR-029）
    if (exAid === 'act_npc_job_teach_disciple') teachTriggers++;
    if (exAid === 'act_npc_protect_disciple') protectDiscipleTriggers++;
    if (exAid === 'act_npc_job_visit_master') visitMasterTriggers++;

    // 一生回放（2026-06-02）：先捕获本 tick 的生平事件，再记录这一天（在 _deathInfo/_breakthroughInfo 被清空前）。
    const lifeEvents = [];
    if (lifeTracked.has(ent.id)) {
      if (outcome === 'enemy_slain') lifeEvents.push({ kind: 'kill', text: '手刃仇人' });
      else if (outcome === 'slain_by_enemy') lifeEvents.push({ kind: 'death', text: '寻仇反被杀' });
      else if (outcome === 'wounded') lifeEvents.push({ kind: 'hurt', text: '负伤' });
      if (exAid === 'act_npc_job_teach_disciple') lifeEvents.push({ kind: 'social', text: '点化徒弟' });
      if (exAid === 'act_npc_job_visit_master') lifeEvents.push({ kind: 'social', text: '探望恩师' });
      if (exAid === 'act_npc_visit_benefactor') lifeEvents.push({ kind: 'social', text: '探望恩人' });
      if (exAid === 'act_npc_assist_ally') lifeEvents.push({ kind: 'social', text: '驰援同门' });
      if (ent._breakthroughInfo) {
        const bi = ent._breakthroughInfo;
        lifeEvents.push({
          kind: 'breakthrough',
          text: bi.success === false ? `突破 ${bi.targetRank || ''} 失败` : `突破至 ${bi.toRank || rankShort(ent)}`,
        });
      }
      if (ent._deathInfo) {
        const c = ent._deathInfo.cause;
        const causeText = c === 'natural' ? '寿尽而终' : c === 'slain' ? '死于仇杀' : c === 'monster' ? '殒于妖兽' : `身故(${c})`;
        lifeEvents.push({ kind: 'death', text: causeText });
      }
    }

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

    // 记录被跟踪 NPC 这一天（变化点压缩）。在死亡事件捕获之后调用，保证最后一行带死亡。
    if (lifeTracked.has(ent.id)) {
      recordLifeDay(day, ent, nl, lifeEvents);
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
    // 妖兽行为画像（2026-06-02）：稀疏采样存活妖兽的 behaviorState，按 阶/族/类型 分桶统计分布。
    for (const m of engine.entityRegistry.getAliveByType('monster')) {
      const bs = m.state.get('behaviorState') || 'unknown';
      const grade = m.grade;
      const family = m.staticData.get('family');
      const mtype = m.staticData.get('type') || m.type;
      for (const [dim, cat] of [['grade', grade], ['family', family], ['type', mtype]]) {
        const b = monsterBucket(dim, cat);
        b.ticks++;
        b.members.add(m.id);
        b.states[bs] = (b.states[bs] || 0) + 1;
      }
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
const relLayers = relStats.byLayer || {};
const relMarks = relStats.marksByType || {};
console.log(`[关系网] goalsEnabled=${relGoalsOn}，关系边总数: ${relStats.total}`);
console.log(`[关系网] 人际边: same_sect=${bt.same_sect || 0}, master=${bt.master || 0}, enemy=${bt.enemy || 0}, grudge=${bt.grudge || 0}, dao_companion=${bt.dao_companion || 0}, kin=${bt.kin || 0}`);
console.log(`[关系网] 妖群/领地边: pack_member=${bt.pack_member || 0}, pack_leader=${bt.pack_leader || 0}, territory_threat=${bt.territory_threat || 0}, beast_grudge=${bt.beast_grudge || 0}`);
console.log(`[关系账本] individual=${relLayers.individual || 0}, group=${relLayers.group || 0}, faction=${relLayers.faction || 0}, legacyEdges=${relStats.legacyEdges || 0}`);
console.log(`[关系标记] wantedOrder=${relMarks.wantedOrder || 0}, bloodFeud=${relMarks.bloodFeud || 0}, lifeDebt=${relMarks.lifeDebt || 0}, resourceGrudge=${relMarks.resourceGrudge || 0}`);
console.log(`[关系驱动] 驰援同门触发: ${assistTriggers}，探望恩人触发: ${visitTriggers}`);
console.log(`[师徒互动] 传功点化: ${teachTriggers}，护徒驰援: ${protectDiscipleTriggers}，探望恩师: ${visitMasterTriggers}`);

console.log(`[妖兽资源] 猎妖接取: ${monsterResourceStats.huntQuestAccepted}，完成: ${monsterResourceStats.huntQuestCompleted}，失败: ${monsterResourceStats.huntQuestFailed}`);
console.log(`[妖兽资源] 妖兽死亡: ${monsterResourceStats.deaths}，任务击杀: ${monsterResourceStats.questHuntDeaths}，掉落: ${JSON.stringify(monsterResourceStats.drops)}`);
console.log(`[Job诊断] reason Top: ${topEntries(jobActionDiagnostics.byReason) || '-'}`);
console.log(`[Job诊断] toil Top: ${topEntries(jobActionDiagnostics.byToilId) || '-'}`);

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
  const cultivationCompletion = alive.map(n => {
    const required = Number(n.nextCultivationRequired || 0);
    return required > 0 ? Number(n.totalCultivation || 0) / required : 0;
  });
  const fs = Object.values(snap.factions).filter(f => !f.isDestroyed);
  return {
    day: snap.day,
    aliveNPC: alive.length, deadNPC: ns.length - alive.length,
    aliveFaction: fs.length,
    avgQi: qi.length > 0 ? +(qi.reduce((a, b) => a + b, 0) / qi.length).toFixed(2) : 0,
    maxQi: qi.length > 0 ? +Math.max(...qi).toFixed(2) : 0,
    avgCultivationCompletion: cultivationCompletion.length > 0
      ? +(cultivationCompletion.reduce((a, b) => a + b, 0) / cultivationCompletion.length).toFixed(4)
      : 0,
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
      qi: m.qi || 0,
      totalCultivation: m.totalCultivation || 0,
      nextCultivationRequired: m.nextCultivationRequired || 0,
      cultivationCompletion: m.nextCultivationRequired > 0
        ? (m.totalCultivation || 0) / m.nextCultivationRequired
        : 0,
      stone: m.inventory?.low_spirit_stone ?? 0,
      contribution: m.contribution || 0, quests: m.totalQuestsCompleted || 0,
      gender: m.gender || 'male',
      daoCompanionId: m.daoCompanionId || null,
      childrenCount: m.childrenCount || 0,
      alive: m.alive,
    })),
  };
});

// ── 行为画像整理（2026-06-02）──────────────────────
// 把每个 (dim, cat) 的行为表整理成「top 行为 + 占比 + 行为种类数 + 空闲率」，
// 这是判断"某类人行为是否单一/是否缺失关键行为"的核心证据。
function buildProfile(dimMaps) {
  const out = {};
  for (const [dim, cats] of Object.entries(dimMaps)) {
    out[dim] = {};
    for (const [cat, data] of Object.entries(cats)) {
      const entries = Object.entries(data.actions || data.states || {}).sort(([, a], [, b]) => b - a);
      const totalActs = entries.reduce((s, [, c]) => s + c, 0);
      out[dim][cat] = {
        members: data.members ? data.members.size : 0,
        ticks: data.ticks,
        idleRate: data.ticks > 0 ? +((data.idle || 0) / data.ticks).toFixed(3) : 0,
        actionKinds: entries.length,
        top: entries.slice(0, 8).map(([name, count]) => ({
          name, count, pct: totalActs > 0 ? +(count / totalActs * 100).toFixed(1) : 0,
        })),
      };
    }
  }
  return out;
}

const npcProfileOut = buildProfile(archetypeProfile);
const monsterProfileOut = buildProfile(monsterProfile);

// 终端打印：逐类行为画像（醒来/每轮分析直接看终端即可）。
function printProfile(title, profileOut, dimLabels) {
  console.log(`\n========== ${title} ==========`);
  for (const [dim, cats] of Object.entries(profileOut)) {
    console.log(`\n--- 维度：${dimLabels[dim] || dim} ---`);
    const sorted = Object.entries(cats).sort(([, a], [, b]) => b.members - a.members);
    for (const [cat, info] of sorted) {
      const topStr = info.top.map(t => `${t.name}(${t.pct}%)`).join('、') || '无';
      console.log(`  [${cat}] 个体${info.members} 行为种类${info.actionKinds} 空闲率${(info.idleRate * 100).toFixed(0)}% | ${topStr}`);
    }
  }
}
printProfile('NPC 行为画像', npcProfileOut, { role: '职位', rank: '境界', factionType: '势力类型', archetype: '流派执念' });
printProfile('妖兽行为画像', monsterProfileOut, { grade: '阶', family: '族', type: '类型' });

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
  seed: engine.seed,
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
  relationshipStats: relStats,
  jobActionDiagnostics,
  questObservationStats,
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
  // 行为画像（2026-06-02）：按类别拆分的 NPC/妖兽行为分布，供逐类对标世界观分析。
  npcProfile: npcProfileOut,
  monsterProfile: monsterProfileOut,
  // NPC 一生回放（2026-06-02）：采样 NPC 的逐决策点人生日记（变化点压缩），供"人生回放"tab 渲染。
  npcLife: [...lifeTracked.values()].map(rec => ({
    ...rec.meta,
    deathDay: rec.days.find(d => d.events?.some(e => e.kind === 'death'))?.day ?? null,
    dayCount: rec.days.length,
    days: rec.days,
  })),
  diagnostics,
};

// 一生回放采集情况打印（醒来/每轮可直接在终端核对数据是否采到）。
console.log(`\n========== NPC 一生回放（采样 ${lifeTracked.size} 人）==========`);
for (const rec of lifeTracked.values()) {
  const last = rec.days[rec.days.length - 1];
  const deathLine = rec.days.find(d => d.events?.some(e => e.kind === 'death'));
  const fate = deathLine ? `第${deathLine.day}天${deathLine.events.find(e => e.kind === 'death').text}` : '仍在世';
  console.log(`  [${rec.meta.label}] ${rec.meta.name}（${rec.meta.factionName}/${rec.meta.role}）变化点 ${rec.days.length} 条，结局：${fate}，末态境界 ${last?.rank || '?'}`);
}

const outPath = resolve(__dirname, 'report-data.js');
writeFileSync(outPath, `window.REPORT_DATA = ${JSON.stringify(reportData, null, 2)};`, 'utf-8');
console.log(`数据已写入: ${outPath}`);
console.log(`打开 report.html 查看可视化报告`);
