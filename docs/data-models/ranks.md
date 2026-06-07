# 数据模型：境界表

> 最后更新：2026-06-07

## 定位

`apps/game/data/definitions/ranks.json` 是 NPC 运行时修仙境界、突破门槛、寿元桶和继任评分的静态配置表。`rankId` 只表示修仙境界，不承载宗门职位、凡人王朝头衔或武道头衔。

职位由 `npcs.json` 的 `role` 字段表示；掌门、长老、核心弟子、将领、执事等都是社会身份，不进入 `ranks.json`。

## 结构

```javascript
Rank {
  id: string,
  name: string,
  category: 'mortal' | 'cultivation',
  order: number,
  successionScore: number,
  cultivationRequired: number,
  qiRequired: number,
  lifespan: {
    bucketId: string,
    bucketName: string,
    baseYears: number,
    varianceYears: number
  },
  aliases: string[]
}
```

`cultivationRequired` 与 `qiRequired` 必须相等。运行时突破同时检查 `totalCultivation`、最低闭关修为占比和 `qi`；不再使用旧比例进度字段。

## 运行时主链

当前 `rankId` 恰好允许 12 个：

| 顺序 | rankId | 名称 | 门槛 | 寿元桶 | 最大寿元 |
|---:|---|---|---:|---:|---:|
| 0 | `mortal` | 凡人 | 0 | 80 + 20 | 100 |
| 20 | `qi_refining` | 炼气 | 50 | 125 + 25 | 150 |
| 40 | `foundation_building` | 筑基 | 500 | 320 + 60 | 380 |
| 60 | `golden_core` | 金丹 | 5,000 | 750 + 150 | 900 |
| 80 | `nascent_soul` | 元婴 | 50,000 | 1,500 + 300 | 1,800 |
| 100 | `spirit_transformation` | 化神 | 500,000 | 2,200 + 300 | 2,500 |
| 120 | `void_refining` | 炼虚 | 1,000,000 | 2,850 + 350 | 3,200 |
| 140 | `body_integration` | 合体 | 2,000,000 | 3,400 + 400 | 3,800 |
| 160 | `mahayana` | 大乘 | 4,000,000 | 3,900 + 400 | 4,300 |
| 180 | `tribulation` | 渡劫 | 8,000,000 | 4,350 + 350 | 4,700 |
| 200 | `earth_immortal` | 地仙 | 16,000,000 | 4,650 + 250 | 4,900 |
| 220 | `heaven_immortal` | 天仙 | 32,000,000 | 4,850 + 149 | 4,999 |

`spirit_transformation` 固定表示化神并保持第六档。`great_luo_heaven_immortal` 与 `dao_ancestor` 不是运行时境界 ID。

## 运行时规则

- `npcs.json` 不再保存中文 `rank`，只保存 `rankId`。
- `disciple`、`outer_disciple`、`core_disciple`、`elder`、`leader`、`general`、`officer` 等是 `role`，不得作为 `rankId`。
- `WorldEngine.initNPCs()` 用 `rankId` 查询 `ranks.json`，补齐 `rankName`、`lifespanBucket`、`maxAgeYears/maxAgeDays` 等运行时字段。
- 掌门继任先按 `role` 候选范围筛选，再在同角色候选中使用 `successionScore` 排序。
- 运行时小层 `rankStage` 由 `totalCultivation / nextCultivationRequired` 派生，阈值来自 `apps/game/data/balance/cultivation.json` 的 `stageThresholds`。
- 天仙为当前顶级；顶级无下一境界时，GOAP 派生的 `nextCultivationRequired` 为 0，不能制造假突破。

## 表内唯一 ID

每张静态表只要求本表内唯一 ID，不要求全局唯一。当前 `factions.json`、`npcs.json`、`rules.json`、`ranks.json` 使用 `id` 作为主键；`events.json`、`modifiers.json`、`terrains.json` 已补充 `id`，并暂时保留 `type` 作为运行时分类字段。
