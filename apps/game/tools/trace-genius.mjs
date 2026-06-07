#!/usr/bin/env node
/**
 * 天才 NPC 修炼轨迹追踪 — 无头运行 WorldEngine，逐境界/变化点记录 npc_999（林天骄）的一生。
 *
 * 用法: node apps/game/tools/trace-genius.mjs [天数] [npcId]
 *   天数缺省 3000；npcId 缺省 npc_999。
 *
 * 输出：终端打印
 *   1) 该 NPC 的逐境界突破时间线（哪天从什么境界突破到什么境界、当时年龄）
 *   2) 行为分布（这一生主要在做什么）
 *   3) 关键变化点日记（境界/修为/真气/年龄/行为变化）
 *   4) 结局（仍在世 / 何时何因身故）
 */
import { readFileSync, createWriteStream } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GAME_ROOT = resolve(__dirname, '..');
function loadJSON(p) { return JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8')); }

// 同时输出到控制台与 UTF-8 文件，规避 Windows 终端中文乱码。
// 文件路径可用 LOG_FILE 覆盖，缺省 apps/game/tools/tmp-genius-log.txt。
const LOG_FILE = resolve(GAME_ROOT, 'tools', process.env.LOG_FILE || 'tmp-genius-log.txt');
const logStream = createWriteStream(LOG_FILE, { encoding: 'utf-8' });
const _origLog = console.log.bind(console);
console.log = (...args) => {
  const line = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
  logStream.write(line + '\n');
  _origLog(...args);
};
process.on('exit', () => { try { logStream.end(); } catch { /* noop */ } });

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
  monsterAttributeTemplates: loadJSON('data/definitions/monster-attribute-templates.json'),
  monsterSpawn: loadJSON('data/balance/monster-spawn.json'),
  worldNews: loadJSON('data/world/news.json'),
  worldOpportunities: loadJSON('data/world/opportunities.json'),
  balanceCovet: loadJSON('data/balance/covet.json'),
  itemDefs: { items: ['currency','material','pill','artifact','talisman','technique'].flatMap(c => loadJSON(`data/items/${c}.json`).items) },
  // GAS 机制资产（ADR-042）：缺这三项则锁血/遁地能力不会被授予，保命符形同虚设。
  tags: loadJSON('data/tags/tags.json'),
  effects: { effects: [...(loadJSON('data/effects/combat-effects.json')?.effects || []), ...(loadJSON('data/effects/core-effects.json')?.effects || [])] },
  abilities: loadJSON('data/abilities/combat-abilities.json'),
};

const ACTION_MAP = {};
for (const a of [...configs.factionActions, ...configs.npcActions, ...configs.worldRules]) {
  if (a.id && a.name) ACTION_MAP[a.id] = a.name;
}
function actName(raw) {
  if (!raw || raw === 'idle') return '空闲';
  return raw.startsWith('act_') ? (ACTION_MAP[raw] || raw) : raw;
}

const { WorldEngine } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href
);

const TOTAL_DAYS = Number.isFinite(parseInt(process.argv[2], 10)) ? parseInt(process.argv[2], 10) : 3000;
const TARGET_ID = process.argv[3] || 'npc_999';
const SEED = Number.isFinite(parseInt(process.argv[4], 10)) ? parseInt(process.argv[4], 10) : undefined;
if (SEED !== undefined) { configs.seed = SEED; console.log(`使用种子: ${SEED}`); }

const engine = new WorldEngine();
const initResult = engine.init(configs);
console.log(`引擎初始化: ${initResult.totalFactions} 势力, ${initResult.totalNPCs} NPC`);

const target = engine.entityRegistry.getById(TARGET_ID);
if (!target) {
  console.error(`找不到目标 NPC: ${TARGET_ID}`);
  process.exit(1);
}

function snap(ent) {
  const totalCultivation = Number(ent.state.get('totalCultivation') || 0);
  const nextCultivationRequired = Number(ent.state.get('nextCultivationRequired') || 0);
  const cultivationCompletion = nextCultivationRequired > 0
    ? totalCultivation / nextCultivationRequired
    : 0;
  return {
    rankName: ent.state.get('rankName'),
    rankId: ent.state.get('rankId'),
    role: ent.state.get('currentRole'),
    age: ent.state.get('ageYears'),
    maxAge: ent.state.get('maxAgeYears'),
    qi: Math.round((ent.state.get('qi') || 0) * 100) / 100,
    cultivation: Number((ent.state.get('cultivation') || 0).toFixed(2)),
    experienceCultivation: Number((ent.state.get('experienceCultivation') || 0).toFixed(2)),
    totalCultivation: Number(totalCultivation.toFixed(2)),
    nextCultivationRequired: Number(nextCultivationRequired.toFixed(2)),
    cultivationCompletion: Number(cultivationCompletion.toFixed(4)),
    contribution: Math.round(ent.state.get('contribution') || 0),
    stone: ent.inventory?.getAmount('low_spirit_stone') || 0,
    spiritRoot: ent.state.get('spiritRootId'),
    physique: ent.state.get('physiqueId'),
  };
}

const VERBOSE = process.env.VERBOSE !== '0'; // 默认全量明细，设 VERBOSE=0 关闭

const s0 = snap(target);
console.log(`\n========== 追踪对象 ==========`);
console.log(`${target.name}（${TARGET_ID}）`);
console.log(`天赋: 灵根=${s0.spiritRoot} 体质=${s0.physique}`);
console.log(`初始: 境界=${s0.rankName} 职位=${s0.role} 年龄=${s0.age}/${s0.maxAge}岁 真气=${s0.qi} 修为=${s0.totalCultivation}/${s0.nextCultivationRequired}`);
if (VERBOSE) console.log(`\n========== 全量事件日志（每一次行为/突破/跳过）==========`);

/** 提取并格式化一条 npcLog 的全部可读信息 */
function fmtLog(day, ent, nl) {
  const s = snap(ent);
  const head = `第${day}天 [${s.rankName}|${s.age}岁|真气${s.qi}|修为${s.totalCultivation}/${s.nextCultivationRequired}(${Math.round(s.cultivationCompletion * 100)}%，闭${s.cultivation}+历${s.experienceCultivation})|贡${s.contribution}|石${s.stone}]`;
  if (!nl) return `${head} （本tick无NPC日志）`;
  if (nl.skipped) return `${head} 跳过: ${nl.skipReason || nl.reason || JSON.stringify(nl).slice(0, 120)}`;
  const exec = nl.execution || {};
  const res = exec.result || {};
  const status = exec.status || res.status || '?';
  const actRaw = exec.action?.id || exec.action?.name || res.actionId || res.actionName;
  const aName = actName(actRaw || (status === 'idle' ? 'idle' : '?'));
  const phase = exec.phase ? ` (${exec.phase})` : '';
  const desc = res.description || exec.description || '';
  // 收集 result 里的数值字段
  const nums = [];
  for (const k of ['qiGain', 'qi', 'speed', 'stoneConsumed', 'contributionSpent',
                   'cultivationGain', 'experienceCultivationGain', 'totalCultivation', 'lifespanGain', 'reward',
                   'contributionGain', 'stoneGain', 'success']) {
    if (res[k] !== undefined) nums.push(`${k}=${typeof res[k] === 'number' ? Math.round(res[k] * 1000) / 1000 : res[k]}`);
  }
  let line = `${head} 行为=${aName}${phase} status=${status}`;
  if (desc) line += ` | ${desc}`;
  if (nums.length) line += ` | {${nums.join(', ')}}`;
  return line;
}

const breakthroughs = [];     // 突破事件（成功/失败）
const rankFirstReach = {};    // 各境界首次达到的天
rankFirstReach[s0.rankId] = { day: 0, age: s0.age };
const actionCounts = {};      // 行为分布
const diary = [];             // 变化点日记
let lastRank = s0.rankId;
let lastAction = null;
let aliveDays = 0;
let deathRecord = null;

for (let day = 1; day <= TOTAL_DAYS; day++) {
  const tick = engine.tick();

  const ent = engine.entityRegistry.getById(TARGET_ID);
  if (!ent) break;

  // 从 npcUpdates 找本 NPC 的本 tick 行为
  let nl = null;
  for (const u of tick.npcUpdates) {
    if (u.entityId === TARGET_ID) { nl = u; break; }
  }

  // 已死亡：记录后停止逐日追踪
  if (ent.alive === false) {
    if (!deathRecord) {
      const di = ent._deathInfo || {};
      deathRecord = { day, cause: di.cause || 'unknown', age: di.ageYears ?? ent.state.get('ageYears'), rank: di.rankName || ent.state.get('rankName'), monsterName: di.monsterName, monsterGrade: di.monsterGrade, crushDamage: di.crushDamage, victimMaxHp: di.victimMaxHp, orderGap: di.orderGap };
      diary.push({ day, ...snap(ent), action: '【身故】' + (deathRecord.cause === 'natural' ? '寿尽而终' : deathRecord.cause), event: true });
    }
    break;
  }
  aliveDays = day;

  // 全量明细：每个有日志的 tick 打印一行（含跳过）
  if (VERBOSE && nl) {
    console.log('  ' + fmtLog(day, ent, nl));
  }

  if (nl && !(nl.skipped)) {
    const a = nl.execution?.status === 'idle' ? '空闲'
      : actName(nl.execution?.action?.name || nl.execution?.result?.actionName || '空闲');
    actionCounts[a] = (actionCounts[a] || 0) + 1;

    if (a !== lastAction) {
      diary.push({ day, ...snap(ent), action: a, event: false });
      lastAction = a;
    }
  }

  // 突破事件（无论是否 skipped 都检查）
  if (ent._breakthroughInfo) {
    const bi = ent._breakthroughInfo;
    breakthroughs.push({ day, age: ent.state.get('ageYears'), ...bi });
    const tag = bi.success ? `★突破成功 ${bi.fromRank}→${bi.toRank}` : `突破失败 ${bi.fromRank}→${bi.targetRank}`;
    diary.push({ day, ...snap(ent), action: tag, event: true });
    if (VERBOSE) console.log(`  ◆◆◆ 第${day}天 ${tag} (成功率掷骰) ◆◆◆`);
    ent._breakthroughInfo = null; // 消费掉，避免重复记录
  }

  // 境界首次达到
  const curRank = ent.state.get('rankId');
  if (curRank !== lastRank) {
    if (!rankFirstReach[curRank]) rankFirstReach[curRank] = { day, age: ent.state.get('ageYears') };
    lastRank = curRank;
  }
}

console.log(`\n========== 突破时间线 ==========`);
if (breakthroughs.length === 0) {
  console.log('  （整段模拟内未发生任何突破尝试）');
} else {
  for (const b of breakthroughs) {
    const tag = b.success ? '✔成功' : '✘失败';
    const to = b.success ? b.toRank : b.targetRank;
    const yrs = Math.round(b.day / 360 * 10) / 10;
    console.log(`  第${b.day}天(第${yrs}年, ${b.age}岁) ${tag}：${b.fromRank} → ${to}`);
  }
}

console.log(`\n========== 各境界首次达到 ==========`);
const rankOrder = ['mortal', 'qi_refining', 'foundation_building', 'golden_core', 'nascent_soul', 'spirit_transformation'];
const rankCN = { mortal: '凡人', qi_refining: '炼气', foundation_building: '筑基', golden_core: '金丹', nascent_soul: '元婴', spirit_transformation: '化神' };
for (const r of rankOrder) {
  if (rankFirstReach[r]) {
    const f = rankFirstReach[r];
    console.log(`  ${rankCN[r]}: 第${f.day}天（${f.age}岁）`);
  }
}

console.log(`\n========== 一生行为分布 ==========`);
const totalActs = Object.values(actionCounts).reduce((a, b) => a + b, 0);
for (const [a, c] of Object.entries(actionCounts).sort(([, x], [, y]) => y - x)) {
  console.log(`  ${a}: ${c} 次 (${(c / totalActs * 100).toFixed(1)}%)`);
}

console.log(`\n========== 关键变化点日记（共 ${diary.length} 条，仅显示突破/前30条）==========`);
const shown = diary.filter(d => d.event).concat(diary.filter(d => !d.event).slice(0, 30 - diary.filter(d => d.event).length));
shown.sort((a, b) => a.day - b.day);
for (const d of shown) {
  const mark = d.event ? '◆' : ' ';
  console.log(`  ${mark} 第${d.day}天 [${d.rankName}|${d.age}岁] ${d.action} | 真气${d.qi} 总进度${d.total}`);
}

console.log(`\n========== 结局 ==========`);
const final = engine.entityRegistry.getById(TARGET_ID);
if (deathRecord) {
  const causeCN = deathRecord.cause === 'natural' ? '寿尽而终' : deathRecord.cause === 'slain' ? '死于仇杀' : deathRecord.cause;
  console.log(`  第${deathRecord.day}天 ${causeCN}，享年${deathRecord.age}岁，止步于 ${deathRecord.rank}`);
  if (deathRecord.cause === 'monster') {
    console.log(`  死因诊断: 妖兽=${deathRecord.monsterName}(grade${deathRecord.monsterGrade}) 单击伤害=${deathRecord.crushDamage} 受害maxHp=${deathRecord.victimMaxHp} orderGap=${deathRecord.orderGap} (碾压阈值: orderGap≥25 或 伤害≥maxHp×3)`);
  }
} else {
  const s = snap(final);
  console.log(`  存活至模拟结束（第${TOTAL_DAYS}天 / 约${Math.round(TOTAL_DAYS / 360)}年）`);
  console.log(`  末态：${s.rankName} | 年龄${s.age}/${s.maxAge}岁 | 真气${s.qi} | 总进度${s.total} | 贡献${s.contribution}`);
}
