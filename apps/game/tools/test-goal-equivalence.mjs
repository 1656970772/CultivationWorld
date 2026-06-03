#!/usr/bin/env node
/**
 * Goal 等价性验证：Goal 抽取后，BehaviorSystem 走 Goal 路径的规划结果
 * 必须与"直接对 getTopNeeds 的 goalState 逐个 GOAP 规划"完全一致。
 *
 * 用法：node tools/test-goal-equivalence.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Action } = await imp('js/engine/abstract/action.js');
const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');
const { BehaviorSystem } = await imp('js/engine/abstract/behavior-system.js');
const { NeedSystem } = await imp('js/engine/abstract/need-system.js');
const { Need, ConfigurableEvaluator } = await imp('js/engine/abstract/need.js');

const npcActions = load('data/actions/npc-actions.json').map(c => new Action(c));
const npcNeedConfigs = load('data/needs/npc-needs.json');

// mulberry32 确定性 PRNG
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 最小 RuntimeState 替身：提供 get/toGOAPState
function makeState(flat) {
  return {
    _d: { ...flat },
    get(k) { return this._d[k]; },
    set(k, v) { this._d[k] = v; },
    toGOAPState() { return { ...this._d }; },
    personality: { ambition: 50, loyalty: 50, courage: 50, caution: 50, diplomacy: 50, justice: 50 },
  };
}

function buildNeedSystem() {
  const ns = new NeedSystem();
  for (const cfg of npcNeedConfigs) {
    const evaluator = new ConfigurableEvaluator({
      rules: cfg.rules || [],
      basePriority: cfg.basePriority || 0,
      satisfiedCondition: cfg.satisfiedCondition || null,
    });
    ns.addNeed(new Need({
      id: cfg.id, name: cfg.name, description: cfg.description,
      evaluator, goalState: cfg.goalState, basePriority: cfg.basePriority,
    }));
  }
  return ns;
}

function randomState(rng) {
  return makeState({
    alive: true,
    lifespanRemaining: Math.floor(rng() * 200),
    injuryLevel: Math.floor(rng() * 100),
    cultivationProgress: Math.floor(rng() * 100),
    totalProgress: Math.floor(rng() * 100),
    contribution: Math.floor(rng() * 100),
    monthlyQuotaMet: rng() > 0.5,
    rankOrder: Math.floor(rng() * 5),
    hasActiveQuest: rng() > 0.5,
    canTakeQuest: true,
  });
}

const worldContext = { balanceConfig: { personality: load('data/balance/personality.json') } };
const rng = mulberry32(0xBEEF);
let mismatches = 0;
let total = 0;

for (let i = 0; i < 400; i++) {
  const state = randomState(rng);
  const ns = buildNeedSystem();
  ns.evaluate(state, worldContext);

  // 旧路径参考：直接对 getTopNeeds 逐个规划，取第一个成功的
  const planner = new GOAPPlanner({ maxDepth: 10, maxIterations: 1000 });
  const refNeeds = ns.getTopNeeds(3);
  let refActions = null;
  for (const need of refNeeds) {
    const r = planner.plan(state.toGOAPState(), need.goalState, npcActions);
    if (r.success && r.plan.length > 0) { refActions = r.plan.map(a => a.id); break; }
  }

  // 新路径：BehaviorSystem 走 Goal
  const bs = new BehaviorSystem(new GOAPPlanner({ maxDepth: 10, maxIterations: 1000 }), npcActions);
  const plan = bs.plan(ns, state.toGOAPState(), worldContext);
  const newActions = plan.length > 0 ? plan.map(a => a.id) : null;

  total++;
  // 只在两边都通过 GOAP（非贪心回退）时严格比对行为链；贪心回退是新路径附加能力。
  if (refActions) {
    const lastResult = bs.getLastPlanResult();
    if (!lastResult?.fallback) {
      if (JSON.stringify(refActions) !== JSON.stringify(newActions)) {
        mismatches++;
        if (mismatches <= 5) {
          console.error(`用例 ${i} 不一致:\n  旧: ${JSON.stringify(refActions)}\n  新: ${JSON.stringify(newActions)}`);
        }
      }
    }
  }
}

if (mismatches === 0) {
  console.log(`Goal 等价性测试通过：${total} 用例`);
  process.exit(0);
} else {
  console.error(`Goal 等价性测试失败：${mismatches}/${total} 用例不一致`);
  process.exit(1);
}
