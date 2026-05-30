# ADR-008：建筑功能化与行为目标分散

> 日期：2026-05-29
> 状态：已接受 · 已实现并验证（无头脚本断言通过）
> 关联：ADR-007（势力领地与建筑布局，本 ADR 补齐其点 5 留下的"逻辑联动"）、ADR-006（空间移动与实时渲染）

## 背景

ADR-007 生成了势力领地与功能建筑（主殿、任务殿、修炼场、藏经阁、炼丹房等），但建筑当前**仅可视化**：没有任何行为以它们为目标。

实际表现问题：NPC 的 9 个行为中有 5 个（`serve_faction` / `challenge` / `assist_faction` / `accept_quest` / `turn_in_quest`）的 `targetResolver` 都指向 `faction_hq`（总部中心一格）。结果是：

- 所有 NPC 都往总部那一格挤，形成视觉与语义上的"主殿黑洞"；
- 任务殿、修炼场等建筑明明存在却没人去，"可见但无功能"；
- 大量行为要专程跑回总部，产生无谓往返。

用户要求：(1) 把行为分散到对应建筑；(2) 让主殿有超出"目的地"的功能；(3) 部分势力杂务允许领地内就近完成，减少返回总部。

## 决策

1. **建筑坐标可查询**：`TerritoryLayoutGenerator` 生成时把每个势力的建筑坐标聚合为
   `Map<factionId, { hq:{x,y}, byType: Map<buildingType, {x,y}[]> }>`，经 `generate()` 的
   `stats.buildingsByFaction` 返回。引擎 `_initTerritories` 存入 `_factionBuildings` 并传给
   TickManager；两者都提供 `getFactionBuilding(factionId, buildingType, from?)` 查询（同类建筑按
   `from` 就近选择，缺失时回退总部坐标）。

2. **建筑级目标解析器**：TickManager 的 `resolveTarget` 新增
   `main_hall / quest_hall / library / alchemy / training` 解析分支，`faction_hq` 并入并等价于
   `main_hall`。无所属势力（散修）时回退到最近坊市（`market` 语义），避免散修行为失去目标。

3. **行为重指与减少往返**（`npc-actions.json`）：
   - `接取/交付任务` → `quest_hall`（任务殿）
   - `履行职责 / 挑战上位` → `main_hall`（主殿述职/争权）
   - `寻找续命丹药` → `alchemy`（炼丹房，散修回退坊市）
   - `辅助势力` → 改为 `self` 原地就近（不再 `requiresTravel` 专程回总部）
   - `修炼` 保持 `self`（洞府闭关）、`游历` 保持 `wander_far`

   > 补充（2026-05-29，见 ADR-010）：`training`（修炼场）当时只做了解析分支，但没有任何行为指向它，
   > 导致修炼场"可见但无人去"。后续由 ADR-010 新增 `act_npc_train_chamber` 行为补齐。

4. **主殿 = 行政中枢**：掌门（`currentRole === 'leader'`）被引导到主殿履职后，若身处主殿格（含相邻 1 格），
   `NPCServeFactionExecutor` 额外触发"行政中枢加成"——在常规 `leaderStoneBonus/leaderFoodBonus` 之外，
   再加 `cultivation.json → actions.serveFaction.mainHallStoneBonus/mainHallFoodBonus/mainHallStabilityBonus`
   （资源 + 稳定度）。使主殿不只是落点，而是治理产出的来源。

## 后果

### 正面
- NPC 行为按功能分散到任务殿/主殿/炼丹房等，地图上不再全员挤总部，行为语义清晰。
- 辅助势力改为原地就近，明显减少无谓往返。
- 主殿具备治理语义，掌门坐镇有正反馈，强化"势力运转"的可读性。
- 建筑坐标查询集中在 `getFactionBuilding`，解析器与执行器低耦合复用（开闭/单一职责）。

### 负面/风险
- 建筑坐标在初始化后固定；若后续支持领地动态扩张/迁移，需让 `_factionBuildings` 同步更新。
- 行政中枢加成依赖掌门确实走到主殿；若掌门长期在外，宗门治理产出下降（属预期，但需平衡数值观察）。

## 涉及文件
- 改 `apps/game/js/engine/world/territory-layout-generator.js`（记录 `buildingsByFaction`）
- 改 `apps/game/js/engine/world-engine.js`（存 `_factionBuildings` + `getFactionBuilding`，传入 TickManager）
- 改 `apps/game/js/engine/world/tick-manager.js`（导入 `BuildingType`、构造接收 `factionBuildings`、`getFactionBuilding`、`resolveTarget` 建筑解析、worldContext 暴露 `getFactionBuilding`）
- 改 `apps/game/js/engine/npc/npc-actions.js`（`NPCServeFactionExecutor` 主殿行政加成）
- 改 `apps/game/data/actions/npc-actions.json`（行为 `targetResolver` 重指）
- 改 `apps/game/data/balance/cultivation.json`（`serveFaction.mainHall*` 加成参数）
