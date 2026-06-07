# 经济交易数据模型

> 最后更新：2026-06-07
> 关联系统：`docs/systems/economic-transaction-system.md`

本文记录统一经济交易底座的运行时数据模型。模型用于资产校验、托管、交割、债务、账本和经济信号，不作为静态数据配置文件；场景倍率和规则配置见后续 `apps/game/data/economy/`。

## AssetSpec

`AssetSpec` 描述一次交易、托管或债务中涉及的资产。

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | string | `item` / `faction_state_resource` / `organization_point` |
| `itemId` | string? | 物品 ID；当 `kind` 为 `item` 或 `faction_state_resource` 时使用 |
| `pointKey` | string? | 组织点数 key，如 `contribution`、`warMerit`、`sectCredit` |
| `quantity` | number | 数量，必须大于 0 |
| `metadata` | object? | 场景附加信息，如抵押、估价、来源说明 |

约束：

- `item` 读写实体 inventory。
- `faction_state_resource` 只用于势力 `state` 资源，不写入普通 inventory。
- `organization_point` 只能由所属组织发放、扣除、冻结和兑换，不可私下转让或抵押。

## TransactionRecord

`TransactionRecord` 是交易账本中的事实记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | `tx_` 前缀运行时记录 ID |
| `type` | string | `direct_purchase`、`material_donation`、`contribution_exchange`、`quest_reward`、`auction_sale` 等 |
| `status` | string | `pending` / `settled` / `failed` |
| `day` | number | 发生日 |
| `parties` | array | 参与方角色和实体 ID，如买方、卖方、机构、见证人 |
| `assets` | array | 资产转移摘要，通常由若干 `AssetSpec` 或 delta 组成 |
| `escrowRefs` | array | 关联托管记录 ID |
| `debtRefs` | array | 关联债务记录 ID |
| `visibility` | string | `system` / `institution` / `public` / `personal` |
| `source` | object | 来源系统和来源 ID，如任务、拍卖、事件、Job/Toil |
| `evidence` | array | 调查、审判、追责和声望系统可使用的证据 |

可见性语义：

| 可见性 | 说明 |
|--------|------|
| `system` | 系统真相层，保存完整事实 |
| `institution` | 机构层，只能看到自己经手或备案的交易 |
| `public` | 公开层，可被传闻、新闻、拍卖公告等系统引用 |
| `personal` | 个人认知层，默认只有参与者、见证人和后续调查者知道 |

## EscrowEntry

`EscrowEntry` 记录被真实移出原持有者资产容器的托管资产。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | `escrow_` 前缀运行时记录 ID |
| `purpose` | string | `quest_reward`、`auction_lot`、`collateral`、`deposit` 等 |
| `itemizedAssets` | array | 被托管资产，按 `AssetSpec` 或资产明细保存 |
| `nominalOwnerId` | string | 名义所有人 |
| `sourceEntityId` | string | 原资产持有人 |
| `escrowHolderId` | string | 托管方，如机构、见证人或交易实例 |
| `status` | string | `locked` / `released` / `refunded` / `forfeited` |
| `createdDay` | number? | 创建日 |
| `resolvedDay` | number? | 释放、返还或罚没日期 |
| `source` | object? | 来源交易、任务、拍卖或事件 |

状态语义：

| 状态 | 说明 |
|------|------|
| `locked` | 已锁定，资产不再属于原持有者可自由支配资产 |
| `released` | 成功结算并释放给目标方 |
| `refunded` | 交易失败、取消或流拍后返还 |
| `forfeited` | 因违约、罚没或赔付被划转 |

## DebtRecord

`DebtRecord` 记录长期欠款、欠物、担保和到期状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | `debt_` 前缀运行时记录 ID |
| `debtorId` | string | 债务人 |
| `creditorId` | string | 债权人 |
| `origin` | object | 来源交易、任务、拍卖或赔偿 |
| `dueDay` | number | 到期日 |
| `assetsDue` | array | 应偿还资产 |
| `guarantorIds` | array | 担保人 ID |
| `collateralRefs` | array | 抵押托管引用 |
| `status` | string | `active` / `paid` / `overdue` / `forgiven` / `disputed` / `converted_to_quest` |
| `visibility` | string | 债务可见性，沿用账本可见性语义 |
| `createdDay` | number? | 创建日 |
| `paidDay` | number? | 偿清日 |
| `evidence` | array? | 追责、调查、审判和关系后果证据 |

债务状态只描述经济事实。追债、宽免、担保牵连、通缉、封禁和复仇由外部系统根据债务信号决定。

## 典型记录关系

```text
TransactionRecord
  ├── assets[]         -> AssetSpec / 资产 delta
  ├── escrowRefs[]     -> EscrowEntry
  ├── debtRefs[]       -> DebtRecord
  └── evidence[]       -> 调查、关系、任务和声望系统消费
```

一次任务奖励短款可以同时产生一条 `quest_reward` 交易记录和一条 `active` 债务；一次拍卖流拍可以产生 `auction_sale` 失败或流拍记录，并把拍品托管从 `locked` 更新为 `refunded`。
