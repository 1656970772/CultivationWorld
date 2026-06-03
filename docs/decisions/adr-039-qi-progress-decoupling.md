# ADR-039：真气-进度解耦（修复"进度满但真气不足"卡境界死锁）

最后更新：2026-06-02

状态：已实现（节奏数值随 ADR-040 再校准）

## 背景

用户验证"高天赋低境界天才能否一步步修炼上去"时，发现卡死：天才闭关把 `cultivationProgress`
修满了，却**始终无法突破**，且**不去兑换/服用聚气丹**，长期原地踏步直至寿尽或被妖兽所杀。

排查根因：

1. **突破缺少真气维度**：突破判定只看进度，未把"真气积累到下一境界门槛"作为硬约束；而世界观
   （参考凡人修仙传）里真气是修炼的核心——修炼时给得多、不修炼做其他事也自然涨但很慢、灵石/丹药能加。
2. **聚气丹链不可达**：`act_npc_use_qi_pill` 带 `totalProgress < 1.0` 前置，进度满后该行为
   被规划器永久剪掉，AI 再也不会服丹补真气 → 真气永远不足 → 死锁。
3. **修炼需求未含真气项**：`need_npc_cultivation` 的 goalState 只要求进度满，AI 认为目标已达成。

## 决策

引入"真气"作为与进度并列的突破硬约束，并打通聚气丹链。

### 一、派生状态 `qiBelowNextRank`

`npc-entity.js`：

- `_isQiBelowNextRankRequirement()`：读下一境界 `qiRequired`，比较当前 `qi` 是否不足；
- `buildGOAPState()` 暴露 `flat.qiBelowNextRank`，供 GOAP 前置/目标与行为效果使用。

### 二、真气产出三来源

`cultivation.json` + `npc-entity.js`：

- **修炼时大量给**：`NPCCultivateExecutor.run` 按本次进度增量 × `qiPerProgress[rank]` 折算真气，
  使闭关同时推进进度与真气。
- **被动自然增长（很慢）**：`_passiveQiAbsorb()` 每日 `onPreTick` 给 `passiveQiGain.base[rank]`
  涓流真气，"不修炼做任何事也在涨"。
- **丹药/灵石**：聚气丹（见下）。

### 三、聚气丹链解锁

`npc-actions.json`：

- `act_npc_use_qi_pill` 去掉 `totalProgress < 1.0`，前置改为 `qiBelowNextRank == true`，
  效果 `qiBelowNextRank → false`；`act_npc_redeem_qi_pill` 以真气不足为兑换动机。
  （注：该 `qiBelowNextRank` 服丹限制在 ADR-040 进一步放开为"真气可无限累积"。）

### 四、修炼目标双满

`npc-needs.json` 的 `need_npc_cultivation` goalState 改为
`totalProgress >= 1.0` **且** `qiBelowNextRank == false`，真气与进度同为突破前提。

## 验证

真实模拟（trace 观测真实 NPC）确认：天才在进度满后会主动兑换/服用聚气丹补真气，死锁解除、能够突破。

## 关系

- 暴露出"修炼太快/不游历/真气过早满足"的失衡 → 由 ADR-040 校准节奏。
