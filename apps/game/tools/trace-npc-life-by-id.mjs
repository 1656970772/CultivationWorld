#!/usr/bin/env node
/**
 * 按 NPC id 追踪 1000 天内的逐日状态与行为日志。
 *
 * 用法：
 *   node tools/trace-npc-life-by-id.mjs --days=1000 --seed=20260619 --id=npc_born_1038 --out=linyao-npc_born_1038-1000-life-log.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GAME_ROOT = resolve(__dirname, '..');

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function loadJSON(path) {
  return JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number(n.toFixed(digits));
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

const DAYS = num(argValue('days', '1000'), 1000);
const SEED = num(argValue('seed', '20260619'), 20260619) >>> 0;
const TARGET_ID = argValue('id', 'npc_born_1038');
const OUT_FILE = argValue('out', `${TARGET_ID}-${DAYS}-life-log.md`);

const { loadGameConfigsFromManifest } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/core/data-manifest-loader.js')).href
);
const { WorldEngine } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href
);
const { getCultivationRequired, nextCultivationRank } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/numeric-cultivation.js')).href
);

const configs = await loadGameConfigsFromManifest(loadJSON('data/config/data-manifest.json'), {
  loadJson: loadJSON,
});
configs.seed = SEED;

const actionMap = {};
for (const action of [
  ...(configs.factionActions || []),
  ...(configs.npcActions || []),
  ...(configs.worldRules || []),
  ...(configs.npcJobActions || []),
]) {
  if (action?.id && action?.name) actionMap[action.id] = action.name;
}

function actionName(raw) {
  if (!raw || raw === 'idle') return '空闲';
  return actionMap[raw] || raw;
}

function snapshot(day, ent, tick, npcLog, extraEvents = []) {
  const exec = npcLog?.execution || {};
  const result = exec.result || {};
  const plan = npcLog?.plan || {};
  const job = exec.job || {};
  const isIdle = exec.status === 'idle' || !npcLog;
  const actionRaw = exec.action?.id || result.actionId || exec.action?.name || result.actionName;
  const action = isIdle ? '空闲' : actionName(actionRaw);

  const nextRequired = num(getCultivationRequired(ent, configs.ranks || []));
  const cultivation = num(ent.state.get('cultivation'));
  const experienceCultivation = num(ent.state.get('experienceCultivation'));
  const minRootRatio = num(configs.balanceCultivation?.minCultivationRatio, 0.3);
  const maxExpRatio = num(configs.balanceCultivation?.maxExperienceCultivationRatio, Math.max(0, 1 - minRootRatio));
  const effectiveExperience = nextRequired > 0
    ? Math.min(experienceCultivation, nextRequired * maxExpRatio)
    : experienceCultivation;
  const totalCultivation = cultivation + effectiveExperience;
  const nextRank = nextCultivationRank(ent, configs.ranks || []);
  const qiRequired = num(nextRank?.qiRequired, nextRequired);
  const rootRequired = nextRequired * minRootRatio;

  const events = [...extraEvents];
  if (ent._breakthroughInfo) {
    const bi = ent._breakthroughInfo;
    events.push(bi.success === false
      ? `突破失败:${bi.fromRank || ''}->${bi.targetRank || ''}`
      : `突破成功:${bi.fromRank || ''}->${bi.toRank || ''}`);
  }
  if (ent._deathInfo) {
    const cause = ent._deathInfo.cause || 'unknown';
    events.push(cause === 'natural' ? '身故:寿尽而终' : `身故:${cause}`);
  }
  for (const death of tick.deaths || []) {
    if (death.id === ent.id || death.entityId === ent.id || death.npcId === ent.id) {
      events.push(`死亡记录:${death.cause || 'unknown'}`);
    }
  }

  return {
    day,
    name: ent.name || ent.staticData?.name || ent.id,
    action,
    need: plan.needName || result.needName || plan.needId || result.needId || '',
    priority: plan.needPriority != null ? Math.round(plan.needPriority) : '',
    rank: ent.state.get('rankName') || ent.state.get('rankId') || '',
    role: ent.state.get('currentRole') || '',
    age: ent.state.get('ageYears') ?? '',
    qi: fmt(ent.state.get('qi'), 2),
    cultivation: fmt(cultivation),
    expCultivation: fmt(experienceCultivation),
    effectiveExp: fmt(effectiveExperience),
    totalCultivation: fmt(totalCultivation),
    completion: nextRequired > 0 ? `${(totalCultivation / nextRequired * 100).toFixed(1)}%` : '',
    rootShortfall: fmt(Math.max(0, rootRequired - cultivation)),
    totalShortfall: fmt(Math.max(0, nextRequired - totalCultivation)),
    qiShortfall: fmt(Math.max(0, qiRequired - num(ent.state.get('qi')))),
    stone: ent.inventory?.getAmount?.('low_spirit_stone') ?? '',
    contribution: fmt(ent.state.get('contribution'), 2),
    activeQuest: ent.state.get('activeQuestTypeName') || ent.state.get('activeQuestTypeId') || '',
    questComplete: ent.state.get('questComplete') === true ? '是' : '否',
    questDays: ent.state.get('questDaysRemaining') ?? '',
    job: job.currentJobId || ent.state.get('currentJobId') || '',
    toil: job.currentToilId || ent.state.get('currentToilId') || '',
    jobStatus: job.jobStatus || ent.state.get('jobStatus') || exec.status || '',
    result: result.description || result.outcome || result.status || '',
    events: events.join('; '),
  };
}

const engine = new WorldEngine();
const initResult = engine.init(configs);
const rows = [];
const birthEvents = [];
let firstSeen = null;
let finalEntity = null;

console.log(`引擎初始化: ${initResult.totalFactions} 势力, ${initResult.totalNPCs} NPC`);
console.log(`模拟种子: ${engine.seed}`);
console.log(`追踪目标: ${TARGET_ID}`);

for (let day = 1; day <= DAYS; day++) {
  const tick = engine.tick();
  const dayEvents = [];
  for (const evt of tick.events || []) {
    if (evt.type === 'birth' && evt.childId === TARGET_ID) {
      const line = `出生: ${evt.childName}，父=${evt.fatherName}，母=${evt.motherName}，势力=${evt.factionId || ''}`;
      dayEvents.push(line);
      birthEvents.push({ day, ...evt });
    }
  }

  const ent = engine.entityRegistry.getById(TARGET_ID);
  if (!ent) {
    if (day % 100 === 0) console.log(`  进度: ${day}/${DAYS}（目标尚未出现）`);
    continue;
  }

  if (!firstSeen) firstSeen = { day, name: ent.name || ent.id };
  finalEntity = ent;
  const npcLog = (tick.npcUpdates || []).find(update => update.entityId === TARGET_ID) || null;
  rows.push(snapshot(day, ent, tick, npcLog, dayEvents));

  if (ent._breakthroughInfo) ent._breakthroughInfo = null;
  if (ent._deathInfo) ent._deathInfo = null;

  if (day % 100 === 0) console.log(`  进度: ${day}/${DAYS}（已记录 ${rows.length} 天）`);
}

const counts = {};
for (const row of rows) counts[row.action] = (counts[row.action] || 0) + 1;
const countLines = Object.entries(counts)
  .sort(([, a], [, b]) => b - a)
  .map(([name, count]) => `| ${text(name)} | ${count} | ${(count / Math.max(1, rows.length) * 100).toFixed(1)}% |`);

const finalRow = rows[rows.length - 1] || null;
const keyRows = rows.filter(row => row.events || row.day === firstSeen?.day || row.day === DAYS || row.action !== '空闲')
  .filter((row, index, arr) => index === 0 || row.events || row.action !== arr[index - 1]?.action || row.day === DAYS)
  .slice(0, 80);

function table(rowsToWrite) {
  const header = '| 天 | 姓名 | 行为 | Need | 优先级 | 境界/职位 | 年龄 | 真气 | 修为本体 | 历练 | 有效历练 | 总进度 | 进度% | 本体缺口 | 总缺口 | 真气缺口 | 灵石 | 贡献 | 当前任务 | 完成 | 剩余天 | Job | Toil | Job状态 | 结果 | 事件 |';
  const sep = '|---:|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---|---|---|---|---|';
  const body = rowsToWrite.map(row => [
    row.day,
    text(row.name),
    text(row.action),
    text(row.need),
    row.priority,
    text(`${row.rank}/${row.role}`),
    row.age,
    row.qi,
    row.cultivation,
    row.expCultivation,
    row.effectiveExp,
    row.totalCultivation,
    row.completion,
    row.rootShortfall,
    row.totalShortfall,
    row.qiShortfall,
    row.stone,
    row.contribution,
    text(row.activeQuest),
    row.questComplete,
    row.questDays,
    text(row.job),
    text(row.toil),
    text(row.jobStatus),
    text(row.result),
    text(row.events),
  ].join(' | ')).map(line => `| ${line} |`);
  return [header, sep, ...body].join('\n');
}

const md = [
  `# ${finalRow?.name || TARGET_ID} ${DAYS} 天逐日日志`,
  '',
  `- 整局模拟种子：${engine.seed}`,
  `- 目标 NPC：${TARGET_ID}`,
  `- 首次出现：${firstSeen ? `第 ${firstSeen.day} 天，姓名 ${firstSeen.name}` : '1000 天内未出现'}`,
  `- 记录天数：${rows.length}`,
  `- 结局：${finalEntity?.alive === false ? '已身故' : '仍在世或未出现死亡记录'}`,
  finalRow ? `- 末态：${finalRow.rank}/${finalRow.role}，真气 ${finalRow.qi}，总进度 ${finalRow.totalCultivation}（${finalRow.completion}）` : '',
  '',
  '## 行为统计',
  '',
  '| 行为 | 天数 | 占比 |',
  '|---|---:|---:|',
  ...countLines,
  '',
  '## 出生记录',
  '',
  birthEvents.length
    ? birthEvents.map(evt => `- 第 ${evt.day} 天：${evt.childName} 出生，父 ${evt.fatherName}，母 ${evt.motherName}，势力 ${evt.factionId || ''}`).join('\n')
    : '- 未捕获出生事件；目标可能在当日 tick 后出现或 1000 天内未出现。',
  '',
  '## 关键变化与事件',
  '',
  keyRows.length ? table(keyRows) : '无。',
  '',
  '## 逐日日志',
  '',
  rows.length ? table(rows) : '1000 天内没有找到目标 NPC。',
  '',
].join('\n');

const outPath = resolve(__dirname, OUT_FILE);
writeFileSync(outPath, md, 'utf-8');

console.log(`模拟完成: ${DAYS} 天`);
console.log(`首次出现: ${firstSeen ? `第${firstSeen.day}天 ${firstSeen.name}` : '未出现'}`);
console.log(`记录天数: ${rows.length}`);
if (finalRow) {
  console.log(`末态: ${finalRow.name} ${finalRow.rank}/${finalRow.role} 真气=${finalRow.qi} 总进度=${finalRow.totalCultivation}(${finalRow.completion})`);
}
console.log(`日志已写入: ${outPath}`);
