#!/usr/bin/env node
/**
 * BT 骨架单元测试（GOBT，ADR-018）：
 * 1. 复合/装饰器节点语义正确性。
 * 2. PlannerNode 门控时序与旧 NPC _planBehavior 等价（gate→plan→执行；busy/hasPlan 短路）。
 *
 * 用法：node tools/test-bt.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { BTStatus } = await imp('js/engine/abstract/bt/bt-node.js');
const { SelectorNode, SequenceNode } = await imp('js/engine/abstract/bt/composites.js');
const { CooldownNode, InverterNode } = await imp('js/engine/abstract/bt/decorators.js');
const { ConditionNode, AlwaysNode } = await imp('js/engine/abstract/bt/leaves.js');
const { PlannerNode } = await imp('js/engine/abstract/bt/planner-node.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
}

// ── 1. Selector：第一个非 FAILURE 即返回 ──
{
  const sel = new SelectorNode();
  sel.addChild(new AlwaysNode({ status: 'failure' }));
  sel.addChild(new AlwaysNode({ status: 'success' }));
  sel.addChild(new AlwaysNode({ status: 'failure' }));
  assert(sel.tick({}, {}, {}) === BTStatus.SUCCESS, 'Selector 命中第二个 success');

  const selAllFail = new SelectorNode();
  selAllFail.addChild(new AlwaysNode({ status: 'failure' }));
  selAllFail.addChild(new AlwaysNode({ status: 'failure' }));
  assert(selAllFail.tick({}, {}, {}) === BTStatus.FAILURE, 'Selector 全 failure 返回 failure');
}

// ── 2. Sequence：第一个非 SUCCESS 即返回 ──
{
  const seq = new SequenceNode();
  seq.addChild(new AlwaysNode({ status: 'success' }));
  seq.addChild(new AlwaysNode({ status: 'failure' }));
  seq.addChild(new AlwaysNode({ status: 'success' }));
  assert(seq.tick({}, {}, {}) === BTStatus.FAILURE, 'Sequence 中途 failure 返回 failure');

  const seqAllOk = new SequenceNode();
  seqAllOk.addChild(new AlwaysNode({ status: 'success' }));
  seqAllOk.addChild(new AlwaysNode({ status: 'success' }));
  assert(seqAllOk.tick({}, {}, {}) === BTStatus.SUCCESS, 'Sequence 全 success 返回 success');
}

// ── 3. Inverter ──
{
  const inv = new InverterNode();
  inv.addChild(new AlwaysNode({ status: 'success' }));
  assert(inv.tick({}, {}, {}) === BTStatus.FAILURE, 'Inverter 翻转 success→failure');
}

// ── 4. Condition ──
{
  const entity = { state: { get: (k) => ({ hp: 30 }[k]) } };
  const c1 = new ConditionNode({ condition: { key: 'hp', op: 'lt', value: 50 } });
  assert(c1.tick(entity, {}, {}) === BTStatus.SUCCESS, 'Condition hp<50 成立');
  const c2 = new ConditionNode({ condition: { key: 'hp', op: 'gt', value: 50 } });
  assert(c2.tick(entity, {}, {}) === BTStatus.FAILURE, 'Condition hp>50 不成立');
}

// ── 5. Cooldown：冷却期内返回 cooldownStatus，到期才 tick 子节点 ──
{
  let childTicks = 0;
  const child = new AlwaysNode({ status: 'success' });
  const origTick = child.tick.bind(child);
  child.tick = (...a) => { childTicks++; return origTick(...a); };
  // minTicks=maxTicks=2：起始 remaining=2，前两次返回 failure 且不 tick 子节点，第三次才 tick
  const cd = new CooldownNode({ minTicks: 2, maxTicks: 2, child: null });
  cd.addChild(child);
  assert(cd.tick({}, {}, {}) === BTStatus.FAILURE && childTicks === 0, 'Cooldown 第1天静候');
  assert(cd.tick({}, {}, {}) === BTStatus.FAILURE && childTicks === 0, 'Cooldown 第2天静候');
  assert(cd.tick({}, {}, {}) === BTStatus.SUCCESS && childTicks === 1, 'Cooldown 第3天放行并 tick 子节点');
}

// ── 6. PlannerNode 门控时序：等价旧 _planBehavior ──
{
  // mock behaviorSystem：记录 plan/executeStep 调用，模拟 hasPlan/isBusy
  function makeBS() {
    return {
      _plan: [], _busy: false, _planCalls: 0, _execCalls: 0,
      hasPlan() { return this._plan.length > 0; },
      isBusy() { return this._busy; },
      plan() { this._planCalls++; this._plan = ['act_x']; },
      executeStep() { this._execCalls++; return { status: 'in_progress' }; },
      getLastPlanResult() { return { actions: this._plan }; },
      clearPlan() { this._plan = []; },
    };
  }

  // 场景 A：决策门控未到期 → 不规划、不执行（静候），等价旧 cooldown 分支
  {
    const bs = makeBS();
    const entity = {
      behaviorSystem: bs, state: { toGOAPState: () => ({}) }, _tickLog: {},
      canStartNewDecision: () => false,
    };
    const p = new PlannerNode();
    const st = p.tick(entity, {}, {});
    assert(st === BTStatus.RUNNING && bs._planCalls === 0 && bs._execCalls === 0,
      'Planner 门控未到期：静候(RUNNING)，不规划不执行');
  }

  // 场景 B：门控到期且无计划 → 规划并执行一步
  {
    const bs = makeBS();
    let planChosen = 0;
    const entity = {
      behaviorSystem: bs, state: { toGOAPState: () => ({}) }, _tickLog: {},
      canStartNewDecision: () => true,
      onPlanChosen: () => planChosen++,
    };
    const p = new PlannerNode();
    const st = p.tick(entity, {}, {});
    assert(bs._planCalls === 1 && bs._execCalls === 1 && planChosen === 1 && st === BTStatus.RUNNING,
      'Planner 门控到期：规划1次+执行1次+onPlanChosen 1次');
  }

  // 场景 C：已有计划（busy/hasPlan）→ 不重新规划，仅执行，不触发门控
  {
    const bs = makeBS();
    bs._plan = ['act_y'];
    let gateCalls = 0;
    const entity = {
      behaviorSystem: bs, state: { toGOAPState: () => ({}) }, _tickLog: {},
      canStartNewDecision: () => { gateCalls++; return true; },
    };
    const p = new PlannerNode();
    p.tick(entity, {}, {});
    assert(bs._planCalls === 0 && bs._execCalls === 1 && gateCalls === 0,
      'Planner 已有计划：不规划、不问门控，仅执行');
  }
}

if (failed === 0) {
  console.log('BT 单元测试全部通过');
  process.exit(0);
} else {
  console.error(`BT 单元测试失败：${failed} 项`);
  process.exit(1);
}
