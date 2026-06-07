# 自然死亡规则

> 最后更新：2026-06-07
> 状态：已敲定
> 类型：规则
> 关联文档：`docs/decisions/adr-054-twelve-realm-runtime-chain.md`、`docs/data-models/npc.md`、`docs/data-models/ranks.md`、`docs/systems/world-tick.md`、`docs/worldbuilding/npcs.md`

## 一句话定义

自然死亡是指 NPC 不因战争、暗杀、灾变等外部事件，而是因年龄、寿元耗尽、旧伤衰退或修行失败后的自然衰亡而退出世界。

## 已敲定内容

- 自然死亡属于 NPC 死亡的一种来源，应纳入世界演化 Tick 中的 NPC 状态更新。
- 自然死亡只影响具名核心 NPC，不直接消耗 `resources.disciples` 表示的抽象弟子规模。
- 世界模拟使用 `apps/game/data/config/game-config.json` 中的时间设置，当前为 `1 年 = 360 天`。
- 每个 NPC 根据 `rankId` 引用 `apps/game/data/definitions/ranks.json`，获得一个可复现随机寿元上限 `maxAgeYears/maxAgeDays`，同一 seed 下结果一致。
- 当前寿元表以十二境界运行时主链为准：

| 境界 | rankId | 基准寿元 | 浮动 | 最大寿元 |
|------|--------|---------:|-----:|---------:|
| 凡人 | `mortal` | 80 | 20 | 100 |
| 炼气 | `qi_refining` | 125 | 25 | 150 |
| 筑基 | `foundation_building` | 320 | 60 | 380 |
| 金丹 | `golden_core` | 750 | 150 | 900 |
| 元婴 | `nascent_soul` | 1,500 | 300 | 1,800 |
| 化神 | `spirit_transformation` | 2,200 | 300 | 2,500 |
| 炼虚 | `void_refining` | 2,850 | 350 | 3,200 |
| 合体 | `body_integration` | 3,400 | 400 | 3,800 |
| 大乘 | `mahayana` | 3,900 | 400 | 4,300 |
| 渡劫 | `tribulation` | 4,350 | 350 | 4,700 |
| 地仙 | `earth_immortal` | 4,650 | 250 | 4,900 |
| 天仙 | `heaven_immortal` | 4,850 | 149 | 4,999 |

天仙最大寿元为 4999 年，用于压住当前运行时寿元上限。4999 年大劫、飞升退场、个人天劫等机制不在本轮实现范围内。

## 概率规则

- 当 `age < maxAge * naturalDeath.startRatio` 时，不触发自然死亡。
- 当 `age >= maxAge * naturalDeath.startRatio` 且 `< maxAge` 时，每日自然死亡概率从 `naturalDeath.minChance` 按 `naturalDeath.curve` 增长到接近 `naturalDeath.maxChance`。
- 当 `age >= maxAge` 时，当天自然死亡概率为 `naturalDeath.maxChance`。

```text
progress = (ageDays - maxAgeDays * startRatio) / (maxAgeDays * (1 - startRatio))
deathChance = minChance + progress^2 * (maxChance - minChance)
```

NPC 自然死亡后，`alive` 应变为 `false`，并从后续掌门决策、继任候选和事件对象中排除。如果死亡 NPC 是当前掌门、皇帝、族长或其他 `leader`，应立即触发掌门继任规则。

## 叙事表现

- 自然死亡应表现为世界正常流逝的一部分，而不是高戏剧性突发事件。
- 对普通核心成员的自然死亡，可作为低强度日志或势力内部消息记录。
- 对掌门、皇帝、族长等领袖的自然死亡，应产生更明显的世界反馈，例如继任公告、势力稳定度波动或关系重新评估。
- 年事已高、长期闭关、旧伤未愈、寿元将尽等描述，可作为自然死亡日志的叙事来源。

## 规则边界

- 自然死亡不处理战争伤亡、暗杀、叛乱处决、秘境陨落、灾害死亡等事件性死亡。
- 自然死亡不负责决定继任人选，只负责把死亡结果交给既有继任规则处理。
- 自然死亡不直接改变势力领地、资源或外交关系；这些影响应由继任、稳定度或事件系统后续结算。
- 本轮不实现 4999 年大劫、飞升退场或突破失败死亡。

## 数据与实现提示

- `apps/game/data/definitions/ranks.json` 保存境界静态数据、寿元桶和继任评分。
- `apps/game/js/engine/npc/npc-state.js` 会在 NPC 初始化时根据 rank 寿元桶生成 `maxAgeYears/maxAgeDays`。
- `apps/game/js/engine/npc/npc-lifecycle.js` 在突破成功后刷新寿元。
- 长期模拟报告应区分自然死亡、事件死亡、掌门继任和继承链断绝导致的势力覆灭，避免调参时混淆来源。

## 来源

- ADR-054：十二境界运行时主链。
- 项目世界观规则：采用“凡人修仙传风味”的寿元阶梯，但把当前运行时上限压到天仙 4999 年。
- 项目文档：`docs/data-models/npc.md` 定义核心 NPC、`alive` 字段与掌门继任规则。
- 项目文档：`docs/systems/world-tick.md` 定义世界 Tick 中的 NPC 生命周期处理。
