# 数据模型：NPC

> 最后更新：2026-06-05  
> 数据来源：`apps/game/data/entities/npcs.json`

## 当前规模

当前初始 NPC 为 152 个。运行时可通过婚配生育生成新 NPC。

## 初始结构

```javascript
NPC {
  id: string,
  name: string,
  factionId?: string,
  role: string,
  rankId: string,
  gender: "male" | "female",
  personality: {
    ambition: number,
    caution: number,
    loyalty: number,
    diplomacy: number,
    courage?: number,
    justice?: number
  },
  alive: boolean,
  techniqueId?: string
}
```

## 运行时状态

`NPCEntity` 初始化时会补齐：

- 年龄、寿元、自然死亡参数。
- 修炼进度、真气、突破进度、灵根、体质。
- HP、maxHp、攻击、防御、伤势。
- 空间坐标、移动目标、行为生命周期。
- 背包、装备、物品效果和能力组件。
- 记忆、情绪、执念、关系图兼容视图。
- 事件感知、动态目标和打断状态。

## 角色

| role | 说明 |
|------|------|
| `leader` | 掌门、皇帝、族长、组织首领 |
| `heir` | 继承人 |
| `elder` | 长老、高层 |
| `general` | 战斗将领 |
| `officer` | 执事、官员、功能负责人 |
| `core_disciple` | 核心弟子 |
| `disciple` / `outer_disciple` | 普通/外门弟子 |
| `wanderer` | 散修 |

## 性格

| 维度 | 影响 |
|------|------|
| `ambition` | 晋升、夺权、夺宝、探索收益偏好 |
| `caution` | 风险厌恶、生存倾向、打断策略 |
| `loyalty` | 宗门忠诚、叛投/死战倾向 |
| `diplomacy` | 结盟、人情、放过他人倾向 |
| `courage` | 游历、战斗、冒险和上头倾向 |
| `justice` | 放过、报恩、正义倾向；部分逻辑仍在扩展 |

## AI 接入

NPC 每 tick 通过行为树推进：

1. `onPreTick` 更新生命周期、状态、记忆、情绪、执念。
2. Reaction 层消费被攻击等刺激。
3. Intent/Utility 收集需求、执念、关系、机会点、动态事件目标。
4. GOAP 规划行为链。
5. Execution 处理移动、耗时、结算、重规划。

相关文档：`docs/systems/behavior-tree.md`、`docs/decisions/adr-048-four-layer-reactive-ai.md`、`docs/decisions/adr-049-dynamic-goal-interrupt-policy.md`。
