# 系统设计：信息传播与机会点系统

> 最后更新：2026-06-05  
> 架构决策：ADR-024、ADR-025、ADR-049

## 概述

信息传播与机会点系统负责把世界事件变成“有人知道、有人误判、有人赶去”的叙事热点。

```mermaid
flowchart LR
  EV["事件/暴露/动态事件"] --> NEWS["WorldNews"]
  NEWS --> PROP["半径/口耳/城镇/宗门/商会传播"]
  PROP --> KNOW["NPC 已知消息"]
  KNOW --> OPP["WorldOpportunity"]
  OPP --> UTIL["Utility 收益-风险评估"]
  UTIL --> GOAL["GoalSource.OPPORTUNITY"]
  GOAL --> ACT["act_npc_goto_opportunity"]
```

## 运行时组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `InfoPropagationSystem` | `engine/world/info-propagation.js` | 消息扩散、可信度衰减、过期、写入 NPC 知晓 |
| `OpportunitySystem` | `engine/world/opportunity.js` | 机会点坐标、价值、过期、参与记录 |
| `InfoCoordinator` | `engine/world/services/info-coordinator.js` | 编排消息、机会点、怀璧其罪和动态事件传播 |
| `NPCInfoActions` | `engine/npc/info-actions.js` | 交换消息、同步宗门/城镇/商会情报 |
| `NPCGotoOpportunityExecutor` | `engine/npc/actions/*` | 前往机会点并结算收益/风险 |

## 数据配置

| 文件 | 说明 |
|------|------|
| `apps/game/data/world/news.json` | 消息类型、传播渠道、可信度、TTL |
| `apps/game/data/world/opportunities.json` | 机会点类型、价值、寿命、参与上限、奖励来源、风险键 |
| `apps/game/data/balance/reward.json` | 机会点收益分布 |
| `apps/game/data/balance/risk.json` | 机会点风险 |
| `apps/game/data/world/dynamic-events.json` | 可预告/开启/结算的动态世界事件 |

## 决策与结算

- `_bestOpportunityFor` 以价值、可信度、距离、战力和风险折算机会吸引力。
- `GoalSource.OPPORTUNITY` 进入 Utility/GOAP，与需求、执念、关系目标并列。
- `act_npc_goto_opportunity` 通过 `nearest_opportunity` 定位目标。
- 怀璧其罪产生的 `wealth_target` 不走通用前往，而由怀璧逻辑单独处理抢夺/放过。

## 验证

- `node tools/test-info-propagation.mjs`
- `node tools/simulate-analysis.mjs <days>`
- 启用相关开关后，观察消息扩散、机会点参与、抢夺/放过、NPC 死亡和收益分布。
