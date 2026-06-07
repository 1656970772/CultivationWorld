# 数据模型：关系网（Relationship）

> 最后更新：2026-06-07（三期：师徒互动，ADR-029；数值修为口径）
>
> **状态：已实现**（ADR-027 数据层 + ADR-028 关系驱动决策）。运行时为世界级 `RelationshipSystem`（`js/engine/world/relationship-system.js`），
> 配置见 `data/balance/relationship.json`。NPC 侧 `RelationshipGraph`（`js/engine/npc/relationship.js`）
> 为本系统的兼容查询视图（绑定模式），承载旧的 grudge/gratitude 接口（复仇链零改动）。
> 二期起关系边经 `goalsEnabled`（默认 true）驱动 NPC Goal 与妖兽护群/护领地行为；三期起 `master`/`disciple` 边驱动师徒互动与遗志继承（见末"关系驱动决策"）。

## 关系边（RelationEdge）

```javascript
RelationEdge {
  fromId: string,        // 关系发出方实体 id（NPC / 妖兽）
  toId: string,          // 关系指向方实体 id
  type: string,          // 关系类型（RelationType，见下）
  affinity: number,      // 好感 -100~100（取自 edgeType 默认）
  strength: number,      // 强度 0~100（事件叠加，随 decay 衰减）
  originTick: number,    // 建边的世界日
  originEventType: string|null  // 建边触发事件类型（eventBindings 键 / null）
}
```

存储：`Map<fromId, Map<"toId|type", RelationEdge>>`（按发出方分桶，键为 `toId|type`，故同一对实体可有多种类型边）。

## 关系类型（RelationType）

| 分层 | 类型键 | 名称 | 对称类型 | 默认衰减 |
|------|--------|------|----------|----------|
| 人际 | `master` / `disciple` | 师傅 / 徒弟 | 互为对称 | 0 |
| | `dao_companion` | 道侣 | 自对称 | 0 |
| | `kin` | 血亲 | 自对称 | 0 |
| | `same_sect` | 同门 | 自对称 | 1（floor 10） |
| | `ally` / `rival` / `enemy` | 盟友 / 竞争 / 宿敌 | ally 自对称 | 1 / 1 / 0.5 |
| | `benefactor` / `grudge` / `gratitude` | 恩人 / 仇怨 / 恩义 | — | 0.2 / 0 / 0 |
| 人妖 | `spirit_pet` / `mount` | 灵宠 / 坐骑 | — | 0 |
| | `beast_grudge` / `territory_threat` | 妖兽仇敌 / 领地入侵 | — | 0.5 / 2 |
| 妖妖 | `pack_member` / `pack_leader` / `beast_rival` | 同群 / 妖群首领 / 妖兽争斗 | pack_member 自对称 | 0 / 0 / 1 |

> 数值（affinity/strength/decay/decayFloor）以 `data/balance/relationship.json` 的 `edgeTypes` 为准。

## 事件 → 关系边（eventBindings）

`tick-manager.js` 在既有事件结算点调用 `_applyRelationEvent(eventType, fromId, toId)`，按 `eventBindings` 落边：

| eventType | edgeType | 方向 |
|-----------|----------|------|
| `faction_war_attacked` | `enemy` | 败方成员 → 攻方成员 |
| `humiliated` | `rival` | 受害者 → 加害者 |
| `demoted` | `rival` | 被贬者 → 势力领袖 |
| `dao_companion_matched` | `dao_companion` | 双向 |
| `birth` | `kin` | 父母 → 子女（对称双向） |
| `same_sect_init` | `same_sect` | 同门两两（初始化） |
| `monster_grudge` | `beast_grudge` | 妖兽 → NPC |
| `pack_init` | `pack_member` | 同群妖兽两两（对称，二期） |
| `pack_leader_init` | `pack_leader` | 群内首领 → 成员（二期） |
| `territory_intrusion` | `territory_threat` | 妖兽 → 闯入老巢的 NPC（二期，`decay=2` 自然消退） |

> `grudge`/`gratitude` 边由记忆系统经 `RelationshipGraph` 兼容路径写入（`recordMemory` → `addGrudge`），不在 `eventBindings` 重复触发，避免强度双计。
> `pack_init`/`pack_leader_init` 在世界创建与妖兽重生时由 `initMonsterRelationships`/`_linkRespawnedToPacks` 调用；`territory_intrusion` 由妖兽 `_senseTerritory` 经 `worldContext.recordTerritoryThreat` 调用。

## 强度与衰减规则

- 首次建边：显式传 `strengthDelta` 时以 delta 为初值（累积型，如 grudge/enemy）；否则用类型默认 `strength`（定值型，如 master/dao_companion）。
- 重复建边：`strength += delta`，clamp 0~100。
- 每日 `RelationshipSystem.tick()`：`strength` 按 `decay` 向 `decayFloor` 回落（`decay<=0` 不变）；归零且 floor 为 0 的边清理。
- 实体死亡（妖兽）：`removeEntity` 清理其出边+入边。

## 初始关系（init）

`relationship-init.js` 据 `npcs.json` 的 `factionId + role` 推导：

- `same_sect`：同势力弟子两两互建（`maxPerFaction` 规模护栏）。
- `master`/`disciple`：同势力 `leader`/`elder` 按境界就近收弟子（`discipleRoles` = `core_disciple`/`disciple`/`inner_disciple`/`outer_disciple`，`maxDisciplesPerMaster`）。三期修正：原 `discipleRoles` 仅 `disciple`/`outer_disciple` 与实体数据主角色 `core_disciple` 不匹配，导致 master 边从未建立，现已对齐（实测 master=55 边）。

妖兽侧（二期 `initMonsterRelationships`，受 `monsterPack` 配置）：

- `pack_member`：同 `family` 且老巢（`homeX/homeY`）距离 ≤ `packRadius` 的妖兽两两互建（`maxPackSize` 护栏）。
- `pack_leader`：群内最高 grade 妖兽 → 其余成员（`buildPackLeader` 开关）。
- `swarmBehavior===true` 物种由 `MonsterSpawner` 在 `swarmClusterRadius` 内成簇生成（`swarmClusterSize`），使其天然聚群后再建边。

## 关系驱动决策（二期，ADR-028）

受 `relationship.json -> goalsEnabled`（默认 true，`!== false` 为开）总 gate；关闭即回退一期纯数据态（默认关闭不改变既有行为）。

- **NPC Goal**（`GoalSource.RELATIONSHIP`，`npc-entity.js._buildRelationshipGoals`，按优先级单点锁定，写 `state.targetRelationshipId`，经 `relationship_target` resolver 解析坐标）：
  - 护短同门 `assist_sect_mate`：高强度 `same_sect`/`ally` 对象持有复仇目标（遭袭）时前往支援（`act_npc_assist_ally`，结算强化 `same_sect`）。
  - 报恩 `repay_benefactor`：对高强度 `benefactor`/`gratitude` 对象低频探望（`act_npc_visit_benefactor`，结算强化 `gratitude`）。
  - 关系复仇：不另造系统，`_resolveRevengeTarget` 兼认高强度 `enemy` 边（阈值 `npcGoals.relationRevenge.minEnemyStrength`），复用现有 hunt/kill 复仇链；深关系被杀仍走执念。
- **妖兽行为**（`monster-entity.js`）：
  - `_senseTerritory`：对进入 `home±wanderRadius` 的 NPC 建 `territory_threat` 边并记 `state.intruderNpcId`。
  - `monsterCallPack`：读 `pack_member` 边，对附近空闲同群设同一 `targetNpcId` 协防。
  - `monsterDefendTerritory`（tier2/tier3 BT `repel-intruder`，受 `territory.defendEnabled`+`minTierForDefense`）：对领地入侵者（含强者）发动攻击，区别于只猎弱者的 `_findPrey`。

## 师徒互动（三期，ADR-029）

`master`/`disciple` 边驱动的师徒专属行为，受同一 `goalsEnabled` gate。复用二期 Goal 单点锁定架构（`masterDiscipleGoals` 参数块）：

- **NPC Goal**（`npc-entity.js._considerMasterDiscipleGoals`，并入 `_buildRelationshipGoals`）：
  - 师傅传功 `teach_disciple`：对高强度 `master` 边、总修为低于点化阈值（`totalCultivation < discipleMaxTotalCultivation`）且在范围的徒弟低频前往点化（`act_npc_teach_disciple`，给徒弟 `experienceCultivation` 增量 + 强化 `master` 边）。
  - 师傅护徒 `protect_disciple`：徒弟遭袭（`hasRevengeTarget`）时前往护卫（`act_npc_protect_disciple`，优先级 8 > 护短同门 6/传功 7，范围更大）。
  - 徒弟尽孝 `visit_master`：对高强度 `disciple` 边师傅低频探望（`act_npc_visit_master`，强化 `disciple` 边）。
- **继承遗志**（`tick-manager._collectDeaths` 师傅死亡钩子 → 徒弟 `inheritMasterLegacy`）：① 写 `master_lost` 记忆触发 `revenge` 执念（对凶手，复用复仇链）；② 复制师傅未竟非复仇执念（`inheritableObsessionTypes`）按 `inheritObsessionIntensityMult`(0.7) 折扣给徒弟。
- **夺舍（轻度）**（`npc-entity._checkSeizeDiscipleObsession`，`onPreTick`）：邪修（低 `justice`+低 `loyalty`）高境界师傅对高资质徒弟起 `seizure` 执念锁定徒弟 → `_resolveRevengeTarget` 认 `seizure` → 复用 hunt/kill 击杀链。未做真正身体接管，留待深挖为流派（见 `关系系统后续扩展项` 第 8 项）。

## 与势力外交的分层

本模型管理**个人/族群层**关系（实体 ↔ 实体）。**势力间外交**仍由 `faction.state.relations`（-100~100 矩阵，见 `faction.md` / `combat.json`）管理，二者并存不混淆。

## 存档

`WorldEngine.getWorldSnapshot()` 输出 `relationships`（`RelationshipSystem.allEdges()` 扁平数组）与 `relationshipStats`，经 `SaveManager` 序列化；`RelationshipSystem.snapshot()/loadFrom()` 提供世界级（再）水化。NPC 兼容视图在绑定模式下不重复序列化（`_backedBySystem`）。

## 相关

- `docs/decisions/adr-027-relationship-network.md`、`docs/decisions/adr-028-relationship-driven-decisions.md`、`docs/decisions/adr-029-master-disciple-interactions.md`
- `docs/worldbuilding/wiki/characters/relationship-types.md`、`关系系统后续扩展项`
- `docs/data-models/npc.md`（NPC 实体）、`docs/data-models/faction.md`（势力外交）

