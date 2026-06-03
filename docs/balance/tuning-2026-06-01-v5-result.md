# 2026-06-01 平衡调优迭代 v5 验证报告

> 状态：v5（势力凝聚力 + 多元危亡抉择）已实现 + 2000 天冒烟 + 5000 天定稿验证
> 关联：
> - 迭代流程 `docs/balance/simulation-iteration-process.md`（ADR-033）
> - 上一轮 `docs/balance/tuning-2026-06-01-v4-result.md`
> - 设定 `docs/worldbuilding/wiki/rules/faction-crisis-defection.md`
> - 决策 `docs/decisions/adr-035-faction-cohesion-crisis.md`
> - 备份 `docs/balance/backup/pre-tuning-v5-*`

## 1. 一句话结论

**v5 终于打通了"势力覆灭"——这是 v3/v4 两轮都没能解决的结构目标**。通过让势力危亡时成员按性格/利益做多元抉择（死战/退避/叛投/出走/被迫效忠/逃命/投降），凝聚力低的势力真实人口骤降，触发 ADR-034 的覆灭阈值而自然灭门。5000 天定稿：势力覆灭 **0 → 1**（万妖山），且只覆灭 1 个、其余 17 个稳定存活——证明机制有**差异性**（有的势力凝聚力强扛得住），没有雪崩。

## 2. 关键 KPI 四轮对比（5000 天全激活态）

| 指标 | v2 基线 | v3 | v4 | **v5** | 评价 |
|------|---------|----|----|----|------|
| **势力覆灭** | 0 | 0 | 0 | **1** | 🟢 **历史首次突破** |
| 末态存活 NPC | 38 | 44 | 54 | 51 | 🟢 维持高位 |
| 女/男比 | 0.31 | 0.63 | 0.29 | **0.70** | 🟢 四轮最佳 |
| 出生数 | 35 | 93 | 64 | 82 | 🟢 |
| 突破成功 | 27 | 121 | 62 | 94 | 🟢 |
| 死亡总数 | 279 | 385 | 310 | 359 | 🟡 |
| power_struggle 死因 | — | 1 | 2 | **6** | 🟢 权力斗争升温 |
| 攻伐 | 18148 | 17529 | 17526 | 18130 | 持平 |

### 存活势力曲线（5000 天）

| 天 | 500 | 1000 | 2000 | 3000 | 5000 |
|----|----|------|------|------|------|
| v4 | 18 | 18 | 18 | 18 | 18 |
| **v5** | 17 | 17 | 17 | 17 | **17** |

> 万妖山在早期（D200 前）即因凝聚力不足覆灭，此后格局稳定——既证明机制生效，又证明不会连锁崩盘。

## 3. v5 改动

### 设定（先落 Wiki）

`docs/worldbuilding/wiki/rules/faction-crisis-defection.md`：参考凡人修仙传 / 仙逆 / 大道争锋的冲突分析，提炼 **7 类危亡反应**——死战、退避隐忍、叛投敌方、出走散修、被迫效忠、抢先逃命、投降归顺。

### 数据 `data/balance/combat.json` → `cohesion`

- `enabled`、危机态触发（`crisisStabilityThreshold` / `crisisPowerRatio` / `crisisAliveNpcThreshold`）。
- `reactions`：6 类个体反应的权重公式（base × 性格 trait 映射倍率 + 核心成员死战放大 `coreMult`）。
- `surrender`：群体投降判定（领袖陨落 / 稳定度崩溃 / 战力悬殊）。
- `effects`：死战/退避被杀权重、被迫效忠心境损耗。

### 代码 `js/engine/world/services/faction-ai-service.js`

- 构造读取 `cohesion` 配置。
- 新增 `_trait` / `_traitFactor` / `_chooseCrisisReaction`（按性格加权抽取个体抉择）/ `_makeWanderer` / `_switchFaction` / `_resolveCrisisChoices`（危机态逐成员抉择 + 群体投降 + 真实人口流失同步扣 disciples）。
- 在攻战胜利结算处插入 `_resolveCrisisChoices`，`cohesionEnabled=false` 时完全退化为 v4 行为。

## 4. 关键诊断与修订（迭代中的发现）

**第一次冒烟（2000 天）势力覆灭仍 0**。诊断发现：危机触发用绝对稳定度阈值（≤35），但所有势力稳定度因自然恢复维持在 80~3000+（虚高，且疑似有独立的稳定度上限 bug，非 v5 引入）——阈值永远进不去。**这与 ADR-034 v4 P1 是同一病根**。

修订：危机判定改用攻战当下可靠的**相对信号**——战力悬殊（`powerRatio ≥ 1.5`）或防守方真实活 NPC 已很少（`≤ 6`），不再依赖绝对稳定度。修订后**势力覆灭立刻 0 → 1**。

> 这正是 ADR-033 归因决策树的又一次应用：调阈值无响应 → 不是参数问题，而是"判据选错了信号源"。

## 5. 验收对照

- [x] NPC 危亡不再全员死战，出现多元抉择（叛投/出走/逃命/被迫效忠/投降）✅
- [x] 势力凝聚力差异化（涌现量，非硬编）✅
- [x] **势力覆灭 0 → 1**（历史首次）✅
- [x] 不雪崩（仅 1 个覆灭，其余稳定）✅
- [x] GOAP 黄金指纹 `5740e12a` 零漂移 ✅
- [x] 回归测试通过（goap-golden / revenge / relationship-goals / monster-resource-loop）✅
- [x] cohesion `enabled=false` 可一键回退 v4 行为 ✅

## 6. 未解 / v6 方向

1. **稳定度量级异常**：势力稳定度可达 3000+（应是 0-100），疑似独立历史 bug。v5 用相对信号绕过，但根因待查（v6 可单独修，会让稳定度类危机/投降判据也恢复可用）。
2. **覆灭数偏少（仅 1）**：当前只有"万妖山"凝聚力低到覆灭。可微调 `cohesion.reactions` 让中等凝聚力势力在持续挨打下也会流失，产生更多权力流动。
3. **复仇 PvP 击杀仍低**：与 ADR-034 同列，复仇执念行动待加强。
4. **降众消化**：投降/叛投后攻方对降众的同化/猜忌叙事（见 wiki 待扩展）。

## 7. 回滚

```powershell
cp docs/balance/backup/pre-tuning-v5-combat.json            apps/game/data/balance/combat.json
cp docs/balance/backup/pre-tuning-v5-faction-ai-service.js  apps/game/js/engine/world/services/faction-ai-service.js
```
或仅设 `combat.json` → `cohesion.enabled=false`（保留代码，行为退回 v4）。
