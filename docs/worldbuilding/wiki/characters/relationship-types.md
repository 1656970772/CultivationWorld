# 人物关系网：关系类型

> 最后更新：2026-06-01（三期：师徒边现已驱动行为与遗志继承）
> 状态：已敲定（一期数据层 + 二期关系驱动决策 + 三期师徒互动）
> 类型：人物
> 关联文档：`docs/decisions/adr-027-relationship-network.md`、`docs/decisions/adr-028-relationship-driven-decisions.md`、`docs/decisions/adr-029-master-disciple-interactions.md`、`apps/game/data/balance/relationship.json`

## 一句话定义

NPC、妖兽、势力之间的"关系"统一为一张**有向带类型关系网**（单一真相源），表达师徒、道侣、同门、宿敌、灵宠、妖群等修仙世界的典型羁绊；与势力外交（势力间好感矩阵）分层并存。

## 已敲定内容

### 关系分三层

| 层级 | 关系类型 | 世界观来源 |
|------|----------|------------|
| 人际（NPC↔NPC） | 师傅 `master` / 徒弟 `disciple` | 参考凡人修仙传：师徒双重性（夺舍阴谋↔无私传承） |
| | 道侣 `dao_companion` | 参考凡人修仙传：韩立↔南宫婉，情感克制、关键时刻互助 |
| | 血亲 `kin` | 项目生育系统：父母↔子女 |
| | 同门 `same_sect` | 参考凡人修仙传：同门多为利益交集、存在竞争 |
| | 盟友 `ally` / 竞争 `rival` / 宿敌 `enemy` | 参考凡人修仙传：利益同盟脆弱、敌对逐级升级 |
| | 恩人 `benefactor` / 仇怨 `grudge` / 恩义 `gratitude` | ADR-019 个人恩怨图（被救/被害累积） |
| 人妖（NPC↔妖兽） | 灵宠 `spirit_pet` / 坐骑 `mount` | 参考凡人修仙传：噬金虫/啼魂兽神识烙印；遮天：龙马坐骑 |
| | 妖兽仇敌 `beast_grudge` / 领地入侵 `territory_threat` | 参考凡人修仙传：猎杀引发族群报复、千里追杀；领地意识 |
| 妖妖（妖兽↔妖兽） | 同群 `pack_member` / 妖群首领 `pack_leader` / 妖兽争斗 `beast_rival` | 参考凡人修仙传：化形妖兽建势力；万妖山↔蛮蛟族争地盘 |

### 边的属性

每条关系边记录：方向（from→to）、类型、好感 `affinity`（-100~100）、强度 `strength`（0~100）、建边世界日、触发事件。对称类型（道侣/血亲/同门/盟友/同群）自动建立双向边。

### 数值与衰减

各类型的默认好感/强度/衰减率配置在 `relationship.json`。师徒/道侣/血亲/灵宠等羁绊不随时间淡化（`decay=0`）；同门/盟友/竞争/宿敌等随时间向 `decayFloor` 回落；个人恩怨（grudge/gratitude）的强度由记忆系统（`memory.json` 的 grudgeGain/gratitudeGain）驱动。

## 叙事表现

- 同一宗门的弟子开局即互为同门；掌门/长老与弟子结为师徒。
- 势力交战后，败方修士对攻方修士结下宿敌；道侣陨落者对凶手结深仇；夺职/抢夺的受害者对加害者心生竞争之念。
- 修士结为道侣、诞下后代，自动织入道侣与血亲关系。
- 妖兽被修士反击后记住仇人（妖兽仇敌边），与其 `grudgeTargetId` 一致。
- 关系网可在调试关系图中查看（不同类型用颜色/虚实线区分正负好感），并随存档持久化。
- **二期起关系驱动行为**（ADR-028，`goalsEnabled` 默认开）：高强度同门遭袭时会有同门驰援；对恩人会低频探望报恩；高强度宿敌会被纳入复仇目标；同群妖兽协防群起而攻；tier2+ 妖兽对闯入老巢的修士（含强者）发动领地防御。
- **三期起师徒边驱动行为**（ADR-029）：师傅会前往为修为偏低的徒弟传功点化（给感悟增量）、徒弟遭袭时驰援护卫；徒弟会低频探望师傅尽孝；师傅陨落后徒弟会为师复仇并继承师傅未竟的执念（意志延续）；邪修师傅可能对高资质徒弟起夺舍之心（轻度，复用击杀链）。

## 规则边界

- 本系统处理**个人/族群层**关系；**势力间外交**仍由 `faction.state.relations`（`combat.json`）管理，二者分层不混淆。
- 一期关系网只维护数据/可视化/存档；**二期（ADR-028）起关系边驱动 NPC Goal 与妖兽护群/护领地行为**，受 `relationship.json -> goalsEnabled`（默认开）gate，关闭即回退一期纯数据态（零漂移）。
- 复仇取向：多数恩怨走 ADR-019/020 的现有复仇链（关系网经兼容视图提供 `topGrudge`，并把高强度 `enemy` 边纳入复仇目标）；唯"深关系被杀"（道侣/血亲/师徒）升格为执念。

## 数据与实现提示

- 配置：`apps/game/data/balance/relationship.json`（`edgeTypes` / `eventBindings` / `init`；二期增 `goalsEnabled` / `npcGoals` / `monsterPack` / `territory`；三期增 `masterDiscipleGoals` + 修正 `init.masterDisciple.discipleRoles` 含 `core_disciple`）。
- 代码：世界级 `RelationshipSystem`（`engine/world/relationship-system.js`）为单一真相源；`RelationshipGraph`（`engine/npc/relationship.js`）为 NPC 侧兼容查询视图。
- 二期接入点：NPC `_buildRelationshipGoals`（`npc-entity.js`）+ `relationship_target` resolver（`tick-manager.js`）+ `act_npc_assist_ally`/`act_npc_visit_benefactor`；妖兽 `initMonsterRelationships`（`relationship-init.js`）+ `_senseTerritory`/`monsterDefendTerritory`（`monster-entity.js`）。
- 三期接入点：NPC `_considerMasterDiscipleGoals`/`_checkSeizeDiscipleObsession`/`inheritMasterLegacy`（`npc-entity.js`）+ `act_npc_teach_disciple`/`act_npc_protect_disciple`/`act_npc_visit_master`；遗志继承死亡钩子在 `tick-manager._collectDeaths`；夺舍执念走 `_resolveRevengeTarget`（认 `seizure`）。
- ID 用 snake_case 类型键，名称用中文（见 `relationship.json` 的 `name` 字段）。

## 待扩展

详见 `docs/worldbuilding/wiki/characters/relationship-todo.md`：信任度与背叛、隐秘关系暴露追杀、灵宠养成/反噬、化形妖兽建势力、夺舍流派深挖等（关系驱动 Goal、妖群/领地建边已于二期实现；师徒互动已于三期实现）。

## 来源

- 用户确认：做 NPC/妖兽关系网，全量覆盖（人际+人妖+妖妖+势力联动），重构为统一系统，第一期只做数据层、直接全量启用；二期做关系驱动决策；三期做师徒互动（传功选感悟增量、继承遗志含复仇与执念延续、夺舍先轻度）。
- 项目文档：`docs/世界观参考/凡人修仙传/人物关系与事件分析.md`、`docs/世界观参考/凡人修仙传/妖兽与修士关系分析.md`、`docs/世界观参考/遮天/妖兽与修士关系分析.md`、`docs/worldbuilding/relations.md`。
- 我的判断：边类型枚举划分、affinity/strength/decay 的默认数值、与势力外交分层的边界，为项目推演设定。
