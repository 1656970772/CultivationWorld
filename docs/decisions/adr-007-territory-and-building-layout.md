# ADR-007：势力领地与建筑布局生成（可视化）

> 日期：2026-05-29
> 状态：已接受 · 已实现并验证（无头脚本断言通过）
> 关联：ADR-006（空间移动与实时渲染）

## 背景

此前地图仅有地形：`generate-map.mjs` 生成的 tile 上 `ownerId/buildings` 全为空；`world-engine.js` 的 `_initTerritories()` 虽以 BFS 占领，但 `territoryCount` 仅 1-8 格，几乎不可见，且没有建筑、没有可辨认的形状。地图看起来只是一片地形噪声，看不出"谁占了哪里、宗门长什么样"。

用户希望：宗门 / 中立势力 / 矿脉在地形上形成**连续成片的形状**，宗门内部还能看到主殿、任务殿、修炼场等功能建筑。

## 决策

1. **运行时生成，不落盘 map.json**：领地形状与建筑由引擎初始化阶段的 `TerritoryLayoutGenerator` 生成，直接写入 `tileIndex` 上 tile 的 `ownerId / district / building` 字段。渲染层与引擎共享同一 `tileIndex` 引用，无需改 `getWorldSnapshot()`。这样 `map.json` 只存地形，布局可随势力配置/算法演进而重算。

2. **"混合"形状**：以总部为中心，先用 BFS + 噪声扰动半径生成**有机外围领地**（`district=inner`，边缘自然起伏、成片），再在中心嵌入**轴对齐规整院落**（`district=core`，最外圈 `district=wall` 作院墙/山门）。远看成片、近看有结构。

3. **规则化建筑布局**：院落内按固定相对位置放置功能建筑（枚举 `BuildingType`）——中心主殿（中立机构为坊市）、下方任务殿（含兑奖）、四角修炼场、两侧藏经阁/炼丹房、下墙开山门；矿脉连通块标记 `district=mine`，按间隔布置采矿点与边缘守卫位。建筑用枚举而非字符串散值表达。

4. **优先级与避让**：势力领地先于矿区生成；矿区只装饰**未被势力占领**的矿脉格，保留领地内建筑。总部落在不可通行格（如河流）时就近迁移（复用 `nearestPassable`）；主殿保证落地（中心不可用则取院内最靠中心的可通行格）。

5. ~~**本次仅可视化**：建筑只影响渲染与图例，不改模拟逻辑（任务殿接任务、修炼场修炼等"走到建筑才执行"的逻辑联动留作下一步）。~~ **（已由 ADR-008 实现逻辑联动）**

## 后果

### 正面
- 地图一眼可辨"谁的地盘、宗门结构"，可视化表达力大幅提升。
- 领地/建筑与地形解耦（运行时生成），算法与势力数据可独立演进（开闭原则）。
- 枚举集中在 `layout-constants.js`，生成器与渲染器共用，低耦合。

### 负面/风险
- 初始化阶段一次性扫描全图矿脉 + 逐势力 BFS，有一定开销（300x300 一次性，可接受）。
- 建筑当前不参与模拟，存在"可见但无功能"的暂态，需在下一步补齐逻辑联动。

## 涉及文件
- 新增 `apps/game/js/engine/world/layout-constants.js`（枚举 + 阵营主题色）
- 新增 `apps/game/js/engine/world/territory-layout-generator.js`（生成器）
- 改 `apps/game/js/engine/world-engine.js`（`_initTerritories` 改用生成器）
- 改 `apps/game/js/renderer/simulation-renderer.js`（`_drawTerritory` 图层）
- 改 `apps/game/simulation.html` / `css/simulation.css`（图例）
