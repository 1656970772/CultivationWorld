# 数据模型：信息传播（InfoPropagation）

> 最后更新：2026-05-30
>
> **状态：已实现**（ADR-024）。运行时实体为 `WorldNews`（`js/engine/world/info-propagation.js`），
> 参数见 `data/world/news.json`。下文 `InfoEvent` 为早期设计名，运行时对应 `WorldNews`，
> 主要差异：`knownBy`（势力级）已升级为写入每个 NPC 的 `_knownNews`（NPC 级，带个体可信度）；
> 新增多渠道传播（口耳/城镇/宗门/商会）与机会点关联（`opportunityId`）。详见 ADR-024。

## 结构

```javascript
InfoEvent {
  id: string,                     // 事件唯一 ID
  content: string,                // 事件描述文本
  origin: { x: number, y: number }, // 事件发生地坐标
  day: number,                    // 发生日
  spreadRadius: number,           // 当前传播半径（每天增长）
  spreadSpeed: number,            // 每天传播的格数
  maxRadius: number,              // 最大传播半径
  reliability: number,            // 基础可信度 0-1
  knownBy: string[]               // 已知晓的势力 ID 列表
}
```

## 传播规则

1. 每天世界 Tick 时，所有信息事件的 `spreadRadius += spreadSpeed`
2. 传播范围覆盖到某个势力领地时，该势力加入 `knownBy`（影响其 AI 决策）
3. 传播范围覆盖到玩家位置时，玩家日志收到消息

## 可信度衰减

```
显示可信度 = 基础可信度 × (1 - 传播距离 / 最大传播距离)
```

- 可信度 > 0.7 → 显示为"确认：xxx已被证实"
- 可信度 0.3 ~ 0.7 → 显示为"消息：xxx"
- 可信度 < 0.3 → 显示为"传闻：听说xxx..."

## 传播效果

信息传播机制产生的涌现行为：
- **谣言** —— 低可信度信息可能不准确
- **误判** —— 势力基于不完整信息做出错误决策
- **偷袭** —— 信息还没传开时发动攻击
- **恐慌** —— 坏消息传播引起连锁反应

## 第一版简化

第一版核心是"事件有传播半径"，已经足以产生信息不对称的效果。

## 实现现状（ADR-024）

- 运行时 `WorldNews` 在 `data/world/news.json enabled=true` 时由事件源（妖王陨落/秘境开启/宗门大战/怀璧暴露）发布。
- 传播由 `InfoPropagationSystem.tick`（半径）+ `TickManager._propagateChannels`（口耳/城镇/宗门/商会）驱动。
- NPC 知晓写入 `npc._knownNews: Map<newsId, {reliability, value, opportunityId, subjectId, tickKnown}>`。
- 知晓后经 `_bestOpportunityFor` 关联机会点并参与 Utility 决策（ADR-024 决策层）。
- 默认 `enabled=false` 时整套系统静默，保护既有 golden 摘要。

