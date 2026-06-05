# ADR-021：Utility-GOAP 职责分离

最后更新：2026-05-30

## 背景

在 ADR-018（GOBT 三层架构）和 ADR-017（价值-风险决策）建立之后，NPC AI 的决策链为：

```
Utility（选目标）
  → GOAP step cost = base + λRisk×risk − λValue×value + 上头 + 路径偏好
  → BT 执行
```

**存在的问题：**

GOAP 的 step cost 承担了双重职责：
1. 路径规划（HOW）：哪条行为序列路径最短/代价最低？
2. 目标决策（WHAT）：风险、价值、情绪、冲动（上头）对选哪条路的影响。

这导致所有 NPC 的行为越来越趋同——同一境界、同一状态的 NPC 会通过相同的 GOAP 规划路径作出相同的选择，而缺乏基于人格/情绪的差异化。

根本原因：**GOAP 本质上只回答 HOW，不应该回答 WHAT。**

## 决策

将所有"目标价值评估"因素从 GOAP step cost 迁移到 **Utility 选目标层**。

### 迁移内容

| 因素 | 原位置 | 新位置 |
|------|--------|--------|
| 期望风险损失（λRisk × risk） | GOAP costFn | Utility `riskAversion` 乘子 |
| 行为价值（λValue × value） | GOAP costFn | 保留在 Goal.priority / Need urgency |
| 上头随机扰动（headstrongChance） | GOAP 行为级 roll | Utility 目标级 roll |
| 路径偏好（explore_first 降 cost） | GOAP action cost 系数 | Utility 目标级 deltaPriority 加成 |
| 情绪修正风险厌恶 | 无（新增） | Utility emotionRisk 乘子 |

### 重构后的完整 Utility 公式

```
GoalScore
  = (priority + Σ deltaPriority × modulator)
  × Π(consideration ∈ [0,1])
  × obsessionNeedMult
  × riskAversion(caution × emotionFactor × goalRisk)
  × headstrongMult(若上头命中)
```

其中：
- `riskAversion = max(0.05, 1 − riskWeight × goalRisk)`
- `riskWeight = baseWeight × (caution/50) × (1 − anger/100 × angerFactor) × (1 + fear/100 × fearFactor)`
- `headstrongMult` 以 `headstrong.chance` 概率命中，命中则 `mult`（默认 1.8）

### GOAP 的新职责（收窄后）

```
stepCost = max(costFloor, action.getPlanCost())
         = max(0.1, weight + max(0, duration-1))
```

纯路径代价，不含任何风险/价值/情绪/性格信息。

## 架构对比

```
【重构前】
  BT 即时反应
    ↓
  Utility（Need+Obsession+Emotion+TimeValue+GoalRisk）
    ↓
  GOAP costFn = base + λRisk×risk − λValue×value + 上头 + 路径偏好
    ↓
  BT 执行

【重构后】
  BT 即时反应
    ↓
  Utility（Need+Obsession+Emotion+TimeValue+GoalRisk
          +情绪风险修正+随机扰动/上头+路径偏好）
    ↓
  GOAP costFn = action.getPlanCost()  ← 纯路径代价
    ↓
  BT 执行
```

## 影响

### 修改的文件

- `apps/game/js/engine/npc/npc-actions.js`
  - `computeDecisionCost`：简化为纯基础路径代价，移除 lambdaRisk/lambdaValue/上头/pathOrder。
  - 保留 `estimateRiskCost`、`computeActionValue`（供 Utility 层调用）。

- `apps/game/js/engine/npc/npc-entity.js`
  - `buildDecisionCostFn`：改为返回 `null`，GOAP 自动回退 `action.getPlanCost()`。
  - 移除 `_buildDecisionCostFn`、`_markHeadstrongFromPlan`、`_perDecisionCtx`。

- `apps/game/js/engine/npc/npc-utility.js`
  - `decorateGoalConsiderations` 新增三块逻辑：
    - D. 情绪修正风险厌恶（anger 降低、fear 提高风险权重）
    - E. 随机扰动/上头（目标级 roll，命中则 mult 放大分数）
    - F. 路径偏好（explore_first 给探索类目标 deltaPriority 加成）

- `apps/game/data/config/ai-config.json`
  - `npc.decision`：仅保留 `costFloor`（GOAP 用）。
  - 新增 `npc.utility`：包含 `lambdaRisk`、`riskAversion`、`emotionRisk`、`headstrong`、`pathPreference`。

- `apps/game/js/engine/world-engine.js`
  - `utilityConfig` 构建：合并 `balance/utility.json` 与 `ai-config.npc.utility`（后者覆盖前者同名键）。

### 默认关闭不改变既有行为保证

- `balance/utility.json enabled=false`（默认）时，`decorateGoalConsiderations` 在执念乘子后立即返回，所有新逻辑均不执行，行为与重构前完全一致。
- 各子功能有独立 `enabled` 开关：`riskAversion.enabled`、`emotionRisk.enabled`、`headstrong.enabled`、`pathPreference.enabled`。
- GOAP 固定场景回归摘要 `c4ac92da` 不变（GOAP 规划器本身逻辑未改变）。

## 权衡

| 方面 | 重构前 | 重构后 |
|------|--------|--------|
| NPC 差异性来源 | GOAP 行为选择的代价差异 | Utility 目标选择的分数差异 |
| 情绪对决策的影响 | 仅通过 Utility 调制 Goal 乘子 | 额外影响风险厌恶系数（更细腻） |
| 上头/冲动 | 行为级（某个具体行为更便宜） | 目标级（某个目标整体更吸引） |
| GOAP 可预测性 | 受情绪/风险/上头干扰 | 纯路径成本，更稳定 |
| 故事生成质量 | 同境界 NPC 行为趋同 | NPC 差异主要来自 Utility 分歧 |

