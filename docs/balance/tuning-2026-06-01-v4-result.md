# 2026-06-01 平衡调优迭代 v4 验证报告

> 状态：v4（P0 接单战力自检 + P1 势力覆灭动态阈值）已实施 + 5000 天全激活态验证
> 关联：
> - 迭代流程 `docs/balance/simulation-iteration-process.md`
> - 上一轮 `docs/balance/tuning-2026-06-01-v3-result.md`
> - 备份 `docs/balance/backup/pre-tuning-v4-*`

## 1. 一句话结论

**v4 接单战力自检（P0）大成功——任务类死亡显著下降，人口从 v3 的 44 继续抬升到 54，逼近健康线**。但势力覆灭动态阈值（P1）未触发：覆灭仍为 0，暴露了更深的结构裂缝——**势力强度挂在抽象 `disciples` 数值上，与真实活 NPC 数脱钩**，势力被 `faction_recruit` 持续"输血"而打不死。这是 v5 任务。

## 2. 关键 KPI 三轮对比（5000 天全激活态）

| 指标 | v2 基线 | v3 | **v4** | 趋势 |
|------|---------|----|----|------|
| **末态存活 NPC** | 38 | 44 | **54** | 🟢 持续抬升（+42% vs 基线） |
| **死亡总数** | 279 | 385 | **310** | 🟢 较 v3 降 19% |
| **quest 死因**(末300) | 60 | 130 | **90** | 🟢 接单自检降 31% |
| **quest_hunt_failed**(末300) | 20 | 56 | **32** | 🟢 降 43% |
| monster 死因 | 160 | 92 | 162 | ⚠️ 回升（行为再分配） |
| 突破成功 | 27 | 121 | 62 | 🟡 回落但仍 2.3x 基线 |
| 出生数 | 35 | 93 | 64 | ⚠️ 回落（接单自检改变行为分布） |
| 女/男比 | 0.31 | 0.63 | 0.29 | ⚠️ 回落 |
| 攻伐 | 18148 | 17529 | 17526 | 持平 |
| **势力覆灭** | 0 | 0 | **0** | ❌ P1 未触发（见 §5） |
| 猎妖失败率 | 61% | 69% | **67%** | 🟡 略降 |

### 人口曲线对比

| 天 | 50 | 500 | 1000 | 2000 | 3000 | 5000 |
|----|----|----|------|------|------|------|
| v2 基线 | 136 | 90 | 74 | 57 | 43 | 38 |
| v3 | 136 | 129 | 118 | 81 | 65 | 44 |
| **v4** | 137 | 115 | 101 | 75 | 62 | **54** |

> v4 中期人口略低于 v3（出生回落），但**后期衰减更缓、末态最高（54）**——因为死亡显著减少，活下来的人留得住。这正是 P0 的设计意图：用"少死"替代"多生"，更可持续。

## 3. v4 改动

### P0：NPC 接单战力自检（数据驱动）

| 文件 | 改动 |
|------|------|
| `data/quests/quest-templates.json` | 新增 `safetyPreference { enabled, falloffPerStep: 0.55 }` |
| `js/engine/npc/actions/npc-action-utils.js` → `pickQuestCandidate` | 对【非猎妖】任务按"难度高出该境界可接最低难度的步数"指数衰减权重（`falloffPerStep^stepsAboveSafe`），让 NPC 倾向留安全边际、不顶格冒险 |

### P1：势力覆灭动态阈值

| 文件 | 改动 |
|------|------|
| `data/balance/combat.json` | `attack` 新增 `annihilation { enabled, stabilityThreshold: 20, aliveNpcThreshold: 3 }` |
| `js/engine/world/services/faction-ai-service.js` | 攻战胜利结算时，若防守方稳定度 ≤20 且实际活 NPC ≤3，将 `winDefenderMinDisciples` 托底降为 0，允许灭门 |

## 4. 验收对照

- [x] 任务类死亡显著下降（quest 130→90，hunt_failed 56→32）✅
- [x] 末态存活 NPC 继续抬升（44→54，目标 ≥60 接近达成）🟡
- [x] 死亡总数下降（385→310）✅
- [x] GOAP 黄金指纹零漂移（`5740e12a`）✅
- [x] 回归测试通过（goap-golden / monster-resource-loop）✅
- [ ] 势力覆灭 ≥1 ❌（P1 未触发，见 §5）

## 5. P1 未触发的根因（v5 核心任务）

势力覆灭条件是 `faction-entity.js`：`disciples <= 0 || stability <= 0` → `isDestroyed`。

但诊断发现 P1 的动态托底**永远进不去**：
1. `disciples` 是**抽象人力数值**，由 `faction_recruit`（每次 +固定量）和 `resourceRegen.disciplesPerDay` 持续补充。
2. 攻战即使杀掉真实 NPC，抽象 `disciples` 仍被输血维持在高位。
3. 18 个势力的稳定度也都有 `naturalRecoveryRate` 自然恢复，几乎不会跌到 ≤20。
4. → 触发条件"稳定度≤20 且活NPC≤3"从未同时满足。

**这是 v3 就埋下的同一类结构裂缝的延伸**：抽象资源（disciples 数值）与真实个体（NPC 实体）两套人口不同步。

### v5 方案（结构修复，优先级最高）

让**势力的 `disciples` 与真实活 NPC 数挂钩**——例如每 tick 把 `disciples` 校准为 `实际活 NPC 数 + 抽象散兵`，或让 `faction_recruit` 在真实 NPC 枯竭时无法继续输血。这样攻战杀 NPC 才能真正削弱势力，权力流动（覆灭/补位/挑战）才会涌现。

其余顺延：复仇执念行动（PvP 击杀仍 0）、招募生成真实个体（同属抽象/真实同步问题）。

## 6. 方法论回顾

- **P0 是教科书式的成功迭代**：精准定位（quest 死因为人口流失主因）→ 最小数据杠杆（一个 falloff 系数）→ 立竿见影（任务死亡 -31%/-43%，末态人口 +23%）。
- **P1 是有价值的"失败"**：它没达成目标，但**证伪了"调阈值就能让势力覆灭"的假设**，把真正的病根（抽象资源 vs 真实个体不同步）逼了出来。这比盲目把阈值调得更激进有价值得多——后者只会制造假覆灭。
- 再次印证流程 §4 的归因决策树：**改了参数无响应 = 结构问题，不要继续硬调参数**。

## 7. 回滚

```powershell
cp docs/balance/backup/pre-tuning-v4-quest-templates.json    apps/game/data/quests/quest-templates.json
cp docs/balance/backup/pre-tuning-v4-npc-action-utils.js     apps/game/js/engine/npc/actions/npc-action-utils.js
cp docs/balance/backup/pre-tuning-v4-combat.json             apps/game/data/balance/combat.json
cp docs/balance/backup/pre-tuning-v4-faction-ai-service.js   apps/game/js/engine/world/services/faction-ai-service.js
```
