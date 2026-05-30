# ADR-018: GOBT 三层 AI 架构（BT + Planner Node + Goal 抽取）

> 日期：2026-05-30
> 状态：已采纳

## 背景

ADR-005 确立了「需求驱动 + GOAP」架构，ADR-014 做了 GOAP 性能护栏，ADR-017 加入价值-风险决策。
但「何时反应 / 何时重规划 / 何时打断」的编排逻辑硬编码在 `BaseEntity.tick()` 的四段式
（onPreTick → 评估需求 → 规划 → 执行）与 `NPCEntity._planBehavior` 的决策冷却里，难以扩展为
「即时反应抢占」「分支决策」「情绪/执念驱动」等更复杂的行为编排。

用户参考论文 [GOBT: A Synergistic Approach to Game AI Using Goal-Oriented and Utility-Based
Planning in Behavior Trees](https://www.jmis.org/archive/view_article_pubreader?pid=jmis-10-4-321)
提出将架构重构为 BT + GOAP + Utility 三层混合：

```
BT 负责即时反应/分支/打断
  ↓
Utility 负责选目标（Goal）
  ↓
GOAP 负责规划实现目标的方法
```

## 决策

### 1. Goal 抽取（解耦地基）

新增 `abstract/goal.js`：把原先隐含在 `Need.goalState` 里的「目标」抽成独立的 `Goal` 对象：

```
Goal { id, name, source(need|obsession|reaction), sourceId, goalState, priority, urgency, tag, modulators[] }
```

- `NeedSystem.getTopGoals()` 把需求转为 Goal（priority/urgency/goalState 直接沿用 Need 评估结果）。
- `Goal.score()` 在无调制项时严格等于 priority，保证与重构前 Need 排序口径一致（**行为零漂移**）。
- `modulators[]` 预留给情绪/执念调制层（ADR-019），叠加后由 `score()` 汇总。

### 2. BT 骨架（数据驱动）

新增 `abstract/bt/` 目录，节点 tick 一律返回 `BTStatus` 枚举（SUCCESS/FAILURE/RUNNING，遵循枚举规则）：

- `bt-node.js`：基类 + 状态枚举。
- `composites.js`：Selector / Sequence / Parallel。
- `decorators.js`：Inverter / Succeeder / Cooldown。
- `leaves.js`：Condition / Hook / Always。
- `reactions.js`：EmotionReactionNode（情绪驱动的即时反应抢占）。
- `bt-runner.js`：tick 驱动器 + 黑板（blackboard）。
- `bt-loader.js`：节点类型注册表（开闭原则），从 JSON 构树。

BT 树用 JSON 数据驱动：`apps/game/data/behavior-trees/npc-default.json`、`faction-default.json`。
代码侧 `bt/index.js` 提供内置默认树常量（与 JSON 同构）与已注册 PlannerNode 的 `createBTLoader()`。

### 3. Planner Node（论文核心）

新增 `abstract/bt/planner-node.js`，作为 BT 叶子封装论文的 planner node：

1. **选目标（Utility）**：合并需求 Goal + 额外 Goal（执念等），按 `score` 降序、`urgency` 次级排序。
2. **规划（GOAP）**：对选中目标用 A* 生成行为链。
3. **执行**：按行为生命周期推进一步（traveling→executing→结算），失败则 replan。
4. **执行期实时重选（可选）**：`realtimeReselect=true` 时，每步用 utility(costFn) 重新挑选当前步动作
   （论文 rocket/gun 例子）。默认关闭以保证行为零漂移。

PlannerNode 不持有规划状态，全部委托 `entity.behaviorSystem`，可被多次构建而不重复状态。

### 4. tick 重连与等价迁移

- `BaseEntity.tick()`：安装了 `btRunner` 的实体由 BT 驱动；未安装的（妖兽/世界）回退旧四段式。
- NPC 决策冷却等价迁移为 `entity.canStartNewDecision()` 门控（PlannerNode 在「空闲且无计划」时询问），
  时序与旧 `_planBehavior` 完全一致。
- NPC 的价值-风险 costFn 通过 `entity.buildDecisionCostFn()` 暴露；headstrong 标记通过 `onPlanChosen()`。
- 势力（Faction）仍走 tick-manager 的分阶段调用（plan→冲突解决→execute），透明复用新的 Goal 管线。

### 5. 即时反应分支

NPC BT 高优先 Selector 前置反应分支（`EmotionReactionNode`），命中即抢占 planner。
默认阈值 101（不可达）以保证未调参时不破坏既有世界平衡，调参入口在 BT 配置与 emotion.json。

## 后果

### 正面

- 行为编排从硬编码变为 BT 数据驱动，新增反应/分支无需改核心代码（开闭原则）。
- 目标来源统一为 Goal，执念/情绪等长期心智（ADR-019）可无缝接入同一选择管线。
- 论文 planner node 的「执行期实时重选」语义就位，为战斗等场景预留能力。

### 代价 / 风险

- 多了一层 BT 抽象，调试需理解节点 tick 流。已用单元测试（`tools/test-bt.mjs`）锁定节点语义与门控时序。

## 回归保证

- `tools/test-goal-equivalence.mjs`：400 用例验证 Goal 路径与旧需求路径 GOAP 主行为链零漂移。
- `tools/test-goap-golden.mjs`：GOAP 规划器指纹保持 `989688d2` 不变。
- `tools/test-bt.mjs`：BT 节点语义 + PlannerNode 门控时序等价旧 `_planBehavior`。
- 端到端：simulation.html / simulate-analysis.mjs 可正常跑 300 天。

## 相关

- 论文 GOBT（第七类混合架构）。
- ADR-005（需求驱动 GOAP）、ADR-014（GOAP 性能）、ADR-017（价值-风险决策）。
- ADR-019（长期心智系统：记忆/执念/情绪/恩怨）。
- `docs/systems/behavior-tree.md`（实现细节与节点参考）。
