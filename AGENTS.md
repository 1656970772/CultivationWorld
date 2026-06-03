# AGENTS.md instructions for F:\MyTools\WorldDymnic-Cursor

> 规则来源：由 `.cursor/rules/project-rules.md` 迁移，供 Codex 在本项目中读取和执行。
> 迁移日期：2026-05-25

## 文档规则

1. **所有讨论确认的设计决策，必须记录到对应的文档中。** 不允许只在对话中确认而不落地到文档。
2. **文档拆分为多个文档，像程序一样，有结构的文档架构。** 不允许所有内容堆在一个大文件里。每个主题一个文件，按目录分类。
3. **文档目录结构见 `docs/README.md`。** 新增文档时需同步更新导航。
4. **架构决策使用 ADR 格式**（Architecture Decision Record），存放在 `docs/decisions/` 目录下。
5. **文档修改需注明日期**（在文件头部 “最后更新” 字段）。

## 代码规则

1. **遵守设计模式，易于扩展和维护，低耦合。** 具体采用的设计模式见 `docs/architecture/design-patterns.md`。
2. **单一职责**：每个模块或类只做一件事。
3. **开闭原则**：新增功能（地形、势力类型、事件规则等）不需要修改核心代码，通过配置或新增策略类扩展。
4. **依赖倒置**：模块间通过事件总线或消息通信，不直接引用内部实现。
5. **数据驱动**：游戏运行时规则、配置、初始数据放在 `apps/game/data/`；编辑器模板数据放在 `apps/editor/data/`。代码只负责读取和执行。
6. **文件结构见 `docs/architecture/file-structure.md`。** 新增代码文件时需遵循已定义的目录结构。

## 世界观设定规则

1. **涉及游戏世界观设定（境界、寿命、势力类型、修炼体系、物品、天劫、秘境等）时，必须优先查找 `docs/世界观参考/` 目录下的参考资料。** 该目录汇总了凡人修仙传、遮天、完美世界、仙逆、一念永恒、斗破苍穹、牧神记、大道争锋、阳神、武破九荒、武逆乾坤、黎明之剑等小说的世界观设定。
2. **如果 `docs/世界观参考/` 中没有找到所需设定，必须主动告知用户，** 而非自行编造或使用训练数据中的模糊印象。
3. **设定决策确认后，需同步记录到 `docs/worldbuilding/wiki/` 对应的 Wiki 条目中，** 标明数据来源（如"参考自凡人修仙传"）。

## 数据配置规则

1. **所有游戏运行时数据放在 `apps/game/data/`，遵循 `docs/data/data-config-rules.md` 中的分类与命名规范。**
2. **新增数据文件时需同步更新 `docs/data/data-config-rules.md` 中的目录说明。**
3. **JSON 数据文件中的 ID 使用 snake_case，名称使用中文。**

## GAS 机制资产规则（ADR-042）

战斗/修炼等机制全面 GAS 化（参考虚幻引擎 Gameplay Ability System）。机制资产做成**数据驱动、可复用**的独立定义，新增时遵循以下规范：

1. **存放位置（单一职责，按类型分目录，每类一目录多文件）：**
   - **GameplayEffect（GE）** → `apps/game/data/effects/*.json`（如 `combat-effects.json`/`pill-effects.json`/`cultivation-effects.json`）。`EffectPool` 合并加载该目录下全部文件。
   - **GameplayAbility（GA）** → `apps/game/data/abilities/*.json`（如 `combat-abilities.json`）。`AbilityPool` 加载。
   - **GameplayCue（GC，特效/音效表现层，暂未实现，前缀预留）** → `apps/game/data/cues/*.json`。
   - **GameplayTag** → `apps/game/data/tags/tags.json`（层级字符串登记表，加载期校验未登记 Tag）。
2. **id 前缀命名（强制，便于跨文件引用与复用，沿用 snake_case）：**
   - GE 以 **`ge_`** 开头（如 `ge_lock_hp`、`ge_qi_pill`、`ge_breakthrough_full_heal`）。
   - GA 以 **`ga_`** 开头（如 `ga_lock_hp`、`ga_escape_talisman`）。
   - GC 以 **`gc_`** 开头（预留，如 `gc_breakthrough_flash`）。
   - GameplayTag 用层级字符串、`.` 分隔、PascalCase 段名（如 `State.Dying`、`Trait.Physique.<id>`），不用前缀。
3. **可复用：** 同一 GE/GA 写一次，可被多个 GA 的 `grantsEffects`、多个物品的 `grantsAbilities`、多处代码 `EffectPool.get('ge_xxx')` / `AbilityPool.get('ga_xxx')` 引用。**新增机制优先复用已有 GE/GA，而非复制。**
6. **GE 必须是通用机制原语，禁止"一物一专用 Effect"。** GE 只声明机制（改哪个 attribute、用什么 op、默认量纲/夹取），**具体数值由挂载来源提供**：丹药/灵草/灵果/强者精血等在 `items.json` 的 `effects` 字段里声明 `{ effect: "ge_xxx", magnitude, magnitudeType?, decay?, clamp?... }`，经 `EffectEngine.applyEffect(target, def, { spec })` 用 spec 覆盖 GE 默认值后结算。
   - 正例：`ge_add_qi`（瞬间加真气）/`ge_add_hp`（加血夹 maxHp）/`ge_add_progress`/`ge_add_breakthrough_bonus`/`ge_full_heal`，被聚气丹/灵果/精血/灵石（货币亦可服用，ADR-043）等多来源复用，数值各取自各自物品。
   - 反例：`ge_qi_pill`/`ge_breakthrough_pill` 这种把"聚气丹"具体数值写死在 Effect 里的专用 Effect（已废弃）。
   - "服用物品即生效"的来源统一走 `npc-economy.applyItemEffects(entity, itemId)` 入口（读物品 `effects` 逐条施加，返回各属性实际增量 delta 供叙事事件）。
4. **机制化迁移须可回退、不改变现有行为：** 把现有功能迁为 GE/GA 时，用数据开关（如 `traitEffects.enabled`/`pillEffects.enabled`）控制新旧路径，且新路径数值与旧逻辑严格等价；以**真实多种子长程模拟**直接观察行为是否一致来校验，**严禁用任何指纹/golden 一致性自证**（见"验证规则"）。
5. **数值单一真相源：** 迁移时数值仍以原平衡配置（如 `cultivation.json`/`economy.json`）为单一真相源，GE 只承载机制；字段说明见 `docs/systems/gameplay-ability-system.md`，决策见 `docs/decisions/adr-042-gameplay-ability-system.md`。

## 验证规则

1. **严禁"黄金指纹"（golden-fingerprint）一切形态。** 不允许：
   - **靠指纹/哈希一致性自证**——不得记录一个"基线指纹/golden fingerprint"，再用"重跑后指纹一致"作为"功能正确/行为未变"的证据。指纹只能证明字节相同，证明不了行为合理；改逻辑本就该让行为变化，用指纹一致反而说明新逻辑没生效。
   - 给特定对象开特权（如让天才妖兽免疫、锁血、无限资源）。
   - 隔离干扰因素（如临时关闭妖兽生成）。
   - 造一次性作弊脚本/特例数据来"自证能跑通"。
   - 文档/注释/工具中不要再引入"指纹/fingerprint/golden/零漂移指纹"这类自证话术；要描述"开关默认关闭、不改变现有行为"时，直接这样陈述事实即可。
2. **验证必须在真实、完整的模拟环境中进行**：用正常配置的世界引擎跑模拟，**直接观察真实行为数据**（发生了什么、是否合理、能否恢复）。临时探针脚本仅可用于定位 Bug 根因，不得作为"功能达成"的证据。
3. **平衡/节奏/逻辑类改动以真实长程模拟的统计结果为准**（多种子、足够天数、全量 NPC），看现象本身，而非单个特例对象的理想轨迹，也不是某个指纹值。
4. **校验"未破坏旧行为"也要看行为本身**：开关默认关闭时，跑真实模拟对比关键行为统计是否与改前一致；不得以"指纹相同"代替对行为的实际观察。

## 语言规则

1. 默认使用简体中文回复用户。
