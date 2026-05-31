# 修仙世界模拟器 —— 文档中心

> 项目代号：WorldDynamic
> 创建日期：2026-05-23
> 最后更新：2026-05-30

## 文档结构

```
docs/
├── README.md                          # 本文件：文档导航
├── overview.md                        # 项目概览与定位
├── architecture/
│   ├── system-overview.md             # 系统架构总览（模块划分、数据流）
│   ├── design-patterns.md             # 采用的设计模式与原则
│   └── file-structure.md              # 项目文件结构
├── data-models/
│   ├── world-map.md                   # 地图数据模型
│   ├── faction.md                     # 势力数据模型
│   ├── npc.md                         # NPC 数据模型
│   ├── ranks.md                       # 境界与职位表
│   ├── world-modifiers.md             # 全局世界状态
│   ├── behavior-configs.md            # 行为配置模型
│   ├── info-propagation.md            # 信息传播模型
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
│   └── debug-timeline.md             # 决策时间线（开发看板）
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
│       ├── artifacts/
│       │   ├── techniques.md          # 功法道具体系
│       │   └── weapons.md             # 法宝武器体系
│       └── creatures/
│           └── monsters.md            # 妖族异兽体系
├── data/
│   └── data-config-rules.md           # 游戏数据配置规则与目录说明
├── TODO-quest-reward.md               # 待完善：任务奖励系统（物品、消费场景）
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
│   └── adr-026-monster-resource-loop.md # ADR-026：妖兽资源化模拟闭环（猎妖→上交→炼丹/炼器→修炼/战力）
├── plans/
│   └── implementation-plan.md         # 实施计划（6阶段 + 11个子Agent）
└── superpowers/
    ├── specs/
    │   ├── 2026-05-25-data-editor-design.md # 数据编辑器设计
    │   ├── 2026-05-27-自动世界模拟与核心NPC池设计.md # 自动世界模拟与核心 NPC 池设计
    │   └── 2026-05-29-空间移动行为耗时与实时渲染设计.md # 空间移动/行为耗时/妖兽分布/实时渲染设计
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

- `reports/2026-05-30-项目分析与下一步建议.md` —— 当前项目问题清单、验证结果与下一步优先级
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
- `decisions/adr-014-goap-planning-performance.md` —— GOAP 规划性能优化：Action effects/preconditions 预计算缓存 + 定长值数组快路径 + parent 链回溯，单天模拟 268.79→78.09ms（3.44×，-71%），行为零漂移（黄金指纹 f08c3248 回归保证）
- `decisions/adr-015-faction-resource-and-promotion.md` —— 宗门资源真相源统一（资源以 state 为单一真相，修复 costs/yields/attack/trade 被覆盖丢失的双轨 bug）+ 成员晋升体系（全职位阶梯 outer→…→heir、贡献/大比/挑战/继任四通道、安全网、高阶名额限制，数据驱动于 cultivation.json→promotion）；继任改用 successionScore+loyalty。参考 docs/世界观参考/宗门运行流程与制度平衡分析.md
- `decisions/adr-016-travel-insight-and-risk.md` —— 游历感悟与风险系统：突破进度双源化（闭关 cultivationProgress 有境界上限 + 游历 insight 补足，totalProgress≥1.0 可突破），闭关撞顶后 GOAP 自然推导出游历；游历机缘事件表 + 数据驱动 risk.json（受伤/掉落/挑战失败/陨落，权重+境界减免+性格 courage 加成），为后续大世界机缘/厮杀/洞天福地/法宝材料预留入口
- `decisions/adr-021-utility-goap-separation.md` —— Utility-GOAP 职责分离：将价值/风险/情绪/上头/路径偏好全部从 GOAP step cost 迁移到 Utility 选目标层，GOAP step cost 退化为纯路径代价 `getPlanCost()`，所有"差异化"由 Utility 决定（修仙 NPC 稳健流/赌狗流/复仇流分化的根本）
- `decisions/adr-022-expected-value-utility.md` —— 期望收益模型：在 Utility 层引入 `ExpectedValue=Σ(prob×value)`，与 ADR-021 风险厌恶对称（吸引项 vs 惩罚项），收益分布数据驱动于 reward.json（如秘境仙器 1%/法宝 10%/材料 60%/空手 29%），赌狗流=高期望收益吸引+低风险厌恶
- `decisions/adr-023-archetype-goal-system.md` —— 流派目标体系：新增夺宝/养老/传承/夺权四种执念，各有专属 goalState（treasureObtained/atPeace/discipleRaised/isFactionLeader）与终点行为，新增"条件触发"机制（随寿元/境界演化），让同境界 NPC 在相同局面下做出差异化选择；养老流诚实标注为项目推演设定
- `decisions/adr-026-monster-resource-loop.md` —— 妖兽资源化模拟闭环：斩妖任务锁定具体妖兽，死亡按等阶产出妖丹/妖材，NPC 上交换贡献，宗门兑换丹药/法器消耗库存，高阶尸骸生成机会点
- `worldbuilding/wiki/README.md` —— 已敲定设定 Wiki 的导航与维护规则
- `worldbuilding/wiki/rules/natural-death.md` —— NPC 自然死亡规则设定
- `worldbuilding/wiki/rules/leader-succession.md` —— 掌门继任与无候选覆灭规则
- `worldbuilding/wiki/rules/archetype-obsession.md` —— 流派执念：夺宝/养老/传承/夺权四种人生取向执念的触发条件、目标终点与世界观来源
- `data-models/ranks.md` —— 境界、职位、寿元与继任分数静态表
- `data/data-config-rules.md` —— 游戏 data/ 目录结构规范与所有 JSON 配置字段说明
- `data-models/behavior-configs.md` —— 开局数据与行为配置的分层说明
- `superpowers/specs/2026-05-27-自动世界模拟与核心NPC池设计.md` —— 自动世界模拟、核心 NPC 池、日志与报告设计
- `superpowers/plans/2026-05-25-data-editor.md` —— 纯前端数据编辑器实施计划
- `superpowers/plans/2026-05-27-world-simulation-stability.md` —— 自动世界模拟稳定性第一批实施计划
- `superpowers/plans/2026-05-25-tauri-desktop-editor.md` —— Tauri 桌面编辑器实施计划
- `superpowers/plans/2026-05-25-tauri-desktop-editor-multi-agent.md` —— Tauri 桌面编辑器多 Agent 实施计划

## 文档维护规则

- 所有讨论确认的设计决策，必须记录到对应文档中
- 架构决策使用 ADR（Architecture Decision Record）格式
- 文档修改需注明日期
