# 《武炼巅峰》世界观参考调研文档

> 最后更新：2026-06-06
> 状态：已启用（文档结构已与模板对齐）
> 类型：作品导航
> 资料来源：`武炼巅峰.txt`（GB18030，约 425,985 行）、`.storygraph/storygraph.db`
> 对应模板目录：`docs/世界观参考/模板/`
> 适用范围：《武炼巅峰》小说世界观调研文档目录和交叉导航

## 定位

本目录存放《武炼巅峰》小说的世界观参考调研文档。所有文档均基于小说原文和 StoryGraph 数据库的事实证据，严格按照 `docs/世界观参考/模板/` 下对应模板的结构与规范编写。

文档目标不是写小说百科，而是为当前项目的整体设计提供可追溯参考：NPC AI、势力制度、关系网、物品/GAS、动态事件、信息传播、经济循环、妖兽生态、平衡验证和 Wiki 设定确认。

通用采集原则：每个文档都在 `适用范围` 前段明确"尽可能覆盖各修为阶段、各身份/势力/职业/场景等维度"的要求；具体维度按主题调整，避免只摘录主角线、名场面或少数高阶案例。

## 三类内容区分

所有调研文档都必须区分三类内容：

| 分类 | 含义 | 写法 |
|------|------|------|
| 原作事实 | 能被原文或 StoryGraph 依据支持的内容 | 写入事实表，附证据（锚点ID/行号/章节） |
| 我的判断 | 基于原作事实抽象出的游戏化设计启示 | 明确标注"我的判断"，说明依据 |
| 待核验 | 暂时没有足够证据、可能串书或需要复查的内容 | 在对应位置标注"待核验"，不得当成结论 |

## 详细程度分级

| 等级 | 用途 | 当前覆盖 |
|------|------|----------|
| L1 摘要 | 快速了解该作品有没有相关素材 | 全部文档已完成 |
| L2 可参考 | 可用于系统设计讨论 | 核心文档已达标 |
| L3 可转化 | 可进入 Wiki 草案、ADR、数据/任务设计 | 部分文档已达标（标注"L3"的文档） |

## 文档清单

### 核心设定

| 文档 | 状态 | 说明 |
|------|------|------|
| [世界观设定](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\世界观设定.md>) | L2+ | 世界层级、底层规则、社会分层、世界结构总览 |
| [势力设定](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\势力设定.md>) | L2 | 宗门、家族、散修、墨族等势力系统 |
| [NPC性格与代表事件](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\NPC性格与代表事件.md>) | L2+ | 性格维度、代表事件、角色卡片 |
| [世界状态与灾变](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\世界状态与灾变.md>) | L2 | 墨族入侵、世界层级灾变 |

### 角色系统

| 文档 | 状态 | 说明 |
|------|------|------|
| [角色AI行为参考](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\角色AI行为参考.md>) | L2 | AI参数建议、决策模式 |
| [角色修炼历程](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\角色修炼历程.md>) | L2 | 主角和关键角色修炼轨迹 |
| [人物关系与事件分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\人物关系与事件分析.md>) | L2 | 关系网、关键事件链 |
| [灵根体质血脉](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\灵根体质血脉.md>) | L2 | 体质、血脉、灵根体系 |
| [记忆情绪与执念](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\记忆情绪与执念.md>) | L2 | 记忆/情绪触发、执念系统 |

### 修炼与战斗

| 文档 | 状态 | 说明 |
|------|------|------|
| [境界提升与功法分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\境界提升与功法分析.md>) | L2+ | 修为境界、突破规则、功法体系 |
| [修炼流派](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\修炼流派.md>) | L2 | 修炼路线、流派分化 |
| [战斗与保命机制](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\战斗与保命机制.md>) | L2 | 战斗规则、保命手段、底牌 |
| [散修生存方式](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\散修生存方式.md>) | L2 | 散修经济、生存策略 |
| [宗门任务体系](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\宗门任务体系.md>) | L2 | 贡献点、任务系统 |
| [出门游历流程分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\出门游历流程分析.md>) | L2 | 游历路线、历练节点 |

### 经济与物品

| 文档 | 状态 | 说明 |
|------|------|------|
| [法宝分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\法宝分析.md>) | L2 | 法宝品阶、效果、祭炼与交易（2026-06-06 拆分新建） |
| [武器分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\武器分析.md>) | L1+ | 武器形制、制式装备（证据薄弱，待补全） |
| [妖兽分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\妖兽分析.md>) | L2 | 妖兽品阶、生态、资源产出（2026-06-06 拆分新建） |
| [丹药分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\丹药分析.md>) | L2 | 丹药品阶、材料、功效与副作用（2026-06-06 拆分新建） |
| [物品设定](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\物品设定.md>) | L2 | 通用物品、特殊道具 |
| [物资产出与消耗](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\物资产出与消耗.md>) | L2 | 资源产出、消耗循环 |
| [拍卖坊市与交易](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\拍卖坊市与交易.md>) | L2 | 交易场所、流通体系 |

### 生产职业

| 文档 | 状态 | 说明 |
|------|------|------|
| [炼丹师](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\炼丹师.md>) | L2 | 炼丹、医术、灵植（2026-06-06 拆分新建） |
| [炼器师](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\炼器师.md>) | L2 | 炼器、锻造、祭炼修复（2026-06-06 拆分新建） |
| [阵法师](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\阵法师.md>) | L2 | 阵法、禁制、传送（2026-06-06 拆分新建） |
| [符师](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\符师.md>) | L1 | 符箓、符宝（2026-06-06 新建；证据严重不足） |
| [傀儡师](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\傀儡师.md>) | L2 | 傀儡、机关、石傀（2026-06-06 拆分新建） |
| [鉴宝师](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\鉴宝师.md>) | L2 | 鉴宝、估价、拍卖（2026-06-06 拆分新建） |
| [御兽师](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\御兽师.md>) | L1 | 御兽、灵宠（2026-06-06 新建；证据严重不足） |

### 交互与叙事

| 文档 | 状态 | 说明 |
|------|------|------|
| [冲突事件分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\冲突事件分析.md>) | L2 | 冲突类型、触发条件 |
| [动态事件与机会点](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\动态事件与机会点.md>) | L2 | 随机事件、机遇节点 |
| [信息传播与情报](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\信息传播与情报.md>) | L2 | 情报网络、消息传递 |
| [时间行动与事件耗时](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\时间行动与事件耗时.md>) | L2 | 时间尺度、行动耗时 |
| [建筑设施与场所功能](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\建筑设施与场所功能.md>) | L2 | 建筑类型、场所功能 |
| [有限视角与叙事日志](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\有限视角与叙事日志.md>) | L2 | 视角规则、叙事日志 |
| [妖兽与修士关系分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\妖兽与修士关系分析.md>) | L2 | 妖兽与修士社会关系 |
| [邪修分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\邪修分析.md>) | L2 | 邪修行为、禁忌手段 |
| [夺舍设定分析](<E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\夺舍设定分析.md>) | L2 | 夺舍规则、元神转移 |

### 辅助文件（非模板对齐）

| 文件 | 说明 |
|------|------|
| `武炼巅峰.txt` | 小说原文（GB18030 编码，约 425,985 行） |
| `.storygraph/` | StoryGraph 数据库目录 |
| `待做分析列表.md` | 内部工作追踪文档（T01-T08 专题） |

## 2026-06-06 结构对齐变更记录

本次对齐操作将《武炼巅峰》文档结构与模板目录完全对齐：

**合并操作**（2 项，已删除源文件）：
- `NPC设定.md` → 合并入 `NPC性格与代表事件.md`（增加角色简介卡片附录）
- `世界设定.md` → 合并入 `世界观设定.md`（增加世界地理结构附录）

**拆分操作**（2 个源文件 → 11 个新文件，已删除源文件）：
- `法宝妖兽丹药分析.md` → 拆分为 `法宝分析.md`、`武器分析.md`、`妖兽分析.md`、`丹药分析.md`
- `生产技艺与副职业.md` → 拆分为 `炼丹师.md`、`炼器师.md`、`阵法师.md`、`符师.md`、`傀儡师.md`、`鉴宝师.md`、`御兽师.md`

**新建操作**（3 个）：
- `符师.md`：按模板新建，原文证据严重不足，标注大量"待核验"
- `御兽师.md`：按模板新建，原文证据严重不足，标注大量"待核验"
- `README.md`：本文件

## 与项目文档的关系

- 可确认为项目设定的结论进入 `docs/worldbuilding/wiki/`
- 影响系统边界的结论进入 `docs/decisions/` ADR 或 `docs/systems/`
- 影响 JSON 配置的结论对齐 `apps/game/data/` 与 `docs/data/data-config-rules.md`
- 仅作为素材的内容保留在本目录
