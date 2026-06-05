# ADR-036：状态边界钳制与弟子锚定真实 NPC（修地基）

最后更新：2026-06-01

状态：已实现（v6；修复稳定度溢出 + disciples 与真实 NPC 脱钩两个历史 bug，势力覆灭在真实状态下重现）

## 背景

v5（ADR-035）打通了"势力覆灭 0→1"，但迭代中暴露：那次覆灭是建立在 **bug 之上**——靠绕过虚高的稳定度（势力稳定度竟达 3000+，本该 0–100）。进一步排查发现两个相互独立的历史 bug，共同导致"世界不会运行"：

- **病根 A**：`action.js._applyEffects` 处理 `faction-actions.json` 的声明式 `{op:add}` 时**无边界钳制**。势力动作反复 `stability +2~+15` 累加，数千天溢出到 3000+。
- **病根 B**：`disciples`（弟子数）是脱离真实 NPC 的纸面抽象数字，靠每天自增 + 招募/发展声明式 add（同样无上限）堆到**上万**，与真实活 NPC（仅几十）完全脱钩。势力实力挂在这个虚高数字上 → 无论怎么打都死不了。这正是 ADR-034 P1 / ADR-035 反复点出的"未解结构问题"。

用户（2026-06-01）确认 v6 顺势把 disciples 膨胀一并修掉，让势力实力能反映真实人口、能被真正削弱。

## 决策

### 一、effect 数据驱动边界（修 A）

`_applyEffects` 的 `op:add/multiply/set/max/min` 结算后，若 effect 声明了 `min`/`max` 则钳制数值结果；缺省不限。这是通用的、数据驱动的边界机制——给"有界字段"（如 stability=[0,100]）配边界，不影响 disciples/food/qi 等其他 key（开闭原则）。

并补两道防线：`FactionState` 初始 stability 钳 `[0,100]`（防配置脏值/历史溢出值带入）；`quest-rewards` 的 `maxStability` 默认 105 → 100。

### 二、disciples 锚定真实活 NPC（修 B）

弟子上限从"固定/领地容量"改为 `min(领地容量, 真实活 NPC × discipleNpcRatio)`；当纸面弟子虚高（真实 NPC 撑不起）时，按 `discipleRegressRate` 每天缓慢流失。

效果：真实 NPC 多的势力弟子维持高位（强）；真实 NPC 凋零的势力弟子随之回落（弱）→ 可被攻灭。纸面实力终于反映真实人口。先用声明式 `disciples add` 的 `max:500` 止血防无限堆积，再用 world-rules 的 NPC 锚定上限做根本约束。

## 设计模式映射

- **数据驱动 + 开闭原则**：边界（effect min/max）、锚定系数（economy.discipleNpcRatio 等）全部配置化，调参不改核心代码。
- **单一真相源**：disciples 上限锚定真实活 NPC，消除"抽象资源 vs 真实实体"的双轨脱钩。
- **治本优于治标**：v5 用相对信号"绕过"虚高稳定度；v6 直接修溢出与脱钩根因，让 v5 机制建立在可信地基上。

## 数据与接口

- 改 `js/engine/abstract/action.js`：`_applyEffects` 支持 effect 可选 `min`/`max`。
- 改 `data/actions/faction-actions.json`：6 处 stability effect 补 `min:0/max:100`；4 处 disciples effect 补 `max:500`。
- 改 `js/engine/faction/faction-state.js`：初始 stability 钳 `[0,100]`。
- 改 `js/engine/npc/quest-rewards.js`：maxStability 默认 105 → 100。
- 改 `js/engine/world/world-rules.js`：弟子上限锚定真实活 NPC + 超额回归；预计算每势力活 NPC 数。
- 改 `data/balance/economy.json`：新增 `discipleNpcRatio:25` / `discipleRegressRate:3` / `discipleFloor:0`。
- 备份 `历史备份（已清理）：pre-tuning-v6-*`。不改任何对外 API 签名。

## 后果

- 稳定度回到 `[0,100]`（3145 → 100）；disciples 锚定真实 NPC（上万 → 0~500 健康差异化）。
- 势力覆灭在**真实健康状态下**重现（万妖山，0→1），不再依赖 bug 绕过。
- 势力实力梯度真实反映人口分布——世界"实力反映真实"的关键。
- 全程数据驱动可回退；GOAP 旧摘要回归 `5740e12a` 默认关闭不改变既有行为；回归测试通过。

## 验证

- 2000 天冒烟 ×2：修 A 后稳定度 3145 → ≤101（再修 quest-rewards 后 ≤100）；修 B 后 disciples 上万 → 0~500 差异化、覆灭重现。
- 5000 天定稿：稳定度 70~100，disciples 0~500，势力覆灭 1，末态存活 NPC 48，出生 75，突破 89。
- GOAP 旧摘要回归 `5740e12a` 默认关闭不改变既有行为；回归通过（goal-equivalence / revenge / relationship-goals / monster-resource-loop）。
- 详见 `ADR-036`。

## 未解问题（v7）

- 覆灭数仍偏少（1）——可调低 discipleNpcRatio 或微调 v5 危机判据，产生更多兼并/易主。
- 稳定度崩溃路径未激活（现稳定 70~100）——可让持续挨打/缺俸更狠地压稳定度，激活 v5 投降判据。
- 降众消化（同化/猜忌/反叛）、复仇 PvP 击杀偏低（与 ADR-034/035 同列）。

## 相关

- ADR-035（势力凝聚力与危亡抉择 —— v5 覆灭建立在本 ADR 修复的地基之上才扎实）。
- ADR-034（人口可持续 —— 本 ADR 修掉了它点出的"抽象资源脱钩"未解问题）。
- ADR-033（自迭代优化流程）+ `docs/balance/simulation-iteration-process.md`。

