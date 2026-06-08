# 门派运行系统

> 最后更新：2026-06-08
> 关联 ADR：`docs/decisions/adr-057-sect-operation-and-unified-quest-board.md`
> 关联数据模型：`docs/data-models/sect-operation.md`

门派运行系统描述宗门作为势力组织的日常运营：组织模板、宗门财政、实物库存、月俸与丹药俸禄、个人悬赏、库存压力、离宗和倒闭。门派仍复用 `FactionEntity`，不新增独立实体类型。

## 系统边界

| 模块 | 路径 | 职责 |
|------|------|------|
| 通用任务板 | `apps/game/js/engine/quest/` | 任务仓储、任务状态机、可见性策略、去重策略、任务来源策略、交付处理器 |
| 门派运行 | `apps/game/js/engine/sect/` | 门派组织、宗门财政、悬赏托管、月俸库存压力、离宗倒闭规则 |
| 势力实体 | `apps/game/js/engine/faction/` | `FactionEntity`、`FactionState`、势力宏观状态和基础行为 |
| 统一经济 | `apps/game/js/engine/economy/` | 个人悬赏奖励托管、交易场景、结算、账本和债务 |

`engine/quest/` 是通用任务板，不属于门派专用模块。宗门任务、个人悬赏、悬赏阁任务、坊市委托和动态事件任务都应复用同一套任务仓储与状态机。

`engine/sect/` 只注册宗门任务来源、门派运行规则和悬赏结算策略。它可以依赖通用任务域和统一经济域，但 `QuestService` 依赖任务域，不反向依赖门派域。

## 设计原则

- **配置注册表 + 策略规则链**：`SectOperationService` 只编排上下文，月俸、库存压力、离宗、倒闭、任务来源、悬赏结算等机制由可注册规则处理。
- **数据驱动**：组织、运行数值、初始资源/库存、NPC starter kit、堂口编制、任务板可见性、库存压力回流和交易场景都来自 JSON。
- **资源分层**：宗门宏观资源继续由 `ResourceRegistry` + `FactionState` 管理；宗门实物库存只进入 faction inventory。
- **经济托管**：个人悬赏奖励不进入宗门普通库存，不叠加普通任务模板奖励，统一走经济托管和交割。
- **严格配置**：最新门派运行默认进入正式流程，缺配置由 strict validator 报错，不保留旧月俸 fallback。

## 运行流程

```text
World Tick / 月度结算
  -> SectOperationService 构建宗门上下文
  -> 读取 sectOrganization / sectSeedProfiles / balanceSectOperation
  -> 规则链处理财政、月俸、丹药俸禄、库存压力、离宗和倒闭
  -> 注册或刷新宗门任务来源
  -> 通用任务板生成、去重、展示、接取和推进任务
  -> 任务交付处理器调用经济托管或宗门资源回流
  -> 写入事件、账本、关系和 AI 可消费信号
```

`SectOperationService` 不直接写死职位、堂口、发薪物品、手续费、库存阈值或任务模板。它只把 `FactionEntity`、成员、库存、资源、任务板和经济系统组合成上下文，然后交给注册规则执行。

## 配置输入

| 输出字段 | 数据文件 | 用途 |
|----------|----------|------|
| `sectOrganization` | `apps/game/data/definitions/sect-organization.json` | 门派组织模板、堂口、管理层、身份边界和堂口资格 |
| `sectSeedProfiles` | `apps/game/data/definitions/sect-seed-profiles.json` | 门派初始化资源 profile、实物库存 profile、堂口编制 profile、NPC starter kit |
| `balanceSectOperation` | `apps/game/data/balance/sect-operation.json` | 月俸、丹药俸禄、维护费、安全库存线、离宗阈值、任务板策略和个人悬赏手续费 |

`data-manifest.json` 必须输出以上三个字段。门派实现不得绕开 manifest 直接列举文件。

### 初始化 profile

- `sect-seed-profiles.resourceProfiles` 只定义宏观资源 profile。应用后仍交给 `ResourceRegistry.initialStateFrom()` 生成 `FactionState` 初始资源。
- `sect-seed-profiles.inventoryProfiles` 只定义宗门实物库存，写入 faction inventory。
- `npcStarterKits` 只定义 NPC 初始实物道具，写入 NPC inventory。
- `inventoryProfiles` 与 `npcStarterKits` 中所有 `itemId` 必须经 `itemDefs.items` 校验。

## 通用任务板接入

任务板由以下组件组合：

| 组件 | 职责 |
|------|------|
| 任务仓储 | 保存任务实例、来源、目标、奖励、可见性、生命周期和交付记录 |
| 状态机 | 管理 `draft`、`available`、`accepted`、`in_progress`、`completed`、`turned_in`、`failed`、`expired` |
| 可见性策略 | 决定任务对公开、宗门、堂口、个人或关系网络是否可见 |
| 去重策略 | 防止同一来源、目标或模板生成重复任务 |
| 任务来源策略 | 从宗门、悬赏阁、个人委托、事件或坊市生成任务 |
| 交付处理器 | 根据任务来源结算奖励、托管、贡献、库存回流和账本 |

宗门只提供宗门任务来源策略和宗门交付处理器。个人悬赏提供独立来源与结算策略，奖励来自托管，不使用普通任务模板奖励叠加。

QuestBoard canonical 状态集合固定为 `draft`、`available`、`accepted`、`in_progress`、`completed`、`turned_in`、`failed`、`expired`。旧 `activeQuestInstance` / 斩妖任务状态属于 NPC 任务实例兼容状态，不是 QuestBoard canonical 状态；后续接入时只作为旧任务实例到通用任务板的迁移和兼容映射来源。

## Strict 校验入口

`game-data-validator.js` 是门派配置 strict 校验的主入口。`test-sect-config-load.mjs` 只验证 validator 覆盖，不维护第二套规则。

strict validator 至少校验：

- `isSect` / `isPublic` 在势力配置中显式声明。
- `sectTemplateId`、seed profile、hall profile、starter kit、hallId、role、rank 引用存在。
- `itemId` 存在于 `itemDefs.items`。
- `questTemplateId` 存在于 `quests/quest-templates.json`。
- transaction scenario 存在于 `economy/transaction-scenarios.json`。
- faction state resource 能被 `ResourceRegistry` 解释。
- `questSelection` tag 来自登记的任务模板标签或任务板策略标签。
- `stockPressure` 的阈值、比例和扣减值处于有效数值范围。

## 验证要求

门派运行属于平衡、节奏和逻辑类改动。后续实现验证应观察真实行为：月俸是否发放、库存是否下降、库存压力是否回流到任务板、个人悬赏是否托管并交割、成员是否因长期欠薪或库存压力离宗、宗门是否在资源耗尽时倒闭。不得用字节摘要一致性代替行为观察。
