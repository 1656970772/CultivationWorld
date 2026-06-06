# 数据模型：势力（Faction）

> 最后更新：2026-06-06
> 数据来源：`apps/game/data/entities/factions.json`

## 当前规模

当前有 16 个势力/组织：

- 10 个核心势力：正派、邪派、中立宗门、妖族。
- 6 个功能组织：拍卖、镖行、杀手、悬赏、坊市、情报。

## 结构

```javascript
Faction {
  id: string,
  name: string,
  type: string,
  subtype?: string,
  headquarters: { x: number, y: number },
  stability: number,
  resources: Record<string, number>,
  leader: string,
  traits: string[],
  territory: string[],
  territoryCount: number,
  roleQuota?: Record<string, number>,
  relations: Record<string, number>
}
```

## 字段说明

| 字段 | 说明 |
|------|------|
| `id` | 唯一 ID。宗门/妖族使用 `sect_*`，功能组织使用 `org_*` |
| `type` | `righteous` / `evil` / `neutral` / `demon` |
| `subtype` | 功能组织子类，如 `auction_house`、`market` |
| `headquarters` | 总部坐标，供建筑布局、任务地点、动态事件定位使用 |
| `resources` | 初始资源，可包含 `food`、`disciples`、`low_spirit_stone` 等 |
| `leader` | 首领 NPC ID |
| `traits` | 势力倾向，如 `diplomatic`、`aggressive` |
| `territoryCount` | 初始领地规模参数 |
| `roleQuota` | 高阶职位名额，当前常见为 elder/heir |
| `relations` | 初始势力关系，范围约为 -100 到 100 |

## 运行时扩展

初始化后，`FactionEntity` 会把静态数据转成运行时状态和背包。Tick 中由 `FactionAIService`、`PromotionService`、`PopulationService`、`DeathCollector` 等服务持续更新资源、稳定度、晋升、继任、攻伐和覆灭状态。

势力宏观资源只保留 `food`、`disciples` 等抽象数量；可持有实物统一走 `apps/game/data/items/` 和 `Inventory`。
