# ADR-050：GOAP 与 Job/Toil 分层执行架构

> 最后更新：2026-06-05  
> 状态：首批 Job/Toil 动态目标链路已正式默认启用（2026-06-05）
> 来源：用户关于 Utility / GOAP / Job-Toil / Execution 分工的设计要求；当前代码 `apps/game/js/engine/abstract/action.js`、`apps/game/js/engine/abstract/behavior-system.js`、`apps/game/js/engine/abstract/job-system.js`、`apps/game/js/engine/abstract/toil.js`、`apps/game/js/engine/pools/job-pool.js`、`apps/game/js/engine/pools/toil-pool.js`、`apps/game/js/engine/npc/toils/`、`apps/game/data/actions/npc-job-actions.json`、`apps/game/data/jobs/`、`apps/game/data/toils/`；既有决策 ADR-048、ADR-049。

## 背景

ADR-048 已把 NPC AI 拆成四层：

```text
Reaction → Utility / Intent → GOAP → Execution
```

ADR-049 又把动态世界事件、动态目标和打断策略从常驻需求中拆出，避免 GOAP 承担事件生命周期和打断语义。

当前剩余问题在执行边界：`Action` 同时是 GOAP 的规划步骤，又是实际执行单元。简单行为可以接受，例如闭关、回血、交任务、反击；复杂行为会让 executor 膨胀。`act_npc_prepare_dynamic_event` 已经出现这个信号：配置上它只是“筹备动态事件”，代码里 executor 只能一次性标记 prepared，无法清晰表达“检查背包、找坊市、移动、购买回血丹、兑换法器、等待秘境开启、失败回退”等内部流程。

## 决策

在四层 AI 的基础上，引入 Job/Toil 作为复杂行动编排层，形成后续五层 AI：

```text
Reaction → Utility / Intent → GOAP → Job / Toil → Execution
```

职责如下：

| 层 | 职责 |
|----|------|
| Reaction | 处理被攻击、濒死、仇人贴脸等即时刺激，可抢占当前计划或暂停 Job。 |
| Utility / Intent | 在需求、执念、关系、机会点、动态目标中选择“现在最想做什么”。 |
| GOAP | 为已选目标规划高层路径，只回答“需要安排哪些动作”。 |
| Job / Toil | 展开复杂动作内部流程，只回答“这件复杂事怎么一步步做，失败怎么回退”。 |
| Execution | 推进当前 Action 或 Toil 的移动、耗时、结算和状态回写。 |

Action 分成两类：

| 类型 | 用途 | 执行方式 |
|------|------|----------|
| SimpleAction | 闭关、回血、交任务、反击等短小行为 | 沿用当前 `ActionExecutor` 直接执行。 |
| JobAction | 准备秘境、参与秘境、组队探索、炼丹、夺宝、宗门大比、复仇筹备等复杂行为 | GOAP 规划到该 Action 后，由 Execution 启动对应 Job，Job 内部推进多个 Toil。 |

GOAP 仍保留为中层规划器，不被 Job/Toil 替代。Job/Toil 只接管复杂 Action 的内部流程，不参与目标评分，也不改写 Utility 的价值/风险/情绪逻辑。

## 配置边界

后续实施时，配置需要拆清楚：

- `apps/game/data/actions/npc-actions.json`：保留 NPC SimpleAction。
- `apps/game/data/actions/npc-job-actions.json`：新增 NPC JobAction，高层动作仍给 GOAP 使用。
- `apps/game/data/jobs/*.json`：新增 Job 定义，描述复杂行动的 Toil 流程、输入、成功状态、失败策略和可打断策略。
- `apps/game/data/toils/*.json`：新增可复用 Toil 模板或 Toil 类型声明，描述通用步骤能力；具体参数可由 Job 覆盖。
- `apps/game/data/actions/npc-action-sets.json`：把当前 `NPCEntity._initActions()` 中硬编码的默认 NPC 行为列表迁入配置。

命名约定：

- GOAP Action 继续使用 `act_` 前缀。
- Job 使用 `job_` 前缀。
- Toil 使用 `toil_` 前缀。
- ID 使用 snake_case，中文名放 `name` 字段。

## 代码边界

后续实施时，代码需要拆成以下职责：

| 文件或目录 | 职责 |
|------------|------|
| `apps/game/js/engine/abstract/job.js` | Job 定义、Job 实例、状态枚举和结果对象。 |
| `apps/game/js/engine/abstract/toil.js` | Toil 定义、ToilExecutor 接口和运行结果。 |
| `apps/game/js/engine/abstract/job-system.js` | 当前 Job 的启动、推进、暂停、恢复、失败和完成。 |
| `apps/game/js/engine/pools/job-pool.js` | 加载与创建 Job 定义。 |
| `apps/game/js/engine/pools/toil-pool.js` | 注册 Toil 类型和 ToilExecutor。 |
| `apps/game/js/engine/npc/toils/` | NPC 领域 Toil 执行器，按库存、移动、经济、动态事件、关系等拆分。 |
| `apps/game/js/core/config-loader.js` | 显式加载 actions/jobs/toils/action-sets 新配置。 |
| `apps/game/js/engine/world-engine.js` | 初始化 JobPool、ToilPool 和 NPC 默认行为集。 |
| `apps/game/js/engine/abstract/behavior-system.js` | 在 `executeStep()` 中识别 JobAction，委托 JobSystem 推进。 |

`Action` 增加 `executionKind`、`jobId`、`jobInput` 等字段。`executionKind` 缺省为 `simple`，以保持现有行为兼容。

## 首批迁移范围

首批不把所有 Action 都迁移为 Job。只迁移已经具有复杂流程压力的动态事件行为：

- `act_npc_prepare_dynamic_event` → `job_npc_prepare_dynamic_event`
- `act_npc_join_dynamic_event` → `job_npc_join_dynamic_event`
- 秘境特化准备流程 → `job_npc_prepare_secret_realm`
- 宗门大比准备流程 → `job_npc_prepare_sect_tournament`
- 获取回血丹 → `job_npc_acquire_heal_item`
- 获取或兑换法器 → `job_npc_acquire_artifact`

简单行为继续直接执行，避免过早把所有行为都塞进 Job/Toil。

## 实施状态

2026-06-05 首批实施已覆盖：

- `Action` 增加 `executionKind`、`jobId`、`jobInput`，SimpleAction 仍走原执行路径，JobAction 由 `BehaviorSystem` 委托 `JobSystem` 推进。
- 新增 `JobDefinition`、`JobInstance`、`JobSystem`、`ToilDefinition`、`ToilPool`、`JobPool`，并由 `ConfigLoader`、`WorldEngine` 加载 actions/jobs/toils/action-sets 配置。
- NPC 默认行为集迁入 `apps/game/data/actions/npc-action-sets.json`，复杂 NPC JobAction 迁入 `apps/game/data/actions/npc-job-actions.json`。
- 首批动态事件、经济和社交流程 Job 配置迁入 `apps/game/data/jobs/`；通用、动态事件、经济和社交 Toil 类型迁入 `apps/game/data/toils/`。
- 动态事件准备、秘境准备、宗门大比准备、参与动态事件、获取回血丹、获取法器已具备初始 Job/Toil 流程。
- 动态事件准备类目标已拆分事件类型前置：通用准备、秘境准备、宗门大比准备不会在 GOAP 中互相串线；执行期也会沿当前动态计划补齐同一组事件类型谓词，并通过 Job 输入或绑定 Toil 的 `expectedEventType` 校验具体事件类型，避免规划能通过但 Job 绑定错误事件。
- 2026-06-05 多种子 900 天真实模拟验证已通过，准备 Job、参与 Job、Toil 分布、普通行为恢复均可观察。

2026-06-05 默认启用收尾已覆盖：

- `ai-config.npc.jobs.enabled=true`、`dynamic-events.enabled=true`、`dynamic-goals.enabled=true` 组成默认体验链路。
- `jobs.enabled=false` 仍保留为运行时回退开关；关闭后默认 NPC 行为集不追加 JobAction。
- 默认配置路径已通过 900 天、3 种子长程验证；报告见 `docs/superpowers/reports/2026-06-05-Job-Toil默认启用验证.md`。
- 动态事件内容库扩展、PvP 真实扣血和反击触发仍是 ADR-050 之后的独立后续阶段，不阻塞本 ADR 的默认启用。

后续扩展仍需要继续补齐更丰富的 Toil 失败回退、社交组队、炼丹/夺宝等复杂行为，但这些属于 ADR-050 之后的能力扩展，不再是本 ADR 的基础设施缺口。

## 后果

好处：

- GOAP 的职责保持纯粹：规划高层路径，不背复杂 executor 细节。
- Job/Toil 能把复杂行为拆成可观察、可测试、可失败回退的步骤。
- 配置层可以分别维护“高层可规划动作”和“复杂动作内部流程”。
- 动态事件准备、秘境参与、宗门大比、夺宝、炼丹等复杂行为有统一扩展位置。

代价：

- 引擎会多出 JobPool、ToilPool、JobSystem 三类基础设施。
- Execution 需要同时推进 SimpleAction 和 JobAction。
- 动态事件验证需要从“Action 是否结算”升级为“Job 是否启动、Toil 是否推进、失败是否恢复、最终行为是否合理”。

## 验证原则

验证仍遵守项目规则：不用固定摘要或保存输出一致性自证。新增 Job/Toil 后，需要在真实完整模拟中观察：

- JobAction 是否真的被 GOAP 规划到。
- Job 是否启动、推进、完成或失败回退。
- Toil 是否产生预期副作用，例如购买丹药、装备法器、移动到事件入口、等待事件阶段、参与事件。
- Reaction 打断后 Job 是否按配置暂停、恢复或终止。
- 动态事件开启后，NPC 是否仍能恢复普通修炼、生存、经济和关系行为。

详细规格见 `docs/systems/job-toil-ai-spec.md`。
