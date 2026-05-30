# ADR-022：期望收益（Expected Value）Utility 模型

最后更新：2026-05-30

## 背景

ADR-021 将所有"目标价值评估"因素从 GOAP step cost 迁移到 Utility 选目标层，建立了**风险厌恶**乘子：

```
GoalScore = priority × Π(consideration) × riskAversion(1 − riskWeight × goalRisk) × ...
```

**存在的问题：**

风险被建模为"折扣"（让目标分数变小），但**收益（reward）从未被独立建模**——一个目标值不值得追，其 `reward` 项基本等同于静态 `priority`。这在修仙世界里不够：

- 秘境/夺宝这类行为是**概率性收益**：可能得仙器（1%）、极品法宝（10%）、普通材料（60%）、空手而归（29%）。NPC 看到的"价值"应当是**期望收益 `Σ(概率 × 收益)`**，而非固定值。
- 没有期望收益模型，"赌狗流"（低谨慎/愤怒，铤而走险博高收益）和"稳健流"（高谨慎，只做确定性收益）无法在数值上分化——他们对同一秘境目标算出的分数没有结构性差异。

参考：《凡人修仙传》"杀人夺宝/闯秘境"、《完美世界》"夺宝类 NPC"、《遮天》"抢夺帝兵古经"，修士对险地的取舍正是"期望收益 vs 风险"的权衡。

## 决策

在 Utility 选目标层引入**期望收益**项，与 ADR-021 的风险厌恶项**对称**：

```
Score = (基础价值 priority) × Π(consideration) × riskAversion × expectedValueMult × ...
```

其中期望收益按概率分布求期望：

```
ExpectedValue(goal) = Σ_i (outcome_i.prob × outcome_i.value)
```

- 收益分布数据驱动，配置在 `data/balance/reward.json`，按 `goal.sourceId`（或 `tag`）匹配一组结果分项 `{ id, prob, value }`。
- `ExpectedValue` 作为**派生输入 `derived.expectedValue`** 提供给 Consideration（复用 ADR-020 的 consideration 曲线机制），由 `utility.json considerationsBySource` 的曲线（如 linear）映射到 `[0,1]` 后参与乘法效用。这样高期望收益目标 consideration 接近 1，低期望收益接近 0。

### 为什么用期望值而非"风险作折扣 + 收益作折扣"两套

- 风险（riskAversion，ADR-021）描述"为追这个目标可能付出的损失"，是**惩罚项**（乘子 ≤ 1）。
- 收益（expectedValue，本 ADR）描述"这个目标大概能拿到多少好处"，是**吸引项**（consideration ∈ [0,1]，作为目标想做程度的乘子）。
- 二者职责不同、来源不同（risk.json vs reward.json），分开建模更清晰，符合单一职责。
- 赌狗流 = 高 expectedValue 吸引 + 低 riskAversion 惩罚（愤怒/低谨慎）；稳健流 = 同样 expectedValue 但高 riskAversion 惩罚。分化由两项的相对强弱自然产生。

### 完整 Utility 公式（ADR-022 后）

```
GoalScore
  = (priority + Σ deltaPriority)
  × Π(modulator.mult)              // 执念乘子（ADR-020）+ riskAversion（ADR-021）+ headstrong（ADR-021）
  × Π(consideration ∈ [0,1])       // 瓶颈/寿元/伤势（ADR-020）+ expectedValue（本 ADR）
```

`expectedValue` 通过 consideration 进入 `Π(consideration)`，不新增独立乘法层，最大程度复用既有机制。

## 实现要点

### 数据：reward.json

```json
{
  "enabled": false,
  "rewardsBySource": {
    "obsession_plunder": {
      "outcomes": [
        { "id": "immortal_artifact", "prob": 0.01, "value": 1.0 },
        { "id": "top_treasure",      "prob": 0.10, "value": 0.7 },
        { "id": "common_material",   "prob": 0.60, "value": 0.3 },
        { "id": "empty_handed",      "prob": 0.29, "value": 0.0 }
      ]
    }
  }
}
```

- `value` 归一化到 `[0,1]`（相对收益），`ExpectedValue` 因 `Σprob×value` 自然落在 `[0,1]`。
- `enabled=false`（默认）时不计算期望收益，零漂移。

### 代码：consideration.js

新增 `deriveExpectedValue(rewardCfg, sourceId)` 帮助函数，按 sourceId 取 outcomes 算 `Σprob×value`。期望收益作为 `derived.expectedValue` 注入 Consideration 求值（无需新增 curve 类型，linear 曲线即可）。

### 代码：npc-utility.js decorateGoalConsiderations

在 C 段（consideration 装配）的 `derived` 表中加入 `expectedValue`，使 `obsession_plunder` 等目标的 `expectedValue` consideration（见 utility.json）能读到该派生值。

### 配置：ai-config.json npc.utility

新增 `expectedValue` 段（如 `{ "enabled": true }`）作为总开关说明；实际数据在 reward.json。

## 零漂移保证

- `reward.json enabled=false`（默认）时，`deriveExpectedValue` 返回 0，无 reward 目标的 expectedValue consideration 不参与（或值为常量），且 `utility.json enabled=false` 时整个 decorate 提前返回。
- 本 ADR 仅改 Utility 层（reward 仅在激活态、且仅对配置了 reward 的目标生效），不改 GOAP 行为数据，黄金指纹 `c4ac92da` 在本 ADR 阶段保持不变。
  > 注：随后的 ADR-023 因新增流派行为数据使黄金指纹变为 `3c1d45df`（见 ADR-023 说明）；`test-goal-equivalence.mjs` 始终通过，证明现有目标规划路径零漂移。
- 新增 `tools/test-utility-divergence.mjs` 在激活态验证赌狗流/稳健流对高期望收益目标的分化。

## 权衡

| 方面 | 仅风险折扣（ADR-021） | 期望收益 + 风险（ADR-022） |
|------|----------------------|---------------------------|
| 收益建模 | 静态 priority | `Σ(prob×value)` 概率期望 |
| 赌狗流/稳健流分化 | 仅靠风险厌恶强弱 | 收益吸引 × 风险惩罚双向分化 |
| 秘境/夺宝表达 | 价值固定 | 概率性收益（仙器/法宝/材料/空手） |
| 数据复杂度 | 仅 risk.json | risk.json + reward.json（职责分离） |
