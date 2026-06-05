# ADR-006：实体空间移动、行为耗时与按需实时渲染

> 日期：2026-05-29
> 状态：已接受 · 已实现并验证（Agent A/B/C/D 全部落地，浏览器端端到端跑通）
> 关联设计：`ADR-006`

## 背景

世界模拟此前缺少"空间"与"时间"维度：NPC 无坐标、不移动，所有行为在单 tick 内瞬间完成，势力交互只看关系值不看地理；妖兽仅为静态数据未落地到地图；且没有"边模拟边看画面"的入口。

## 决策

1. **实体引入空间组件**：以组合方式给 `BaseEntity` 增加可选 `SpatialComponent`（坐标/速度/路径/目标）。NPC、妖兽使用精确坐标并按速度逐 tick 移动；势力仍用 `headquarters` + `territory` 表达，不加坐标。

2. **行为引入耗时与移动阶段**：`Action` 增加 `duration`、`requiresTravel`、`targetResolver`、`distanceCostPerTile` 字段。需要"去某地"的行为分 `TRAVELING → EXECUTING → DONE` 三阶段跨多 tick 完成；期间实体 `busy`，不重新规划。`duration` 参与 GOAP weight。未声明新字段的行为保持原瞬时语义（向后兼容）。

3. **妖兽实例化为活实体**：新增 `MonsterEntity`（继承 `BaseEntity`）+ `MonsterSpawner`（按地形/区域/境界梯度分布）+ 最小行为集（游荡/觅食/休整）。接入 `config-loader`、`EntityRegistry`（新增 type `monster`）、`TickManager`。

4. **按需实时渲染**：保留 `index.html`（主角玩法）但不再作为主入口。在 `simulation.html` 增加"开启渲染"开关，默认纯数据快跑；开启后复用 `js/renderer/` 的 Pixi 渲染绘制地图与移动实体，支持调速与"实体列表点选跟随视角"。`Camera` 增加 `follow/stopFollow`。

5. **渲染与模拟单向依赖**：引擎层不依赖渲染层；渲染层只读 `getWorldSnapshot()`，保证模拟可脱离渲染独立运行（同 seed 结果一致）。

## 后果

### 正面
- 世界演化具备空间与时间真实感，可观察、可解释。
- 妖兽分布合理，形成境界梯度与探索价值。
- 渲染按需开启，不拖累批量模拟性能。
- 复用既有 GOAP/Action/Pixi/Camera 框架，扩展而非重写（开闭原则）。

### 负面/风险
- 增加寻路与移动的计算开销，需控制妖兽总量与寻路频率。
- 存档结构扩展，需保证旧存档可读（新字段可选）。
- 主线程同时跑模拟+渲染，需靠调速控制帧预算（暂不引入 Worker 渲染以控制改动面）。

