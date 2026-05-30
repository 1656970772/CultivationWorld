#!/usr/bin/env node
/**
 * GOAP 黄金测试：用真实行为数据 + 一批确定性场景，对 planner.plan 的输出做指纹。
 * 优化前先记录基线指纹，优化后重跑必须一致，确保规划逻辑零行为漂移。
 *
 * 用法：node tools/test-goap-golden.mjs            （打印指纹）
 *      node tools/test-goap-golden.mjs <baseline>  （与基线比对，不一致则退出码 1）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { Action } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/action.js')).href);
const { GOAPPlanner } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/goap-planner.js')).href);

const npcActions = load('data/actions/npc-actions.json').map(c => new Action(c));
const factionActions = load('data/actions/faction-actions.json').map(c => new Action(c));

// 简易确定性 PRNG（mulberry32）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 收集行为里出现过的所有状态键（precondition + effect），构造随机但合理的 state
function collectKeys(actions) {
  const keys = new Set();
  for (const a of actions) {
    for (const k of Object.keys(a.preconditions)) keys.add(k);
    for (const k of Object.keys(a.effects)) keys.add(k);
  }
  return [...keys];
}

function randomState(keys, rng) {
  const s = { alive: true };
  for (const k of keys) {
    const r = rng();
    if (k === 'alive' || k === 'hasFaction') s[k] = r > 0.3;
    else s[k] = Math.floor(r * 100);
  }
  return s;
}

// 一组覆盖性的目标（贴近真实需求）
const npcGoals = [
  { cultivationProgress: { op: 'gte', value: 50 } },
  { injuryLevel: { op: 'lte', value: 0 } },
  { contribution: { op: 'gte', value: 30 } },
  { alive: { op: 'true' } },
];
const factionGoals = [
  { 'resources.spiritStone': { op: 'gte', value: 500 } },
  { memberCount: { op: 'gte', value: 20 } },
  { territory: { op: 'gte', value: 10 } },
];

function fingerprintFor(actions, goals, tag) {
  const keys = collectKeys(actions);
  const rng = mulberry32(0xC0FFEE ^ tag.length);
  const planner = new GOAPPlanner({ maxDepth: 10, maxIterations: 1000 });
  const lines = [];
  for (let i = 0; i < 300; i++) {
    const state = randomState(keys, rng);
    const goal = goals[i % goals.length];
    const r = planner.plan(state, goal, actions);
    lines.push(`${r.success ? 1 : 0}|${r.cost}|${r.plan.map(a => a.id).join(',')}`);
  }
  return lines.join('\n');
}

const fpNpc = fingerprintFor(npcActions, npcGoals, 'npc');
const fpFaction = fingerprintFor(factionActions, factionGoals, 'faction');
const combined = `NPC[${npcActions.length}]\n${fpNpc}\n---\nFACTION[${factionActions.length}]\n${fpFaction}`;

// 简单 hash
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const fp = hash(combined);
const baseline = process.argv[2];
if (baseline) {
  if (fp === baseline) {
    console.log(`GOAP 黄金测试通过：指纹一致 ${fp}`);
    process.exit(0);
  } else {
    console.error(`GOAP 黄金测试失败：指纹不一致！基线 ${baseline} 现在 ${fp}`);
    process.exit(1);
  }
} else {
  console.log(`GOAP 输出指纹：${fp}`);
  console.log(`（用例 NPC 300 + FACTION 300，覆盖修炼/疗伤/贡献/资源/成员/领地等目标）`);
}
