# 数据模型：行为配置

> 最后更新：2026-05-27

## 定位

行为配置描述“静态开局数据进入世界 Tick 后如何变化”。它不替代 `npcs.json`、`factions.json`、`map.json` 等开局数据，而是记录计算规则、可调参数和公式文字说明。

第一阶段不做通用公式解释器。代码仍按明确函数执行规则，但公式参数、阈值、表格和文字描述应放在 `apps/game/data/behaviors/`，方便后续调参、校验和生成模拟报告。

## 开局数据与行为配置

| 类型 | 作用 | 示例 |
|------|------|------|
| 静态开局数据 | 世界开始时已经存在的对象和初始状态 | `npcs.json`、`factions.json`、`ranks.json`、`map.json`、`terrains.json` |
| 行为配置 | 世界运转时的规则参数、阈值、公式描述 | `behaviors/npc-lifecycle.json`、后续 `succession.json`、`combat.json` |

## 计划目录

```text
apps/game/data/
├── npcs.json                 # NPC 开局数据
├── factions.json             # 势力开局数据
├── ranks.json                # 境界、职位、寿元与继任分数静态表
├── terrains.json             # 地形开局数据
├── events.json               # 事件模板数据
├── rules.json                # 事件触发数据
└── behaviors/
    ├── npc-lifecycle.json    # NPC 寿元、自然死亡、年龄初始化
    ├── succession.json       # 掌门继任与无候选覆灭行为
    ├── faction-ai.json       # 势力决策行为（计划）
    ├── stability.json        # 稳定度行为（计划）
    ├── territory.json        # 扩张/占领行为（计划）
    ├── combat.json           # 战斗结算行为（计划）
    └── economy.json          # 发展/贸易/资源行为（计划）
```

## 当前已落地

### `behaviors/npc-lifecycle.json`

负责核心 NPC 生命周期行为：

- `time.daysPerYear`：年与天的换算。
- `ranks.json`：境界或职位对应寿元上限、显示名和继任分数的静态来源。
- `initialAgeRatioByRole`：不同 role 的初始年龄比例。
- `naturalDeath`：自然死亡起算比例、概率上下限、曲线类型和公式说明。
- `behaviorDescriptions`：年龄初始化、年龄推进、自然死亡的文字规则。

### `behaviors/succession.json`

负责掌门继任行为：

- `rolePriority`：继任候选角色优先级，当前为 `heir`、`elder`、`general/officer`、`core_disciple`。
- `tieBreakers`：同角色优先级候选的排序说明，当前使用境界继任分数、忠诚度和 ID。
- `noCandidate`：没有存活候选时的处理，当前为 `destroy_faction`，并清空领地、停止主动决策。
- `behaviorDescriptions`：候选过滤、候选排序和无候选覆灭的文字规则。

## 设计约束

- 行为配置只保存可调参数和公式说明，不在 JSON 中写可执行 JavaScript。
- 代码读取行为配置执行规则；如果关键行为配置缺失，校验器应报告错误。
- 每新增一个行为配置文件，需要同步更新本文、`docs/README.md` 和 `docs/architecture/file-structure.md`。
