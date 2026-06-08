# 门派运行数据模型

> 最后更新：2026-06-08
> 关联系统：`docs/systems/sect-operation-system.md`
> 关联 ADR：`docs/decisions/adr-057-sect-operation-and-unified-quest-board.md`

本文记录门派运行与通用任务板接入的数据模型。静态配置位于 `apps/game/data/definitions/`、`apps/game/data/balance/`、`apps/game/data/economy/` 和 `apps/game/data/quests/`；运行时仍以 `FactionEntity`、`FactionState`、faction inventory、任务实例和经济托管记录为真相源。

## FactionEntity 门派扩展

门派不新增独立实体，仍复用 `FactionEntity`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `isSect` | boolean | 是否为门派，必须显式声明 |
| `isPublic` | boolean | 是否公开展示或可被公开任务板访问，必须显式声明 |
| `sectTemplateId` | string? | 引用 `sectOrganization.templates[].id` |
| `seedProfileId` | string? | 引用 `sectSeedProfiles.seedProfiles[].id` |
| `hallProfileId` | string? | 引用堂口编制 profile |
| `inventoryProfileId` | string? | 引用宗门初始实物库存 profile |

`isSect=true` 的势力必须能解析组织模板和初始化 profile；普通组织或功能机构也应显式声明 `isSect=false`，避免由缺字段推断身份。

## SectOrganization

`sectOrganization` 来自 `definitions/sect-organization.json`，描述组织模板和身份边界。

| 字段 | 类型 | 说明 |
|------|------|------|
| `templates[]` | array | 门派组织模板 |
| `templates[].id` | string | 模板 ID，snake_case |
| `templates[].name` | string | 中文名 |
| `templates[].halls[]` | array | 堂口定义 |
| `templates[].leadershipRoles[]` | array | 管理层职位 |
| `templates[].memberRoles[]` | array | 普通成员职位 |
| `templates[].identityBoundary` | object | 门派成员、客卿、散修、公共组织等身份边界 |
| `templates[].hallEligibility` | object | 进入各堂口所需 role、rank、贡献或特质 |

堂口 ID、role 和 rank 只由配置解释。代码不得写死丹堂、器堂、执法堂等固定堂口列表。

## SectSeedProfiles

`sectSeedProfiles` 来自 `definitions/sect-seed-profiles.json`，用于初始化门派资源、库存、堂口编制和 NPC starter kit。

| 字段 | 类型 | 说明 |
|------|------|------|
| `resourceProfiles[]` | array | 宏观资源 profile，只声明 faction state resource |
| `inventoryProfiles[]` | array | 宗门实物库存 profile，只声明 item |
| `hallProfiles[]` | array | 堂口编制 profile，声明 hallId、role、rank 和人数规则 |
| `npcStarterKits[]` | array | NPC 初始道具 profile，只声明 item |
| `seedProfiles[]` | array | 对上述 profile 的组合引用 |

`resourceProfiles` 应用后仍交给 `ResourceRegistry.initialStateFrom()`。`inventoryProfiles` 与 `npcStarterKits` 写入 inventory，所有 `itemId` 必须经 `itemDefs.items` 校验。

## BalanceSectOperation

`balanceSectOperation` 来自 `balance/sect-operation.json`，描述门派运行数值。

| 字段 | 类型 | 说明 |
|------|------|------|
| `salary` | object | 月俸结算周期、职位灵石俸禄、欠薪处理 |
| `pillSalary` | object | 丹药俸禄、发放条件、库存不足处理 |
| `maintenance` | object | 堂口、建筑或抽象维护费 |
| `stockPressure` | object | 安全库存线、库存压力、回流比例、离宗和倒闭阈值 |
| `questBoard` | object | 任务板可见性、任务选择、去重和来源策略 |
| `personalBounty` | object | 个人悬赏手续费、托管场景和交付策略 |
| `transactionScenarios` | object | 引用统一经济交易场景 |

`stockPressure` 的阈值和比例必须在 strict validator 中做范围校验。个人悬赏奖励必须通过经济托管，不进入宗门普通库存。

## QuestBoardTask

通用任务板任务实例位于任务域，不属于门派专用模型。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 运行时任务实例 ID |
| `templateId` | string | 引用 `quests/quest-templates.json` |
| `source` | object | 来源域、来源实体、来源策略和可见性 |
| `state` | string | `draft` / `available` / `accepted` / `in_progress` / `completed` / `turned_in` / `failed` / `expired` |
| `visibility` | object | 公开、宗门、堂口、个人或关系网络可见性 |
| `dedupeKey` | string? | 去重策略生成的任务去重键 |
| `target` | object | 目标实体、地点、物品、妖兽或条件 |
| `rewardPolicy` | object | 奖励来源与交付策略 |
| `escrowRefs` | array? | 个人悬赏或正式交易托管记录 |
| `turnIn` | object? | 交付要求、交付处理器和结算记录 |

门派任务可以把奖励策略指向宗门贡献、库存回流或宗门资源；个人悬赏必须指向托管资产，不叠加任务模板中的普通奖励。

QuestBoard canonical 状态集合固定为 `draft`、`available`、`accepted`、`in_progress`、`completed`、`turned_in`、`failed`、`expired`。旧 `activeQuestInstance` / 斩妖任务状态属于 NPC 任务实例兼容状态，不是 QuestBoard canonical 状态；迁移时应由适配器映射到通用任务板状态，不让旧状态继续扩散。

## SectOperationContext

运行时规则链接收上下文而非直接读取全局状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `day` | number | 当前世界日 |
| `faction` | FactionEntity | 当前宗门势力实体 |
| `factionState` | FactionState | 宏观资源状态 |
| `inventory` | object | faction inventory 实物库存 |
| `members` | array | 当前宗门具名成员 |
| `organization` | object | 已解析组织模板 |
| `operationBalance` | object | 已解析运行数值 |
| `questBoard` | object | 通用任务板服务 |
| `economicSystem` | object | 统一经济系统 |
| `events` | array | 本轮规则链产出的事件摘要 |

规则链只消费上下文和配置，不在规则中固定宗门 ID、堂口 ID、物品 ID、任务模板 ID 或交易场景 ID。

## 校验关系

```text
data-manifest.json
  -> sectOrganization
  -> sectSeedProfiles
  -> balanceSectOperation
  -> game-data-validator.js strict 校验
  -> ResourceRegistry / itemDefs / quest templates / transaction scenarios 引用解析
  -> SectOperationService 与 QuestService 使用
```

`test-sect-config-load.mjs` 只验证 validator 覆盖，不维护第二套门派规则。
