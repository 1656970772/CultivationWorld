# NPC 执行 Profiler

> 最后更新：2026-06-20

## 目标

NPC 执行 Profiler 用于把模拟过程中每个 NPC 的每日状态、需求评估、目标选择、计划、Job/Toil 执行结果和相关事件保存成可查询的离线数据。它面向调试、平衡分析和后续编辑器可视化，不参与正式游戏逻辑决策。

## 文件布局

默认输出目录：

```text
apps/game/tools/profiles/<seed>-<days>-<target>/
├── meta.json
├── records.jsonl
└── index.json
```

- `meta.json`：记录 schema 版本、模拟种子、天数、目标 NPC、记录数量和引擎适配器说明。
- `records.jsonl`：每行一条 NPC 日记录。使用 JSONL 是为了支持 1000 天、全 NPC 的大体量输出。
- `index.json`：按 `npcId -> day -> line` 建立轻量索引，查询工具可直接定位记录行。

## 记录结构

当前 schema 版本为 `npc_execution_profile.v1`。单条记录包含：

- `npc`：NPC id、姓名、存活状态、势力、职位、境界。
- `state.raw`：当日完整 `RuntimeState.snapshot()`。
- `state.cultivation`：突破相关派生字段，包括真气、闭关修为、历练修为、有效历练、总进度、根基缺口、总缺口、真气缺口和 `canAttemptBreakthrough`。
- `state.inventory`：物品快照。
- `state.spatial`：位置与移动目标快照。
- `needs.results`：当日全部 Need 评估结果。
- `needs.ranking`：未满足且优先级大于 0 的 Need 排序。
- `needs.cultivationRank`：修炼 Need 在可行动 Need 中的排名。
- `needs.blockersAboveCultivation`：排在修炼前面的需求，用于快速回答“谁压过了闭关”。
- `decision`：选中的目标来源、优先级、动态事件 id、计划 action 列表、规划成本和迭代数。
- `execution`：实际执行的 action、job/toil 快照、执行结果和原始执行日志。
- `events`：与该 NPC 相关的出生、死亡、任务、情报、动态事件等事件。

所有输出都必须是纯 JSON：不允许函数、Map、Set、循环引用或 JS class 实例直接进入记录。

## 使用方式

生成指定 NPC 的执行剖析：

```powershell
node tools/profile-npc-execution.mjs --days=1000 --seed=20260619 --id=npc_born_1038 --out=tools/profiles/20260619-1000-npc_born_1038
```

生成全 NPC 剖析：

```powershell
node tools/profile-npc-execution.mjs --days=1000 --seed=20260619 --all --out=tools/profiles/20260619-1000-all
```

查询指定 NPC 指定日期：

```powershell
node tools/query-npc-profile.mjs --profile=tools/profiles/20260619-1000-npc_born_1038 --id=npc_born_1038 --day=777
```

查询摘要：

```powershell
node tools/query-npc-profile.mjs --profile=tools/profiles/20260619-1000-npc_born_1038 --id=npc_born_1038 --day=777 --summary
```

## Unity 迁移边界

Profiler 的长期边界是“引擎无关事件流/快照流”，而不是绑定当前 JS 引擎对象：

1. 当前 JS 适配器读取 `WorldEngine.tick()`、`npc._tickLog`、`RuntimeState.snapshot()`、`inventory.getAll()` 和 `spatial.snapshot()`。
2. Unity 版本不需要复刻这些 JS API，只需要在每日结算后输出同 schema 的纯 JSON 记录。
3. 编辑器和可视化工具只读取 `meta.json`、`records.jsonl`、`index.json`，不直接调用 JS 或 Unity 模拟对象。
4. 如果未来 schema 扩展，必须新增字段或提升 `schemaVersion`，不要改变现有字段语义。

这个边界保证调试数据、编辑器可视化和引擎实现三者解耦。
