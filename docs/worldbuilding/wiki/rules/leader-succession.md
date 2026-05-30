# 掌门继任规则

> 最后更新：2026-05-30
> 状态：已敲定
> 类型：规则
> 关联文档：`docs/data-models/npc.md`、`docs/data-models/ranks.md`、`docs/systems/world-tick.md`、`docs/worldbuilding/wiki/rules/sect-operation.md`

## 一句话定义

掌门继任是指势力当前 `leader` 死亡、叛变或失效后，从本势力存活核心 NPC 中选择新掌门；如果继承链断绝，势力覆灭。

## 已敲定内容

- 继任只从本势力核心 NPC 中选择，不从其他势力借人。
- 候选必须 `alive === true`，且 `factionId` 等于本势力 ID。
- 旧掌门不能继任，当前 `role: "leader"` 的其他 NPC 也不能作为候选。
- 可继任角色只包括：`heir`、`elder`、`general`、`officer`、`core_disciple`。
- 角色优先级为：`heir` > `elder` > `general/officer` > `core_disciple`。
- 同一角色优先级内，先比较 `ranks.json` 的 `successionScore`，再比较 `personality.loyalty`，最后用 `id` 字典序兜底，保证可复现。
- 有候选人时，将候选人的 `role` 改为 `leader`，并把 `faction.leader` 指向该 NPC。
- 无候选人时，不随机生成新掌门；势力标记为 `destroyed`，领地转为无主地，并停止后续主动决策。

## 数据与实现提示

- 继任角色优先级保存在 `apps/game/data/balance/social.json` 的 `succession.rolePriority`（数据驱动；历史上曾计划放入 `behaviors/succession.json`，现已统一到 social.json）。
- `apps/game/data/definitions/ranks.json` 保存境界/职位的 `successionScore`，用于同职位优先级内的排序。
- 排序实现见 `apps/game/js/engine/npc/npc-entity.js` 的 `_triggerSuccession()` 与 `_successionScoreOf()`：先按 `successionScore`（按 NPC 的 `rankId` 查表，缺省回退 `order`）降序，再按 `personality.loyalty` 降序，最后 `id` 字典序兜底。
- 覆灭势力保留在 `factions` 中作为历史记录，不从数据结构中删除。
- 覆灭势力不参与每日势力 AI、事件触发目标、稳定度更新和关系战争更新。
- 已排队事件在结算时如果发现目标势力已经 `destroyed`，必须跳过该目标，不允许把覆灭势力改判为荒野收益或继续产生资源副作用。

## 待扩展

- 势力覆灭后的遗产、难民、残党和复宗事件。
- 玩家是否可以干预继任或扶持傀儡掌门。
- 特殊制度势力是否有不同继任规则。

## 来源

- 用户确认：掌门继任按既定优先级执行；不需要兜底生成逻辑，没人继任时宗门覆灭。
- 项目文件：`apps/game/data/balance/social.json` 的 `succession.rolePriority` 记录继任角色优先级。
- 项目文件：`apps/game/data/definitions/ranks.json` 提供继任排序使用的境界/职位分数 `successionScore`。
