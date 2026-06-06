# StoryGraph 单作品本地索引库规格

> 最后更新：2026-06-06
> 状态：设计草案，待用户审阅
> 类型：StoryGraph 增量规格

## 资料来源

- 用户确认：StoryGraph MVP 只做单作品索引与查询。
- 用户确认：初始化数据库应直接放到小说相同目录，并且 agent 需要读取哪本小说时，应先在当前小说目录查找 `.storygraph`。
- 用户确认：`work=武炼巅峰` 等单作品查询必须避免路径匹配不稳；中文 Git 路径输出需要关闭转义；小说原文检索必须显式使用 `rg --encoding gb18030`。
- 现有 StoryGraph 初始设计：`docs/superpowers/specs/2026-06-05-StoryGraph小说图谱设计.md` 已定义 StoryGraph 的目标、Schema、CLI、MCP 与单作品 MVP 范围。
- 实现位置：StoryGraph 工具源码位于 `E:\AI_Projects\storygraph`，核心路径解析在 `src\paths.ts`，原文扫描在 `src\scanner\scan.ts`，查询入口在 `src\query\*.ts` 与 `src\mcp\tools.ts`。

## 目标

本规格修订 StoryGraph 的索引库定位规则：每本小说目录拥有自己的 `.storygraph` 目录和 `storygraph.db`，查询时优先从当前小说目录发现索引库。

目标效果：

1. 每本小说可独立初始化、独立索引、独立查询。
2. agent 进入或定位某本小说目录后，可直接通过该目录下的 `.storygraph` 找到索引。
3. `index/status/search/entity/timeline/evidence` 对同一本小说使用同一个本地 DB。
4. 旧的项目根目录 `.storygraph` 不再作为单作品小说索引的默认位置。

## 非目标

- 不实现多作品同库索引。
- 不实现跨小说时间线、跨小说角色合并或跨小说设定比较。
- 不自动删除既有项目根目录 `.storygraph`，避免误删历史索引或用户手工数据。
- 不改变小说原文、Markdown 分析文档和 `docs/worldbuilding/wiki/` 的写入规则。

## 目录与术语

以《一念永恒》为例：

```text
projectRoot = E:\AI_Projects\CultivationWorld
sourceDir   = docs\世界观参考
work        = 一念永恒
workRoot    = E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒
graphDir    = E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph
dbPath      = E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph\storygraph.db
```

推荐目录结构：

```text
E:\AI_Projects\CultivationWorld\
└── docs\
    └── 世界观参考\
        └── 一念永恒\
            ├── 一念永恒.txt
            ├── 人物关系与事件分析.md
            └── .storygraph\
                └── storygraph.db
```

我的判断：`.storygraph` 放在作品目录内，比放在项目根目录更适合单作品索引。依据是索引与原文目录同生共存，agent 不需要先理解整个项目结构，也能在当前小说上下文里直接发现本地知识库。

## 定位规则

### 初始化与索引

`init` 和 `index` 在传入 `--work` 时，必须先解析 `workRoot`，再把 DB 初始化到 `workRoot\.storygraph\storygraph.db`。

示例：

```powershell
storygraph init E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒
storygraph index E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒
```

运行后应产生：

```text
E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph\storygraph.db
```

### 查询

查询命令在传入 `--work` 时，必须读取同一个 `workRoot\.storygraph\storygraph.db`。

示例：

```powershell
storygraph status E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒 --json
storygraph search E:\AI_Projects\CultivationWorld "白小纯 灵溪宗" --source docs\世界观参考 --work 一念永恒
storygraph entity E:\AI_Projects\CultivationWorld "白小纯" --source docs\世界观参考 --work 一念永恒
storygraph timeline E:\AI_Projects\CultivationWorld --character 白小纯 --source docs\世界观参考 --work 一念永恒
storygraph evidence E:\AI_Projects\CultivationWorld "火灶房" --source docs\世界观参考 --work 一念永恒
```

### Agent 当前目录发现

agent 若已经处于某本小说目录，查询流程应优先检查：

```text
当前目录\.storygraph\storygraph.db
```

若当前目录位于小说目录的子目录中，应向上查找最近的 `.storygraph`。找到最近的 DB 后即停止，不继续回退到项目根目录 `.storygraph`。

如果当前目录没有 `.storygraph`，并且调用参数提供了 `projectRoot + sourceDir + work`，才通过参数解析 `workRoot`。

如果两种方式都找不到 DB，应明确报错：

```text
StoryGraph index not found for work: 一念永恒
Expected: E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph\storygraph.db
Run: storygraph index E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒
```

## API 与 MCP 规则

TypeScript API 和 MCP 工具应使用同一套 DB 定位函数，避免 CLI、MCP、测试各自拼路径。

建议新增或调整一个解析函数：

```ts
resolveStoryGraphDbRoot(input): string
```

输入可以来自：

- 当前工作目录。
- `projectRoot`。
- `sourceDir`。
- `work`。

输出应是实际承载 `.storygraph` 的目录，也就是 `workRoot`。

MCP 工具必须支持 `work`，并支持 `sourceDir`，其中 `sourceDir` 默认值为 `docs\世界观参考`。当提供 `work` 时，不再打开项目根目录 DB。

### work 参数规范化

`work` 的语义是“作品目录名”。为降低 agent、CLI、MCP 与脚本调用之间的路径格式差异，工具实现应先把 `work` 统一规范化为最后一级作品目录名，再用于 DB 定位、扫描过滤和 SQL 查询过滤。

必须支持的输入形式：

```text
武炼巅峰
武炼巅峰\
docs\世界观参考\武炼巅峰
docs/世界观参考/武炼巅峰/
E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰
```

以上形式都应等价于：

```text
work = 武炼巅峰
```

实现要求：

1. 去除 `work` 前后空白。
2. 同时兼容 `/` 与 `\` 分隔符。
3. 去除末尾分隔符。
4. 取最后一级非空路径段作为作品目录名。
5. 对 DB 路径解析、原文扫描、MCP/CLI 查询过滤使用同一个规范化结果。
6. 查询返回的证据、时间线、实体卡来源路径必须位于目标作品目录内；不能因为项目根目录存在旧 `.storygraph` 而混入跨作品证据。

## 兼容策略

旧的项目根目录 DB 只保留为兼容路径，不作为单作品查询默认值。

兼容规则：

1. `--work` 存在时，必须使用作品目录 DB。
2. 当前目录存在 `.storygraph/storygraph.db` 时，优先使用当前目录或最近父目录 DB。
3. 只有既没有当前目录 DB，也没有 `--work` 时，才允许打开传入 root 下的 `.storygraph/storygraph.db`。
4. 文档和示例命令一律使用 `--work` 形式，避免继续传播项目根目录 DB 用法。

## 测试与验收

### 单元测试

- 路径解析：`projectRoot + sourceDir + work` 能解析到 `workRoot`。
- 路径解析：当前目录已有 `.storygraph/storygraph.db` 时优先返回当前目录。
- 路径解析：子目录向上查找时返回最近的作品目录 `.storygraph`。
- 路径解析：传入 `--work` 时不打开项目根目录 `.storygraph`。
- 路径解析：路径式 `work` 输入（如 `docs\世界观参考\武炼巅峰\`）会规范化为作品目录名。

### 集成测试

- `index` 后 DB 出现在 `docs/世界观参考/<作品名>/.storygraph/storygraph.db`。
- `index` 后项目根目录不应新建用于该作品的 `.storygraph/storygraph.db`。
- `status/search/entity/timeline/evidence` 使用 `--work` 时能读取作品目录 DB。
- MCP 工具在传入 `work` 和 `sourceDir` 时能读取同一个作品目录 DB。
- MCP/CLI 查询传入路径式 `work` 时，DB 定位与 SQL 作品过滤结果一致，不应出现能打开 DB 但查询为空的情况。

### 真实资料验收

以《一念永恒》试点：

```powershell
storygraph index E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒
storygraph status E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒 --json
storygraph timeline E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒 --all --json
```

验收标准：

- DB 位于 `E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph\storygraph.db`。
- `status` 中作品数为 1。
- `timeline --all` 能返回该作品全部已索引章节事件。
- 查询结果的证据路径指向《一念永恒》目录内的源文件。

## 文档关系

本规格修订 `2026-06-05-StoryGraph小说图谱设计.md` 中“索引产物写入被服务项目根目录 `.storygraph/`”的旧假设。

后续实施计划应以本规格为准：

- 工具源码仍位于 `E:\AI_Projects\storygraph`。
- 生成索引位于每本小说目录下的 `.storygraph`。
- `docs/世界观参考/` 仍是小说原文与人工分析资料库。
- `.storygraph/` 是生成索引，不纳入世界观 Wiki，不作为人工设定文档。

## 自检

- 无悬而未决条目。
- 已明确 DB 路径：每本小说目录内 `.storygraph/storygraph.db`。
- 已明确 agent 发现规则：优先当前目录或最近父目录 `.storygraph`。
- 已明确兼容边界：`--work` 存在时不使用项目根目录 DB。
- 已明确后续测试与真实资料验收口径。
