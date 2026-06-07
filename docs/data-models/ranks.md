# 数据模型：境界表

> 最后更新：2026-06-07

## 定位

`apps/game/data/definitions/ranks.json` 是 NPC 修仙境界与寿元上限的静态配置表。`rankId` 只表示修仙境界，不承载宗门职位、凡人王朝头衔或武道头衔。

职位由 `npcs.json` 的 `role` 字段表示；掌门、长老、核心弟子、将领、执事等都是角色语义，不进入 `ranks.json`。

## 结构

```javascript
Rank {
  id: string,                 // 本表内唯一 ID，NPC 通过 rankId 引用
  name: string,               // 显示名，如 元婴 / 金丹 / 凡人
  category: string,           // cultivation / mortal
  order: number,              // 世界观层级排序
  successionScore: number,    // 掌门继任同角色候选的境界分数；职位排序仍看 role
  cultivationRequired?: number, // 突破到本境界所需数值修为
  qiRequired?: number,          // 突破到本境界所需真气
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
- 当前 `rankId` 只允许：`mortal`、`qi_refining`、`foundation_building`、`golden_core`、`nascent_soul`、`spirit_transformation`。
- `disciple`、`outer_disciple`、`core_disciple`、`elder`、`leader`、`general`、`officer` 等是 `role`，不得作为 `rankId`。
- `npc-lifecycle.json` 不再保存 `lifespanByRank` 或 `defaultLifespan`。
- `WorldEngine.initNPCs()` 会用 `rankId` 查询 `ranks.json`，补齐 `rankName`、`lifespanBucket`、`maxAgeYears/maxAgeDays` 等运行时字段。
- 掌门继任先按 `role` 候选范围筛选，再在同角色候选中使用 `ranks.json` 的 `successionScore` 排序。
- 修仙境界必须维护 `cultivationRequired` 与 `qiRequired`。`cultivationRequired` 是突破修为门槛，运行时由 `totalCultivation` 对比；`qiRequired` 是独立真气门槛，运行时由 `qi` 对比。
- 运行时小层 `rankStage` 由 `totalCultivation / nextCultivationRequired` 派生，阈值来自 `apps/game/data/balance/cultivation.json` 的 `stageThresholds`。
- 当前顶级境界没有下一境界时，GOAP 派生的 `nextCultivationRequired` 为 0；成功突破到顶级境界后仍显式进入 `rankStage="early"`。

## 表内唯一 ID

每张静态表只要求本表内唯一 ID，不要求全局唯一。当前 `factions.json`、`npcs.json`、`rules.json`、`ranks.json` 使用 `id` 作为主键；`events.json`、`modifiers.json`、`terrains.json` 已补充 `id`，并暂时保留 `type` 作为运行时分类字段。
