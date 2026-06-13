# 数据模型：行为配置

> 最后更新：2026-06-09

## 定位

行为配置描述“静态开局数据进入世界 Tick 后如何变化”。它不替代 `npcs.json`、`factions.json`、`map.json` 等开局数据，而是记录计算规则、可调参数和公式文字说明。

运行时规则优先由现有 `apps/game/data/actions/`、`jobs/`、`toils/`、`needs/`、`goals/`、`balance/` 和未来的 `simulation/`、`drama/` 配置表达。代码负责解释配置、执行服务和提交状态 delta，不在核心流程中写固定 NPC、固定地点或固定对白分支。

## 开局数据与行为配置

| 类型 | 作用 | 示例 |
|------|------|------|
| 静态开局数据 | 世界开始时已经存在的对象和初始状态 | `npcs.json`、`factions.json`、`ranks.json`、`map.json`、`terrains.json` |
| 行为配置 | 世界运转时的规则参数、阈值、公式描述 | `behaviors/npc-lifecycle.json`、后续 `succession.json`、`combat.json` |

## 历史目录说明

早期文档曾设想 `apps/game/data/behaviors/`。当前正式数据结构已演进为 manifest 驱动的分目录配置，新增行为规则应优先进入现有目录或新增受 manifest 管理的目录。

## 当前已落地

### `behaviors/npc-lifecycle.json`

负责核心 NPC 生命周期行为：

- `time.daysPerYear`：年与天的换算。
- `ranks.json`：修仙境界对应寿元上限、显示名和继任分数的静态来源。
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
- 分层模拟配置应覆盖时间域半径、月压缩周期、保真度评分、月度 agenda 权重、episode 保留数量和恢复实时域策略。
- 玩家相遇对话配置应覆盖对白候选、条件、权重、选项、成本、冷却、剧情包 step 和副作用命令。
