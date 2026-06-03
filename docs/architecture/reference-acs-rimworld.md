# 参考借鉴：了不起的修仙模拟器 & RimWorld 世界架构

> 最后更新：2026-06-02
> 类型：架构参考资料（非 ADR，不是已落地决策；用于指导后续重构与设计取舍）
> 来源：
> - 《了不起的修仙模拟器》（Amazing Cultivation Simulator，下称 **ACS**）反编译 C# 源码（`XiaWorld.*` 命名空间）
> - RimWorld 官方公开 C# 源码（`Verse.*` / `RimWorld.*`，43 个文件 + 知识图谱）
> 性质：本文是「读它们的代码 → 对照我们现状 → 提炼可借鉴/可重构点」的笔记，写代码时翻这里取经。

---

## 0. 为什么参考这两个项目

| 项目 | 题材契合度 | 架构成熟度 | 对我们的价值 |
|------|-----------|-----------|-------------|
| **ACS** | 高（修仙：境界/功法/瓶颈/雷劫/法宝/阵法/灵兽） | 单体上帝类，但子系统建模贴题 | **数据模型**直接对题：Gong 境界阶段、Neck 瓶颈、Modifier 特质 |
| **RimWorld** | 中（殖民地生存，但 AI/事件/物品范式通用） | 业界教科书级数据驱动 + 组件化 | **架构范式**：Def / Comp / Job-Toil / Incident 四支柱，可移植性极强 |

一句话：**RimWorld 教我们"怎么组织"，ACS 教我们"修仙怎么建模"。**

---

## 1. 三方架构总览对照

| 维度 | ACS（XiaWorld） | RimWorld（Verse） | 我们（WorldDynamic） |
|------|----------------|-------------------|---------------------|
| 实体模型 | `Thing` 万物基类 + `Npc : Thing` 组合大量 Mgr | `Thing` → `ThingWithComps` + 组件 | `BaseEntity` 组合（StaticData/RuntimeState/Need/Behavior/Inventory） ✅ |
| 静态/运行时分离 | `ThingDef`（XML）vs JsonProperty 字段 | `Def`（XML，全局只读）vs Thing 实例 | `StaticData`（freeze）vs `RuntimeState` ✅ |
| 组件化 | `Modifier` 挂 `NpcPropertyMgr`，统管 buff/特质/经历 | `ThingComp` 挂 Thing，被动规则插件 | **缺**：逻辑散在实体类 + actions ❌ |
| 行为系统 | 三套：`JobEngine`(做) + `ThingStep`(跨帧状态机) + `LSBTree`(选) | `Job`(意图) + `Toil`(原子步) + `JobDriver`(协程编排) | `Action`(单步) + `GOAP` + `BT` ⚠️ 缺多步编排 |
| 事件系统 | `GameEventMgr` + `EventBase`(Check/Enter) 权重调度 | `IncidentWorker`(CanFireNowSub/TryExecuteWorker) | `world-rules` 大执行器 ⚠️ 非插件式 |
| 数据驱动 | XML Def + JsonConver + Def `Parent` 继承 | XML Def + DefDatabase + `PostLoad/ConfigErrors` | JSON + pools 注册表 ✅，⚠️ 缺加载期校验 |
| 存档 | 全量 `SL_GAME` 聚合根 + `GetSaveData` | （未在样本内） | snapshot + seed/replay（ADR-038） ✅ |
| 调度 | Manager 链式 Step + 分帧 round-robin | TickerType + tick 分级 | `tick-manager` 服务编排 ✅ |

图例：✅ 已具备且不弱于参考 / ⚠️ 有但有差距 / ❌ 缺失

**结论**：我们的「实体组合 + 静态运行时分离 + 数据驱动 + 注册表 + 确定性存档」骨架已经站在正确范式上，甚至比 ACS 的上帝类更干净。**主要差距集中在四点**：组件化(Comp)、多步行为(Toil)、事件插件化(Incident)、加载期校验(ConfigErrors)。下面逐条展开。

---

## 2. RimWorld 四大支柱（架构精髓）

### 2.1 Def —— 一切规则是只读全局表

**精髓**：把几乎所有可配置规则建模为 `Def` 子类（`ThingDef`/`JobDef`/`WeatherDef`/`FactionDef`/`IncidentDef`），纯数据、全局单例、`DefDatabase<T>.GetNamed(name)` 查询。运行时实体只持一个 `def` 引用，**类型和能力都写在 Def 上，实例很轻**。

关键设计点：
- **`thingClass` / `driverClass` / `workerClass` / `compClass`**：Def 里用一个"类型名"字段把数据指向具体策略类 → 数据驱动地选择代码实现（策略模式 + 配置化）。
- **嵌套 Properties 避免顶层膨胀**：`ThingDef.building` / `.plant` / `.race` / `.projectile` 各是一个子结构对象，而不是把几百个字段平铺在 `ThingDef` 上。
- **三段生命周期**：`PostLoad()`（图形/ID 解析）→ `ResolveReferences()`（交叉引用解析为对象）→ `ConfigErrors()`（启动期校验，配置错误直接报错而非运行时静默跑偏）。
- **Def 继承**：XML `Parent`/`Abstract`，子 Def 覆盖父字段，减少重复。

```
ThingDef {
  thingClass = "Building_Bed"      // 指向 C# 类
  comps = [ {compClass:"CompRottable", ...}, ... ]  // 组合能力
  building = { ... }   // 领域子结构
}
```

### 2.2 Thing + ThingComp —— 组合优于继承

**精髓**：实体能力靠**挂组件**扩展，而不是堆继承链或在基类塞 if。

- `ThingWithComps` 持 `comps[]`，`GetComp<T>()` / `TryGetComp` 取组件。
- 每个 `ThingComp`（`CompLifespan` 寿命到期销毁、`CompRottable` 腐烂、`CompExplosive` 引爆、`CompForbiddable` 禁用）是一个**被动世界规则插件**，提供钩子：`CompTick` / `CompTickRare` / `PostPreApplyDamage` / `PostSpawnSetup`。
- `CompProperties` 是 Def 侧的序列化配置（半径、寿命 tick），运行时 `new Comp` 注入 `props`。
- **开闭原则在这里成立**：新增"会爆炸的灵矿" = 新 ThingDef + 挂 `CompExplosive`，**不改** Building/Plant 基类，不改主循环。

### 2.3 Job + Toil —— AI 是可跳转的原子步协程

**精髓**：复杂行为不塞进一个函数，而是拆成**原子步 Toil** 的序列，由 `JobDriver.MakeNewToils()` `yield` 出来，像协程。

- **Job**：一次任务实例（目标 A/B/C、`bill`、`RecipeDef`）。
- **Toil**：原子步骤，含 `initAction` / `tickAction` / `defaultCompleteMode`（Instant/Delay/PatherArrival/Never）。
- **可复用 Toil 库**：`Toils_Goto.GotoThing`、`Toils_Haul.StartCarryThing`、`Toils_Recipe.DoRecipeWork`、`Toils_General.Wait` —— 乐高积木式拼装。
- **失败条件声明式挂载**：`.FailOn(cond)` / `FailOnDespawnedOrNull(TargetIndex.A)` 是扩展方法，挂在 Toil 或整个 JobDriver 上，**和步骤解耦**，不在执行器深处散落 `return false`。
- **条件跳转**：`Toils_Jump.JumpIf` 实现协程式分支/循环（如"8 格内还有材料就回去继续搬"）。

`JobDriver_DoBill`（做工作台配方）是范例：`走到工作台 → 没料则采集 → 搬料 → 创建半成品 → DoRecipeWork(按 stat 扣 workLeft) → 完成入库`，全程挂着"bill 被删/原料腐烂/工作台被毁就中止"的失败条件。

### 2.4 Incident —— 世界事件是 Storyteller 调度的 Worker 插件

**精髓**：世界事件 = `IncidentWorker` 子类，**触发条件与执行分离**。

- `CanFireNowSub(parms)`：能否触发（如热浪只在季节温度 ≥20 时；崩溃飞船只在没有现存机械集群时）。
- `TryExecuteWorker(parms)`：执行，**只改世界数据** + `SendStandardLetter` 统一玩家反馈（叙事和逻辑分离）。
- `IncidentParms.points`：威胁点数，事件强度随之缩放（`RadiusFactorPerPointsCurve`）。
- `IncidentDef` 指定 `workerClass` + 配置 → 加 mod 事件只加 Def + Worker，不改主循环。

---

## 3. ACS 修仙建模（数据模型直接对题）

### 3.1 境界 / 功法（Gong）—— 两级进度 + 瓶颈节点

ACS 的修炼数据模型比 flat level 贴叙事得多，**强烈建议参考**：

```
GongDef {                       // 功法静态定义
  GongKind, ElementKind         // 功法类型/属性
  Stages: [ GongStage ]         // 境界阶段表
  Skill, Magic, GodGuards...    // 各阶段解锁内容
}
GongStage {
  Level                         // 阶段等级
  Value                         // 此阶段修为上限
  Necks: [ GongStageNeck ]      // 瓶颈节点（一个阶段可有多个）
}
GongStageNeck {
  Kind                          // 瓶颈类型（雷劫/心魔/...）
  NeckCountdown                 // 限时倒计时
  AddModifier                   // 突破时挂的 Modifier（成功/失败）
  ResourceCost: [ ... ]         // 突破消耗
}
```

运行时 `NpcPractice` 持：`Gong`(当前功法引用) + `StageIndex/StageValue`(进度) + `NeckIndex/TouchNeck/TimeEnterNeck`(瓶颈状态)。
- `LogicStage`（功法内阶段）vs `GongStateLevel`（展示用大境界）**分离**。
- 修炼 Step **独立于 Job**：NPC 在干活时瓶颈倒计时照走。
- 瓶颈 = 限时 + 消耗 + 成功/失败 Modifier + 解锁内容 + (雷劫则生成劫云 Fight 实体)。

> 对照我们：当前境界推进是 `cultivationProgress` + `insight` 双源（ADR-016/017）。可借鉴 ACS 把"瓶颈/破境"建模成**数据节点 `Neck`**（倒计时、消耗、成败 Modifier），而不是写死在 action 里。

### 3.2 Modifier —— buff / 特质 / 经历的统一抽象

ACS 把 **Buff、Debuff、先天特质、后天经历** 全部统一为 `Modifier`，挂在 `NpcPropertyMgr.m_lisModifiers`，有**对称生命周期**：

```
ModifierBase: Init → Enter → Step(dt) → Leave → Kill
```

- **Enter/Leave 对称**：Enter 时 `ModifierProperty(+addV*Scale)` 把属性修正**叠加到 PropertyExData 层**（不是直接改字段），Leave 时撤销 → 杜绝"加了 buff 忘了减"。
- `ModifierDef` 数据驱动：`Properties`（属性修正）+ `Skills`（技能加成）+ `BanJobs`（禁止行为）+ 嵌套 `Modifiers` + `Moods`。
- `Scale` 乘子统一缩放所有数值效果（难度/境界倍率一处控制）。
- `Duration` 支持字符串属性名（`"MaxHp"`）→ 动态时长；`Stack`/`MaxStack` 层数。
- 移除条件多元：到期 / `LockJobID`(行为结束) / `BindRoom` / `LockThingID`(目标失效)。

> 这正是我们目前最大的缺口（见 §5.1）：我们的属性修正散在各 action 里直接 `state.set`，没有统一的"叠加层 + 对称撤销"。

### 3.3 ThingStep —— 跨帧小状态机

ACS 第三套行为机制：`ThingStep`（`Enter / Step(dt)→ThingStepRes / Leave`），挂在任意 Thing 上，是**短期可存档状态机**（孵化、加 Modifier、进战斗地图、雷劫倒计时）。返回 `emDestroySelf`(移除步骤) / `emDestroyThing`(销毁实体)。在 `Thing.Step` 中倒序遍历执行。

> 这与 RimWorld 的 Toil 是同一思想的两种形态：**把"持续若干 tick 的过程"做成一等公民对象**，而不是在主循环里用 if + 计时器手搓。

### 3.4 EventDriver —— 通用参数槽事件

`EventBase`(Check/Enter) + `EventData`(Kind/Weight/fParam1-4/sParam1-4/WorldFlag)：
- **通用参数槽**（fParam/sParam）减少事件类型爆炸。
- `EventSaveData` 存跨事件状态 → 支持多阶段剧情。
- Kind 分组 + Weight 随机 + `LastHappen` 冷却 → 世界事件 pacing。
- Check + Enter 分离：Enter 失败可换同 Kind 其他事件重试。

---

## 4. 我们已经做对的（不要动）

读完两个标杆后，确认以下设计**已经站在正确范式上**，无需重构，避免"为重构而重构"：

1. **`BaseEntity` 组合**（StaticData + RuntimeState + Need + Behavior + Inventory + Spatial）—— 比 ACS 248KB 的 `Npc.cs` 上帝类干净得多。
2. **StaticData(freeze) / RuntimeState 分离** —— 对标 Def/Thing，方向一致。
3. **pools 注册表**（ActionPool/NeedPool/ItemRegistry/EntityRegistry）—— 对标 DefDatabase。
4. **GOAP + GOBT 三层 AI**（选目标 Utility / 规划 / 执行）—— ACS 用 Lua 硬编码 600 行 `NodePreCondition`，我们更数据驱动。
5. **确定性 seed + replay（ADR-038）** —— ACS `SL_GAME.Seed` 同源思路，我们已落地。
6. **服务化 tick 编排（ADR-030）** —— 对标 Manager 链式 Step，且职责拆分更细。

---

## 5. 可借鉴 / 可重构点（按优先级）

> 原则：**不为重构而重构**。每条都标注「收益」「成本」「建议时机」，写代码前先评估。

### 5.1 【高收益】引入统一 Modifier/Buff 生命周期

**问题**：当前属性修正散落在各 action 的 `state.set` 与 `world-rules.js` 的 `_aggregateModifierEffects`（仅世界级 modifier，且是临时结构）。NPC 级没有统一的"特质/buff/经历"叠加层，加减不对称、难追溯。tuning-v6 已经踩过坑（声明式 `op:add` 无上限导致 stability 溢出 3000+）。

**借鉴**：ACS `ModifierBase`（Enter/Step/Leave 对称）+ RimWorld `ThingComp`（被动规则）。

**落地草案**（`engine/abstract/modifier.js` + `pools/modifier-pool.js`）：
```
class Modifier {
  enter(entity)   // 把 effects 叠加到 entity.state 的"修正层"（不是直接改基值）
  step(entity, dt)// 倒计时 / 触发条件
  leave(entity)   // 对称撤销
}
// 数据驱动：data/modifiers/*.json { id, effects:{maxHp:+10}, duration, stack, scale, banActions:[] }
```
关键：属性读取改为 `基值 + Σ修正层`（RuntimeState 加 `getEffective(key)`），杜绝直接覆写基值。

**收益**：高（治本，统一特质/丹毒/中毒/增益/灵根加成/境界压制）。**成本**：中（要改属性读取路径，需回归黄金指纹）。**时机**：下一个涉及"状态效果"的功能（如丹药 buff、心魔 debuff）落地前先建这层。

### 5.2 【高收益】境界/破境改为 Gong-Stage-Neck 数据模型

**借鉴**：ACS `GongDef.Stages[].Necks[]`（§3.1）。

把"破境瓶颈"从 cultivation-actions 的代码逻辑抽成数据节点：`data/cultivation/gong/*.json` 描述阶段表 + 瓶颈（倒计时/消耗/成败 Modifier/解锁）。代码只读节点驱动。

**收益**：高（修仙核心循环数据化，配表即可调境界曲线，对题）。**成本**：中。**时机**：做"多功法/功法切换/破境差异化"时。

### 5.3 【中收益】Action 升级支持多步编排（Toil/Step 思想）

**问题**：当前 `Action` 是单步（execute 一次完成），"采灵草→炼丹→入库"这类长流程只能拆成多个独立 action 靠 GOAP 串，无法表达"同一意图内的有序子步 + 中途失败中止"。

**借鉴**：RimWorld `Job + Toil`（§2.3）/ ACS `ThingStep`（§3.3）。

**落地草案**：保留 GOAP 选"做什么"，为长流程 action 增加可选的 `steps[]`（每步 `{ enter, tick(dt)→done/fail, fail }`）+ 声明式 `failOn`。短行为不变（向后兼容）。

**收益**：中（炼丹/突破/闭关等长流程更真实，失败条件声明式）。**成本**：中高（行为执行路径改造，需 BehaviorSystem 配合）。**时机**：当出现 3+ 个"多阶段长流程"行为时再做，否则收益不足。

### 5.4 【中收益】world-rules 重构为 Incident 插件

**问题**：`world-rules.js` 的 `ResourceRegenExecutor` 是 250 行 if 堆叠的大执行器，天灾/modifier 生灭混在一起，新增世界事件要改这个大文件。

**借鉴**：RimWorld `IncidentWorker`（`canFire` + `execute` + 标准日志）+ ACS `EventBase`（Check/Enter + 权重）。

**落地草案**（`engine/world/incidents/`）：
```
class Incident { canFire(worldCtx):bool;  execute(worldCtx):result;  weight; cooldownDays }
// data/world/incidents/*.json 驱动，IncidentScheduler 按 weight + 冷却 + canFire 抽样触发
```
天灾、灵潮、秘境开启、宗门危机都收编为 Incident。资源结算（regen/salary）保留为固定 tick 步骤，不属于 Incident。

**收益**：中（世界事件可扩展、可配表、pacing 可控）。**成本**：中。**时机**：下一批世界事件（灵潮/秘境/天象）设计时。

### 5.5 【中收益】加载期 ConfigErrors 校验

**借鉴**：RimWorld `Def.ConfigErrors()`（启动期校验，配置错误即失败）。

在 `config-loader.js` 加载各 JSON 后增加一层 schema/引用校验：action 引用的 itemId 是否存在、need 引用的 action 是否注册、faction 模板引用的 npc 是否存在等。**配置错误在启动时报出**，而不是模拟跑到一半静默跑偏（我们调平衡时多次遇到这类"沉默 bug"）。

**收益**：中（省调试时间，模拟可信度）。**成本**：低。**时机**：随时可做，建议尽早（投入小）。

### 5.6 【低收益 / 暂不做】Def Parent 继承、Lua 扩展、全量存档

- **Def `Parent` 继承**：ACS/RimWorld 都有，但我们 JSON 数据量还不大，`$ref` 或浅合并即可，暂不需要完整继承机制。
- **Lua/反射扩展点**：ACS 用 Lua 扩展 mod，我们纯 JS 用 handler 注册表更简单，**不要引入**。
- **全量 SL_GAME 存档**：浏览器 localStorage/IndexedDB 体积敏感，我们 seed+replay 方向更优，**不要照搬全量快照**。

---

## 6. 反面教材（明确不要学的）

| 反模式 | 出处 | 为什么不学 |
|--------|------|-----------|
| 上帝类（`Npc.cs` 248KB / `Thing.cs` 72KB） | ACS | 职责过载，我们已用 service 拆分，保持 |
| sim 与 render/碰撞耦合在实体上 | ACS（Unity） | 我们 sim 在 Worker、render 在主线程，严格分离，保持 |
| 600 行硬编码 `NodePreCondition` | ACS | 用少量可组合条件原语 + JSON 条件名映射替代 |
| 三套并行行为系统（Job/Step/BT）新人理解陡 | ACS | 我们保持"BT 选 / Action 做 / (可选)step 展开"清晰三层 |
| 反射 + Lua 双实现路径 | ACS | 纯 JS handler 注册表，可静态分析 |
| 全局 `EventMgr.EventTrigger` 隐式广播 | ACS | 用显式 tick phase + 明确事件总线 |

---

## 7. 行动清单（建议顺序）

1. **【尽早 · 低成本】** §5.5 加载期 ConfigErrors 校验 —— 投入小、立刻省调试时间。
2. **【下个状态效果功能前】** §5.1 统一 Modifier/Buff 生命周期 —— 治本，影响后续所有"特质/丹药/debuff"。
3. **【做境界差异化时】** §5.2 Gong-Stage-Neck 数据模型 —— 修仙核心循环数据化。
4. **【下批世界事件时】** §5.4 world-rules → Incident 插件。
5. **【出现 3+ 长流程行为时】** §5.3 Action 多步编排。

> 每项落地都应：先备份 → 跑黄金指纹基线 → 改 → 回归（参考 `docs/balance/simulation-iteration-process.md`）→ 写 ADR。

---

## 附录：源码位置

- ACS 关键源码：`F:\MyTools\ProjectAny\AmazingCultivationSimulator\3.代码\关键源码\XiaWorld*\`
  - 核心：`XiaWorld\Thing.cs` `Npc.cs` `NpcPractice.cs` `GameDefine.cs`
  - 修饰符：`XiaWorld.Modifier\ModifierBase.cs`
  - 行为：`XiaWorld.ThingStep\` `XiaWorld.LSBTree\`
  - 事件：`XiaWorld.EventDriver\`；存档：`XiaWorld.SaveLoad\`
  - 补全（IL 导出）：`3.代码\IL导出\Assembly-CSharp\XiaWorld\`（`GongDef`/`NpcPropertyMgr`/`GameEventMgr` 等）
- RimWorld 源码：`F:\MyTools\ProjectAny\RimWorld\3.代码\脚本\Source-上游\`
  - Def：`Verse\Defs\DefTypes\`（ThingDef/JobDef/WeatherDef）+ `RimWorld\Defs\DefTypes\FactionDef.cs`
  - Comp：`Verse\ThingComps\` + `RimWorld\ThingComps\`
  - Job/Toil：`Verse\AI\JobDrivers\`
  - Incident：`RimWorld\Game\Storyteller\Incidents\Workers\`
  - 知识图谱：`F:\MyTools\ProjectAny\RimWorld\.understand-anything\knowledge-graph.json`
