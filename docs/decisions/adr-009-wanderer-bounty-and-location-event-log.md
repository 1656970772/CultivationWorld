# ADR-009：散修悬赏与位置事件日志

> 日期：2026-05-29
> 状态：已接受 · 已实现并验证（无头模拟跑 800 天，散修接/做/交悬赏各数十次，1120/1309 事件带坐标）
> 关联：ADR-008（建筑功能化与行为目标分散，本 ADR 复用其 `quest_hall` 解析与建筑路由）、ADR-006（空间移动与实时渲染）、ADR-005（需求驱动 GOAP）

## 背景

世界中已有 16 名散修（`npcs.json` 中 `factionId: null`，`role: wanderer`），其故事描述大量提到「悬赏阁」「坊市接斩妖任务」，但引擎层从未对接：

- 任务三连行为（`accept_quest` / `do_quest` / `turn_in_quest`）前置都要求 `hasFaction: true`，散修被完全挡在任务系统之外；
- 散修实际只会修炼/求药/游历/挑战，与设定脱节；
- `tickLog` 事件流（攻击/结盟/妖兽袭击/死亡/道侣/生育）**不含坐标**，无法回答"这件事发生在哪"，而 `game-manager` 的神识范围过滤（`isInPlayerSenseRange(x,y)`）已预留坐标入参却无上游数据。

用户需求（B 档）：参考世界观文档中散修的活动，接入「散修悬赏」与「位置事件日志」。

### 世界观依据（节选）

- 散修 = 未加入任何宗门的独立修士，资源全靠自争（凡人修仙传《散修生存方式》§1.1）。
- 散修核心谋生途径含**接取坊市悬赏榜/商会委托任务**（护送/猎杀/采集）（完美世界《散修生存方式》§1.1）。
- 坊市分级，**小型坊市由散修联盟管理、微型坊市在妖兽猎场出口**；散修联盟外务堂负责任务接洽（凡人《散修生存方式》§8.1、§4.2）。
- 本项目已有中立机构实体：悬赏阁 `org_bounty`（`subtype: bounty_hall`）、百灵坊市 `org_market`（`subtype: market`）。

## 决策

### 一、散修悬赏（复用任务系统，最小可用）

1. **派生可接取状态**：`npc-state.js` 新增 `isWanderer`（`!factionId`）与 `canTakeQuest`（恒 true，宗门弟子与散修都可接）。悬赏动作前置由 `hasFaction: true` 改为 `canTakeQuest: true`（GOAP 前置为「与」逻辑，故用统一派生位而非 `hasFaction || isWanderer`）。
2. **接/交地点分流**：散修无本门任务殿，`quest_hall` 解析器对无 `factionId` 实体回退到 `TickManager._nearestBountyOrg`——优先悬赏阁(`bounty_hall`)、其次坊市(`market`)，再按曼哈顿距离择近。`resolveQuestLocation` 中散修的 `hq` 类悬赏（巡山/值守）同样落到悬赏阁/坊市。
3. **奖励区分**：`NPCTurnInQuestExecutor` 检测 `isWanderer`：散修**不上缴宗门分成、不获贡献点**，灵石奖励按 `cultivation.json → bounty.wandererRewardMultiplier`（默认 1.5）加成，赏金从悬赏阁/坊市库存垫付（`worldContext._resolveBountyOrgFor`）。
4. **需求驱动**：`need_npc_quest` 新增 `isWanderer → priorityBoost 40`（高于宗门弟子的 30，因散修无履职/辅助等其他行为，悬赏是主要谋生方式）。
5. **机构子类型可查询**：`FactionStaticData` 新增 `subtype` 字段（原本只在 `factions.json` 而未进实体），供 `_nearestBountyOrg` 按机构类型分流。
6. **势力覆灭转散修**：`npc-entity.js onPreTick` 中势力覆灭时把原弟子 `hasFaction=false` 同时置 `isWanderer=true`，使其自然转向悬赏谋生。

### 二、位置事件日志（统一 schema）

1. **统一发射器**：`TickManager._emitLocationEvent(tickLog, payload)` 自动取坐标（传 `entity` 时读 `spatial.tileX/Y`）、补 `locationName`（`_resolveLocationName`：领地→`<势力名>领地`，否则地形 `name`），写入 `tickLog.events`。
2. **事件覆盖**：
   - 悬赏/任务接取与完成 → `_emitNpcActionEvent` 在 NPC 行为结算（`step_done`/`plan_complete` 且含 `result`）时发出 `wanderer_bounty_*` / `quest_*`；
   - 道侣（`dao_companion`）、生育（`birth`）改用 `_emitLocationEvent`；
   - 攻击/结盟/妖兽袭击 → `_enrichInfoEvents` 给 `tickLog.infoEvents` 补坐标（攻击/结盟取发起方总部，妖兽袭击取妖兽/NPC 坐标）；
   - 死亡 → `_collectDeaths` 给每条 `deaths`/`monsterDeaths` 加 `x/y/locationName`。
3. **去重**：`do_quest` 仅在 `outcome === 'complete'` 时发事件；任务中身陨已由死亡收集统一记录（含坐标），不重复。
4. **展示**：`simulation-main.js processTickLog` 消费 `events`/`infoEvents`/`deaths`，文案后缀 ` @(x,y) 地点名`（`_locSuffix`）。不新增独立报告表格（按用户要求，只需事件日志带位置即可）。

## 后果

### 正面
- 散修从"有故事无行为"变为真正在悬赏阁/坊市间接活、谋生、奔波，世界更符合设定。
- 散修与宗门弟子复用同一套任务链，改动集中、低耦合（仅放宽前置 + 分流目标 + 区分奖励）。
- 位置事件 schema 统一，所有世界动态可按坐标回溯，且与既有神识范围过滤天然对接。
- 数据驱动：散修奖励倍率落在 `cultivation.json`，无硬编码。

### 负面/风险
- `_nearestBountyOrg` 在散修密集且悬赏阁/坊市稀少时会让多名散修聚到同一机构格（视觉聚集）；后续可加分散落点。
- 悬赏赏金从机构库存垫付，长期可能耗尽机构灵石（当前不足时照常发放兜底，需观察经济平衡）。
- `_emitNpcActionEvent` 对每个 NPC 每 tick 检查一次行为类型，事件量随 NPC 规模线性增长；当前规模（百级）无性能问题。

## 涉及文件
- 改 `apps/game/js/engine/npc/npc-state.js`（新增 `isWanderer` / `canTakeQuest`）
- 改 `apps/game/js/engine/npc/npc-entity.js`（势力覆灭时置 `isWanderer`）
- 改 `apps/game/js/engine/faction/faction-static-data.js`（新增 `subtype`）
- 改 `apps/game/js/engine/world/tick-manager.js`（`_nearestBountyOrg`、`quest_hall`/`hq` 散修分流、`_resolveBountyOrgFor`、`_emitLocationEvent`、`_resolveLocationName`、`_enrichInfoEvents`、`_emitNpcActionEvent`、`_collectDeaths` 补坐标、道侣/生育改发位置事件）
- 改 `apps/game/js/engine/npc/npc-actions.js`（`NPCTurnInQuestExecutor` 区分散修奖励）
- 改 `apps/game/js/simulation-main.js`（`_locSuffix` / `_formatLocationEvent` / `_eventLogClass`、消费 events/infoEvents、死亡日志带坐标）
- 改 `apps/game/data/actions/npc-actions.json`（accept/turn_in 前置改 `canTakeQuest`、描述）
- 改 `apps/game/data/needs/npc-needs.json`（`need_npc_quest` 给散修加 boost）
- 改 `apps/game/data/balance/cultivation.json`（新增 `bounty.wandererRewardMultiplier`）
- 改 `docs/data/data-config-rules.md`（targetResolver/locationTarget 散修说明、cultivation `bounty` 字段、位置事件日志段落）
