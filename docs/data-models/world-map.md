# 数据模型：世界地图（WorldMap）

> 最后更新：2026-05-23

## 结构

```javascript
WorldMap {
  width: number,              // 地图宽度（格数），固定 100
  height: number,             // 地图高度（格数），固定 100
  tiles: Tile[][]             // 二维格子数组
}

Tile {
  x: number,                  // 横坐标
  y: number,                  // 纵坐标
  terrain: TerrainType,       // 地形类型
  ownerId: string | null,     // 所属势力 ID，null 为无主之地
  resourceType: string | null,// 资源类型，null 为无资源
  resourceAmount: number,     // 资源数量
  buildings: Building[]       // 建筑列表
}
```

## 地形类型（TerrainType）

| 枚举值 | 名称 | 移动消耗 | 特性 |
|--------|------|----------|------|
| `plain` | 平原 | 1 行动点 | 宜居，适合建宗门 |
| `mountain` | 山脉 | 1 行动点 | 天然屏障，易守难攻 |
| `forest` | 森林 | 1 行动点 | 灵药资源丰富 |
| `river` | 河流 | 不可通行 | 需绕行 |
| `swamp` | 沼泽 | 2 行动点 | 移动消耗双倍 |
| `desert` | 沙漠 | 1 行动点 | 荒芜，低资源 |
| `spirit_vein` | 灵脉 | 1 行动点 | 稀有修炼圣地，兵家必争 |

地形属性定义在 `data/definitions/terrains.json` 中，代码通过配置读取，便于扩展新地形。

## 地图尺寸

第一版固定 100 × 100 = 10,000 格。后续可扩展为随机生成。
