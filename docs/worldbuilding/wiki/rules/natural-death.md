# 自然死亡规则

> 最后更新：2026-05-28
> 状态：已敲定
> 类型：规则
> 关联文档：`docs/data-models/npc.md`、`docs/data-models/ranks.md`、`docs/data-models/behavior-configs.md`、`docs/systems/world-tick.md`、`docs/worldbuilding/npcs.md`

## 一句话定义

自然死亡是指 NPC 不因战争、暗杀、灾变等外部事件，而是因年龄、寿元耗尽、旧伤衰退或修行失败后的自然衰亡而退出世界。

## 已敲定内容

- 自然死亡属于 NPC 死亡的一种来源，应纳入世界演化 Tick 中的 NPC 状态更新。
- 自然死亡只影响具名核心 NPC，不直接消耗 `resources.disciples` 表示的抽象弟子规模。
- 世界模拟使用 `apps/game/data/behaviors/npc-lifecycle.json` 中的 `time.daysPerYear`，当前为 `1 年 = 360 天`。
- 每个 NPC 会根据 `rankId` 引用 `apps/game/data/definitions/ranks.json`，获得一个可复现随机寿元上限 `maxAgeYears/maxAgeDays`，同一 seed 下结果一致。
- 当前寿元表按“凡人修仙传风味 + 项目现有境界/职位”落地，并以 `ranks.json` 为准：

| rankId / 桶 | 寿元上限 |
|----------|----------|
| 凡人、弟子、谋士、将军、统领、宗师、武圣 | 80 年 ± 20 年 |
| 炼气 | 140 年 ± 40 年 |
| 筑基 | 230 年 ± 30 年 |
| 金丹 / 结丹 | 550 年 ± 50 年 |
| 元婴 | 1250 年 ± 250 年 |
| 化神 | 2000 年 ± 300 年 |

- 当 `age < maxAge * naturalDeath.startRatio` 时，不触发自然死亡。
- 当 `age >= maxAge * naturalDeath.startRatio` 且 `< maxAge` 时，每日自然死亡概率从 `naturalDeath.minChance` 按 `naturalDeath.curve` 增长到接近 `naturalDeath.maxChance`。
- 当 `age >= maxAge` 时，当天自然死亡概率为 `naturalDeath.maxChance`。
- 概率公式：

```text
progress = (ageDays - maxAgeDays * startRatio) / (maxAgeDays * (1 - startRatio))
deathChance = minChance + progress^2 * (maxChance - minChance)
```

- NPC 自然死亡后，`alive` 应变为 `false`，并从后续掌门决策、继任候选和事件对象中排除。
- 如果死亡 NPC 是当前掌门、皇帝、族长或其他 `leader`，应立即触发掌门继任规则。
- 掌门继任优先从本势力存活核心 NPC 中选择；没有存活候选时不生成新掌门，势力覆灭。
- 自然死亡应写入调试时间线和模拟报告，日志至少包含 `npcId`、`factionId`、`cause: "natural"`、`ageYears`、`maxAgeYears`、`lifespanProgress`、`deathChance`、`roll`。

## 叙事表现

- 自然死亡应表现为世界正常流逝的一部分，而不是高戏剧性突发事件。
- 对普通核心成员的自然死亡，可作为低强度日志或势力内部消息记录。
- 对掌门、皇帝、族长等领袖的自然死亡，应产生更明显的世界反馈，例如继任公告、势力稳定度波动或关系重新评估。
- 年事已高、长期闭关、旧伤未愈、寿元将尽等描述，可作为自然死亡日志的叙事来源。

## 规则边界

- 自然死亡不处理战争伤亡、暗杀、叛乱处决、秘境陨落、灾害死亡等事件性死亡。
- 自然死亡不负责决定继任人选，只负责把死亡结果交给既有继任规则处理。
- 自然死亡不直接改变势力领地、资源或外交关系；这些影响应由继任、稳定度或事件系统后续结算。
- 第一阶段不要求每个 NPC 独立日常行动，因此自然死亡不应引入全 NPC AI。

## 数据与实现提示

- `docs/data-models/npc.md` 已定义 `alive` 字段和掌门继任优先级，自然死亡应复用这些字段与规则。
- `apps/game/data/definitions/ranks.json` 保存境界/职位静态数据、寿元上限和继任评分。
- `apps/game/data/behaviors/npc-lifecycle.json` 保存初始年龄比例、自然死亡参数和公式文字说明。
- `docs/systems/world-tick.md` 已把 `updateNPCs()` 放在 Tick 第 8 步，自然死亡适合在该步骤内结算。
- `apps/game/js/engine/lifespan.js` 只负责读取行为配置并执行年龄推进和自然死亡概率计算。
- `apps/game/js/engine/world-engine.js` 的 `initNPCs()` 会为缺少寿元字段的 NPC 自动补齐字段；`updateNPCs()` 每天推进年龄并结算自然死亡。
- `apps/game/js/engine/simulation-validator.js` 应校验寿元字段为有限非负数，并阻止存活 NPC 超过寿元上限。
- 长期模拟报告应能区分自然死亡、事件死亡、掌门继任和继承链断绝导致的势力覆灭，避免调参时混淆来源。

## 待扩展

- 不同种族、境界、功法对自然死亡概率的影响。
- 掌门自然死亡是否必然影响势力稳定度，以及影响幅度如何计算。
- 玩家是否能通过丹药、事件或干预手段延寿。

## 来源

- 用户确认：本次任务要求记录“自然死亡规则”设定，并要求后续敲定设定持续写成 Wiki。
- 用户确认：采用“凡人修仙传风味”的境界寿元，并采用寿元 95%-100% 期间从 `0.0002` 增长到 `1` 的自然死亡概率。
- 项目文档：`docs/data-models/npc.md` 已定义核心 NPC、`alive` 字段与掌门继任规则。
- 项目文档：`docs/systems/world-tick.md` 已定义 Tick 第 8 步 `updateNPCs()` 处理 NPC 死亡与掌门继任。
- 项目文档：`docs/worldbuilding/npcs.md` 已记录多个年事已高或潜在死亡后果的关键 NPC 设定。
- 外部资料参考：`https://mortalsjourney.com/zh/realms/` 记录炼气、筑基、结丹、元婴、化神等境界寿命范围；`https://www.im-mortal.cn/game_wiki/level` 记录凡人、金丹、元婴、化神等寿元参考。
- 我的判断：将自然死亡归入 `worldbuilding/wiki/rules/`，因为它是世界观规则条目，不是代码实现或架构 ADR。
