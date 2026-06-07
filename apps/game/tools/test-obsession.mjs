#!/usr/bin/env node
/**
 * 执念系统单元测试（GOBT 长期心智，ADR-019）：
 * 1. ObsessionSystem 同类型去重保留更强者、toGoals 产出 Goal。
 * 2. 后天执念由记忆触发，并随高强度记忆锁定仇人。
 * 3. 执念 Goal 与需求 Goal 在 BehaviorSystem._collectGoals 中的优先级关系（同分需求优先）。
 *
 * 用法：node tools/test-obsession.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { ObsessionSystem, Obsession, ObsessionType } = await imp('js/engine/abstract/obsession-system.js');
const { GoalSource } = await imp('js/engine/abstract/goal.js');

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } };

// 同类型去重，保留更强者
{
  const os = new ObsessionSystem();
  os.add(new Obsession({ type: ObsessionType.REVENGE, intensity: 60 }));
  os.add(new Obsession({ type: ObsessionType.REVENGE, intensity: 90, targetId: 'enemy' }));
  assert(os.obsessions.length === 1, '同类型执念去重');
  assert(os.obsessions[0].intensity === 90 && os.obsessions[0].targetId === 'enemy', '保留更强执念并更新 target');
}

// toGoals 产出 GoalSource.OBSESSION、priority=intensity
{
  const os = new ObsessionSystem();
  os.add(new Obsession({ type: ObsessionType.SUPREMACY, intensity: 70, goalState: { rankStage: { op: 'eq', value: 'perfection' } } }));
  const goals = os.toGoals();
  assert(goals.length === 1 && goals[0].source === GoalSource.OBSESSION, 'toGoals 来源为 obsession');
  assert(goals[0].priority === 70 && goals[0].score() === 70, '执念 Goal 优先级=强度');
}

// goalMult（ADR-020）：执念对自身 Goal 注入 self 乘子；needGoalMult 给同方向需求乘子
{
  const cfg = { enabled: true, byType: { supremacy: { self: 1.5, needs: { need_npc_cultivation: 2.0 } } } };
  const os = new ObsessionSystem(cfg);
  os.add(new Obsession({ type: ObsessionType.SUPREMACY, intensity: 70, goalState: {} }));
  const g = os.toGoals()[0];
  assert(Math.abs(g.score() - 70 * 1.5) < 1e-6, '执念自身 Goal 施加 self 乘子(70×1.5=105)');
  assert(Math.abs(os.needGoalMult('need_npc_cultivation') - 2.0) < 1e-6, '同方向需求乘子=2.0');
  assert(os.needGoalMult('need_npc_heal') === 1, '非同方向需求乘子=1');

  // enabled=false 时不施加乘子
  const osOff = new ObsessionSystem({ enabled: false, byType: { supremacy: { self: 9 } } });
  osOff.add(new Obsession({ type: ObsessionType.SUPREMACY, intensity: 70, goalState: {} }));
  assert(osOff.toGoals()[0].score() === 70, 'goalMult.enabled=false 时不施加乘子');
  assert(osOff.needGoalMult('need_npc_cultivation') === 1, 'enabled=false 时 needGoalMult=1');
}

// _collectGoals：同分时需求优先于执念
{
  const { BehaviorSystem } = await imp('js/engine/abstract/behavior-system.js');
  const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');
  const { Goal, GoalSource } = await imp('js/engine/abstract/goal.js');

  const bs = new BehaviorSystem(new GOAPPlanner(), []);
  // mock needSystem：返回一个 priority=95 的需求 Goal
  const needGoal = new Goal({ id: 'g_need', source: GoalSource.NEED, sourceId: 'need_survival', priority: 95, goalState: {} });
  const fakeNeedSystem = { getTopGoals: () => [needGoal] };
  const obsGoal = new Goal({ id: 'g_obs', source: GoalSource.OBSESSION, sourceId: 'obsession_revenge', priority: 95, goalState: {} });

  const merged = bs._collectGoals(fakeNeedSystem, [obsGoal]);
  assert(merged[0].source === GoalSource.NEED, '同分(95)时需求优先于执念(生存底线)');

  // 执念更强时压过需求
  const strongObs = new Goal({ id: 'g_obs2', source: GoalSource.OBSESSION, sourceId: 'obsession_revenge', priority: 99, goalState: {} });
  const merged2 = bs._collectGoals(fakeNeedSystem, [strongObs]);
  assert(merged2[0].source === GoalSource.OBSESSION, '强执念(99)压过需求(95)');
}

if (failed === 0) { console.log('执念系统单元测试全部通过'); process.exit(0); }
else { console.error(`执念系统单元测试失败：${failed} 项`); process.exit(1); }
