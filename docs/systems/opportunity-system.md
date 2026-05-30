# 系统设计：信息传播与机会点系统

> 最后更新：2026-05-30
>
> 架构决策见 ADR-024。本文描述运行时实现与数据配置。

## 概述

为修仙世界构建「事件 → 消息 → 传播 → 机会 → 决策 → 行动」闭环。世界事件不再被瞬间全知，而是以消息形式逐步扩散；NPC 基于已知消息关联"机会点"并理性决定是否前往，产生群体涌向热点的涌现现象。

```mermaid
flowchart LR
  EV[世界事件] --> NEWS[WorldNews]
  NEWS --> PROP[多渠道传播]
  PROP --> KNOW[NPC._knownNews]
  KNOW --> OPP[关联 WorldOpportunity]
  OPP --> UTIL[Utility 评估 收益-风险]
  UTIL --> GOAL[GoalSource.OPPORTUNITY]
  GOAL --> GOAP[GOAP 规划]
  GOAP --> TARGET[targetResolver: nearest_opportunity]
  TARGET --> ACT[act_npc_goto_opportunity 结算]
```

## 运行时组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `WorldNews` / `InfoPropagationSystem` | `js/engine/world/info-propagation.js` | 消息载体；半径扩散、可信度衰减、过期、写入 NPC 知晓 |
| `WorldOpportunity` / `OpportunitySystem` | `js/engine/world/opportunity.js` | 机会点；坐标/价值/过期/参与上限 |
| 多渠道传播 / 怀璧逻辑 | `js/engine/npc/info-actions.js` | exchangeNews / syncSectNews / syncGuildNews / broadcastTownNews / 觊觎抢夺 |
| 编排 | `js/engine/world/tick-manager.js` `_tickInfoSystems` | 事件→消息+机会、渠道传播、怀璧其罪、系统 tick |
| 决策接入 | `npc-entity.js` `_buildOpportunityGoal`、`tick-manager.js` `_bestOpportunityFor` | 已知消息→机会点→打分→Goal |

## 数据配置

### data/world/news.json

- `enabled`：总开关（默认 false 零漂移）。
- `newsTypes.<type>`：importance / spreadSpeed / maxRadius / baseReliability / decayRate / ttlDays。
- `channels`：radius / oral / town / sect / guild 各自开关与参数。
- `defaultBeliefThreshold`：可信度低于此值的消息被忽略。

### data/world/opportunities.json

- `enabled`：总开关。
- `types.<type>`：value / lifespanDays / maxClaims / rewardSource（reward.json 键）/ riskKey（risk.json 键）。
- `decision`：minScore（生成 Goal 的最低分）/ distanceCostPerTile / goalPriority。

### data/balance/reward.json

新增 `opportunity_corpse` / `opportunity_secret_realm` / `opportunity_auction` / `opportunity_treasure` 掉落表，outcome 带 `itemId`/`qty` 时发放真实物品（ADR-025）。

## 传播渠道

| 渠道 | 触发 | 可信度 |
|------|------|--------|
| 天地异象 radius | 每天扩散，覆盖到 NPC 坐标 | 随距离/时间衰减 |
| 口耳相传 oral | 相遇（距离<meetDistance） | 转述按 reliabilityDecay 衰减 |
| 城镇广播 town | 进入机构 HQ | 渠道固定值 |
| 宗门情报网 sect | 同 factionId 周期同步 | 较高 |
| 商会情报网 guild | 商会/王朝跨地同步 | 中高 |

## 决策与结算

- `_bestOpportunityFor`：score = `value × reliability × winFactor − dist × distanceCostPerTile`，winFactor 由战力近似（弱者对险地折损更大）。
- `act_npc_goto_opportunity`：`targetResolver: nearest_opportunity` 解析机会点坐标；`NPCGotoOpportunityExecutor` 按 rewardSource 发放真实物品、按 riskKey 结算风险，标记 `claimedBy`。
- 怀璧其罪机会点（wealth_target）不走通用前往，由 `_tickCovet` 处理抢夺/放过（见 item-covet.md）。

## 可视化

`getWorldSnapshot().opportunities` 暴露机会点；`simulation-renderer.js` 以金色菱形标注，颜色按类型区分（秘境紫/尸骸橙红/拍卖金/天材青绿/怀璧洋红）。

## 验证

- `node tools/test-info-propagation.mjs`：单元 + 集成 + 零漂移。
- `INFO_ACTIVE=1 node tools/simulate-analysis.mjs`：长周期观测涌现。
- 禁用态：`test-goal-equivalence` 主路径零漂移。
