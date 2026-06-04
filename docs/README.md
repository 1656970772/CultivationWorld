# 修仙世界模拟器 —— 文档中心

> 项目代号：WorldDynamic
> 创建日期：2026-05-23
> 最后更新：2026-06-04（新增 NPC 需求-动态目标-打断策略重构设计 `superpowers/specs/2026-06-04-NPC需求动态目标打断策略重构设计.md`）

## 文档结构

```
docs/
├── README.md                          # 本文件：文档导航
├── overview.md                        # 项目概览与定位
├── architecture/
│   ├── system-overview.md             # 系统架构总览（模块划分、数据流）
│   ├── design-patterns.md             # 采用的设计模式与原则
│   ├── file-structure.md              # 项目文件结构
│   └── reference-acs-rimworld.md      # 参考借鉴：了不起的修仙模拟器(ACS) & RimWorld 世界架构（Def/Comp/Job-Toil/Incident + Gong境界/Modifier 对照与可重构点）
├── data-models/
│   ├── world-map.md                   # 地图数据模型
│   ├── faction.md                     # 势力数据模型
│   ├── npc.md                         # NPC 数据模型
│   ├── ranks.md                       # 境界与职位表
│   ├── world-modifiers.md             # 全局世界状态
│   ├── behavior-configs.md            # 行为配置模型
│   ├── info-propagation.md            # 信息传播模型
│   ├── relationship.md                # 关系网数据模型（NPC/妖兽/势力关系边，ADR-027；二期关系驱动决策 ADR-028；三期师徒互动 ADR-029）
│   └── player.md                      # 玩家数据模型
├── systems/
│   ├── time-action.md                 # 时间与行动系统
│   ├── world-tick.md                  # 世界演化 Tick 流程
│   ├── event-system.md                # 事件系统（规则 + 预设）
│   ├── faction-ai.md                  # 势力 AI 决策
│   ├── behavior-tree.md               # 行为树（GOBT 三层 AI：BT + Utility + GOAP）
│   ├── info-sense.md                  # 信息感知系统（神识 + 传闻）
│   ├── opportunity-system.md          # 信息传播与机会点系统（ADR-024：事件→消息→传播→机会→决策）
│   ├── item-covet.md                  # 实物系统与怀璧其罪（ADR-025：可转移物品/assetScore/抢夺放过）
│   ├── stability.md                   # 稳定度系统
│   ├── renderer.md                    # Canvas 渲染方案
│   ├── ui.md                          # UI 面板设计
│   ├── save-system.md                 # 存档系统
│   ├── debug-timeline.md             # 决策时间线（开发看板）
│   └── gameplay-ability-system.md     # 战斗机制层（GAS 化，ADR-042）：GameplayTag/AttributeSet/Effect/Ability/AbilityComponent + applyDamage 统一伤害管线，锁血/遁地可组合
├── worldbuilding/
│   ├── README.md                      # 世界观导航
│   ├── history.md                     # 世界背景与纪元
│   ├── continent.md                   # 大陆地理与分区
│   ├── factions.md                    # 势力/宗门列表（12个）
│   ├── npcs.md                        # 关键 NPC 设定（12个）
│   ├── relations.md                   # 势力关系网络与矩阵
│   └── wiki/
│       ├── README.md                  # 已敲定设定的 Wiki 导航
│       ├── wiki-template.md           # Wiki 条目模板
│       ├── rules/
│       │   ├── natural-death.md       # 自然死亡规则
│       │   ├── leader-succession.md   # 掌门继任规则
│       │   ├── sect-operation.md      # 宗门运行与成员晋升制度
│       │   ├── personality.md         # 性格系统 → 需求/风险加成
│       │   ├── travel-and-risk.md     # 游历感悟与风险 + 价值-风险决策
│       │   ├── archetype-obsession.md # 流派执念：夺宝/养老/传承/夺权
│       │   ├── wealth-exposed.md      # 怀璧其罪与江湖热点：暴露身家→消息扩散→抢夺/放过
│       │   ├── spirit-root.md         # 灵根（资质）系统
│       │   └── physique.md            # 体质系统
│       ├── characters/
│       │   ├── relationship-types.md  # 人物关系网：关系类型（人际/人妖/妖妖三层）
│       │   └── relationship-todo.md   # 人物关系网：待做与待扩展
│       ├── artifacts/
│       │   ├── techniques.md          # 功法道具体系
│       │   ├── weapons.md             # 法宝武器体系
│       │   └── spirit-stone.md        # 灵石：货币 + 可服用修炼资源（ADR-006/043）
│       └── creatures/
│           └── monsters.md            # 妖族异兽体系
├── data/
│   └── data-config-rules.md           # 游戏数据配置规则与目录说明
├── TODO-quest-reward.md               # 待完善：任务奖励系统（物品、消费场景）
├── TODO-combat-survival.md            # 接下来要做：战斗与生存系统（配套 ADR-041，分阶段：HP/扣血/锁血→门派庇护/遁地符→回血丹→天材地宝/机缘）
├── TODO-reincarnation-saveload.md     # 待做（很后面才做）：轮回设定—读档记录 + 某些NPC识破玩家是轮回之人 + 相关菜单
├── balance/
│   ├── simulation-iteration-process.md # 世界模拟自迭代优化流程（模拟→诊断→调参→验证 闭环 + KPI 定义）
│   ├── tuning-2026-06-01.md            # 平衡调优 v1（数据杠杆撬动攻伐）
│   ├── tuning-2026-06-01-v2.md         # 平衡调优 v2（结构链路打通复仇）
│   ├── tuning-2026-06-01-v3-result.md  # 平衡调优 v3（人口可持续/出生率，5000 天验证）
│   ├── tuning-2026-06-01-v4-result.md  # 平衡调优 v4（接单战力自检/少死>多生，5000 天验证）
│   ├── tuning-2026-06-01-v5-result.md  # 平衡调优 v5（势力凝聚力/危亡多元抉择，势力覆灭 0→1，5000 天验证）
│   └── tuning-2026-06-01-v6-result.md  # 平衡调优 v6（修地基：稳定度溢出+disciples脱钩，锚定真实NPC，5000 天验证）
├── reports/
│   └── 2026-05-30-项目分析与下一步建议.md # 项目体检报告与后续路线
├── decisions/
│   ├── adr-001-pure-frontend.md       # ADR-001：纯前端架构决策
│   ├── adr-002-tauri-rust-editor.md   # ADR-002：Tauri 2 + Rust 桌面数据编辑器
│   ├── adr-003-apps-directory-split.md # ADR-003：game/editor 应用目录拆分
│   ├── adr-004-auto-simulation-npc-pool.md # ADR-004：自动世界模拟与核心 NPC 池
│   ├── adr-005-need-driven-goap-architecture.md # ADR-005：需求驱动 GOAP 世界模拟架构
│   ├── adr-006-spatial-movement-and-timed-actions.md # ADR-006：空间移动、行为耗时与按需实时渲染
│   ├── adr-007-territory-and-building-layout.md # ADR-007：势力领地与建筑布局生成（可视化）
│   ├── adr-008-building-function-and-action-routing.md # ADR-008：建筑功能化与行为目标分散
│   ├── adr-009-wanderer-bounty-and-location-event-log.md # ADR-009：散修悬赏与位置事件日志
│   ├── adr-010-training-chamber-cultivation.md # ADR-010：修炼场修炼行为（贡献换修炼加速）
│   ├── adr-011-cultivation-incentive-system.md # ADR-011：修炼激励系统（需求重构+GOAP经济链+定时活动）
│   ├── adr-012-spirit-root-and-physique.md # ADR-012：灵根（资质）与体质系统（设计，待实现）
│   ├── adr-013-jps-hierarchical-pathfinding.md # ADR-013：寻路优化（JPS 跳点搜索 + 分层 HPA*）
│   ├── adr-014-goap-planning-performance.md # ADR-014：GOAP 规划性能优化（定长值数组快路径，单天 3.44×）
│   ├── adr-015-faction-resource-and-promotion.md # ADR-015：宗门资源真相源统一 + 成员晋升体系
│   ├── adr-016-travel-insight-and-risk.md # ADR-016：游历感悟与风险系统（突破进度双源 + 数据驱动风险）
│   ├── adr-017-value-risk-decision-and-cultivation-curve.md # ADR-017：价值-风险决策系统 + 修炼曲线改造
│   ├── adr-018-gobt-three-layer-architecture.md # ADR-018：GOBT 三层 AI 架构（BT + Planner Node + Goal 抽取）
│   ├── adr-019-long-term-mind-systems.md # ADR-019：长期心智系统（记忆/执念/情绪/个人恩怨）
│   ├── adr-020-consideration-utility-and-revenge.md # ADR-020：Consideration 乘法 Utility + TimeValue/风险进选目标层 + 复仇 PvP 行为链 + killerId 闭环
│   ├── adr-021-utility-goap-separation.md # ADR-021：Utility-GOAP 职责分离（价值/风险/情绪/上头全迁移到选目标层，GOAP 退化为纯路径代价）
│   ├── adr-022-expected-value-utility.md # ADR-022：期望收益模型（Score=Σ(prob×reward)−riskCost，与风险厌恶对称，支撑赌狗流/稳健流分化）
│   ├── adr-023-archetype-goal-system.md # ADR-023：流派目标体系（夺宝/养老/传承/夺权四种执念 + 专属 goalState/终点行为 + 条件触发机制）
│   ├── adr-024-info-propagation-opportunity.md # ADR-024：信息传播与机会点系统（事件→消息→多渠道传播→机会点→Utility 决策→前往）
│   ├── adr-025-item-covet-system.md   # ADR-025：实物系统与怀璧其罪（可转移物品/assetScore/暴露/觊觎抢夺或放过）
│   ├── adr-026-monster-resource-loop.md # ADR-026：妖兽资源化模拟闭环（猎妖→上交→炼丹/炼器→修炼/战力）
│   ├── adr-027-relationship-network.md # ADR-027：关系网系统（NPC/妖兽/势力统一有向带类型关系图，事件驱动+可视化+存档）
│   ├── adr-028-relationship-driven-decisions.md # ADR-028：关系驱动决策（关系边驱动 NPC Goal 护短/报恩/复仇 + 妖群协防/领地防御，goalsEnabled 默认开）
│   ├── adr-029-master-disciple-interactions.md # ADR-029：师徒互动（师傅传功/护徒、徒弟尽孝、继承遗志复仇+执念延续、夺舍轻度，复用二期架构）
│   ├── adr-030-core-class-refactor.md   # ADR-030：核心引擎类重构（tick-manager/npc-actions/npc-entity 按职责拆分为服务/策略/协作者，对外接口不变）
│   ├── adr-031-editor-rewrite-v2.md     # ADR-031：编辑器 v2 重写（适配 game/data 全部数据集 + 写回 + 快照回滚，自动扫描+schema 推断）
│   ├── adr-033-simulation-iteration-process.md # ADR-033：世界模拟自迭代优化流程（模拟→诊断→调参→验证 闭环 + KPI 量化 + 归因决策树）
│   ├── adr-034-population-sustainability.md # ADR-034：人口可持续性平衡机制（v3 出生率 + v4 接单战力自检 + 势力覆灭动态阈值，末态人口 38→54）
│   ├── adr-035-faction-cohesion-crisis.md # ADR-035：势力凝聚力与危亡抉择（v5 危亡 7 类多元反应：死战/退避/叛投/出走/被迫效忠/逃命/投降，凝聚力涌现，势力覆灭 0→1 首次打通）
│   ├── adr-036-state-bounds-and-disciple-anchoring.md # ADR-036：状态边界钳制与弟子锚定真实 NPC（v6 修地基：稳定度溢出 3145→≤100 + disciples 上万→锚定真实NPC 0~500，势力覆灭在真实状态下重现）
│   ├── adr-037-behavior-precision-by-category.md # ADR-037：逐类行为精准化（按类别画像驱动：妖兽分化/散修生计/关系师徒激活/复仇追击 四项结构修复）
│   ├── adr-038-deterministic-seed-logging-replay.md # ADR-038：确定性种子 + 日志落盘 + 重放（统一 Rng 收拢 23 文件随机、种子贯通 init→ctx→实体、serve.py 落盘接口、ReplayRecorder；重放=相同 seed+输入序列重跑）
│   ├── adr-039-qi-progress-decoupling.md # ADR-039：真气-进度解耦（真气随进度同步增长、被动吸纳、聚气丹链解锁，修复天才"进度满但真气不足"卡境界死锁）
│   ├── adr-040-cultivation-pace-and-qi-pill-decay.md # ADR-040：修炼节奏（秘境改给 insight 不再每日喷进度、真气/进度同步、聚气丹去限制+按境界递减）；修为提升靠机缘/丹药/秘境/天材地宝而非纯闭关
│   ├── adr-041-combat-survival-system.md # ADR-041：战斗与生存系统（NPC HP/真实扣血/锁血/遁地符/回血丹/天材地宝/机缘突破，分阶段；阶段1已实现）
│   ├── adr-042-gameplay-ability-system.md # ADR-042：战斗系统 GAS 化重构（Attribute/Effect/Ability/Tag/Cue 机制层，统一伤害管线 applyDamage，锁血拆为独立 effect_lock_hp 由遁地符等多来源授予、不区分攻击者；阶段0+1已落地）
│   ├── adr-043-item-resource-unified-taxonomy.md # ADR-043：资源与物品统一分类（按 category 区分；势力宏观资源 macro-resources.json，可持有实物 items.json；灵石既是货币又可服用复用 ge_add_qi）
│   ├── adr-044-concrete-items-and-subcategory.md # ADR-044：具体命名道具替换泛称占位项 + 引入 subCategory 子类（按 docs/世界观参考 补具体道具）
│   ├── adr-045-item-files-split-by-category.md # ADR-045：物品定义按 category 拆分为多文件（currency/material/pill/artifact/talisman/technique）+ 加载时合并（仿 effects/），消费结构不变
│   ├── adr-046-purge-generic-material-ids.md # ADR-046：删除泛称材料 ID（spirit_herb/ore/monster_core/beast_material）全改具体道具，monsters drops 静态展开为 _gN
│   ├── adr-047-cultivation-action-selection-balance.md # ADR-047：修炼选行均衡（增量目标 incrementOf + selectStrategy=greedy 跳过 A* 折叠 + 软化权重加权随机"换着做"）+ 凡人血量 30→120/减伤 0→0.15 防一击秒杀
│   └── adr-048-four-layer-reactive-ai.md # ADR-048：四层反应式 AI（Reaction 即时反应抢占/Utility 意图选择/GOAP 短链规划/Execution 执行）+ 刺激队列 + 大事件立即重决策 + 意图层 IntentService 服务化（reaction.enabled/eventReplan 默认 false）
├── plans/
│   └── implementation-plan.md         # 实施计划（6阶段 + 11个子Agent）
└── superpowers/
    ├── specs/
    │   ├── 2026-05-25-data-editor-design.md # 数据编辑器设计
    │   ├── 2026-05-27-自动世界模拟与核心NPC池设计.md # 自动世界模拟与核心 NPC 池设计
    │   ├── 2026-05-29-空间移动行为耗时与实时渲染设计.md # 空间移动/行为耗时/妖兽分布/实时渲染设计
    │   └── 2026-06-04-NPC需求动态目标打断策略重构设计.md # NPC 长期需求、动态事件目标、提前准备与出关打断策略设计
    └── plans/
        ├── 2026-05-25-data-editor.md        # 数据编辑器实施计划
        ├── 2026-05-27-world-simulation-stability.md # 自动世界模拟稳定性第一批实施计划
        ├── 2026-05-25-tauri-desktop-editor.md # Tauri 桌面编辑器实施计划
        ├── 2026-05-25-tauri-desktop-editor-multi-agent.md # Tauri 桌面编辑器多 Agent 实施计划
        └── 2026-05-29-空间移动行为耗时实时渲染多agent计划.md # 本次多 Agent 实施计划
```

## 阅读顺序

1. `overview.md` —— 了解项目是什么
2. `architecture/system-overview.md` —— 了解整体架构
3. `architecture/design-patterns.md` —— 了解设计原则
4. `data-models/` —— 了解核心数据结构
5. `systems/` —— 了解各子系统设计
6. `decisions/` —— 了解关键技术决策的理由
7. `reports/` —— 了解项目体检结论、风险和下一步路线

## 关键导航

- `architecture/reference-acs-rimworld.md` —— 参考借鉴《了不起的修仙模拟器》(XiaWorld) 与 RimWorld (Verse) 的世界架构：RimWorld 四支柱 Def/Comp/Job-Toil/Incident + ACS 修仙建模 Gong境界阶段/Neck瓶颈/Modifier 特质，对照我们现状提炼可借鉴/可重构点（统一 Modifier 生命周期、Gong-Stage-Neck 数据模型、Action 多步编排、world-rules→Incident 插件、加载期 ConfigErrors 校验）与反面教材，写引擎代码前可翻此取经
- `reports/2026-05-30-项目分析与下一步建议.md` —— 当前项目问题清单、验证结果与下一步优先级
- `balance/simulation-iteration-process.md` §8 —— 验证以真实长程模拟的行为统计为准（严禁黄金指纹自证，见 AGENTS.md 验证规则）
- `decisions/adr-001-pure-frontend.md` —— 游戏运行时采用纯前端架构
- `decisions/adr-002-tauri-rust-editor.md` —— 数据编辑器升级为 Tauri 2 + Rust 桌面工具
- `decisions/adr-003-apps-directory-split.md` —— 游戏与编辑器收拢到 `apps/game/` 和 `apps/editor/`
- `decisions/adr-004-auto-simulation-npc-pool.md` —— 自动世界模拟与核心 NPC 池架构决策
- `decisions/adr-005-need-driven-goap-architecture.md` —— 需求驱动 GOAP 世界模拟架构
- `decisions/adr-006-spatial-movement-and-timed-actions.md` —— 空间移动、行为耗时与按需实时渲染
- `decisions/adr-007-territory-and-building-layout.md` —— 势力领地与建筑布局生成（可视化）
- `decisions/adr-008-building-function-and-action-routing.md` —— 建筑功能化与行为目标分散（主殿行政中枢）
- `decisions/adr-009-wanderer-bounty-and-location-event-log.md` —— 散修悬赏（接入悬赏阁/坊市）与位置事件日志（统一带坐标）
- `decisions/adr-010-training-chamber-cultivation.md` —— 修炼场修炼行为（消耗门派贡献换修炼加速，补齐 ADR-008 遗留；加速值后由 ADR-011 升级为 +100%）
- `decisions/adr-011-cultivation-incentive-system.md` —— 修炼激励系统：需求精简为修炼/长寿/回血/职责，打通"做任务攒贡献→进修炼场"GOAP 经济链，新增月度贡献考核/门派考核/门派大比三层压力与外门弟子贬谪
- `decisions/adr-012-spirit-root-and-physique.md` —— 灵根（资质）5 档量化 + 体质（凡体为主+稀有特殊体质）双系统设计：灵根乘修炼速度/加突破率，体质额外叠加并影响功法选择（设计已敲定，待实现）
- `decisions/adr-013-jps-hierarchical-pathfinding.md` —— 寻路优化：整型位图 GridGraph + JPS 跳点搜索 + JPS+ 预处理（step 表查表，单次提速约 62×，与 JPS 输出完全一致）+ 分层 HPA*，寻路自耗时占比由 37.8% 降至 ~1.4%，瓶颈转移到 GOAP
- `decisions/adr-014-goap-planning-performance.md` —— GOAP 规划性能优化：Action effects/preconditions 预计算缓存 + 定长值数组快路径 + parent 链回溯，单天模拟 268.79→78.09ms（3.44×，-71%），规划结果不变
- `decisions/adr-015-faction-resource-and-promotion.md` —— 宗门资源真相源统一（资源以 state 为单一真相，修复 costs/yields/attack/trade 被覆盖丢失的双轨 bug）+ 成员晋升体系（全职位阶梯 outer→…→heir、贡献/大比/挑战/继任四通道、安全网、高阶名额限制，数据驱动于 cultivation.json→promotion）；继任改用 successionScore+loyalty。参考 docs/世界观参考/宗门运行流程与制度平衡分析.md
- `decisions/adr-016-travel-insight-and-risk.md` —— 游历感悟与风险系统：突破进度双源化（闭关 cultivationProgress 有境界上限 + 游历 insight 补足，totalProgress≥1.0 可突破），闭关撞顶后 GOAP 自然推导出游历；游历机缘事件表 + 数据驱动 risk.json（受伤/掉落/挑战失败/陨落，权重+境界减免+性格 courage 加成），为后续大世界机缘/厮杀/洞天福地/法宝材料预留入口
- `decisions/adr-021-utility-goap-separation.md` —— Utility-GOAP 职责分离：将价值/风险/情绪/上头/路径偏好全部从 GOAP step cost 迁移到 Utility 选目标层，GOAP step cost 退化为纯路径代价 `getPlanCost()`，所有"差异化"由 Utility 决定（修仙 NPC 稳健流/赌狗流/复仇流分化的根本）
- `decisions/adr-022-expected-value-utility.md` —— 期望收益模型：在 Utility 层引入 `ExpectedValue=Σ(prob×value)`，与 ADR-021 风险厌恶对称（吸引项 vs 惩罚项），收益分布数据驱动于 reward.json（如秘境仙器 1%/法宝 10%/材料 60%/空手 29%），赌狗流=高期望收益吸引+低风险厌恶
- `decisions/adr-023-archetype-goal-system.md` —— 流派目标体系：新增夺宝/养老/传承/夺权四种执念，各有专属 goalState（treasureObtained/atPeace/discipleRaised/isFactionLeader）与终点行为，新增"条件触发"机制（随寿元/境界演化），让同境界 NPC 在相同局面下做出差异化选择；养老流诚实标注为项目推演设定
- `decisions/adr-026-monster-resource-loop.md` —— 妖兽资源化模拟闭环：斩妖任务锁定具体妖兽，死亡按等阶产出妖丹/妖材，NPC 上交换贡献，宗门兑换丹药/法器消耗库存，高阶尸骸生成机会点
- `decisions/adr-027-relationship-network.md` —— 关系网系统：NPC/妖兽/势力统一为世界级有向带类型关系图（师徒/道侣/同门/宿敌/灵宠/妖群等），事件驱动维护边，重构 ADR-019 个人恩怨图为兼容视图（复仇链零改动），第一期只做数据层+可视化+存档
- `decisions/adr-028-relationship-driven-decisions.md` —— 关系驱动决策（二期）：关系边驱动 NPC Goal（护短同门驰援/报恩探望/高强度宿敌纳入复仇）与妖兽行为（同群协防 + tier2+ 领地防御，群居物种成簇生成、闯巢建 territory_threat），受 `goalsEnabled`（默认开）gate，复仇多走现有链、深关系被杀才升执念
- `decisions/adr-029-master-disciple-interactions.md` —— 师徒互动（三期）：`master`/`disciple` 边驱动师傅传功点化（给 insight 增量）/护徒驰援/徒弟尽孝探望、继承遗志（师傅被杀→徒弟复仇 + 继承未竟执念）、夺舍轻度（邪修师傅起 seizure 执念复用击杀链）；复用二期 Goal 架构；修复一期 discipleRoles 数据缺陷使 master 边首次建立
- `decisions/adr-030-core-class-refactor.md` —— 核心引擎类重构：把 `tick-manager.js`（2139→734 行）按 tick 步骤拆为 `world/services/` 七个服务（WorldContextBuilder/FactionAIService/PromotionService/PopulationService/DeathCollector/InfoCoordinator/MonsterRespawnService），`npc-actions.js`（1552 行）按业务域拆到 `npc/actions/` 并退化为注册入口+门面，`npc-entity.js`（1010→608 行）抽出 `npc-goals.js`/`npc-lifecycle.js`/`npc-obsession-trigger.js` 纯函数协作者；对外接口零改动
- `decisions/adr-033-simulation-iteration-process.md` —— 世界模拟自迭代优化流程：把"让世界运行起来"工程化为「跑基线→采集→诊断→归因→备份→最小调参→重跑验证→记录→回归保护」闭环，配套四维量化 KPI（人口可持续/权力流动/叙事涌现/健康度）与"参数问题 vs 结构问题"归因决策树；流程全文见 `docs/balance/simulation-iteration-process.md`
- `decisions/adr-034-population-sustainability.md` —— 人口可持续性平衡机制：针对 5000 天基线"人口单调衰减空城化"，分三机制推进——v3 出生率参数杠杆（social.json）、v4 接单战力自检（quest-templates.json safetyPreference + pickQuestCandidate 安全偏好加权，让 NPC 不顶格冒险）、v4 势力覆灭动态阈值（combat.json annihilation，真实衰弱时托底降 0）；末态存活 NPC 38→44→54；势力覆灭未触发的根因（disciples 抽象资源与真实 NPC 脱钩）列为 v5
- `decisions/adr-035-faction-cohesion-crisis.md` —— 势力凝聚力与危亡抉择（v5）：参考凡人/仙逆/大道争锋冲突分析，势力危亡时成员按性格×利益×关系做 7 类多元抉择（死战/退避/叛投/出走散修/被迫效忠/抢先逃命/投降归顺），凝聚力是"选择死战比例"的涌现量而非硬编；凝聚力低的势力真实人口骤降→触发 ADR-034 覆灭阈值→自然灭门，5000 天势力覆灭 0→1（万妖山）首次打通且不雪崩；危机判据改用相对信号（战力悬殊/真实活 NPC 少）绕过稳定度虚高病根；combat.json cohesion 数据驱动
- `worldbuilding/wiki/rules/faction-crisis-defection.md` —— 势力危亡抉择与凝聚力规则：7 类危亡反应谱系、触发倾向、后果与世界观来源（凡人/仙逆/大道争锋）
- `decisions/adr-036-state-bounds-and-disciple-anchoring.md` —— 状态边界钳制与弟子锚定真实 NPC（v6 修地基）：修两个历史 bug——(A) action.js 声明式 op:add 无上限致稳定度溢出 3145（应 0-100），改 _applyEffects 支持数据驱动 min/max + faction-actions stability 补边界；(B) disciples 与真实活 NPC 脱钩、堆到上万致势力永不可覆灭（ADR-034/035 病根），改弟子上限=min(领地容量, 真实活NPC×ratio)+超额回归。结果：稳定度 70~100、disciples 0~500 健康差异化，势力覆灭在真实状态下重现（万妖山）
- `decisions/adr-037-behavior-precision-by-category.md` —— 逐类行为精准化：给 simulate-analysis 加按类别（职位/境界/势力类型/执念 + 妖兽阶/族/类型）行为画像，逐批对照世界观参考定位"哪类人没做该做的事"，完成四项结构修复——(A) 妖兽 96% 纯游荡→觅食/守穴/巡逻/群居分化；(B) 散修缺产出型需求→新增"散修生计"接活求生 + 修 needIds 硬编码白名单；(C) 关系/师徒整套 0 触发→根因是 plan() 命中即返回 + consideration 乘法把 priority78 压到 score25，修 priority 量纲 + utility consideration 基线，传功 0→14/探望 0→82；(D) 复仇追而不杀→根因 NPC 同速 1 格/天追不上仇人，复仇提速 + 击杀阶段持续追击，端到端验证 75 格外手刃仇人。流派执念复核达标无需改；妖族 demon 经济死循环已诊断归独立立项
- `decisions/adr-038-deterministic-seed-logging-replay.md` —— 确定性种子 + 日志落盘 + 重放：新增 `engine/abstract/rng.js`（mulberry32）统一随机源，把 23 个文件 ~80 处模拟 `Math.random` 全部替换为 `worldContext.rng` / 实体 `_rng`；种子贯通 `WorldEngine.init(configs.seed)` → `worldContext.rng` → NPC/妖兽实体与状态，领地/妖兽分布种子与主种子耦合，整局由单一 seed 复现；`serve.py` 加 `POST /api/log`、`/api/replay` 落盘到 `runs/<runId>/`，客户端 `storage/replay-recorder.js` 缓冲事件并落盘（服务器不可用自动降级内存）；重放 = 相同 seed + 输入序列重跑
- `worldbuilding/wiki/characters/relationship-types.md` —— 关系类型表（人际/人妖/妖妖三层）与世界观来源标注
- `worldbuilding/wiki/README.md` —— 已敲定设定 Wiki 的导航与维护规则
- `worldbuilding/wiki/rules/natural-death.md` —— NPC 自然死亡规则设定
- `worldbuilding/wiki/rules/leader-succession.md` —— 掌门继任与无候选覆灭规则
- `worldbuilding/wiki/rules/archetype-obsession.md` —— 流派执念：夺宝/养老/传承/夺权四种人生取向执念的触发条件、目标终点与世界观来源
- `data-models/ranks.md` —— 境界、职位、寿元与继任分数静态表
- `data/data-config-rules.md` —— 游戏 data/ 目录结构规范与所有 JSON 配置字段说明
- `data-models/behavior-configs.md` —— 开局数据与行为配置的分层说明
- `superpowers/specs/2026-05-27-自动世界模拟与核心NPC池设计.md` —— 自动世界模拟、核心 NPC 池、日志与报告设计
- `superpowers/specs/2026-06-04-NPC需求动态目标打断策略重构设计.md` —— NPC 需求-动态目标-打断策略重构：长期需求只表达动机，秘境/大比/天材地宝/高手陨落/关系伤亡等事件通过 DynamicGoalProvider + InterruptPolicy 接入，支持未来事件提前准备与闭关出关打断
- `superpowers/plans/2026-05-25-data-editor.md` —— 纯前端数据编辑器实施计划
- `superpowers/plans/2026-05-27-world-simulation-stability.md` —— 自动世界模拟稳定性第一批实施计划
- `superpowers/plans/2026-05-25-tauri-desktop-editor.md` —— Tauri 桌面编辑器实施计划
- `superpowers/plans/2026-05-25-tauri-desktop-editor-multi-agent.md` —— Tauri 桌面编辑器多 Agent 实施计划

## 文档维护规则

- 所有讨论确认的设计决策，必须记录到对应文档中
- 架构决策使用 ADR（Architecture Decision Record）格式
- 文档修改需注明日期
