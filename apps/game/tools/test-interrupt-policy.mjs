#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Goal, GoalSource } = await imp('js/engine/abstract/goal.js');
const { InterruptPolicy, InterruptDecision } = await imp('js/engine/npc/interrupt-policy.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

function makeGoal(kind, score, extra = {}) {
  const g = new Goal({
    id: `goal_${kind}`,
    source: GoalSource.DYNAMIC,
    sourceId: kind,
    goalState: {},
    priority: score,
    urgency: score,
    tag: kind
  });
  g.dynamic = {
    kind,
    eventId: `evt_${kind}`,
    eventValue: extra.eventValue ?? 800,
    daysUntilStart: extra.daysUntilStart ?? 5,
    interrupt: extra.interrupt || {},
    riskKey: extra.riskKey || null
  };
  return g;
}

const busyNearBreakthrough = {
  behaviorSystem: {
    isBusy: () => true,
    getLastPlanResult: () => ({ needId: 'need_npc_cultivation', actions: ['act_npc_cultivate'] })
  },
  state: { get: (key) => ({ totalProgress: 0.96, injuryLevel: 0 }[key] ?? null) },
  staticData: { personality: { caution: 70, courage: 40, loyalty: 50 } }
};

const immediate = InterruptPolicy.decide(busyNearBreakthrough, makeGoal('immediate', 90), { currentDay: 1 });
assert(immediate.decision === InterruptDecision.INTERRUPT_NOW, 'immediate 高分目标立即打断');

const prep = InterruptPolicy.decide(
  busyNearBreakthrough,
  makeGoal('preparation', 68, { daysUntilStart: 90, interrupt: { minDecision: 'after_step' } }),
  { currentDay: 1 }
);
assert(prep.decision === InterruptDecision.AFTER_STEP, '临近突破时准备目标降为 after_step');

const low = InterruptPolicy.decide(
  busyNearBreakthrough,
  makeGoal('window', 35, { eventValue: 200, daysUntilStart: 20 }),
  { currentDay: 1 }
);
assert(low.decision === InterruptDecision.IGNORE, '低分低价值目标忽略');

if (failed === 0) {
  console.log('打断策略单测全部通过');
  process.exit(0);
}
console.error(`打断策略单测失败：${failed} 项`);
process.exit(1);
