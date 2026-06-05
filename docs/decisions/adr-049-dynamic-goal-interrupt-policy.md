# ADR-049：动态世界事件、动态目标与打断策略

> 最后更新：2026-06-05  
> 状态：已采纳并实施  
> 来源：当前代码 `world-event.js`、`event-awareness.js`、`dynamic-goals.js`、`interrupt-policy.js` 与 `dynamic-events.json` / `dynamic-goals.json`

## 背景

NPC 的长期需求适合表达稳定动机，例如修炼、疗伤、任务、贡献、资源和关系维护；但秘境开启、宗门大比、高手陨落、关系伤亡这类事件具有时间窗口，不适合继续塞进常驻 `npc-needs.json`。

如果把所有事件目标都做成常驻需求，会导致需求表膨胀，也会让 GOAP 负担“什么时候该打断当前行为”的判断。当前四层 AI 已经把职责拆开：Reaction 处理即时刺激，Utility/Intent 负责选目标，GOAP 只规划路径，Execution 负责执行。

## 决策

采用 `WorldEventSystem + EventAwareness + DynamicGoalProvider + InterruptPolicy`：

- `WorldEventSystem` 表达世界事件生命周期：`scheduled`、`announced`、`active`、`resolved`、`expired`。
- `EventAwareness` 记录 NPC 已知事件快照、可信度、来源、得知日期和忽略冷却。
- `DynamicGoalProvider` 从已知事件临时产出 `GoalSource.DYNAMIC` 目标。
- `InterruptPolicy` 判断动态目标是否打断当前行为，只输出决策，不执行行为。
- GOAP 仍只回答“如何达成目标”，不承担事件生命周期和打断语义。

## 数据

- `apps/game/data/world/dynamic-events.json`：动态事件配置，默认 `enabled=false`。
- `apps/game/data/goals/dynamic-goals.json`：事件阶段到动态 Goal 的映射，默认 `enabled=false`。
- `apps/game/data/actions/npc-actions.json`：动态事件行为 `act_npc_prepare_dynamic_event`、`act_npc_join_dynamic_event`。

## 代码接缝

| 文件 | 职责 |
|------|------|
| `apps/game/js/engine/world/world-event.js` | 动态世界事件生命周期、可见窗口、参与/准备标记 |
| `apps/game/js/engine/npc/event-awareness.js` | NPC 已知事件表 |
| `apps/game/js/engine/npc/dynamic-goals.js` | 已知事件 → 动态 Goal |
| `apps/game/js/engine/npc/interrupt-policy.js` | `interrupt_now` / `after_step` / `keep_current_queue` / `ignore` |
| `apps/game/js/engine/world/services/world-context-builder.js` | 暴露动态事件查询、准备、参与接口 |
| `apps/game/js/engine/npc/npc-entity.js` | 同步事件感知、收集动态目标、应用打断策略 |
| `apps/game/js/engine/npc/actions/dynamic-event-actions.js` | 准备事件、参与事件的通用行为执行器 |

## 行为边界

- Reaction 仍处理生死级即时刺激，如被攻击、濒死逃命、回血、反击。
- Dynamic Goal 处理“有时间窗口的事件目标”，如筹备秘境、进入秘境、参加大比、争夺高手遗泽。
- 关系伤亡可生成动态目标，但是否转成长期复仇仍由记忆/执念/关系系统决定。
- 动态事件和动态目标默认关闭；开启后应观察真实模拟中是否产生预期行为。

## 后果

好处：

- 长期需求保持干净，只表达稳定动机。
- 事件窗口、未来准备和打断策略成为独立机制，可继续扩展。
- GOAP 职责保持纯粹，避免把时间窗口和中断逻辑写入规划器。

代价：

- 动态事件相关数据需要同时维护 `dynamic-events.json`、`dynamic-goals.json` 和 NPC 行为模板。
- 新事件类型要补齐事件可见性、目标状态、行为执行器和验证脚本。

## 验证

已存在以下脚本覆盖动态事件最小闭环：

- `apps/game/tools/test-dynamic-event-system.mjs`
- `apps/game/tools/test-dynamic-goals.mjs`
- `apps/game/tools/test-interrupt-policy.mjs`
- `apps/game/tools/test-dynamic-event-actions.mjs`

后续开启动态目标参与平衡时，需要补充真实多种子长程模拟观察：动态目标出现次数、准备/参与次数、打断次数、事件完成结果、是否扰乱基础生存和修炼节奏。
