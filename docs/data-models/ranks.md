# 数据模型：境界与职位表

> 最后更新：2026-05-27

## 定位

`apps/game/data/definitions/ranks.json` 是 NPC 境界、凡俗职位与寿元上限的静态配置表。它不放在 `behaviors/` 下，因为境界名称、唯一 ID、寿元基准和继任评分属于世界数据本身；行为配置只描述如何使用这些数据。

## 结构

```javascript
Rank {
  id: string,                 // 本表内唯一 ID，NPC 通过 rankId 引用
  name: string,               // 显示名，如 元婴 / 金丹 / 宗师
  category: string,           // cultivation / martial / mortal_title / mortal
  order: number,              // 世界观层级排序
  successionScore: number,    // 掌门继任同角色候选的境界分数
  lifespan: {
    bucketId: string,         // 寿元桶 ID
    bucketName: string,       // 寿元桶显示名
    baseYears: number,        // 寿元基准年
    varianceYears: number     // 上下浮动年
  },
  aliases: string[]           // 旧名称或同义名，如 结丹 -> 金丹
}
```

## 当前规则

- `npcs.json` 不再保存中文 `rank`，只保存 `rankId`。
- `npc-lifecycle.json` 不再保存 `lifespanByRank` 或 `defaultLifespan`。
- `WorldEngine.initNPCs()` 会用 `rankId` 查询 `ranks.json`，补齐 `rankName`、`lifespanBucket`、`maxAgeYears/maxAgeDays` 等运行时字段。
- 掌门继任同角色候选排序使用 `ranks.json` 中的 `successionScore`，不再在代码里维护中文境界分数表。

## 表内唯一 ID

每张静态表只要求本表内唯一 ID，不要求全局唯一。当前 `factions.json`、`npcs.json`、`rules.json`、`ranks.json` 使用 `id` 作为主键；`events.json`、`modifiers.json`、`terrains.json` 已补充 `id`，并暂时保留 `type` 作为运行时分类字段。
