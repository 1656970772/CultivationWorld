# 游历修为与风险规则

> 最后更新：2026-06-07
> 状态：已敲定（数值修为版，机缘/风险细项可扩展）
> 类型：规则
> 关联文档：`docs/decisions/adr-016-travel-insight-and-risk.md`、`docs/decisions/adr-017-value-risk-decision-and-cultivation-curve.md`、`docs/decisions/adr-051-numeric-cultivation-and-job-action-migration.md`、`docs/data/data-config-rules.md`

## 一句话定义

修士的突破准备由数值修为与真气共同约束：闭关、修炼场、丹药等增加 `cultivation`，游历、任务、动态事件、机会点、PvP 与外出社交增加 `experienceCultivation`，二者相加为 `totalCultivation`；游历途中按数据驱动风险表结算受伤、掉落、死亡等结果。

## 已敲定内容

### 数值修为双源

- `cultivation`：闭关、修炼场、丹药等直接修炼所得。
- `experienceCultivation`：游历、任务、战斗、机会点、动态事件、外出社交等经历所得。
- `totalCultivation = cultivation + experienceCultivation`，用于对比下一境界的 `cultivationRequired`。
- 突破还要求 `cultivation` 达到 `minCultivationRatio × nextCultivationRequired`，默认最低闭关占比为 30%。
- 闭关没有硬上限，但收益随 `cultivation / nextCultivationRequired` 指数递减，避免只靠闭关高速冲顶。
- `rankStage` 由 `totalCultivation / nextCultivationRequired` 派生，阈值来自 `stageThresholds`。

### 游历机缘事件

游历归来按加权事件表 roll 一次，产出历练修为与真气：

| 事件 | 权重 | 历练修为倍率 | 备注 |
|------|------|--------------|------|
| 平安归来 | 50 | 0.5 | |
| 略有感悟 | 30 | 1.0 | |
| 顿悟机缘 | 12 | 2.5 | |
| 洞天福地 | 5 | 4.0 | 预留：限时修炼加速 |
| 拾得遗宝 | 3 | 1.5 | 预留：掉落法宝/材料/药草 |

历练修为统一通过 `applyCultivationExperience()` 或对应 Toil/Action 入口结算，并同步 `totalCultivation` 与 `rankStage`。

### 游历风险

游历归来逐项独立结算以下风险分项（数据驱动，见 `risk.json`）：

- **受伤风险**：增加 injuryLevel；境界越高越能减免；勇敢(courage)越高越易受伤。
- **资源掉落风险**：损失部分灵石。
- **职位挑战失败风险**：降低士气（当前预留，未启用）。
- **死亡风险**：陨落于游历途中，走正常死亡/继任流程；初期概率极低；极度勇敢者略升。

每分项触发概率 = `基础概率 × 境界减免 × (1 + 性格加成)`，各项独立掷骰。“总风险百分比”为各分项基础概率之和（仅用于展示）。

### 价值-风险决策与上头

当前 Utility 选目标层负责收益、风险、情绪与流派分化，GOAP 负责达成目标的行动链。游历、任务、战斗与机会点的吸引力来自目标效用、期望收益与风险厌恶共同计算，而不是把某个行动写死为固定优先级。

## 数据与实现提示

- 修为速度、最低闭关占比、收益递减、小层阈值、机缘事件表：`apps/game/data/balance/cultivation.json`。
- 游历风险表：`apps/game/data/balance/risk.json`。
- Utility / 期望收益 / 风险厌恶：`apps/game/data/balance/utility.json`、`apps/game/data/balance/reward.json`、`apps/game/data/config/ai-config.json`。
- 行为价值/风险键：`apps/game/data/actions/npc-job-actions.json` 与仍保留的 simple action 配置。
- 执行与结算：`apps/game/js/engine/npc/toils/cultivation-toils.js`、`apps/game/js/engine/npc/cultivation-experience.js`、`apps/game/js/engine/npc/actions/combat-actions.js`。
- 游历目标点解析：`apps/game/js/engine/world/tick-manager.js` 的 `_randomWanderTarget`。

## 待扩展

- 洞天福地限时修炼加速 buff；遗宝/材料/药草掉落进背包。
- 职位挑战失败风险接入真实战力对比；游历途中 NPC 间厮杀与夺宝。
- 目的地危险度分级（不同区域风险权重不同）。
- 更多性格维度影响机缘/风险（谨慎降受伤、机敏升机缘等）。

## 来源

- 用户确认（2026-05-30）：闭关与游历共同推动突破；游历是寻机缘/厮杀/洞天福地/法宝材料药草的入口；风险需独立配置表，含资源掉落/受伤/职位挑战失败/死亡分项、带权重、支持性格（勇敢）加成。
- 数值修为重构（2026-06-07）：旧比例进度口径移除，游历与外出行为改为产出历练修为数值。
