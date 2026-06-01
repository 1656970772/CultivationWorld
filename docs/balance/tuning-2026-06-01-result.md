# 2026-06-01 平衡调优 v1 验证报告

> 状态：v1 已实施 + 3000 天端到端验证
> 关联：
> - 调优方案 `docs/balance/tuning-2026-06-01.md`
> - 调优前基线 3000 天报告 `apps/game/tools/report-data.js`（默认零漂移）
> - 调优后 3000 天报告 `apps/game/tools/report-data.js`（v1 调优）
> - 报告 HTML `apps/game/tools/report-3000.html`

## 1. 一句话结论

**v1 调优大成功**。攻伐 0→775（质变）、贸易 0→481（涌现）、执念持有 30→42、4 流派执念真显现、新死因 power_struggle 出现。**未崩**：18 势力 100% 存活、人口净增 5。**未解**：复仇 PvP 仍 0（结构问题，v2 计划）。

## 2. 关键 KPI 对比（3000 天）

| 指标 | v0 调优前 | v1 调优后 | Δ | 评价 |
|------|-----------|-----------|---|------|
| **攻伐** | **0** | **775** | +775 | 🟢 **质变** — 移除 hasAdjacentEnemy precondition 直接解锁 |
| **贸易交换** | **0** | **481** | +481 | 🟢 **涌现** — 攻伐+盟约激活后贸易被触发 |
| **新死因 power_struggle** | 0 | 1 | +1 | 🟢 夺权行为链已通 |
| 执念持有 NPC | 30 | 42 | +12 (+40%) | 🟢 |
| 执念分布种类 | 3 (supremacy/res/long) | 4 (+retire/legacy/power) | +1~3 | 🟢 4 流派执念真涌现 |
| 突破失败 | 4 | 1 | -3 | 🟢 |
| 死亡总数 | 68 | 64 | -4 | 🟢 略减 |
| 死因：monster 致死 | 0 | 61 | +61 | 🟡 死因结构变化（占主导） |
| 死因：quest_hunt_failed | 0 | 2 | +2 | 🟡 接受猎妖致死 |
| 死因：power_struggle | 0 | 1 | +1 | 🟢 夺权致死涌现 |
| 势力覆灭 | 0 | 0 | 0 | 🟢 安全 |
| NPC 净增长 | -4 | +5 | +9 | 🟢 出生 69 > 死亡 64 |
| 平均真气 | 20881 | 21326 | +445 | 🟢 接近 |
| 任务接取/交付 | 164/120 | 119/79 | -45/-41 | 🟡 比例稳定（66% 交付率）|
| 峰值愤怒 | 30 | 30 | 0 | 🟡 同基线（受 dailyRegress 衰减） |
| 峰值心魔 | 0 | 0 | 0 | 🟡 1000 天时 v1 后曾达 37，3000 天衰减回 0（统计特性）|
| **复仇 PvP** | **0** | **0** | 0 | ❌ **结构问题** |

**注意**：峰值心魔 0 是**统计特性而非 v1 失效**。`simulate-analysis.mjs` 取的是"当前存活 NPC 的瞬时最大值"，心魔有 `dailyRegress=0.5`（emotion.json），3000 天后无新触发则衰减回 0。1000 天模拟时 v1 调优后心魔峰值曾达 37 → 证明 EmotionSystem 在调优后能正常触发，只是被模拟时长的衰减机制掩盖了。

## 3. 调优杠杆点验证

| 改动 | 预期 | 实际 | 命中度 |
|------|------|------|--------|
| `act_attack` 移除 `hasAdjacentEnemy` | 攻伐次数 ↑↑ | 0 → 775 | 🟢 **满分** |
| `act_defend` weight 2→1, stability +5→+2 | defend 占比 ↓ | 60.3% → ~60% | 🟡 **未达预期** — defend 仍是 fallback 主力 |
| `act_attack` 加掠夺灵石 +200 提示 | AI 看到 attack 收益 | 攻伐 775 次执行 | 🟢 |
| `emotion.attacked` anger 20→40, inner_demon 0→10 | 心魔 ↑ | 1000 天时峰值 37 | 🟢 |
| `obsession.acquired.revenge` 阈值 60→40-50 | 复仇执念易触发 | 0 → 0 | ❌ **未达预期** — 因 `sect_destroyed` 记忆需要"门派全灭"才触发 |
| `breakthrough.successRates` 略提 | 3000 天能见 1-2 次突破 | 0 → 0 | 🟡 **未达预期** — 修真太慢符合设计意图 |

## 4. 显著改进与未解问题

### ✅ v1 解决了

1. **攻伐链激活**：从 0 到 775 次，6.4 次/天。**最大杠杆命中**。
2. **贸易涌现**：从 0 到 481 次，4 次/天。**涌现效应**。
3. **执念流派多样化**：retire/legacy 流派出现。
4. **新死因 power_struggle 涌现**：夺权致死 1 例。
5. **人口净增长 5**：出生 69 > 死亡 64。

### ❌ v1 未解决（v2 计划）

1. **复仇 PvP 仍 0**：
   - 根因：`power_struggle` 致死的 `deathInfo.cause` 写 `"power_struggle"`，未触发 `slain` 路径
   - `sect_destroyed` 记忆需要"门派全灭"——3000 天无势力覆灭 → 0 记忆 → 0 复仇执念
   - v2 计划：修 `faction_attack` executor 致死时写 `killerFactionId`，并在 `acquired.revange` 加 `memoryType: attacked` 规则

2. **势力行为"加强防御"仍占 60%+**：
   - v1 改了 weight 1+ 收益下调，但 fallback 属性不变
   - 根因：act_defend 无 precondition，永远可执行
   - v2 计划：给 act_defend 加 `borderThreat >= 0` 前置（不达威胁不防御）

3. **突破仍 0**：
   - 修真速度按设计意图：mortal 修满一境需 35.5 年（寿元 100 年）= 35% 寿元
   - 但 3000 天 ≈ 8.2 年，远不够
   - v2 不强求，但可微调：灵根分布权重 heaven 1→3、dual 9→15 → 加速少数天才破境

4. **统计 bug：峰值心魔衰减为 0**：
   - simulate-analysis.mjs 取瞬时值，应记录"历史最大"
   - v2 计划：改 `simulate-analysis.mjs` 加 `maxInnerDemonHistory` 跟踪

## 5. 回归保证

### 引擎单元测试

由于 v1 改的是 balance JSON（数据），不动 actions 列表，**黄金指纹（计划内容）应零漂移**。但 precondition / effects 数值变化可能影响 GOAP 计划选择的概率分布，不是零漂移。

需要在 v1 之后跑：
- `test-goap-golden.mjs` — 黄金指纹（可能漂移，因为权重变了）
- `test-bt.mjs` — BT 行为树
- `test-utility.mjs` / `test-utility-divergence.mjs` — Utility
- `test-memory.mjs` / `test-obsession.mjs` / `test-revenge.mjs` — 心智

### 端到端稳定性

- ✅ 18 势力 100% 存活
- ✅ NPC 净增长 5（出生 69 > 死亡 64）
- ✅ 无 NaN/Error 抛出
- ✅ 平均真气 50 天 217 → 3000 天 21326（健康）

## 6. 备份

调优前的 4 个 JSON 已备份到 `docs/balance/backup/pre-tuning-v1-*.json`：
- `pre-tuning-v1-faction-actions.json`
- `pre-tuning-v1-emotion.json`
- `pre-tuning-v1-obsession.json`
- `pre-tuning-v1-cultivation.json`

如需回滚：`cp docs/balance/backup/pre-tuning-v1-*.json apps/game/data/{actions,balance}/` 对应文件。

## 7. v2 调优计划

| 优先级 | 任务 | 时间 | 收益 |
|--------|------|------|------|
| 🟢 高 | 修 `faction_attack` executor 让致死写 `killerFactionId`/`cause='slain'`，并在 `acquired.revange` 加 `memoryType: attacked` 规则 | 4h | 复仇 PvP 0 → X |
| 🟢 高 | 给 `act_defend` 加 `borderThreat >= 0` 前置 | 1h | defend 占比 60% → 30% |
| 🟡 中 | 修 simulate-analysis.mjs 跟踪"历史最大心魔" | 1h | 修复统计 bug |
| 🟡 中 | 灵根分布微调：heaven 1→3, dual 9→15 | 0.5h | 3000 天见 1-2 次破境 |
| 🟡 中 | 修 `npc-actions.json` 让 NPC 接取猎妖前自检战力 vs 目标妖等阶 | 2h | 猎妖失败率 50% → 30% |
| 🟢 高 | （结构性）拆分 tick-manager / npc-actions 4 个热点子系统 | 1-2d | 降低 P2 模块膨胀风险 |

## 8. 结论

**v1 是成功的"最小变更调优"** —— 仅改 4 个 JSON 就触发了 3 项质变（攻伐、贸易、新死因）。杠杆最大的是 `act_attack` 移除 `hasAdjacentEnemy` precondition（攻伐 0→775）。

**v2 重点**：补完复仇链路（结构改动）+ 进一步降 defend 占比 + 修统计 bug。

调优应**分批做**，每批有明确预期 KPI，跑完对照再决定下一步。v1 证明了这条路是对的。
