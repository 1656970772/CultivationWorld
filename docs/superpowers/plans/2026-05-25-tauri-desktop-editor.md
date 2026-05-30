# Tauri 2 桌面数据编辑器实施计划

> 日期：2026-05-25
> 状态：计划中

## 目标

将现有数据编辑器升级为 Tauri 2 + Rust 后端 + WebView2 的 Windows 桌面工具，同时保留普通浏览器环境下的纯前端降级能力。游戏运行时继续保持 ADR-001 的纯前端架构，桌面编辑器只作为开发工具链存在，不替代 `index.html` 游戏主入口。

## 阶段

### 阶段一：架构与工具链落地

- 新增 ADR-002，确认 Tauri 2 + Rust 后端方案。
- 更新 `docs/README.md`、`system-overview.md` 和 `file-structure.md`。
- 新增 `package.json`，提供桌面构建与运行脚本。
- 新增 `tools/build-tauri-frontend.mjs`，将编辑器前端资源复制到 `desktop-dist/`。
- 新增 `src-tauri/`，初始化 Tauri 2 Rust 工程。

### 阶段二：Rust 文件后端

- 实现项目目录解析，支持选择项目根目录或 `data/` 目录。
- 读取固定数据集：`factions`、`npcs`、`terrains`、`modifiers`、`rules`、`events`、`map`。
- 保存前在 `data/.backups/yyyy-MM-dd_HH-mm-ss/` 创建备份。
- 使用同目录临时文件写入，再替换目标 JSON，降低写坏文件风险。
- 拒绝写出 `data/` 目录之外的路径。

### 阶段三：前端存储适配

- 新增 Tauri 存储适配层，检测 Tauri 环境后通过 `invoke` 调用 Rust 命令。
- 浏览器环境继续保留默认 `fetch` 读取、File System Access API 和下载导出降级。
- 编辑器入口文案从“授权目录”调整为“打开项目”。
- 保存成功后展示备份路径，并正确清理 dirty 状态。

### 阶段四：地图编辑器增强

- 在 `js/editor/map-editor/` 下拆分地图模型、历史记录、Canvas 视图和面板。
- 支持单格画笔、矩形填充、地形修改、归属势力修改、撤销和重做。
- 保持 `map.json` 输出结构兼容现有游戏引擎。

### 阶段五：测试与验收

- 补充 Rust 单元测试，覆盖目录解析、路径越界、备份、原子保存和 JSON 校验。
- 补充 Node 测试，覆盖编辑器校验、Tauri 适配层和地图编辑器模型。
- 使用 Browser 插件检查编辑器桌面和移动布局。
- Rust 工具链可用时执行 Tauri 构建；不可用时记录为阻塞项。

## 接口

Rust 后端通过 Tauri command 暴露以下接口：

```text
load_project_directory(root_path: String) -> ProjectSnapshot
reload_all_datasets() -> ProjectSnapshot
save_dataset(key: String, data: serde_json::Value) -> SaveResult
save_all_datasets(datasets: BTreeMap<String, serde_json::Value>) -> Vec<SaveResult>
validate_datasets(datasets: BTreeMap<String, serde_json::Value>) -> Vec<Issue>
```

核心数据结构规划：

- `ProjectSnapshot`：包含 `ProjectInfo`、所有数据集内容和校验结果。
- `ProjectInfo`：包含 `rootPath`、`dataPath`、`sourceLabel`。
- `SaveResult`：包含数据集 key、保存状态、目标路径、备份路径和错误信息。
- `Issue`：包含级别、数据集 key、定位路径和说明。

## 测试

计划使用以下命令作为主要验收：

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
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run desktop:prepare
npm.cmd run tauri:build
```

如果当前机器没有 Rust、Cargo 或 Tauri 构建能力，`cargo test` 与 `npm.cmd run tauri:build` 标记为阻塞，不伪造通过。

## 工具链前置条件

- Windows 10/11。
- Microsoft Edge WebView2 Runtime。
- Node.js 与 npm，可在 PowerShell 中使用 `npm.cmd`。
- Rust 工具链，包含 `rustc` 与 `cargo`。
- Tauri 2 依赖的 Windows 构建工具。
- 项目根目录存在可读取写入的 `data/` JSON 文件。

## 边界

- 不改变游戏主入口 `index.html`。
- 不把游戏运行时迁移到 Rust 或 Tauri。
- 不要求普通玩家安装桌面编辑器。
- 不取消浏览器版数据编辑器降级能力。
