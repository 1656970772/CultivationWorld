# ADR-026：妖兽资源化模拟闭环

最后更新：2026-05-30

状态：已实现

## 背景

项目内已经有妖兽实体、斩妖任务、任务奖励、材料捐献、信息传播和机会点系统，但此前妖兽主要是地图威胁：`monsters.json` 中的 `drops` 没有真正接入死亡结算，斩妖任务也没有锁定并杀死具体妖兽，宗门兑换丹药/法器没有消耗对应妖兽材料库存。

世界观参考支持把妖兽视为资源来源：

- `docs/世界观参考/凡人修仙传/物资产出与消耗.md`：妖丹、妖骨、妖皮、属性材料进入炼丹/炼器循环，高阶妖丹和妖兽材料具有保值性。
- `docs/世界观参考/凡人修仙传/散修生存方式.md`：猎杀妖兽是散修核心收入之一，关键材料包括妖丹、甲壳、精血等。
- `docs/世界观参考/完美世界/宗门任务体系.md`：宗门任务中有猎杀凶兽/妖兽讨伐，目标是击杀指定凶兽并带回兽骨、妖丹、宝骨等战利品。
- `apps/game/data/definitions/monsters.json`：已有妖兽等阶、属性、栖息地和 `drops` 字段，可作为运行时掉落结算的静态来源。

## 决策

### 一、妖兽掉落品阶化

`monsters.json` 的 `drops` 正式进入妖兽死亡结算。运行时按妖兽 `grade` 把兼容旧任务的基础资源映射为品阶化资源：

- `monster_core` → `monster_core_g1` 到 `monster_core_g9`
- `beast_material` → `beast_material_g1` 到 `beast_material_g9`

旧的 `monster_core` / `beast_material` 继续保留，用于已有奖励配置和兼容任务链。

### 二、斩妖任务锁定具体妖兽

`qt_slay_monster`、`qt_exterminate`、`qt_hunt_beast` 被纳入斩妖任务类型。接取任务时，`TickManager.resolveQuestLocation()` 对 `locationTarget: "monster"` 选择一个活体妖兽，写入固定坐标，并附带 `monsterId`；`NPCState` 新增 `questTargetMonsterId` 保存该目标。

执行任务最后一天时，`NPCDoQuestExecutor` 按 NPC 战力与妖兽战力结算：

- 胜利：目标妖兽死亡，记录 `monsterDeaths`，掉落妖丹/妖材写入 NPC 背包。
- 失败：NPC 受伤并任务失败，极低概率死亡。
- 若目标死亡或丢失，允许按配置在附近/同难度范围内重选活体目标。

### 三、宗门经济消耗妖兽材料

NPC 可以把妖丹/妖材上交宗门换贡献，宗门库存获得对应材料。兑换聚气丹、破境丹、低阶法器时支持 `requiredFactionItems`，库存不足时 GOAP 不规划或执行失败，库存充足时兑换会真实消耗宗门材料。

为避免“资源存在但没人猎杀/使用”，NPC 需求层增加了四个驱动：

- `need_npc_hunt_resources`：宗门缺破境丹/法器所需妖丹、妖材时，生成猎妖目标。
- `need_npc_active_quest`：已接任务必须优先推进，避免多日斩妖被其他目标长期打断。
- `need_npc_donate_materials`：身上有可上交材料时优先送回宗门。
- `need_npc_breakthrough_aid` / `need_npc_combat_gear`：临近突破时兑换并服用破境丹；无装备时尝试兑换法器。

`act_npc_accept_hunt_quest` 专门过滤斩妖类任务，并按宗门缺口品阶加权选择目标；`act_npc_do_quest` 的真实完成状态只由执行器按任务天数结算，避免第一天就交付多日任务。

这使闭环成立：

```
猎妖 → 妖丹/妖材 → 上交宗门 → 宗门炼丹/炼器库存 → 兑换丹药/法器 → 修炼/战力提升
```

### 四、高阶尸骸变成机会点

高阶妖兽死亡后会生成 `monster_corpse` 机会点和 `monster_king_death` 消息。机会点带品阶化 `rewardSource`，例如 `opportunity_corpse_g4`，领取时按品阶发放残余妖材/妖丹。低阶妖兽不生成全图热点，主要走任务和日常材料产出，避免机会点泛滥。

### 五、明确不做范围

本次不实现灵兽驯化、坐骑、战宠、妖族势力外交，也不启用完整“高阶材料导致怀璧其罪抢夺”的系统联动。高阶材料具备 `transferable: true` 和 `value`，可进入后续身家估值与抢夺系统。

## 数据与接口

- `apps/game/data/definitions/macro-resources.json 或 data/items/`：新增 `monster_core_g1..g9`、`beast_material_g1..g9`，字段含 `grade`、`value`、`transferable: true`、中文名和来源说明。
- `apps/game/data/balance/economy.json`：新增 `monsterResources`，配置斩妖任务类型、失败风险、尸骸最低等阶、尸骸价值、捐献贡献倍率；`npcExchange.options.*` 支持 `requiredFactionItems`。
- `apps/game/data/actions/npc-actions.json`：新增 `act_npc_accept_hunt_quest`，并让 `act_npc_do_quest` 的规划效果与真实完成结算分离。
- `apps/game/data/needs/npc-needs.json`：新增猎妖资源、活跃任务收尾、材料上交、破境辅助和法器装备需求。
- `apps/game/js/engine/monster/monster-resources.js`：集中封装妖兽掉落、战力估算和狩猎结算。
- `apps/game/js/engine/npc/npc-state.js`：新增 `questTargetMonsterId`。
- `apps/game/js/engine/world/tick-manager.js`：`resolveQuestLocation()` 对妖兽目标返回 `monsterId`；`_collectDeaths()` 保留掉落与击杀者信息；`_spawnNewsFromEvents()` 生成尸骸机会。
- `apps/game/tools/simulate-analysis.mjs`：加载妖兽定义和刷新后的出生配置，并输出猎妖接取、完成、失败、妖兽死亡原因、掉落与品阶材料库存统计。

## 后果

- 妖兽从抽象威胁变成可追踪、可猎杀、可上交、可消耗的资源节点。
- 宗门兑换不再只消耗贡献和灵石，还受炼丹/炼器材料库存制约。
- 高阶妖兽死亡成为局部信息热点，能被 NPC 听闻并前往争夺残余材料。
- 经济若膨胀，优先调整 `monsterResources` 的掉落概率、尸骸最低等阶、尸骸价值或领取上限，不削弱妖兽作为资源的核心定位。

## 验证

- `node apps/game/tools/test-monster-resource-loop.mjs`
- `node apps/game/tools/test-npc-consumption-chain.mjs`
- `node apps/game/tools/test-quest-reward-economy.mjs`
- `node apps/game/tools/test-info-propagation.mjs`
- `node apps/game/tools/test-goal-equivalence.mjs`

