# 2026-06-01 平衡调优迭代 v6 验证报告

> 状态：v6（修地基——稳定度溢出 bug + disciples 膨胀脱钩）已实现 + 2000 天冒烟 ×2 + 5000 天定稿验证
> 关联：
> - 迭代流程 `docs/balance/simulation-iteration-process.md`（ADR-033）
> - 上一轮 `docs/balance/tuning-2026-06-01-v5-result.md`
> - 决策 `docs/decisions/adr-036-state-bounds-and-disciple-anchoring.md`
> - 备份 `docs/balance/backup/pre-tuning-v6-*`

## 1. 一句话结论

**v6 修掉了世界"不会运行"的两个地基 bug，并打通了 ADR-034/035 一直绕不过去的"抽象资源脱钩"病根。** 稳定度从溢出的 **3145 → 回到 ≤100**；势力弟子从堆积的**上万 → 锚定真实活 NPC（0~500 健康差异化）**。结果是势力覆灭在**真实健康状态下**自然重现（万妖山，0→1）——不再像 v5 那样靠"绕过虚高稳定度"才勉强覆灭。

## 2. 两个根因（均为历史 bug，非 v5 引入）

### 病根 A：声明式 `op:add` 无边界 → 稳定度溢出
`action.js` 的 `_applyEffects` 处理 `faction-actions.json` 的声明式 `{ "op": "add" }` 时**不做任何钳制**。势力动作反复 `stability +2~+15`，数千天累加 → 稳定度涨到 **3000+**（本该 0–100）。导致 v5 的"稳定度崩溃→投降/危机"判据形同虚设，只能用相对信号绕过。

### 病根 B：disciples 与真实活 NPC 脱钩 → 势力永不可覆灭
弟子数 `disciples` 是个纸面抽象数字：靠每天自增 + 招募/发展/会盟等声明式 add（同样无上限）堆到**上万**，与真实活 NPC（仅几十）完全无关。势力实力挂在这个虚高数字上 → **无论怎么打都死不了**。这正是 ADR-034 P1 与 ADR-035 反复点出的"未解结构问题"。

## 3. v6 改动

### 修 A：effect 支持数据驱动边界
- `js/engine/abstract/action.js` → `_applyEffects`：`op:add/multiply/set/max/min` 结算后，若 effect 声明了 `min`/`max` 则钳制数值结果（缺省不限，不影响其他 key）。
- `data/actions/faction-actions.json`：6 处 `stability` effect 补 `"min":0,"max":100`。
- `js/engine/faction/faction-state.js`：初始 stability 钳到 `[0,100]`，防配置脏值。
- `js/engine/npc/quest-rewards.js`：`maxStability` 默认 105 → 100。

### 修 B：disciples 锚定真实活 NPC
- `data/actions/faction-actions.json`：4 处 `disciples` 声明式 add（develop/recruit/host/formation）补 `"max":500`，先止血防无限堆积。
- `js/engine/world/world-rules.js`：弟子上限改为 `min(领地容量, 真实活 NPC × discipleNpcRatio)`；纸面弟子虚高（真实 NPC 撑不起）时按 `discipleRegressRate` 每天缓慢流失。预计算每势力真实活 NPC 数（一次遍历）。
- `data/balance/economy.json`：新增 `discipleNpcRatio: 25` / `discipleRegressRate: 3` / `discipleFloor: 0`。

## 4. KPI 对比（5000 天全激活态）

| 指标 | v4 | v5 | **v6** | 评价 |
|------|----|----|----|------|
| 势力稳定度 max | 3000+（bug） | 3000+（bug） | **100** | 🟢 **bug 修复** |
| 势力 disciples | 上万 | 上万 | **0~500 差异化** | 🟢 **锚定真实 NPC** |
| 势力覆灭 | 0 | 1（绕过虚高） | **1（真实状态）** | 🟢 扎实重现 |
| 末态存活 NPC | 54 | 51 | 48 | 🟡 |
| 出生 | 64 | 82 | 75 | 🟢 |
| 突破成功 | 62 | 94 | 89 | 🟢 |
| 攻伐 | 17526 | 18130 | 16390 | 持平 |

### disciples 分布（5000 天末态，18 势力）

```
0, 96, 105, 107, 108, 110, 125, 180, 277, 395, 407, 483, 499, 500, 500, 500, 500, 500
```

> 从"全部上万" → 真实差异化：万妖山真实 NPC 凋零 → 弟子回落到 0 → 被攻灭；其余势力按真实人口呈梯度分布。这是世界"实力反映真实"的关键证据。

## 5. 验收对照

- [x] 稳定度回到 `[0,100]`（3145 → 100）✅
- [x] disciples 锚定真实活 NPC（上万 → 0~500 差异化）✅
- [x] 势力覆灭在真实健康状态下重现（万妖山）✅
- [x] GOAP 黄金指纹 `5740e12a` 零漂移 ✅
- [x] 回归测试通过（goap-golden / revenge / relationship-goals / monster-resource-loop）✅
- [x] 全部数据驱动（effect min/max + economy 锚定参数）可调可回退 ✅

## 6. 关键洞察

v6 验证了 ADR-033 归因决策树的核心价值：**v5 的"势力覆灭 0→1"其实建立在 bug 之上**（靠绕过虚高稳定度）。只有把地基（稳定度量级、disciples 锚定）修对，覆灭才在真实状态下扎实发生。**先修地基，再谈玩法**——这是本轮最重要的方法论确认。

## 7. 未解 / v7 方向

1. **覆灭数仍偏少（1）**：disciples 已差异化，但其余势力尚未弱到临界。可调低 `discipleNpcRatio`（让上限更紧）或微调 v5 危机判据，产生更多兼并/易主。
2. **稳定度崩溃路径未激活**：稳定度现稳定在 70~100（很健康），v5 的"稳定度崩溃→投降"判据仍难触发。可让持续挨打/缺俸更狠地压稳定度。
3. **降众消化**：投降/叛投后攻方对降众的同化/猜忌/反叛叙事（ADR-035 待扩展）。
4. **复仇 PvP 击杀仍低**：slain 死因 10，复仇执念行动待加强。

## 8. 回滚

```powershell
cp docs/balance/backup/pre-tuning-v6-action.js          apps/game/js/engine/abstract/action.js
cp docs/balance/backup/pre-tuning-v6-faction-actions.json apps/game/data/actions/faction-actions.json
cp docs/balance/backup/pre-tuning-v6-faction-state.js   apps/game/js/engine/faction/faction-state.js
# economy.json / world-rules.js / quest-rewards.js 改动较小，按 git/手动回退
```
