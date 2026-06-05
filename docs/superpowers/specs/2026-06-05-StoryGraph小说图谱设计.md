# StoryGraph 小说图谱设计

> 最后更新：2026-06-05
> 状态：设计草案，待用户审阅
> 类型：工具与资料索引设计规格

## 资料来源

- 用户需求：希望参考 `E:\AI_Projects\codegraph`，为小说阅读、时间线、角色卡、世界观抽取建立 StoryGraph，让 agent 读小说查资料更快、更准。
- 用户确认：功能范围选择“全都要，但先做最小可用版”，并先写 specs。
- 用户最新确认：MVP 只做单作品索引与查询；多作品同库索引、跨作品比较和跨作品强一致性属于后续扩展。
- CodeGraph 原项目：`E:\AI_Projects\codegraph` 是 TypeScript + SQLite + CLI/MCP/API 工程，数据库核心表为 `nodes`、`edges`、`files`、`nodes_fts`。来源：`E:\AI_Projects\codegraph\src\db\schema.sql`。
- CodeGraph 文档：其公共 API 使用 `CodeGraph.init/open/indexAll/searchNodes/buildContext`，MCP 工具包括 search、context、explore、files、status 等。来源：`E:\AI_Projects\codegraph\site\src\content\docs\reference\api.md`、`E:\AI_Projects\codegraph\site\src\content\docs\reference\mcp-server.md`。
- 当前项目事实：`E:\AI_Projects\CultivationWorld\.codegraph\codegraph.db` 已存在，状态显示已索引 159 个文件、3155 个节点、8968 条边。
- 当前资料库：`docs/世界观参考/` 下已有多部小说原文 `.txt` 与分析 Markdown，项目规则要求世界观设定优先查该目录。来源：`AGENTS.md`、`docs/README.md`。
- 当前原文补充计划：`docs/superpowers/plans/2026-06-05-世界观参考原文补充修正计划.md` 已列出 15 部小说原文、主题文档与证据锚点要求。

## 目标

StoryGraph 要把小说原文和现有世界观参考文档转成可查询的本地图谱索引，使 agent 在回答“人物、时间线、势力、境界、物品、事件、原文证据”类问题时，不再每次从整部小说全文搜索和长上下文阅读开始。

首版目标是做一个最小可用但结构完整的图谱系统：

1. 支持原文查证：能根据角色、物品、境界、势力、事件关键词返回证据锚点。
2. 支持角色卡：能聚合角色别名、身份、关系、修炼阶段、关键事件和原文来源。
3. 支持时间线：能在单部作品内按角色、势力或主题查询事件顺序。
4. 支持世界观抽取：能汇总境界、功法、宗门、物品、妖兽、规则等可供游戏化参考的设定。
5. 支持 agent 快速查询：提供 CLI/API/MCP 查询接口，查询结果带来源、置信度和是否为“我的判断”。

## 非目标

- 首版不直接修改 `docs/世界观参考/` 下的原文和分析 Markdown。
- 首版不把所有抽取结果直接写入 `docs/worldbuilding/wiki/`；Wiki 仍只保存用户确认后的项目设定。
- 首版不追求一次性自动准确抽完 15 部小说，也不支持一次索引多部作品；每次索引与查询默认服务单部作品。
- 首版不实现跨作品比较、跨作品同名合并或多作品同库的强一致性校验；相关能力在后续扩展时单独设计。
- 首版不把 StoryGraph 合并到 CodeGraph 源码中；CodeGraph 作为架构参考与可复用思想来源。

## 存放位置决策

我的判断：StoryGraph 应作为独立 sibling 工具项目创建在 `E:\AI_Projects\storygraph`，索引产物写入被服务项目的 `.storygraph/` 目录。

推荐布局：

```text
E:\AI_Projects\
├── codegraph\              # 代码图谱原项目，作为架构参考
├── storygraph\             # 新建小说图谱工具库、CLI、MCP、API
└── CultivationWorld\
    ├── docs\世界观参考\    # 小说原文与参考文档，保持为资料库
    └── .storygraph\        # StoryGraph 生成索引，默认不纳入文档目录
```

理由：

- `docs/世界观参考/` 是资料来源库，不应混入工具源码、数据库和运行时缓存。
- `E:\AI_Projects\codegraph` 是代码图谱工具项目，不应混入小说领域节点和抽取逻辑。
- 独立 `storygraph` 可以复用 CodeGraph 的工程模式，也能服务其他小说资料目录。
- `.storygraph/storygraph.db` 与 `.codegraph/codegraph.db` 形态一致，agent 易于理解：工具项目负责构建，目标项目保存索引。

## 总体架构

StoryGraph 分为五层：

1. **Source Scanner**
   扫描 `docs/世界观参考/`，识别作品目录、原文 `.txt`、分析 Markdown、时间戳备份文档和待做清单。

2. **Segmenter**
   对原文进行编码识别、章节切分、行号/字符偏移映射；对 Markdown 提取标题层级、表格、证据锚点和主题段落。

3. **Extractor**
   生成候选角色、势力、地点、物品、境界、功法、事件、关系和时间线。首版采用“规则抽取 + LLM 辅助结构化抽取”的混合方式。

4. **Graph Store**
   SQLite 存储节点、边、证据锚点、别名、片段和全文检索索引。结构参考 CodeGraph，但节点种类换成小说语义。

5. **Query Surface**
   提供 CLI、TypeScript API 和 MCP 工具。agent 查询时优先走 StoryGraph，再按证据锚点回读必要原文片段。

## 数据模型

### 核心表

StoryGraph 的数据库建议写入 `.storygraph/storygraph.db`，核心表包括：

| 表 | 作用 |
|----|------|
| `works` | 作品目录，如《凡人修仙传》《仙逆》《遮天》 |
| `source_files` | 原文和 Markdown 文件，记录路径、编码、大小、哈希、索引时间 |
| `chunks` | 切分后的章节/段落/窗口，带行号、字符偏移和摘要 |
| `story_nodes` | 小说语义节点，如角色、势力、事件、物品、境界 |
| `story_edges` | 语义关系边，如师徒、敌对、获得、突破、参与、导致 |
| `evidence_anchors` | 证据锚点，记录文件、章节、行号、短摘录、哈希 |
| `aliases` | 别名、称号、错写、繁简映射 |
| `assertions` | 结构化事实声明，连接节点、边和证据，标注置信度 |
| `story_nodes_fts` | FTS5 全文索引，用于名称、摘要、证据短摘录检索 |

### 节点种类

| kind | 含义 |
|------|------|
| `work` | 作品 |
| `chapter` | 章节或篇章 |
| `chunk` | 文本片段 |
| `character` | 角色 |
| `faction` | 势力、宗门、家族、国家、组织 |
| `location` | 地点、秘境、世界、区域 |
| `item` | 法宝、丹药、材料、灵石、特殊物品 |
| `technique` | 功法、神通、术法、修炼法门 |
| `realm` | 境界、修炼阶段、称号阶位 |
| `creature` | 妖兽、种族、特殊生命 |
| `event` | 剧情事件、战斗、突破、游历、灾变 |
| `concept` | 世界规则、制度、术语、主题设定 |
| `evidence` | 可回溯到原文或 Markdown 的证据节点 |

### 边种类

| kind | 含义 |
|------|------|
| `appears_in` | 节点出现于章节/片段 |
| `supports` | 证据支持事实或节点 |
| `contradicts` | 证据或声明互相冲突 |
| `alias_of` | 别名指向规范实体 |
| `member_of` | 角色属于势力 |
| `leader_of` | 角色领导势力 |
| `master_of` | 师徒关系 |
| `ally_of` | 同盟、友方、合作 |
| `enemy_of` | 敌对、仇怨、冲突 |
| `obtains` | 获得物品、功法、资源 |
| `practices` | 修炼功法或体系 |
| `breaks_through_to` | 突破到境界 |
| `located_in` | 地点从属或事件发生地 |
| `participates_in` | 角色/势力参与事件 |
| `causes` | 事件或行动导致另一事件 |
| `precedes` | 时间顺序关系 |
| `similar_to` | 跨作品设定相似 |
| `derived_to_game_rule` | 可抽象为项目世界观/系统规则 |

### 证据与判断分层

每条重要事实必须能追到 `evidence_anchors`。没有证据的内容只能进入 `assertions`，并标注：

- `source_type = original_text`：来自小说原文。
- `source_type = analysis_md`：来自现有 Markdown 分析。
- `source_type = inference`：我的判断或游戏化抽象。
- `confidence = high | medium | low`：证据强度。
- `status = observed | inferred | disputed | needs_review`：事实状态。

## 抽取流程

### 1. 扫描与编码识别

扫描 `docs/世界观参考/**`，识别作品目录，但 MVP 的索引入口必须指定单部作品。原文 `.txt` 默认尝试 UTF-8、GB18030、GBK；失败时记录错误，不改写原文文件。

针对当前资料库，需要特别处理：

- 多数原文可能是 GBK/GB18030。
- `武破九荒` 存在繁体检索需求。
- `武炼巅峰` 可能存在异常换行，索引时只读取和映射，不改写原文件。

### 2. 文本切分

原文优先按章节标题切分；章节识别失败时按固定窗口切分。每个 chunk 保存：

- 作品名
- 文件路径
- 章节名或窗口编号
- 起止行号
- 起止字符偏移
- 片段摘要
- 内容哈希

Markdown 按标题层级和表格切分，保留标题路径，例如 `人物关系与事件分析.md > 关键人物关系 > 韩立`。

### 3. 候选实体抽取

首版采用规则和上下文窗口：

- 从现有 Markdown 标题、表格、加粗词、列表项中抽候选实体。
- 从原文中按高频专名、称号模式、境界词、势力词、物品后缀抽候选实体。
- 对同名或别名建立 `aliases`，但不自动强合并为同一实体；低置信候选进入 `needs_review`。

### 4. 结构化事实抽取

对候选实体附近的 chunk 做结构化抽取，输出 JSON 风格事实：

```json
{
  "work": "凡人修仙传",
  "subject": "韩立",
  "predicate": "member_of",
  "object": "黄枫谷",
  "event": "加入黄枫谷",
  "time_hint": "早期",
  "evidence": {
    "file": "docs/世界观参考/凡人修仙传/凡人修仙传.txt",
    "chapter": "待识别章节",
    "line_start": 1234,
    "line_end": 1238
  },
  "confidence": "medium",
  "source_type": "original_text"
}
```

抽取器不得把“我的判断”伪装成原作事实。游戏化抽象必须进入 `source_type = inference`。

### 5. 实体归并与冲突检查

归并流程：

1. 精确名称匹配。
2. 别名表匹配。
3. 同作品内称号/本名候选匹配。
4. MVP 不处理跨作品同名；后续支持多作品时，跨作品同名默认不合并。
5. 冲突事实不覆盖旧事实，而是建立 `contradicts` 边并标记 `needs_review`。

### 6. 图谱生成

将实体、事件、证据和事实写入 `story_nodes`、`story_edges`、`assertions`，并更新 FTS 索引。

## 查询接口

### CLI

建议 CLI 形态：

```powershell
storygraph init E:\AI_Projects\CultivationWorld
storygraph index E:\AI_Projects\CultivationWorld --source docs\世界观参考
storygraph status E:\AI_Projects\CultivationWorld --json
storygraph search E:\AI_Projects\CultivationWorld "韩立 筑基丹"
storygraph entity E:\AI_Projects\CultivationWorld "韩立" --work 凡人修仙传
storygraph timeline E:\AI_Projects\CultivationWorld --character 韩立
storygraph evidence E:\AI_Projects\CultivationWorld "夺舍"
```

### MCP 工具

建议首版 MCP 工具：

| 工具 | 作用 |
|------|------|
| `storygraph_status` | 查看索引状态、作品数、节点数、边数、待审事实数 |
| `storygraph_search` | 搜索实体、事件、概念、证据 |
| `storygraph_entity` | 返回角色卡/势力卡/物品卡/境界卡 |
| `storygraph_timeline` | 按作品、角色、势力、主题返回时间线 |
| `storygraph_evidence` | 返回指定概念或事实的证据锚点 |
| `storygraph_context` | 为 agent 的问题组装短上下文，附证据和置信度 |
| `storygraph_compare` | 后续扩展：横向比较多部作品中的同类设定，MVP 不实现 |

### Agent 查询流程

agent 处理世界观问题时的推荐流程：

1. 先调用 `storygraph_search` 或 `storygraph_context`。
2. 如果命中高置信事实，直接引用证据锚点回答。
3. 如果命中低置信或冲突事实，明确说明“待核验”。
4. 如果 StoryGraph 无命中，再回退到 `rg` 或原文检索。
5. 如果产生新设定决策，按项目规则写入 `docs/worldbuilding/wiki/`，并标明来源。

## MVP 范围

首版最小可用版明确限定为“单作品索引 + 单作品查询”。一次 `index` 运行只处理一个 `--work` 指定作品，数据库可以保留 `work_id` 字段作为后续扩展接口，但当前验收不要求多作品同库隔离、跨作品比较或跨作品同名处理。

首版最小可用版分四步：

1. **Schema 与本地索引**
   建立 `storygraph` 工具项目、SQLite schema、`init/index/status/search` CLI。

2. **一部小说试点**
   我的判断：优先试点《一念永恒》。依据是体量小于《凡人修仙传》《遮天》《武炼巅峰》，且当前计划中已有“疑似生成时间线核验”的需求，适合验证证据回溯能力。用户也可指定其他作品。

3. **角色卡 + 时间线 + 证据查询**
   对试点作品输出角色卡、事件时间线、实体关系和证据锚点。

4. **MCP 接入**
   暴露 `storygraph_search`、`storygraph_entity`、`storygraph_timeline`、`storygraph_evidence`、`storygraph_status`，让 agent 查询时可直接调用。

完成 MVP 后，再扩展到 15 部小说和跨作品比较。

## 错误处理

- 编码失败：记录到 `source_files.errors`，不丢弃文件路径。
- 章节识别失败：降级为固定窗口 chunk。
- 实体同名冲突：MVP 只处理同作品低置信别名并进入待审；跨作品冲突留到后续扩展。
- 证据缺失：事实进入 `needs_review`，查询时不作为高置信依据。
- 抽取冲突：建立 `contradicts` 边，不覆盖旧事实。
- 索引过期：根据文件哈希和修改时间提示 `stale`。
- 输出过长：查询接口只返回最相关证据与摘要，提供可继续查询的节点 ID。

## 测试与验收

### 单元测试

- schema 初始化和迁移。
- 文件扫描和编码识别。
- 章节切分和行号映射。
- 节点/边插入与 FTS 搜索。
- 别名归并和冲突标记。

### 集成测试

- 使用小型虚构 fixture 文本验证角色、势力、事件、证据锚点。
- 使用一部真实小说目录试点，验证索引不改写源文件。
- 验证 CLI 查询结果可回溯到具体文件和行号。
- 验证 MCP 工具输出不超过预算，且包含置信度和来源类型。

### 验收标准

- `storygraph status` 能列出作品数、文件数、节点数、边数、待审事实数；MVP 试点预期作品数为 1。
- 对试点作品，至少能查到 5 个主要角色卡、20 条关键事件、10 条关系边、10 条世界观设定证据。
- 任意高置信事实必须带 `evidence_anchors`。
- 查询“角色 + 物品/境界/势力/事件”时，优先返回结构化结果，而不是整段原文。
- 若无证据，回答必须明确“StoryGraph 未找到来源支持”。

## 与当前项目文档的关系

StoryGraph 是资料索引工具，不直接替代当前文档体系：

- `docs/世界观参考/` 保持原文与人工分析资料库。
- `.storygraph/` 保存生成索引，默认不作为文档导航的一部分。
- `docs/worldbuilding/wiki/` 继续只保存用户确认后的项目设定。
- `docs/superpowers/specs/` 保存本设计规格。
- 后续如 StoryGraph 成为长期工具，可新增 ADR 记录工具架构决策。

## 后续实施建议

我的判断：下一步应在 `E:\AI_Projects\storygraph` 新建工具项目，直接复用 CodeGraph 的工程组织方式，而不是从零散脚本开始。

建议实施优先级：

1. 建 `storygraph` 项目骨架、SQLite schema、CLI。
2. 建 `source scanner` 和 `segmenter`，先保证编码、行号和文件哈希可靠。
3. 建 `story_nodes/story_edges/evidence_anchors` 写入与 search。
4. 做《一念永恒》试点抽取。
5. 加 MCP 工具。
6. 扩展到全部作品和跨作品比较。

## 自检

- 无未完成条目。
- 存放位置明确：工具在 `E:\AI_Projects\storygraph`，索引在当前项目 `.storygraph/`。
- 范围明确：全能力目标，MVP 只跑通一部作品；跨作品能力为后续扩展。
- 证据规则明确：原作事实、分析文档、我的判断分层存储。
- 与项目规则一致：不污染 `docs/世界观参考/`，世界观决策仍需进入 Wiki 并标明来源。
