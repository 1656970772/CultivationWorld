# 数据模型：核心 NPC

> 最后更新：2026-05-27

## 结构

```javascript
NPC {
  id: string,                 // 唯一标识
  name: string,               // 名称
  factionId: string,          // 所属势力 ID
  role: string,               // leader / heir / elder / general / officer / core_disciple
  rankId: string,             // 引用 apps/game/data/definitions/ranks.json 的境界或职位 ID
  personality: {
    ambition: number,         // 野心 0-100，高→倾向扩张
    caution: number,          // 谨慎 0-100，高→倾向防守
    loyalty: number,          // 忠诚 0-100，低→可能叛变
    diplomacy: number         // 外交 0-100，高→倾向结盟
  },
  alive: boolean,             // 是否存活
  ageDays: number,            // 当前年龄（天，1 年 = 360 天）
  ageYears: number,           // 当前年龄（年，展示与报告用）
  maxAgeDays: number,         // 寿元上限（天）
  maxAgeYears: number,        // 寿元上限（年）
  rankName: string,           // 运行时由 ranks.json 补齐的显示名
  lifespanBucket: string,     // 寿元桶 ID
  lifespanBucketName: string, // 寿元桶显示名
}
```

## 双层人口模型

`resources.disciples` 继续表示势力总体弟子、军队或妖众规模。`npcs.json` 只保存具名核心人物，用于掌门继任、事件对象、伤亡统计、日志叙事和未来玩家交互。

每个势力的具名 NPC 数量包含掌门本人，并且不得超过 20 人。

| 势力规模 | 判定依据 | 具名 NPC 数量 |
|----------|----------|---------------|
| 大势力 | `resources.disciples >= 500` | 16 人 |
| 中势力 | `resources.disciples >= 150` 且 `< 500` | 10 人 |
| 小势力 | `resources.disciples < 150` | 7 人 |

## 角色枚举

| role | 含义 | 第一阶段用途 |
|------|------|--------------|
| `leader` | 掌门、皇帝、族长等最高决策者 | 每日势力 AI 决策 |
| `heir` | 明确继承人 | 掌门继任最高优先级 |
| `elder` | 长老、太师、国师等核心高层 | 继任候选与事件对象 |
| `general` | 战斗将领或军事负责人 | 继任候选与战争事件对象 |
| `officer` | 执事、官员、情报/后勤负责人 | 继任候选与事件对象 |
| `core_disciple` | 亲传、核心弟子、重要成员 | 低优先级继任候选与事件对象 |

## 性格维度说明

| 维度 | 低值表现 | 高值表现 |
|------|---------|---------|
| ambition | 安于现状，倾向发展 | 野心勃勃，倾向扩张和攻伐 |
| caution | 冒进，容易发动战争 | 谨慎，只在有把握时行动 |
| loyalty | 可能叛变或投敌 | 忠心耿耿，绝不背叛 |
| diplomacy | 独来独往，不善交际 | 善于外交，倾向结盟 |

## NPC 对势力的影响

第一阶段只有 `role: "leader"` 的 NPC 直接驱动所属势力每天的行为决策。其他核心 NPC 不独立日常行动，先用于继任、伤亡、事件对象和模拟报告。

## 寿元与自然死亡

NPC 原始数据可以不手填年龄字段。`WorldEngine.initNPCs()` 会在初始化时读取 `apps/game/data/definitions/ranks.json` 与 `apps/game/data/behaviors/npc-lifecycle.json`，根据 `rankId` 和可复现 RNG 自动补齐 `rankName`、`ageDays`、`ageYears`、`maxAgeDays`、`maxAgeYears` 与 `lifespanBucket`。

| rankId / 桶 | 寿元上限 |
|----------|----------|
| 凡人、弟子、谋士、将军、统领、宗师、武圣 | 80 年 ± 20 年 |
| 炼气 | 140 年 ± 40 年 |
| 筑基 | 230 年 ± 30 年 |
| 金丹 / 结丹 | 550 年 ± 50 年 |
| 元婴 | 1250 年 ± 250 年 |
| 化神 | 2000 年 ± 300 年 |

上表来自 `apps/game/data/definitions/ranks.json`。自然死亡只在 `ageDays >= maxAgeDays * 0.95` 后开始判定。达到寿元上限时，当天死亡概率为 `1`。详细规则见 `docs/worldbuilding/wiki/rules/natural-death.md`。

## 掌门更替

- 掌门死亡 → 优先从本势力存活核心 NPC 中继任
- 继任优先级：`heir` → `elder` → `general/officer` → `core_disciple`
- 同级候选按 `ranks.json` 的 `successionScore` 与 `loyalty` 排序
- 无存活候选时不生成新掌门，势力标记为 `destroyed`，领地转为无主地
