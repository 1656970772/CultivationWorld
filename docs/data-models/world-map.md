# 数据模型：世界地图（WorldMap）

> 最后更新：2026-06-05  
> 数据来源：`apps/game/data/world/map.json`

## 结构

当前地图为 300×300，共 90,000 个 tile。

```javascript
WorldMap {
  width: number,       // 当前为 300
  height: number,      // 当前为 300
  tiles: Tile[]        // 一维数组，每项带 x/y 坐标
}

Tile {
  x: number,
  y: number,
  terrain: string,          // 引用 definitions/terrains.json
  ownerId: string | null,   // 引用 entities/factions.json 的 id
  resourceType: string | null,
  resourceAmount: number,
  buildings: Building[]
}
```

## 地形

地形定义在 `apps/game/data/definitions/terrains.json` 中，常见类型：

| ID | 名称 | 说明 |
|----|------|------|
| `plain` | 平原 | 常规通行地形 |
| `mountain` | 山脉 | 天险与灵脉分布区域 |
| `forest` | 森林 | 灵草、妖兽、游历常见区域 |
| `river` | 河流 | 通行受限 |
| `swamp` | 沼泽 | 高风险/高消耗地形 |
| `desert` | 沙漠 | 西域荒原 |
| `spirit_vein` | 灵脉 | 修炼资源关键点 |

具体移动代价以 `terrains.json` 和 `data/balance/movement.json` 为准。

## 使用方

- `WorldEngine._buildTileIndex()`：建立坐标索引、地形索引和任务选点索引。
- `GridGraph` / `JpsPlusData` / `HierarchicalGraph`：寻路图与加速结构。
- `TerritoryLayoutGenerator`：势力建筑与领地布局。
- `Renderer` / `SimulationRenderer`：地图渲染。
- 编辑器地图面板：摘要渲染与地图编辑。
