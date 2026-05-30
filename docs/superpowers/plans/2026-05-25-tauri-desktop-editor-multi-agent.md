# Tauri 2 桌面数据编辑器多 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. 每个 Agent 在独立上下文中工作，完成后由主 Agent 审查、集成、运行全量验证。

**Goal:** 将现有 `data-editor.html` 升级为 Tauri 2 + Rust 后端的 Windows 桌面数据编辑器，并保留普通浏览器降级能力。

**Architecture:** 主 Agent 负责集成与冲突控制；各子 Agent 按文档、Tauri 外壳、Rust 文件后端、前端存储适配、地图编辑器、测试验收拆分。第一波并行完成互不冲突的文档、脚手架设计、Rust 后端、前端适配方案；第二波在接口稳定后实现地图编辑器和端到端验收。

**Tech Stack:** Tauri 2、Rust、Serde、原生 JavaScript ES Module、Canvas 2D、Node 测试脚本、Browser 插件视觉检查。

---

## 调度总览

### 主 Agent：集成协调与最终验收

**职责**

- 控制文件边界，避免多个 Agent 同时改同一文件。
- 先合并 Agent A、B、C 的输出，锁定 Tauri/Rust/前端接口。
- 再分派 Agent D、E、F 做前端接入、地图编辑器和测试。
- 每轮集成后运行对应验证命令。

**关键约束**

- 当前目录不是 Git 仓库，不执行 `git commit`。
- PowerShell 下使用 `npm.cmd` / `npx.cmd`。
- `rustc` / `cargo` 当前不在 PATH；涉及 Tauri 编译的步骤必须先检查工具链。

**最终验收命令**

```powershell
node tools/test-editor-validation.mjs
node tools/test-editor-map-lightweight.mjs
node tools/test-engine.mjs
node --check js/editor/data-store.js
node --check js/editor/editor-app.js
node --check js/editor/map-editor/model.js
node --check js/editor/map-editor/history.js
node --check js/editor/map-editor/canvas-view.js
node --check js/editor/map-editor/panel.js
npm.cmd run tauri:build
```

如果 Rust 工具链未安装，`npm.cmd run tauri:build` 记录为阻塞项，不用伪造通过。

## 第一波并行 Agent

### Agent A：文档与架构决策

**可并行原因:** 只改 `docs/`，不依赖代码实现。

**文件**

- Create: `docs/decisions/adr-002-tauri-rust-editor.md`
- Create/Update: `docs/superpowers/plans/2026-05-25-tauri-desktop-editor.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/architecture/file-structure.md`

**任务**

- 写明游戏运行时仍保留纯前端架构，数据编辑器升级为 Tauri 桌面工具。
- 记录 Tauri 2 + Rust 后端 + WebView2 的选择理由、替代方案 Electron、风险和后果。
- 更新文档导航，新增桌面编辑器计划和 ADR。
- 在架构总览中补充“桌面编辑器”作为独立工具链，不替代游戏主入口。

**验收**

- 所有新增/修改文档顶部包含日期或最后更新字段。
- `docs/README.md` 能导航到新增 ADR 和计划。

### Agent B：Tauri 外壳与构建资源

**可并行原因:** 主要新增 `package.json`、`src-tauri/` 和构建脚本，不改业务逻辑。

**文件**

- Create: `package.json`
- Create: `tools/build-tauri-frontend.mjs`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

**任务**

- 配置 `desktop-dist/` 为 Tauri 前端资源目录。
- `tools/build-tauri-frontend.mjs` 复制 `data-editor.html`、`index.html`、`css/`、`js/`、`data/` 到 `desktop-dist/`。
- Tauri 窗口标题设为 `玄天大陆编辑器`，默认 URL 指向 `data-editor.html`。
- `package.json` 提供 `desktop:prepare`、`tauri:dev`、`tauri:build` 脚本。

**验收**

```powershell
npm.cmd run desktop:prepare
```

预期：生成 `desktop-dist/data-editor.html`、`desktop-dist/css/`、`desktop-dist/js/`、`desktop-dist/data/`。

### Agent C：Rust 文件后端核心

**可并行原因:** 先按固定命令接口实现 Rust 模块，可用 Rust 单元测试验证，不依赖前端接入。

**文件**

- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/project.rs`
- Create: `src-tauri/src/json_store.rs`
- Create: `src-tauri/src/backup.rs`
- Create: `src-tauri/src/validation.rs`
- Modify: `src-tauri/src/lib.rs`

**接口**

- `load_project_directory(root_path: String) -> ProjectSnapshot`
- `reload_all_datasets() -> ProjectSnapshot`
- `save_dataset(key: String, data: serde_json::Value) -> SaveResult`
- `save_all_datasets(datasets: BTreeMap<String, serde_json::Value>) -> Vec<SaveResult>`
- `validate_datasets(datasets: BTreeMap<String, serde_json::Value>) -> Vec<Issue>`

**任务**

- 支持选择项目根目录或 `data/` 目录，并解析出 `ProjectInfo { rootPath, dataPath, sourceLabel }`。
- 固定数据集顺序：`factions`、`npcs`、`terrains`、`modifiers`、`rules`、`events`、`map`。
- 保存前创建 `data/.backups/yyyy-MM-dd_HH-mm-ss/`，备份被保存的 JSON 文件。
- 写入使用同目录临时文件，再替换目标文件。
- 拒绝写出 `data/` 目录之外的路径。
- 保存级校验覆盖结构类型、主键重复、引用断裂、地图坐标越界、地形/势力引用不存在。

**验收**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：目录解析、缺文件报错、路径越界、备份命名、原子保存、无效 JSON 拒绝保存测试通过。

## 第二波串并结合 Agent

### Agent D：前端存储适配

**前置依赖:** Agent C 的 Rust 命令接口已固定。

**文件**

- Create: `js/editor/tauri-store.js`
- Modify: `js/editor/data-store.js`
- Modify: `js/editor/editor-app.js`
- Modify: `data-editor.html`

**任务**

- 检测 `window.__TAURI__` 或 `@tauri-apps/api/core` 可用时，走 Tauri `invoke`。
- 浏览器环境继续保留 `showDirectoryPicker` 和下载降级。
- 将按钮文案从“授权目录”改为“打开项目”。
- 保存成功后展示 `backupPath`，并正确清理 dirty 状态。
- `reloadData()` 在 Tauri 项目已打开时调用 `reload_all_datasets()`。

**验收**

```powershell
node --check js/editor/tauri-store.js
node --check js/editor/data-store.js
node --check js/editor/editor-app.js
node tools/test-editor-validation.mjs
```

### Agent E：Canvas 地图编辑器

**前置依赖:** Agent D 完成 `DataStore` 接入；`map` 数据仍保持原结构。

**文件**

- Create: `js/editor/map-editor/model.js`
- Create: `js/editor/map-editor/history.js`
- Create: `js/editor/map-editor/canvas-view.js`
- Create: `js/editor/map-editor/panel.js`
- Modify: `js/editor/field-renderer.js`
- Modify: `css/data-editor.css`
- Create: `tools/test-editor-map-editor.mjs`

**任务**

- `model.js` 建立 `x,y -> tile` 索引，并提供 `paintTile`、`paintRect`、`setTerrain`、`setOwner` 操作。
- `history.js` 支持撤销/重做，记录每次批量修改前后的 tile 补丁。
- `canvas-view.js` 负责 Canvas 2D 绘制、鼠标命中、拖拽框选、缩放适配。
- `panel.js` 提供地形画笔、势力画笔、矩形填充、撤销、重做、格子详情和统计摘要。
- `field-renderer.js` 遇到 `tileSummary` 时挂载地图编辑器，而不是完整 JSON textarea。

**验收**

```powershell
node tools/test-editor-map-editor.mjs
node tools/test-editor-map-lightweight.mjs
```

预期：单格画笔、矩形填充、领地批量修改、撤销/重做、保存结构不变全部通过。

### Agent F：端到端验收与视觉检查

**前置依赖:** Agent B、D、E 已集成。

**文件**

- Modify/Create: `tools/test-editor-tauri-adapter.mjs`
- Modify/Create: `tools/test-editor-detail-slot.mjs`
- Output: `artifacts/tauri-editor-desktop.png`
- Output: `artifacts/tauri-editor-map.png`

**任务**

- 增加前端适配测试：浏览器环境不应调用 Tauri；模拟 Tauri 环境时应调用 `invoke`。
- 用现有本地服务检查 `data-editor.html` 桌面和移动布局。
- 若 Tauri 工具链可用，启动 `npm.cmd run tauri:dev` 做桌面窗口人工/截图验收。
- 检查地图编辑器工具栏、Canvas、详情栏不发生文本遮挡或横向溢出。

**验收**

```powershell
python serve.py
node tools/test-editor-detail-slot.mjs
node tools/test-editor-tauri-adapter.mjs
```

如能启动 Tauri：

```powershell
npm.cmd run tauri:dev
```

## 集成顺序

1. 主 Agent 先合并 Agent A 文档，确保架构决策落地。
2. 合并 Agent B 外壳，运行 `npm.cmd run desktop:prepare`。
3. 合并 Agent C Rust 后端，运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
4. 合并 Agent D 前端适配，跑 JS 校验与浏览器降级测试。
5. 合并 Agent E 地图编辑器，跑地图编辑测试和轻量地图测试。
6. 合并 Agent F 验收脚本和截图，跑全量命令。

## 冲突控制

- `docs/README.md` 只允许 Agent A 修改；其他 Agent 需要补文档时交给主 Agent 集成。
- `js/editor/data-store.js` 和 `js/editor/editor-app.js` 只允许 Agent D 修改。
- `js/editor/field-renderer.js` 和 `css/data-editor.css` 只允许 Agent E 修改。
- `src-tauri/src/lib.rs` 由 Agent B 创建基础版本，Agent C 在其后修改注册命令。
- 所有 Agent 禁止格式化全仓库，禁止重写无关文件。

## 完成定义

- `玄天大陆编辑器` Tauri 窗口可打开现有 Web UI。
- 浏览器访问 `data-editor.html` 仍可读取默认 `data/`，不因 Tauri 代码报错。
- Tauri 环境可打开项目目录、读取全部 JSON、保存单个/全部数据集。
- 每次保存前自动备份到 `data/.backups/yyyy-MM-dd_HH-mm-ss/`。
- 地图编辑器能对 `map.json` 做可视化单格和批量修改，输出结构兼容现有引擎。
- 现有 Node 回归测试通过；Rust 工具链可用时 Tauri 构建通过。
