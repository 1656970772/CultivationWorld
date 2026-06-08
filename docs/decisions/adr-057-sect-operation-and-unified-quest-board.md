# ADR-057：门派运行规则链与通用任务板

> 最后更新：2026-06-08
> 日期：2026-06-08
> 状态：已决策，已落地

## 背景

门派架构与运行模拟落地后，需要持续维护组织边界、任务板归属、配置清单、资源真相源和校验入口。此前宗门月俸、贡献、任务、库存和势力资源分散在势力、NPC、经济、任务和世界 Tick 逻辑中，容易在新增机制时回到硬编码分支或双轨 fallback。

本决策要求门派运行默认进入最新正式流程：门派仍是势力体系中的一种组织形态，门派运行只负责宗门内部运营，任务板作为通用任务域供门派、悬赏阁、坊市、事件和个人委托等来源复用。

## 决策

1. 门派仍复用 `FactionEntity`，不新增独立门派实体。
2. 门派运行子域放在 `apps/game/js/engine/sect/`，只处理门派组织、宗门财政、个人悬赏、月俸库存压力、离宗和倒闭。
3. 通用任务板放在 `apps/game/js/engine/quest/`，由任务仓储、状态机、可见性策略、去重策略、任务来源策略和交付处理器组合；`QuestService` 依赖任务域，不反向依赖门派域。
4. 门派运行采用配置注册表 + 策略规则链；`SectOperationService` 只编排已构建上下文，具体机制由可注册规则处理。
5. 所有可配置内容进入 JSON：组织、运行数值、初始资源/库存、NPC starter kit、堂口编制、任务板可见性、库存压力回流、交易场景。
6. 宗门宏观资源继续由 `ResourceRegistry` + `FactionState` 管理；宗门实物库存只进入 faction inventory。
7. 个人悬赏奖励使用统一经济托管，不进入宗门普通库存，不叠加普通任务模板奖励。
8. 最新门派运行默认进入正式流程，缺配置由 strict validator 报错，不保留旧月俸 fallback。

## 架构边界

| 域 | 路径 | 职责 |
|----|------|------|
| 通用任务板 | `apps/game/js/engine/quest/` | 任务实例仓储、状态机、可见性、去重、来源策略和交付处理器 |
| 门派运行 | `apps/game/js/engine/sect/` | 宗门任务来源注册、门派运行规则链、悬赏结算策略、月俸库存压力、离宗和倒闭 |
| 势力状态 | `apps/game/js/engine/faction/` | `FactionEntity` 与 `FactionState`，继续承载门派实体和宏观资源状态 |
| 统一经济 | `apps/game/js/engine/economy/` | 托管、结算、交易场景、账本和债务；个人悬赏奖励必须走此域 |

`engine/quest/` 是通用任务域，不属于门派专用模块。门派只向任务域注册来源策略、可见性规则和交付处理器，不让任务域反向感知宗门运行服务。

## 配置要求

- `data-manifest.json` 必须输出 `sectOrganization`、`sectSeedProfiles`、`balanceSectOperation`。
- `definitions/sect-organization.json` 负责门派组织模板、堂口、管理层、身份边界和堂口资格。
- `definitions/sect-seed-profiles.json` 负责门派初始化 profile：宏观资源档、实物库存档、堂口编制档、NPC 初始道具档。
- `balance/sect-operation.json` 负责门派运行数值：月俸、丹药俸禄、维护费、安全库存线、离宗阈值、任务板策略和个人悬赏手续费。
- `sect-seed-profiles.resourceProfiles` 只定义宏观资源 profile，应用后仍交给 `ResourceRegistry.initialStateFrom()`。
- `sect-seed-profiles.inventoryProfiles` 与 `npcStarterKits` 只定义实物物品，所有 `itemId` 必须经 `itemDefs.items` 校验。
- 任务板可见性、库存压力回流和交易场景引用必须配置化，不在代码中固定 ID、阈值、奖励或堂口列表。

## Strict 校验

`game-data-validator.js` 是门派配置 strict 校验主入口；`test-sect-config-load.mjs` 只验证 validator 覆盖，不维护第二套规则。

strict validator 必须校验：

- `factions.json` 中 `isSect` / `isPublic` 的显式性，以及门派引用的 `sectTemplateId`。
- seed profile、hall profile、starter kit、hallId、role、rank 的引用完整性。
- `sect-seed-profiles.inventoryProfiles` 与 `npcStarterKits` 中所有 `itemId` 均存在于 `itemDefs.items`。
- 任务来源、堂口任务和个人悬赏引用的 `questTemplateId` 均存在于 `quests/quest-templates.json`。
- 悬赏、回流和发薪引用的 transaction scenario 存在于 `economy/transaction-scenarios.json`。
- 宗门宏观资源引用必须存在于 `ResourceRegistry` 可解释的 faction state resource。
- `questSelection` tag 必须来自任务模板或任务板策略登记项。
- `stockPressure` 的安全库存线、回流比例、离宗阈值和倒闭阈值均在有效数值范围内。

## 影响

- 当前实现不新增 `SectEntity`，避免势力系统和门派系统产生平行实体生命周期。
- 门派任务、悬赏阁任务、坊市委托、动态事件任务可以共享同一个任务板仓储和状态机。
- 门派运行规则可通过新增配置与策略类扩展，而不是修改 `SectOperationService` 分支。
- 宗门宏观资源和实物库存不混用，减少 `FactionState` 与 inventory 的双轨覆盖。
- 个人悬赏奖励不会污染宗门普通库存，也不会与普通任务模板奖励重复结算。
- 缺失配置在启动期暴露，不维护旧月俸 fallback 或默认关闭 gate。

## 验收关注

- 默认流程读取 `sectOrganization`、`sectSeedProfiles`、`balanceSectOperation`，缺任何关键配置都会由 strict validator 报错。
- `engine/quest/` 不依赖 `engine/sect/`；门派只作为任务来源和交付策略接入。
- 宗门宏观资源初始化通过 `ResourceRegistry.initialStateFrom()`，实物库存通过 faction inventory。
- 门派月俸、库存压力、个人悬赏和离宗倒闭规则都来自配置注册表与策略规则链。
- 验证不得用字节摘要一致性代替行为观察，应观察配置加载、校验报错、任务生成、库存变化、托管结算和真实模拟行为。

## 关联

- `docs/systems/sect-operation-system.md`
- `docs/data-models/sect-operation.md`
- `docs/data/data-config-rules.md`
- `docs/architecture/file-structure.md`
- `docs/worldbuilding/wiki/rules/sect-operation.md`
- `docs/superpowers/specs/2026-06-07-门派架构与运行模拟设计.md`
- `docs/superpowers/plans/2026-06-07-门派架构与运行模拟设计.md`
