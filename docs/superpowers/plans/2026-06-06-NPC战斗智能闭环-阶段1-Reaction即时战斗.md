# NPC 战斗智能闭环阶段 1：Reaction 即时战斗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 最后更新：2026-06-06

**Goal:** 把 NPC 被攻击后的即时战斗决策补进已有 Reaction 层，使逃命、撤退、回血、反击都由行为树 `ReactiveNode` 抢占处理。

**Architecture:** `applyDamage()` 继续只负责压入 `ATTACKED` 刺激；`ReactiveNode` 读取刺激、血量、伤势、敌我战力和 `reaction.json` 阈值，选择 `act_npc_react_flee`、`act_npc_react_retreat`、`act_npc_react_heal` 或 `act_npc_react_counter`。即时战斗不启动 GOAP JobAction。

**Tech Stack:** Behavior Tree、Reaction Actions、`reaction.json`、Node 工具测试。

---

## Files

- Modify: `apps/game/js/engine/abstract/bt/reactions.js`
- Modify: `apps/game/js/engine/npc/actions/reaction-actions.js`
- Modify: `apps/game/data/balance/reaction.json`
- Modify: `apps/game/data/actions/reaction-actions.json`
- Create: `apps/game/tools/test-reaction-combat-intelligence.mjs`
- Test: `apps/game/tools/test-job-interrupt-resume.mjs`

## Task 1: Reaction 即时战斗测试

- [ ] **Step 1: 写失败测试**

Create `apps/game/tools/test-reaction-combat-intelligence.mjs`:

```js
#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { ReactiveNode } = await import(pathToFileURL(resolve('apps/game/js/engine/abstract/bt/reactions.js')).href);
const { StimulusType, StimulusQueue } = await import(pathToFileURL(resolve('apps/game/js/engine/abstract/stimulus.js')).href);

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

function state(values = {}) {
  const data = new Map(Object.entries(values));
  return { get: k => data.get(k), set: (k, v) => data.set(k, v), data };
}

function makeEntity(values) {
  const calls = [];
  return {
    id: 'npc_react',
    state: state(values),
    stimulusQueue: new StimulusQueue({ ttl: 2, capacity: 4 }),
    behaviorSystem: {
      suspendPlanForReaction: () => true,
      setSingleActionPlan: (actionId, reason) => { calls.push({ actionId, reason }); return true; },
      restoreSuspendedPlan: () => {},
    },
    _calls: calls,
  };
}

function runReaction(entity, worldContext) {
  entity.stimulusQueue.push(StimulusType.ATTACKED, {
    sourceId: 'monster_1',
    payload: { killerId: 'monster_1', damage: 60, enemyPower: 200, cause: 'monster' },
  });
  const node = new ReactiveNode({ name: 'react-attacked' });
  node.tick(entity, worldContext, {});
  return entity._calls[0]?.actionId;
}

const cfg = {
  enabled: true,
  combat: {
    criticalHpRatio: 0.25,
    lowHpRatio: 0.45,
    counterAdvantageRatio: 1.3,
    retreatDisadvantageRatio: 1.2,
    heavyDamageHpRatio: 0.4,
  },
  actions: {
    flee: 'act_npc_react_flee',
    retreat: 'act_npc_react_retreat',
    heal: 'act_npc_react_heal',
    counter: 'act_npc_react_counter',
  },
};

assert(runReaction(makeEntity({ hp: 20, maxHp: 120, injuryLevel: 3 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 40 }) === 'act_npc_react_flee', 'critical attacked NPC chooses flee in Reaction layer');
assert(runReaction(makeEntity({ hp: 40, maxHp: 120, injuryLevel: 1 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 60 }) === 'act_npc_react_heal', 'low hp attacked NPC chooses heal in Reaction layer');
assert(runReaction(makeEntity({ hp: 100, maxHp: 120, injuryLevel: 0 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 400 }) === 'act_npc_react_counter', 'advantaged attacked NPC chooses counter in Reaction layer');
assert(runReaction(makeEntity({ hp: 100, maxHp: 120, injuryLevel: 0 }), { balanceConfig: { reaction: cfg }, npcCombatPower: () => 80 }) === 'act_npc_react_retreat', 'disadvantaged attacked NPC chooses retreat in Reaction layer');

if (failed > 0) process.exit(1);
console.log('\nReaction combat intelligence tests passed');
```

- [ ] **Step 2: 运行并确认失败**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\CultivationWorld\apps\game'; node tools/test-reaction-combat-intelligence.mjs
```

Expected: FAIL，至少低血量、优势反击或敌强撤退分支未按新阈值选择。

## Task 2: 扩展 Reaction 决策

- [ ] **Step 1: 配置战斗阈值**

在 `apps/game/data/balance/reaction.json` 增加或合并：

```json
"combat": {
  "criticalHpRatio": 0.25,
  "lowHpRatio": 0.45,
  "counterAdvantageRatio": 1.3,
  "retreatDisadvantageRatio": 1.2,
  "heavyDamageHpRatio": 0.4
}
```

- [ ] **Step 2: 在 `ReactiveNode` 中新增 attacked 决策函数**

在 `apps/game/js/engine/abstract/bt/reactions.js` 中实现：

```js
function decideAttackedReaction(entity, stim, worldContext, cfg) {
  const state = entity.state;
  const hp = Number(state?.get?.('hp') ?? state?.get?.('maxHp') ?? 0);
  const maxHp = Math.max(1, Number(state?.get?.('maxHp') ?? hp ?? 1));
  const hpRatio = hp / maxHp;
  const injury = Number(state?.get?.('injuryLevel') || 0);
  const combat = cfg.combat || {};
  const actions = cfg.actions || {};
  const myPower = Math.max(1, Number(worldContext?.npcCombatPower?.(entity) ?? 1));
  const enemyPower = Math.max(1, Number(stim?.payload?.enemyPower ?? stim?.payload?.attackerPower ?? 1));
  const damage = Number(stim?.payload?.damage || 0);

  if (hpRatio <= (combat.criticalHpRatio ?? 0.25) || injury >= 4) {
    if (actions.flee) return { kind: 'flee', actionId: actions.flee };
  }
  if (hpRatio <= (combat.lowHpRatio ?? 0.45)) {
    if (actions.heal) return { kind: 'heal', actionId: actions.heal };
  }
  if (myPower / enemyPower >= (combat.counterAdvantageRatio ?? 1.3)) {
    if (actions.counter) return { kind: 'counter', actionId: actions.counter };
  }
  if (enemyPower / myPower >= (combat.retreatDisadvantageRatio ?? 1.2) || damage >= maxHp * (combat.heavyDamageHpRatio ?? 0.4)) {
    if (actions.retreat) return { kind: 'retreat', actionId: actions.retreat };
  }
  if (actions.retreat) return { kind: 'retreat', actionId: actions.retreat };
  return null;
}
```

`ReactiveNode` 消费 `ATTACKED` 后调用该函数，并继续使用现有 `suspendPlanForReaction()` 与 `setSingleActionPlan()`。

- [ ] **Step 3: Reaction 执行器写回状态**

在 `apps/game/js/engine/npc/actions/reaction-actions.js` 中：

- 逃命/撤退成功：写 `lastCombatReaction`、清 `shouldRetreat`、写 `combatReady=false`、`needsCombatSupply=true`、`needsCombatRecovery=true`。
- 回血成功：写 `lastCombatReaction='heal'`；血量恢复到 `lowHpRatio` 以上时清 `shouldRetreat`；回血丹耗尽时写 `needsCombatSupply=true`。
- 反击成功或失败：写 `lastCombatReaction='counter'`，并向 `infoEvents` 写 `react_counter` 样本。

- [ ] **Step 4: 运行阶段测试**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\CultivationWorld\apps\game'; node tools/test-reaction-combat-intelligence.mjs; node tools/test-job-interrupt-resume.mjs
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\CultivationWorld'; git add apps/game/js/engine/abstract/bt/reactions.js apps/game/js/engine/npc/actions/reaction-actions.js apps/game/data/balance/reaction.json apps/game/data/actions/reaction-actions.json apps/game/tools/test-reaction-combat-intelligence.mjs; git commit -m "feat: add combat decisions to reaction layer"
```

## 阶段验收

- `ATTACKED` 刺激命中后行为树选择 Reaction Action，而不是 GOAP JobAction。
- 濒死、低血、敌弱、敌强四种样本均可解释。
- 原有 Job 中断/恢复测试仍通过。
