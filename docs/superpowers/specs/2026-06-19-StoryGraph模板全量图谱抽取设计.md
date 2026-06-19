# StoryGraph 模板全量图谱抽取设计

> 最后更新：2026-06-19
> 状态：设计草案，待用户审阅
> 类型：StoryGraph 图谱抽取与模板覆盖率设计

## 背景

用户希望 StoryGraph 支持 `docs/世界观参考/模板/` 下所有调研模板的图谱化抽取，最关键目标是“尽量全”。当前测试原文为 `docs/世界观参考/凡人修仙传/凡人修仙传.txt`，模板目录为 `docs/世界观参考/模板/`。

已确认方向：

1. 采用“统一小说总图 + 模板专用子图 + 覆盖率审计”的两层图谱方案。
2. 采用“规则候选池 + LLM 结构化抽取 + 覆盖率审计”的抽取方案。
3. 第一阶段用 6 个模板作为验收样板：丹药、法宝、人物关系、事件因果链、势力、秘境遗迹与机缘。
4. 方案必须参考 `E:\AI_Projects\codegraph` 的本地 SQLite、CLI/MCP、explore/context、图遍历和查询预算控制思路，但 StoryGraph 不合并进 CodeGraph 源码。
5. 不为《凡人修仙传》或某个模板写一次性硬编码；模板字段、候选规则、证据角色、覆盖规则和输出约束必须配置化。

当前观察：

- `E:\AI_Projects\storygraph` 已有 TypeScript + SQLite + CLI/MCP 工程，测试通过，基础扫描、分块、索引、查询可用。
- 当前抽取核心仍是 MVP：少量硬编码实体、基础后缀/正则、`appears_in` 边、证据锚点和实体卡查询。
- 当前 schema 已有 `works`、`source_files`、`chunks`、`story_nodes`、`story_edges`、`evidence_anchors`、`aliases`、`assertions`，适合作为统一总图底座。
- 当前缺少模板 Registry、模板运行记录、候选池、模板子图、覆盖率账本、审查记录和 `storygraph_template_explore` 一类面向 Codex 写作的主力查询接口。
- 《凡人修仙传》原文当前为 UTF-8，无 BOM；用现有章节标题模式可匹配约 2016 个卷/章标题。

## 目标

1. 让 StoryGraph 从“单作品证据索引”升级为“小说证据与模板子图引擎”。
2. 对每部作品建立统一总图：章节、实体、事件、关系、别名、证据、结构化断言。
3. 对每个模板建立专用子图：模板实体、模板关系、模板字段、证据角色和覆盖状态。
4. 通过候选池和覆盖率账本降低遗漏：候选、证据、结构化抽取、入图、输出和待核验状态都可追踪。
5. 提供类似 CodeGraph `explore` 的 StoryGraph 查询接口，让 Codex 一次拿到某个模板需要的证据包、子图关系、缺口和建议输出顺序。
6. 第一阶段以《凡人修仙传》6 个模板为验收样板，证明架构能支撑实体表、关系链、因果链、组织设定和地点机缘混合类模板。

## 非目标

1. 不在第一阶段直接覆盖或重写现有世界观参考 Markdown。
2. 不追求数学意义上的“绝对全”，而是追求工程上可审计的“尽量全”。
3. 不让 LLM 单独决定哪些实体或事件存在；LLM 只在候选和证据范围内做结构化理解。
4. 不把模板规则、小说实体、章节名、输出字段写死在代码里。
5. 不实现跨作品强合并、跨作品同名消歧或多作品比较；这些能力需要独立设计。

## 总体架构

StoryGraph 分为六层：

```text
全文索引层
  扫描作品目录，识别原文、分析 Markdown、模板目录和现有 .storygraph。
  负责编码识别、章节切分、Markdown 标题/表格切分、行号和字符偏移映射。

统一总图层
  抽取通用实体、事件、关系、别名、证据锚点和结构化断言。
  面向所有模板共享，避免每个模板重复扫全文。

模板 Registry 层
  配置每个模板的字段、候选规则、证据角色、子图规则、覆盖规则和 LLM JSON Schema。
  代码只认通用 shape 和策略，不认固定模板数量。

模板子图层
  为每个模板建立专用视角：丹药图、法宝图、人物关系图、因果链图、势力图、秘境机缘图。
  同一 story_node 可以投影到多个 template_entity。

覆盖率账本层
  记录候选、证据、结构化抽取、确认、待核验、驳回、已输出和疑似遗漏。
  用于判断写作阶段是否漏掉已发现条目。

查询与 Explore 层
  提供 CLI/MCP/API。
  主力接口是模板级 explore/context，返回可直接服务 Codex 写作的证据包。
```

架构原则：

- 规则负责召回，LLM 负责理解，覆盖率账本负责防漏。
- 总图负责共享事实，模板子图负责模板视角。
- 配置承载模板差异，代码承载通用流程。
- 证据锚点是事实可信度的中心；没有证据的内容只能进入待核验或推断状态。

## 数据模型扩展

保留现有 `story_nodes`、`story_edges`、`assertions`、`evidence_anchors`。新增模板抽取相关概念。

### template_profiles

记录模板注册信息。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 模板配置 ID，例如 `pill_analysis` |
| `file_name` | 模板文件名，例如 `丹药分析模板.md` |
| `display_name` | 展示名 |
| `shape` | 模板形态，例如 `entity_table`、`relationship_chain`、`causal_chain` |
| `config_hash` | 配置哈希，用于运行记录追踪 |
| `enabled` | 是否参与当前批处理 |

### template_runs

记录某次模板抽取运行。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 运行 ID |
| `work_id` | 作品 ID |
| `template_id` | 模板 ID |
| `started_at` / `finished_at` | 运行时间 |
| `status` | `running`、`completed`、`failed`、`needs_review` |
| `stats` | 候选数、确认数、待核验数、疑似遗漏数、LLM schema 校验失败数、无证据拒绝数、新候选建议数、字段级缺证数等摘要 |

### candidate_mentions

记录候选线索。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 候选提及 ID |
| `run_id` | 所属模板运行 |
| `work_id` | 作品 ID |
| `template_id` | 模板 ID |
| `raw_text` | 原文中发现的候选词 |
| `normalized_name` | 规范化名称 |
| `candidate_type` | 候选类型，例如 `pill`、`artifact`、`faction` |
| `source_file_id` / `chunk_id` | 来源位置 |
| `line_start` / `line_end` | 行号 |
| `rule_id` | 命中的召回规则 |
| `confidence` | 召回置信度 |
| `origin` | `rule`、`llm_suggestion`、`manual_review` |
| `parent_review_id` | 来源审查记录，可为空 |

候选不等于事实。候选可以是泛称、噪声或待核验线索，但不能被静默丢弃。

### template_entities

记录模板子图实体。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 模板实体 ID |
| `run_id` | 所属运行 |
| `story_node_id` | 对应统一总图节点，可为空表示尚未归并 |
| `template_type` | 模板类型，例如 `pill`、`artifact`、`organization` |
| `name` | 实体名 |
| `fields` | 模板字段断言 JSON，字段值必须携带证据状态 |
| `status` | `confirmed`、`needs_review`、`rejected` |
| `primary_evidence_id` | 主证据 |

`fields` 不保存裸值。每个字段值必须使用统一断言结构：

```json
{
  "字段名": {
    "value": "字段值，或 unknown，或 原文未说明",
    "status": "confirmed | needs_review | unknown | rejected",
    "confidence": 0.86,
    "evidence_ids": ["evidence_anchor_id"],
    "review_reason": "证据不足、冲突、原文未说明或其他原因"
  }
}
```

也可以把字段断言拆成独立的 `template_field_assertions` 表；若采用独立表，`template_entities.fields` 只保留规范化后的展示快照，事实判定以断言表为准。

### template_field_assertions

记录字段级事实断言，用于防止无证据字段混入 confirmed。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 字段断言 ID |
| `run_id` | 所属运行 |
| `template_entity_id` | 所属模板实体 |
| `field_name` | 模板字段名 |
| `value` | 字段值，或 `unknown`、`原文未说明` |
| `status` | `confirmed`、`needs_review`、`unknown`、`rejected` |
| `confidence` | 字段级置信度 |
| `evidence_ids` | 字段级证据锚点列表 |
| `review_reason` | 缺证、冲突、低置信或原文未说明原因 |

confirmed 门槛：实体、关系、事件边和关键字段断言都必须至少绑定一个 `evidence_anchor`。字段级事实没有证据时，只能进入 `needs_review`、`unknown` 或标记为 `原文未说明`，不能进入 confirmed 结论，也不能被 coverage report 计入已确认覆盖。

示例：同一个统一总图物品节点可以在法宝模板中投影为 `template_type=artifact`，在秘境机缘模板中投影为 `template_type=opportunity_item`；具体字段能否 confirmed 取决于字段断言自己的证据锚点。

### template_relations

记录模板子图关系。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 模板关系 ID |
| `run_id` | 所属运行 |
| `source_entity_id` / `target_entity_id` | 模板实体关系 |
| `story_edge_id` | 对应总图边，可为空 |
| `relation_type` | 模板关系类型 |
| `label` | 可读标签 |
| `evidence_ids` | 关系或事件边证据锚点列表 |
| `confidence` | 置信度 |
| `status` | 状态 |

关系和事件边不能只继承实体证据。每条 confirmed 关系或事件边必须绑定至少一个直接支持该关系、因果、时序或归属判断的证据锚点；缺少边级证据时进入 `needs_review`。

### coverage_items

记录覆盖率目标账本。覆盖项不只面向候选或模板实体，也面向模板字段断言、模板关系和事件边，保证 coverage audit 可以按字段级、关系级和边级目标核对输出遗漏。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 覆盖项 ID |
| `run_id` | 所属运行 |
| `target_type` | 覆盖目标类型：`candidate`、`entity`、`field_assertion`、`relation`、`event_edge` |
| `target_id` | 对应目标 ID；分别指向 `candidate_mentions`、`template_entities`、`template_field_assertions`、`template_relations`，事件边可指向事件边记录或带事件边语义的 `template_relations.id` |
| `candidate_id` | 来源候选，可为空 |
| `template_entity_id` | 关联模板实体，可为空；字段断言、关系和事件边可通过该字段回溯所属实体 |
| `coverage_status` | 覆盖状态 |
| `evidence_count` | 证据数量 |
| `missing_fields` | 缺失字段列表 |
| `review_reason` | 待核验或疑似遗漏原因 |
| `used_in_output` | 是否已被最终文档使用 |

`target_type + target_id` 是 coverage item 的通用定位机制，必须覆盖 `template_entities`、`template_field_assertions`、`template_relations` 和事件边目标。`used_in_output` 与 `missing_from_output` 不只用于实体，也同样用于字段断言、关系和事件边：只要某个已确认或需显式说明的目标没有出现在最终 Markdown 对应条目中，就应在覆盖率报告中标记为 `missing_from_output`。

覆盖状态枚举：

```text
candidate_only
evidence_found
structured_extracted
confirmed
needs_review
rejected
used_in_output
missing_from_output
```

### extraction_reviews

记录审查信息。

核心字段：

| 字段 | 含义 |
|------|------|
| `id` | 审查记录 ID |
| `run_id` | 所属运行 |
| `target_type` | `candidate`、`entity`、`field_assertion`、`relation`、`event_edge`、`coverage_item` |
| `target_id` | 目标 ID |
| `severity` | `info`、`warning`、`error` |
| `category` | `low_confidence`、`conflict`、`duplicate`、`insufficient_evidence` 等 |
| `message` | 审查说明 |
| `resolved_at` | 解决时间，可为空 |

## 模板 Registry

模板 Registry 是配置化核心，建议存放在 StoryGraph 项目的 `assets/template-registry.yaml` 或等价配置目录中。

每个模板至少配置：

```text
基础信息
  模板文件、展示名、模板形态、输出字段。

候选规则
  后缀词、关键词、触发词、排除词、别名规则、章节范围策略。

证据角色
  定义、来源、使用、变化、结果、限制、后果、关系变化等。

子图规则
  需要哪些模板实体类型、模板关系类型、允许哪些 story_node kind 投影。

覆盖规则
  哪些字段必须有证据，哪些字段属于关键字段断言，哪些字段允许“原文未说明”，哪些候选必须进入待核验。

LLM JSON Schema
  结构化抽取时允许输出的字段、关系、状态和置信度。
  字段、关系和事件边必须显式声明 evidence_ids；没有证据的事实只能输出为 needs_review、unknown 或 原文未说明。
```

示例：

```yaml
templates:
  pill_analysis:
    file: 丹药分析模板.md
    displayName: 丹药分析
    shape: entity_table
    templateTypes: [pill]
    candidateRules:
      suffixes: [丹, 丸, 散, 液, 膏, 药, 毒]
      keywords: [丹药, 丹方, 服下, 炼制, 药力, 突破, 解毒]
      excludeGeneric: [丹药, 药力, 灵药]
    fields:
      - 丹药名称
      - 稀有度
      - 功效
      - 用途
      - 丹方
      - 炼制方式
      - 来源
      - 限制/副作用
      - 适用境界
    evidenceRoles:
      - definition
      - usage
      - source
      - consequence
    coverage:
      requireEvidenceForConfirmed: true
      requireEvidenceForConfirmedFields: true
      requireEvidenceForConfirmedEdges: true
      criticalFields: [丹药名称, 功效, 来源]
      reportUnresolvedCandidates: true
      minEvidenceAnchors: 1
```

第一阶段模板分类：

| 模板 | shape | 主要验证能力 |
|------|-------|--------------|
| 丹药分析模板.md | `entity_table` | 实体候选召回、字段抽取、证据覆盖 |
| 法宝分析模板.md | `entity_table` | 实体别名、主人/来源/使用事件 |
| 人物关系与事件分析模板.md | `relationship_chain` | 角色关系、关系变化、关键事件 |
| 事件因果链（长程因果图）模板.md | `causal_chain` | 事件节点、原因、后果、前后顺序 |
| 势力设定模板.md | `organization_profile` | 组织、层级、成员、资源、规则 |
| 秘境遗迹与机缘模板.md | `location_opportunity` | 地点、进入条件、机缘、冲突、结果 |

## 抽取流程

### 1. Source Scan

扫描目标作品目录，识别：

- 原文 `.txt`。
- 分析 Markdown。
- 模板目录。
- 现有 `.storygraph/storygraph.db`。

扫描结果只记录文件状态，不改写原文或人工文档。

### 2. Segment

原文按卷、章和必要窗口切分，保存行号和字符偏移。Markdown 按标题、表格和卡片切分。

章节识别失败时使用固定窗口兜底，兜底窗口必须保留行号和字符偏移，不能只保存裸文本片段。

### 3. Candidate Harvest

根据模板 Registry 对全文召回候选。

示例：

| 模板 | 候选线索 |
|------|----------|
| 丹药 | 丹、丸、散、液、膏、毒、丹方、服下、炼制、药力 |
| 法宝 | 瓶、鼎、剑、幡、珠、镜、舟、甲、盾、祭出、炼化 |
| 势力 | 宗、门、派、谷、宫、族、盟、城、国、长老、弟子 |
| 秘境 | 殿、洞府、遗迹、禁地、空间、岛、谷、开启、入口 |
| 关系/因果 | 拜师、追杀、结盟、夺宝、突破、导致、引发、反目 |

候选召回结果写入 `candidate_mentions`，不因低置信而丢弃。

### 4. Evidence Expansion

每个候选回查上下文窗口，尽量收集多种证据角色：

- 定义处。
- 来源处。
- 使用处。
- 变化处。
- 结果处。
- 限制或副作用处。

证据锚点仍写入 `evidence_anchors`，并通过覆盖项关联到候选和模板实体。

### 5. LLM Structured Extraction

对候选相关 chunk 执行结构化抽取，输出严格 JSON。LLM 输出必须包含：

- 实体名称和模板类型。
- 模板字段。
- 相关关系或事件。
- 实体、字段断言、关系和事件边各自的证据 ID 或证据位置。
- 置信度。
- 待核验原因。
- `new_candidate_suggestion`。

LLM 不能凭空新增事实。若发现候选外的重要线索，应输出为 `new_candidate_suggestion`，再进入候选池和证据回查，而不是直接进入 confirmed。

阶段 1 必须实现最小回流闭环：`new_candidate_suggestion` 先写入 `candidate_mentions.origin=llm_suggestion`，或在证据位置不足时写入 `extraction_reviews.category=insufficient_evidence`；随后触发 Evidence Expansion 回查。只有回查得到支持对应实体、字段断言、关系或事件边的证据锚点，并通过 schema 校验后，才允许进入 `structured_extracted`、`needs_review` 或 `confirmed` 等后续状态。

### 6. Merge & Normalize

合并别名、同物多名和同事件多描述。低置信合并不覆盖原始条目，进入 `extraction_reviews`。

归并顺序：

1. 精确名称。
2. 模板内别名配置。
3. 同一证据窗口内的强关联称呼。
4. 人工或审查确认。

### 7. Build Template Subgraph

根据模板 shape 生成子图。

示例：

- 丹药图：丹药、功效、来源、适用境界、丹方、限制。
- 法宝图：形态、能力、主人、获得方式、使用事件。
- 人物关系图：角色、关系类型、关系变化、关键事件。
- 因果链图：事件、原因、后果、前后顺序。
- 势力图：组织、成员、层级、资源、规则。
- 秘境图：地点、进入条件、机缘、冲突、结果。

### 8. Coverage Audit

每个模板运行生成覆盖率报告。

报告至少包含：

- 候选总览。
- 已确认条目。
- 待核验条目。
- 疑似遗漏。
- 实体、字段断言、关系和事件边的证据覆盖。
- 去重与冲突。
- 模板字段缺口。
- 已入图但未输出的条目。

报告中的疑似遗漏和已入图未输出条目必须按 `coverage_items.target_type` 分组，至少能分别列出实体、关键字段断言、关系和事件边。字段断言是否属于关键字段由模板 Registry 的 coverage 配置定义。

## 查询接口

StoryGraph 查询层需要新增模板级 CLI/MCP/API。建议工具名称如下：

| 工具 | 作用 |
|------|------|
| `storygraph_index` | 建统一总图 |
| `storygraph_template_run` | 对某作品某模板串起候选召回、证据扩展、LLM 抽取、schema 校验、子图生成和 coverage audit |
| `storygraph_template_status` | 查看模板运行状态和统计 |
| `storygraph_template_coverage` | 返回覆盖率报告 |
| `storygraph_template_explore` | 主力工具，返回模板证据包、子图关系、缺口和建议输出顺序 |

`storygraph_template_explore` 输入：

```json
{
  "projectRoot": "E:/AI_Projects/CultivationWorld",
  "sourceDir": "docs/世界观参考",
  "work": "凡人修仙传",
  "template": "丹药分析模板.md",
  "focus": "全部",
  "includeReview": true,
  "limit": 50
}
```

输出应包含：

- 模板字段。
- 已确认条目。
- 待核验条目。
- 疑似遗漏。
- 实体、字段断言、关系和事件边的相关证据锚点。
- 子图关系。
- 建议输出顺序。
- 查询预算统计。

预算控制参考 CodeGraph `explore`：

- 默认返回最相关、最缺口相关的证据包。
- 支持 `limit`、`offset`、`focus`、`includeReview`。
- 大模板分批返回，避免一次性占满上下文。
- 证据短摘录控制长度，必要时返回文件路径和行号让 agent 回读。

## Codex 使用流程

当用户要求按模板分析某部作品时：

```text
1. Codex 调用 storygraph_template_status。
2. 若目标模板未运行或已过期，调用 storygraph_template_run。
3. storygraph_template_run 必须完成候选召回、证据扩展、LLM 抽取、schema 校验、子图生成和 coverage audit。
4. 调用 storygraph_template_coverage 检查疑似遗漏、待核验和字段级缺证。
5. 调用 storygraph_template_explore 获取证据包。
6. 按模板字段生成 Markdown，只使用 confirmed 或明确标注为待核验、unknown、原文未说明的断言。
7. 将文档条目与实体、字段断言、关系和事件边的 coverage item 对齐，标记 used_in_output。
8. 若任一实体、关键字段断言、关系或事件边存在 missing_from_output，补写或向用户说明。
```

生成文档时仍遵循模板目录规则：最终输出只按模板案例格式和字段输出，不添加模板未要求的章节。

## 第一阶段验收

第一阶段以《凡人修仙传》验证 6 个模板。

验收输入：

```text
projectRoot = E:\AI_Projects\CultivationWorld
sourceDir   = docs\世界观参考
work        = 凡人修仙传
templates   = 丹药、法宝、人物关系、事件因果链、势力、秘境遗迹与机缘
```

验收标准：

1. 能完成《凡人修仙传》统一总图索引。
2. 6 个模板都能通过 `storygraph_template_run` 生成 `template_run`。
3. 6 个模板都能生成 coverage report。
4. 每个 confirmed 的实体、关系、事件边和关键字段断言都必须绑定至少一个 evidence anchor。
5. 每个模板能列出待核验和疑似遗漏。
6. `storygraph_template_explore` 能返回某个模板的证据包、子图关系和输出建议。
7. 模板 Registry 不硬编码《凡人修仙传》的具体实体；实体名只能出现在索引结果、测试 fixture 或验收报告中。
8. 写作阶段能根据 coverage report 检查已入图但未输出的条目。
9. 无证据字段必须进入 `needs_review`、`unknown` 或标记为 `原文未说明`，不能进入 confirmed 结论。
10. 6 个模板的 coverage report 必须能分别列出未输出的实体、关键字段断言、关系和事件边。

6 模板最小闭环验收矩阵：

| 模板 | 必须验证的 confirmed 证据粒度 | 缺证处理 |
|------|-------------------------------|----------|
| 丹药 | 实体、功效/来源等关键字段断言 | 字段进入 `needs_review`、`unknown` 或 `原文未说明` |
| 法宝 | 实体、能力/来源/使用事件字段断言、使用事件边 | 字段或事件边缺证时不计入 confirmed |
| 人物关系 | 人物实体、关系边、关系变化事件边 | 关系缺少边级证据时进入 `needs_review` |
| 事件因果链 | 事件节点、因果边、时序边 | 因果或时序证据不足时进入 `needs_review` |
| 势力 | 组织实体、成员/层级/规则字段断言、隶属关系边 | 字段或关系缺证时标记缺口 |
| 秘境遗迹与机缘 | 地点实体、进入条件/机缘字段断言、冲突或结果事件边 | 字段或事件边缺证时标记缺口 |

## 阶段推进规划

StoryGraph 模板全量图谱抽取分为 6 个阶段推进。每个阶段都必须有可验证产物，不能只停留在模型自述或人工印象。

### 阶段 0：基线整理与工程边界冻结

目标：确认当前 StoryGraph MVP 的真实基线，避免在未提交改动和旧设计假设上继续叠加。

范围：

- 梳理 `E:\AI_Projects\storygraph` 当前未提交改动。
- 确认现有 work-local `.storygraph/storygraph.db` 定位规则仍成立。
- 确认《凡人修仙传》原文编码、章节切分和源文件扫描结果。
- 为模板抽取新增配置目录、测试 fixture 和数据库迁移入口，但不引入模板逻辑。

交付物：

- StoryGraph 基线状态说明。
- 数据库迁移策略说明。
- 《凡人修仙传》索引前置检查报告。

进入下一阶段门槛：

- `npm test` 通过。
- 单作品索引路径和查询路径一致。
- 当前未提交改动被确认、提交或隔离。

### 阶段 1：6 个样板模板闭环

目标：以《凡人修仙传》跑通第一批 6 个模板，证明候选、证据、模板子图和覆盖率账本闭环有效。

本阶段必须接入最小可用的 LLM 结构化抽取。原因是人物关系、事件因果、势力和秘境机缘模板不能只靠规则候选池完成闭环；规则负责召回，LLM 负责在证据窗口内抽取关系、因果、字段和待核验原因，覆盖率账本负责检查遗漏。

范围：

- 增加 `template_profiles`、`template_runs`、`candidate_mentions`、`template_entities`、`template_field_assertions`、`template_relations`、`coverage_items`、`extraction_reviews`。
- 建立 6 个模板的 Registry 配置。
- 实现 `storygraph_template_run` 串联规则候选池、证据扩展、最小 LLM 结构化抽取、schema 校验、模板子图生成和 coverage audit。
- 为 6 个模板提供最小 JSON Schema，至少覆盖实体表、关系链、因果链、组织设定和地点机缘。
- 增加 `storygraph_template_run`、`storygraph_template_status`、`storygraph_template_coverage`、`storygraph_template_explore` 的 CLI 版本。
- LLM adapter 可以先只支持一个实际可用模型后端，但接口必须可替换，且所有 LLM 输出都必须经过 schema 校验、证据绑定和审查落库。
- 实现 `new_candidate_suggestion` 的最小回流：写入 `candidate_mentions` 或 `extraction_reviews`，触发证据回查后再进入后续状态。

交付物：

- 6 个模板的配置文件。
- `storygraph_template_run` CLI 运行样例和运行统计样例。
- 《凡人修仙传》6 个模板的 coverage report。
- CLI 查询结果样例。
- 单元测试和真实资料验收命令。
- 6 个模板的 LLM 结构化抽取样例和失败落审样例。

进入下一阶段门槛：

- 6 个模板都能通过 `storygraph_template_run` 生成 `template_run`，且运行链路覆盖候选召回、证据扩展、LLM 抽取、schema 校验、子图生成和 coverage audit。
- 每个 confirmed 的实体、关系、事件边和关键字段断言都有至少一个 evidence anchor。
- 无证据字段必须进入 `needs_review`、`unknown` 或标记为 `原文未说明`，不能进入 confirmed 结论。
- 每个模板都能列出待核验和疑似遗漏。
- `storygraph_template_explore` 能返回分批、可预算控制的证据包。
- 6 个模板的 coverage report 必须能分别列出未输出的实体、关键字段断言、关系和事件边。
- 6 个模板的 LLM 输出全部通过对应 schema 校验；无证据的 LLM 事实、字段断言、关系或事件边不能进入 confirmed。
- LLM `new_candidate_suggestion` 能落库并完成一次证据回查；无证据建议保留为待核验或审查记录。

### 阶段 2：LLM 结构化抽取强化与规模化

目标：在阶段 1 最小可用 LLM 闭环基础上，提高 LLM 抽取的稳定性、可复核性、成本控制和跨模板扩展能力。

范围：

- 完善不同 template shape 的 JSON Schema，覆盖更多字段、关系和审查状态。
- 强化 LLM adapter，支持批处理、重试、超时、预算限制、结构校验和失败落审。
- 强化阶段 1 已有的新候选回流，支持批处理、重试、去重和质量评估；新发现线索仍不得直接确认为事实。
- 对低置信、冲突、重复和证据不足条目写入 `extraction_reviews`。
- 对同一模板运行规则-only、LLM-assisted 和复核后的 coverage 对比，形成质量评估。

交付物：

- 扩展后的 `entity_table`、`relationship_chain`、`causal_chain`、`organization_profile`、`location_opportunity` 结构化抽取 schema。
- LLM 抽取运行日志、预算统计和失败审计样例。
- 6 个模板在 LLM 接入后的 coverage 对比报告。

进入下一阶段门槛：

- LLM 批处理、重试和失败落审路径都有测试覆盖。
- 新候选能回流到候选池并参与证据回查。
- 复杂模板的待核验原因可读、可追踪。
- 对每个样板模板都能说明 LLM 相比规则-only 增加了哪些关系、字段或待核验线索。

### 阶段 3：扩展到全部模板 Registry

目标：把 6 个样板模板沉淀出的 shape、字段、候选规则和覆盖规则扩展到模板目录内全部 active 模板。

范围：

- 扫描模板目录并生成 active template 清单。
- 为每个模板配置 shape、字段、候选规则、证据角色和覆盖规则。
- 启动时检查模板文件、README 清单和 Registry 一致性。
- 将模板数量作为扫描结果，不在代码里固定为 38 或其他数字。

交付物：

- 全量 `template-registry.yaml`。
- 模板一致性检查命令。
- 每类 shape 的最小 fixture 和测试。

进入下一阶段门槛：

- active 模板全部有 Registry 配置。
- Registry、模板目录、README 清单一致性检查通过。
- 任一模板缺少字段、shape 或覆盖规则时，启动门禁能给出明确错误。

### 阶段 4：与世界观通用抽取插件联动

目标：让 Codex 插件调用 StoryGraph 的模板图谱能力，按模板生成世界观参考 Markdown，并用 coverage 防止写作阶段漏项。

范围：

- 插件调用 `storygraph_template_status`、`storygraph_template_run`、`storygraph_template_coverage` 和 `storygraph_template_explore`。
- 写作阶段把输出条目关联回实体、字段断言、关系和事件边的 `coverage_items`。
- 生成后标记 `used_in_output`，并报告 `missing_from_output`。
- 保持模板输出只按模板案例格式和字段生成，不添加额外章节。

交付物：

- 插件与 StoryGraph 的调用契约。
- 6 个样板模板的 Markdown 写作演示。
- coverage 与输出文档对齐报告。

进入下一阶段门槛：

- 输出文档中的条目能追溯到 coverage item 和 evidence anchor。
- 已入图但未输出的条目会被报告或补写。
- 待核验和疑似遗漏不会混入事实结论。

### 阶段 5：质量评测与多作品推广

目标：建立类似 CodeGraph 搜索质量循环的 StoryGraph 评测体系，并从《凡人修仙传》推广到多部作品。

范围：

- 为不同作品和模板建立评测问题集。
- 统计候选召回、confirmed 数量、待核验比例、疑似遗漏比例、输出覆盖率。
- 对模板 shape、候选规则和 LLM schema 做版本化。
- 支持多作品分别建库、分别验收；不做跨作品强合并。

交付物：

- StoryGraph 模板抽取质量报告。
- 多作品试运行报告。
- Registry 和 schema 版本升级记录。

进入稳定使用门槛：

- 每个作品都能独立生成 `.storygraph/storygraph.db`。
- 模板抽取质量报告能明确说明覆盖、缺口和风险。
- Codex 写文档前能优先使用 StoryGraph，不再从整本小说全文无约束搜索开始。

## 与现有设计的关系

本设计补充并细化以下文档：

- `docs/superpowers/specs/2026-06-05-StoryGraph小说图谱设计.md`
- `docs/superpowers/specs/2026-06-05-StoryGraph单作品本地索引库规格.md`
- `docs/superpowers/plans/2026-06-05-StoryGraph小说图谱MVP实施计划.md`

与 `docs/superpowers/specs/2026-06-19-世界观通用抽取插件设计.md` 的边界：

- 世界观通用抽取插件设计关注 Codex 插件如何调度多 agent、按模板写出 Markdown。
- 本设计关注 StoryGraph 如何提供可查询、可审计、可复用的图谱底座和模板子图。
- 两者可以结合：插件调用 StoryGraph 的 template run、coverage 和 explore 能力，再负责写文档和人工审阅。

## 风险与约束

1. 候选召回过窄会漏项，过宽会带来噪声；需要用 coverage report 和真实模板验收调参。
2. LLM 结构化抽取必须被 JSON Schema、证据锚点和覆盖账本约束，不能把模型输出直接作为事实。
3. 大文本运行时间可能较长，模板运行需要支持分批、断点和局部重试。
4. 模板 Registry 需要和模板目录保持一致；启动时应检查模板文件、README 清单和 Registry 是否一致。
5. 现有 StoryGraph 工作区有未提交修改，实施前需要先确认这些改动是否属于当前基线。

## 自检

- 已明确采用统一总图加模板子图。
- 已明确第一阶段 6 个验收模板。
- 已明确模板配置化范围，避免硬编码小说实体和固定模板数量。
- 已明确覆盖率账本是“尽量全”的工程判定方式。
- 已明确 LLM 只做结构化理解，不单独决定事实存在。
- 已明确阶段 1 必须包含最小 LLM 结构化抽取，阶段 2 负责强化与规模化。
- 已明确阶段 0 到阶段 5 的推进目标、交付物和升级门槛。
- 已明确与现有 StoryGraph 设计和通用抽取插件设计的边界。
