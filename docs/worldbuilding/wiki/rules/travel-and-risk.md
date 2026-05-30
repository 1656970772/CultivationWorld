# 游历感悟与风险规则

> 最后更新：2026-05-30
> 状态：已敲定（基础版，机缘/风险细项可扩展）
> 类型：规则
> 关联文档：`docs/decisions/adr-016-travel-insight-and-risk.md`、`docs/decisions/adr-017-value-risk-decision-and-cultivation-curve.md`、`docs/worldbuilding/wiki/rules/personality.md`、`docs/data/data-config-rules.md`

## 一句话定义

修士的突破进度由"闭关进度 + 游历感悟"双源构成；闭关有境界上限，剩余进度必须外出游历积累，游历途中按数据驱动的风险表结算受伤/掉落/陨落。

## 已敲定内容

### 突破进度双源

- 突破总进度 `totalProgress = cultivationProgress（闭关）+ insight（游历感悟）`，达 `1.0` 方可尝试突破。
- 闭关进度有**境界上限 `cultivationCap`**：凡人/弟子 1.0、炼气 0.7、筑基 0.6、金丹 0.5、元婴 0.4、化神 0.3。
- 境界越高，越依赖游历补足突破进度（呼应"高境界需历练机缘、不能闭门造车"）。
- 闭关撞到 cap 后不再推进突破，弟子会自动外出游历（由 GOAP 推导，非硬编码）。
- 突破成功或失败都会清零 `insight`（机缘已用尽/已逝）。

### 游历机缘事件

游历归来按加权事件表 roll 一次，产出游历感悟(insight)与真气：

| 事件 | 权重 | 感悟倍率 | 备注 |
|------|------|---------|------|
| 平安归来 | 50 | 0.5 | |
| 略有感悟 | 30 | 1.0 | |
| 顿悟机缘 | 12 | 2.5 | |
| 洞天福地 | 5 | 4.0 | 预留：限时修炼加速 |
| 拾得遗宝 | 3 | 1.5 | 预留：掉落法宝/材料/药草 |

### 游历风险

游历归来逐项独立结算以下风险分项（数据驱动，见 `risk.json`）：

- **受伤风险**：增加 injuryLevel；境界越高越能减免；勇敢(courage)越高越易受伤。
- **资源掉落风险**：损失部分灵石。
- **职位挑战失败风险**：降低士气（当前预留，未启用）。
- **死亡风险**：陨落于游历途中，走正常死亡/继任流程；初期概率极低；极度勇敢者略升。

每分项触发概率 = `基础概率 × 境界减免 × (1 + 性格加成)`，各项独立掷骰。"总风险百分比"为各分项基础概率之和（仅用于展示）。

### 价值-风险决策与「上头」（ADR-017）

NPC 选行为时不再只看基础消耗，而是分层加权：

```
决策代价 = 基础消耗 + λ_risk × 期望风险损失 − λ_value × 行为价值，再夹 costFloor 下限
```

- **期望风险损失**：用上述风险表的**期望值** `Σ(触发概率 × 严重度)`（不掷骰，规划期可重复），death 严重度最高。
- **行为价值**：每个行为的 `valueScore`（数据驱动）；游历价值较高、风险也较高，二者在代价里博弈。
- **上头**：每次决策对每个行为以很小概率（`headstrongChance`，默认 3%）命中，命中则给该行为价值注入一个很大的加成，
  使其在代价比较中胜出——NPC 会「上头」做出本不划算的事（如风险高的游历/挑战）。命中且成为首个行为时，
  state 打标记 `lastDecisionHeadstrong`/`headstrongActionId`。
- 系数集中在 `ai-config.json → npc.decision`。

### 修炼曲线与顺序随机（ADR-017）

- **闭关边际递减但可到顶**：闭关有效增量 = 基础增量 × `e^(-k × 当前/上限)`，越接近 cap 越慢但能缓慢到顶（`k = cultivationDecayK`）。
- **闭关至少占 30%**：游历感悟 `insight` 封顶 `1 - minCultivationRatio`（默认最多 70%）；突破额外要求 `cultivationProgress ≥ minCultivationRatio`。
- **游历/闭关顺序随机**：每进入新境界 roll `breakthroughPathOrder ∈ {cultivate_first, explore_first}`；`explore_first` 时游历代价被调低，A* 先选游历。

## 数据与实现提示

- 闭关上限、衰减系数、最低占比、机缘事件表：`apps/game/data/balance/cultivation.json` 的 `cultivationCap`、`cultivationDecayK`、`minCultivationRatio`、`actions.explore.fortuneEvents`。
- 决策系数：`apps/game/data/config/ai-config.json` 的 `npc.decision`（lambdaRisk/lambdaValue/headstrongChance/headstrongValueBonus/costFloor/exploreFirstCostFactor）。
- 行为价值/风险键：`apps/game/data/actions/npc-actions.json` 每行为的 `valueScore`/`riskKey`。
- 决策计算：`npc-actions.js` 的 `estimateRiskCost()`/`computeActionValue()`/`computeDecisionCost()`；NPC 入口 `npc-entity.js` 的 `_buildDecisionCostFn()`/`_markHeadstrongFromPlan()`。
- 风险表：`apps/game/data/balance/risk.json`（`explore.items[]`，含 `personalityModifiers`）。
- 勇敢维度：`apps/game/data/balance/personality.json` 的 `traits.courage`（缺省 50）。
- GOAP 自然驱动游历：闭关行为前置 `cultivationProgress < cap` 由 `npc-entity.js._applyCultivationCapPreconditions` 按境界动态注入，突破后刷新。
- 执行与结算：`npc-actions.js` 的 `NPCExploreExecutor`、`settleRisk()`、`personalityRiskBoost()`。
- 游历目标点解析：`tick-manager.js` 的 `_randomWanderTarget`（朝随机方向走到野外可通行点）。

## 待扩展

- 洞天福地限时修炼加速 buff；遗宝/材料/药草掉落进背包。
- 职位挑战失败风险接入真实战力对比；游历途中 NPC 间厮杀与夺宝。
- 目的地危险度分级（不同区域风险权重不同）。
- 更多性格维度影响机缘/风险（谨慎降受伤、机敏升机缘等）。

## 来源

- 用户确认（2026-05-30）：闭关最多积累约一半进度、剩余靠游历；游历是寻机缘/厮杀/洞天福地/法宝材料药草的入口；风险需独立配置表，含资源掉落/受伤/职位挑战失败/死亡分项、带权重、支持性格（勇敢）加成。
- 闭关/游历占比随境界变化、写入配置表（沿用按境界递减的 cap）。
