# 重要 NPC 保真度

> 最后更新：2026-06-09

## 为什么需要分层

如果所有远处 NPC 都逐日完整模拟，性能不可控。如果所有远处 NPC 都只做聚合数值，玩家关心的人会失去因果和戏剧性。解决方案是配置化保真等级。

## 保真等级

| 等级 | 对象 | 远处模拟方式 | 日志 |
|---|---|---|---|
| S | 玩家绑定 NPC、剧情包关键 NPC、仇敌、道侣、师徒、宗主、世界级天骄。 | 月内 episode，高优先事件逐条结算，必要时 Warm 日域。 | 详细生涯日志、地点轨迹、对话记忆。 |
| A | 势力领袖、长老、核心弟子、重要商人、事件候选人。 | 月内 3 到 5 个 episode，关键状态真实结算。 | 月志加关键节点。 |
| B | 普通可见 NPC、玩家标记区域内 NPC。 | agenda 聚合，保留主要地点和状态 delta。 | 摘要日志。 |
| C | 背景 NPC、远方普通成员。 | 群体统计和轻量个体 delta。 | 只有重大事件日志。 |

等级由 `NpcFidelityPolicy` 计算，不写死在 NPC id 上。

## 评分因子

| 因子 | 影响 |
|---|---|
| 玩家关系 | 道侣、师徒、仇人、恩人、债务对象提升。 |
| 剧情绑定 | active 或即将触发的剧情包绑定 NPC 提升。 |
| 角色身份 | leader、elder、heir、core_disciple 提升。 |
| 境界和稀有性 | 高境界、特殊体质、稀有功法提升。 |
| 玩家标记 | 玩家追踪、收藏、最近查看提升。 |
| 近期事件 | 刚突破、刚杀人、刚获得宝物、亲友死亡提升。 |
| 空间距离 | 距离玩家越近越高，但重要剧情可覆盖距离。 |

## ImportantNpcProfile

```text
ImportantNpcProfile {
  npcId,
  fidelityTier,
  reasons,
  minEpisodesPerMonth,
  maxEpisodesPerMonth,
  preserveItinerary,
  preserveDialogueMemory,
  promoteToWarmWhenEventActive,
  logVisibility
}
```

## 月内 Episode

重要 NPC 月压缩时不只做总量，而是抽样若干 episode：

| Episode 类型 | 状态变化 |
|---|---|
| `cultivation_breakthrough` | 修为、真气、突破、伤势、寿元压力。 |
| `quest_or_hunt` | 位置、任务、战斗、奖励、材料、死亡风险。 |
| `social_obligation` | 师徒、道侣、同门支援、仇恨、恩义。 |
| `commerce_or_auction` | 购买、出售、债务、财富暴露、机会点。 |
| `drama_package_step` | 剧情包 step、绑定 NPC、动作计数。 |
| `travel_and_encounter` | 去过地点、遭遇事件、传闻。 |

Episode 必须按时间顺序提交 delta。若 NPC 在第 12 天死亡，第 13 到 30 天的 episode 不得继续结算。

## 与玩家相遇

当玩家遇到重要 NPC：

- 读取 `recentEpisodes` 作为对白上下文。
- 可展示 NPC 上月去过的地点、受伤、突破、获得宝物、与某人冲突等信息。
- 若 NPC 当前正被剧情包占用，对话入口优先走剧情包。
- 若 NPC 当前 Job 被玩家打断，按 Job 的 interrupt 策略暂停、恢复或中止。

## 群体与个体平衡

普通 NPC 可以用聚合结果维持世界人口、境界分布和资源流动；重要 NPC 用 episode 维持因果。两者通过同一套状态提交和日志规则收束，避免出现“重要 NPC 真实、普通 NPC 假”的双重系统。

## 配置示例

```json
{
  "tiers": [
    {
      "id": "S",
      "minScore": 100,
      "minEpisodesPerMonth": 6,
      "preserveItinerary": true,
      "preserveDialogueMemory": true
    },
    {
      "id": "A",
      "minScore": 60,
      "minEpisodesPerMonth": 3,
      "preserveItinerary": true
    }
  ],
  "scoreRules": [
    { "id": "player_marked", "condition": { "source": "player", "key": "markedNpc", "op": "true" }, "score": 80 },
    { "id": "drama_bound", "condition": { "source": "drama", "key": "boundToActivePackage", "op": "true" }, "score": 100 },
    { "id": "sect_leader", "condition": { "source": "npc", "key": "role", "op": "eq", "value": "leader" }, "score": 45 }
  ]
}
```

## 验收标准

- 重要 NPC 远离玩家 12 个月后仍有可解释的轨迹和关系变化。
- 玩家追踪重要 NPC 时不会看到突然瞬移或状态断裂。
- 剧情包绑定 NPC 不会被普通聚合覆盖。
- 普通 NPC 的群体统计仍能维持世界运行和性能预算。

