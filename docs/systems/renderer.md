# 系统设计：Canvas 渲染方案

> 最后更新：2026-06-05

## 概述

游戏使用原生 Canvas 2D 渲染 300×300 地图。主角玩法使用 `Renderer`，自动模拟视图使用 `SimulationRenderer`。

## 组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `Camera` | `apps/game/js/renderer/camera.js` | 平移、缩放、视口换算 |
| `TileRenderer` | `apps/game/js/renderer/tile-renderer.js` | 地形、领地格子绘制 |
| `FogRenderer` | `apps/game/js/renderer/fog-renderer.js` | 玩家视野/迷雾 |
| `Renderer` | `apps/game/js/renderer/renderer.js` | 玩家玩法主渲染器 |
| `SimulationRenderer` | `apps/game/js/renderer/simulation-renderer.js` | 自动模拟实体和事件渲染 |

## 渲染内容

- 地形底图。
- 势力领地颜色。
- 玩家位置和视野。
- NPC / 妖兽 / 机会点 / 事件标记。
- 缩放、拖拽和平移。

## 性能原则

- 只绘制视口可见范围。
- 地图静态层可缓存，实体层按快照更新。
- 自动模拟时优先保证观察信息密度，不把渲染和世界 Tick 强绑定。

## 数据来源

- 地图：`apps/game/data/world/map.json`
- 地形：`apps/game/data/definitions/terrains.json`
- 快照：`WorldEngine.getWorldSnapshot()`
- 机会点：`snapshot.opportunities`
- 关系图：`graph-builder.js` + `graph-panel.js`
