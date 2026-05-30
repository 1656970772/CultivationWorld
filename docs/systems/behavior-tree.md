# 系统设计：行为树（GOBT 三层 AI）

> 最后更新：2026-05-30

## 概述

GOBT（Goal-Oriented Behavior Tree）将 AI 决策分为三层：**BT 即时反应 → Utility 选目标 → GOAP 规划**。
本文档说明节点类型、数据驱动配置与执行流程。架构决策见 ADR-018，长期心智（记忆/执念/情绪/恩怨）见 ADR-019，Consideration 乘法式 Utility 与复仇 PvP 行为链见 ADR-020，Utility-GOAP 职责分离见 **ADR-021**，期望收益模型见 **ADR-022**，流派目标体系（夺宝/养老/传承/夺权）见 **ADR-023**。

## NPC / 势力三层结构

```
BT 骨架（何时反应/分支/打断）
    │  高优先 Selector：情绪/恩怨驱动的即时反应抢占
    ▼
Planner Node
    ├─ 选目标 Utility：需求 Goal + 执念 Goal，
    │    按 score(含情绪调制 + 风险厌恶 + 上头扰动 + 路径偏好 + 考量因素) 排序
    ├─ 规划 GOAP：对选中目标 A* 生成行为链（纯路径代价，ADR-021）
    ├─ 执行：行为生命周期推进（traveling→executing→结算）+ replan
    └─ 执行期实时重选（可选）：每步按 utility 重选当前动作（论文 rocket/gun）
```

## 职责边界（ADR-021）

| 层 | 职责 | 回答的问题 |
|----|------|-----------|
| **Utility** | 目标价值评估 | 我现在最想干什么？ |
| **GOAP** | 路径规划 | 怎么实现选定的目标？ |
| **BT 执行** | 行为推进 | 当前步骤如何执行？ |

**GOAP 不再包含风险/价值/情绪/上头计算**，step cost = `action.getPlanCost()`（纯路径代价）。
所有"差异化"因素均由 Utility 层决定，这是修仙 NPC 产生稳健流/赌狗流/复仇流等差异性的根本所在。

## 妖兽分级行为树

妖兽按阶位分三档，只有元婴等价（grade 6+）的妖兽才使用与 NPC 相同的完整 GOBT 系统（当前用 tier3 过渡，完整 GOBT 作为后续扩展）。

| 档位 | grade | BT 文件 | 特性 |
|---|---|---|---|
| tier1 | 1-2（炼气/筑基） | `monster-tier1.json` | 纯本能：休整→重伤逃→追杀→游荡 |
| tier2 | 3-4（金丹） | `monster-tier2.json` | 领地本能：呼群协作、受伤撤退老巢、系统性巡逻 |
| tier3 | 5+（元婴+） | `monster-tier3.json` | 初级智慧：情绪驱动（恐惧/狂暴）、仇恨记忆、大范围领地 |

### 妖兽 BT 两个分支

```
每 tick
BT 根节点（sequence）
  ├── monsterPreTick     年龄/死亡/hpRatio/冷却刷新
  ├── monsterSense       感知猎物 → hasTarget / nearTarget
  ├── (tier3) monsterUpdateInstincts  情绪值更新
  └── selector(behavior)
        ├── [高优先] 休整中 → monsterRest
        ├── [即时反应] 血量/情绪驱动 → monsterFlee / monsterBerserkAttack
        ├── [仇恨]    grudgeTargetId → monsterHuntGrudge  (tier3)
        └── [深思]    有猎物 → 呼群 → 追杀；无猎物 → 领地巡逻
```

**深思熟虑分支何时运行：**  
每 tick 都会进入 BT；只有情绪/血量等即时条件不触发时，才落到深思熟虑（Planner/hunt/patrol）。
对 NPC 而言，PlannerNode 内部还有"决策冷却"门控：空闲且周期到期才重新跑 Utility+GOAP。

## Utility 选目标评分（ADR-020 / ADR-021）

Goal 的综合评分为乘法式效用：

```
score = (priority + Σ deltaPriority × modulator)
      × Π(modulator.mult)
      × Π(consideration ∈ [0,1])
```

完整乘子来源（按装配顺序）：

| 乘子/偏移 | 来源 | 说明 |
|----------|------|------|
| `obsessionNeedBoost` | 执念系统 | 执念→同方向需求 Goal 的加成（obsession.json goalMult） |
| `consideration` | utility.json | 响应曲线驱动的效用（瓶颈程度/时间价值/伤势/期望收益等） |
| `expectedValue`（ADR-022）| reward.json | 期望收益 `Σ(prob×value)` 经 consideration 曲线映射，作为目标吸引力（与 riskAversion 对称） |
| `riskAversion` | ai-config npc.utility | 风险厌恶折扣：`1 − riskWeight × goalRisk`（caution 性格影响 riskWeight） |
| `emotionRisk`（ADR-021）| ai-config npc.utility | 愤怒降低 riskWeight（更激进），恐惧提高 riskWeight（更保守） |
| `headstrong`（ADR-021）| ai-config npc.utility | 上头随机扰动：以 chance 概率让目标分数 ×mult 暴增 |
| `pathPreference`（ADR-021）| ai-config npc.utility | explore_first 时给探索类目标 +deltaPriority |
| `modulateGoal`（情绪调制）| emotion-system | 愤怒放大复仇执念目标，恐惧放大生存需求目标 |

## 期望收益（ADR-022）

风险（riskAversion）描述"追这个目标可能付出的损失"（惩罚项 ≤1），期望收益描述"大概能拿到多少好处"（吸引项 ∈[0,1]），二者对称：

```
ExpectedValue(goal) = Σ_i (outcome_i.prob × outcome_i.value)
```

- 收益分布数据驱动于 `data/balance/reward.json`（按 goal sourceId 配置 outcomes），如夺宝：仙器 1%/极品法宝 10%/材料 60%/空手 29%。
- 作为 `derived.expectedValue` 喂给 utility.json 的 expectedValue consideration 曲线。
- 赌狗流 = 高期望收益吸引 + 低风险厌恶（愤怒/低谨慎）；稳健流 = 同期望收益但高风险厌恶。

## 流派目标体系（ADR-023）

为让同境界 NPC 在相同局面下做出不同选择，新增四种流派执念，各有**专属 goalState** 与**终点行为**（不再都收敛到"变强"）：

| 流派 | 执念 | goalState | 终点行为 | 触发 | 依据 |
|------|------|-----------|---------|------|------|
| 夺宝 | plunder | treasureObtained | act_npc_raid_treasure | 先天(高 courage) | 凡人修仙传 ✅ |
| 养老 | retire | atPeace | act_npc_seclude | 条件(高龄+低野心) | 项目推演设定 ⚠ |
| 传承 | legacy | discipleRaised | act_npc_take_disciple | 条件(高龄+高职位) | 大道争锋/遮天 ✅ |
| 夺权 | power | isFactionLeader | act_npc_seize_power | 先天(高 ambition) | 凡人/大道争锋 ✅ |

执念触发新增第三类机制（除先天 roll、记忆触发外）：

- **条件触发**（`_checkConditionalObsession`，obsession.json `conditional` 段）：onPreTick 每日按 `requireState`（寿元/境界）+ `requireTrait` + `chance` 检查，用于养老/传承等"随年龄演化"的人生取向。

> 世界观诚实标注：养老流在 `docs/世界观参考/` 中无直接原著原型，为项目推演设定（参考太上长老闭关等间接元素），已在数据注释与 ADR-023 明示。

**零漂移**：`data/balance/utility.json enabled=false`（默认）时，所有 consideration 与新 ADR-021 乘子均不生效，`score` 退化为纯 priority，与重构前一致。

## 复仇 PvP 行为链（ADR-020）

复仇执念以「击杀仇人」为真目标（`goalState: { enemyKilled: true }`），GOAP 推导：

```
(实力不足→日常修炼变强) → act_npc_hunt_enemy(追踪) → act_npc_kill_enemy(击杀, PvP 战力比拼)
```

- `revenge_target` resolver 按执念 targetId / 个人恩怨 topGrudge 定位仇人。
- `npcCombatPower` 比拼胜负，胜则写仇人 `_deathInfo{cause:'slain', killerId}`，闭环喂给道侣/同门记忆 → 新复仇执念。
- 实力门槛 `totalProgress>=0.3` 使弱者先变强再复仇，受「同分需求优先 + 决策冷却」约束，避免人口崩溃。

## 节点类型

代码位于 `apps/game/js/engine/abstract/bt/`，所有节点 tick 返回 `BTStatus` 枚举（SUCCESS/FAILURE/RUNNING）。

| 类型 (JSON `type`) | 类 | 说明 |
| --- | --- | --- |
| `selector` | SelectorNode | 依次 tick，遇首个非 FAILURE 返回；用于优先级选择/反应抢占 |
| `sequence` | SequenceNode | 依次 tick，遇首个非 SUCCESS 返回；按序步骤 |
| `parallel` | ParallelNode | tick 全部子节点，policy=requireAll/requireOne |
| `inverter` | InverterNode | SUCCESS↔FAILURE 互换 |
| `succeeder` | SucceederNode | 非 RUNNING 一律 SUCCESS |
| `cooldown` | CooldownNode | 冷却期内返回 cooldownStatus，到期才 tick 子节点 |
| `condition` | ConditionNode | 读 entity/world 状态做布尔判断 |
| `hook` | HookNode | 调用实体方法（onPreTick / btEvaluateNeeds 等） |
| `always` | AlwaysNode | 恒定返回某状态（占位/兜底） |
| `emotion_reaction` | EmotionReactionNode | 情绪超阈值时抢占执行指定行为（NPC 专用） |
| `planner` | PlannerNode | 选目标 + GOAP 规划 + 执行（NPC/势力 GOBT 核心） |

## 数据驱动配置

BT 树以 JSON 定义于 `apps/game/data/behavior-trees/`：

- `npc-default.json`：NPC 默认树（onPreTick → 反应 Selector → 深思熟虑 Sequence[评估需求 + planner]）。
- `faction-default.json`：势力默认树（onPreTick → 评估需求 → planner）。
- `monster-tier1.json`：妖兽 tier1（grade 1-2，纯本能）。
- `monster-tier2.json`：妖兽 tier2（grade 3-4，领地本能）。
- `monster-tier3.json`：妖兽 tier3（grade 5+，初级智慧）。

妖兽分级战斗/感知参数见 `data/balance/monster-spawn.json behaviorByTier`。

`bt-loader.js` 用节点类型注册表从 JSON 构树（开闭原则：新增节点类型只需 `registerNodeType`）。
`bt/index.js` 提供与 JSON 同构的内置默认树常量与已注册 PlannerNode 的 `createBTLoader()`。
`monster/monster-bt-presets.js` 提供妖兽三档 BT 的代码侧常量（与 JSON 同构）。

> 注意：当前 NPC 运行时默认加载 `bt/index.js` 的内置 `NPC_DEFAULT_BT` 常量（与 JSON 同构），
> `entityConfig.npcBehaviorTree` 提供时覆盖。妖兽在构造器内按 grade 直接使用预设常量。

## 执行流程（NPC）

1. `BaseEntity.tick()` 检测到 `btRunner` → 由 `BTRunner.run()` 驱动整棵树。
2. `hook(onPreTick)`：年龄推进、记忆/情绪衰减、突破判定、派生状态刷新。
3. 反应 Selector：`emotion_reaction` 若命中（如心魔过高）→ 抢占执行并 RUNNING。
4. 否则深思熟虑：`hook(btEvaluateNeeds)` 评估需求 → `planner`：
   - 空闲且无计划时问 `canStartNewDecision()`（NPC 决策周期门控）；
   - 门控放行则收集 Goal（需求 + 执念），经情绪调制 + decorateGoalConsiderations（风险厌恶/情绪修正/上头/路径偏好/考量因素）后选最高分目标；
   - GOAP 以纯路径代价规划行为链；执行一步，preconditions 失效则 replan。
5. `onPostTick`：结算落库。

## 执行流程（妖兽）

1. `BaseEntity.tick()` 检测到 `btRunner` → 由 `BTRunner.run()` 驱动整棵树。
2. `monsterPreTick`：年龄/死亡判定、hpRatio 刷新、猎食冷却倒计时。死亡则返回 FAILURE 停树。
3. `monsterSense`：扫描感知范围内猎物，写入 hasTarget / nearTarget。
4. （tier3）`monsterUpdateInstincts`：更新 emotionFear / emotionRage。
5. selector 按优先级选行为：休整 > 情绪驱动逃跑/狂暴 > 仇恨追猎 > 受伤撤退 > 追杀 > 巡逻。

## 调试可视化

每 tick 的 `_tickLog` 携带：

- `btTrace.selectedGoal`：选中目标的来源/优先级/行为链。
- `btTrace.reactedPath`：命中的即时反应（情绪类型、值、抢占行为）。
- `mind`：NPC 心智摘要（执念列表、情绪值、记忆数、最深仇恨）。

决策时间线看板见 `docs/systems/debug-timeline.md`。

## 性能护栏

- PlannerNode 复用 ADR-014 的 GOAP 快路径与迭代上限。
- BT 树深度浅；记忆为定长环形队列；情绪为少量标量。
- 反应节点默认阈值不可达（101），避免未调参时产生额外抢占开销与平衡扰动。
- 妖兽 BT（tier1-3）不含 PlannerNode，每 tick 只跑浅层条件判断，适合大量妖兽并发。

## 相关测试

- `tools/test-bt.mjs`：节点语义 + PlannerNode 门控时序。
- `tools/test-goal-equivalence.mjs`：Goal 路径零漂移。
- `tools/test-utility.mjs`：Consideration 曲线 + 情绪风险修正 + 上头扰动 + 路径偏好。
- `tools/test-memory.mjs` / `tools/test-obsession.mjs`：长期心智子系统。
- `tools/test-goap-golden.mjs`：GOAP 规划指纹（纯路径代价，与 ADR-021 后一致）。
