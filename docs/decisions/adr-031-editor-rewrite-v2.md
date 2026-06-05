# ADR-031：编辑器 v2 重写（适配 game/data 全部数据集 + 写回 + 快照回滚）

最后更新：2026-06-01

状态：已确认范围，待实现

## 背景

现有 `apps/editor/` 是**通用数据集 + 表单编辑器**，核心由 `schema-registry.js` 驱动。但：

1. `schema-registry.js` 只硬编码 7 个数据集（`factions / npcs / terrains / modifiers / rules / events / map`），**全是 v1 老游戏 schema**。
2. 新游戏 `apps/game/data/` 实际有 14+ 个 JSON：
   - `balance/` 7 个：combat、cultivation、emotion、memory、obsession、relationship、utility
   - `actions/` 2 个：npc-actions、faction-actions
   - `config/` 3 个：ai-config、game-config、world-config
   - `data/` 2 个：monster-species、ranks
   - 老的 `entities/` `definitions/` `world/` 5 个继续保留
3. `apps/editor/tools/migrate-data-v2.mjs` 只做了一次**数据文件复制**（game/data → editor/data），schema-registry **一行没改** → 编辑器仍认不出新数据集。
4. 字段类型不够：新数据大量嵌套对象、对象数组、polymorphism（`obsession.obsessions[]` 各种 type），老 schema 全部不支持。
5. **核心痛点**：调参（obsession/utility/cultivation）只能改 JSON 重启游戏跑仿真，闭环太慢。
6. **写回高风险**：用户要求"编辑完会覆盖到 game 里"——但**写坏**就游戏跑不起来，必须有快照 + 回滚。

## 决策

### 范围与定调（用户定调）

- **数据集范围**：`apps/game/data/**/*.json` 的**全部文件**。`schema-registry.js` 7 个 v1 schema 保留为**别名/兼容**（如果 game/data 里同名同结构则认，否则标 deprecated 不显示）。
- **写回目标**：保存直接写回 `apps/game/data/`（高风险操作，UI 必须有醒目警告 + 二次确认）。
- **快照/回滚**：每次 save 前自动备份前一个版本到 `apps/editor/.snapshots/<relative-path>/<timestamp>.json`。UI 提供"历史"面板 + 一键恢复到任一历史版本。
- **仿真集成**：**不做**。编辑器只改文件，用户在终端跑 `simulate-analysis.mjs`。
- **桌面 + Web 双形态**：保留 Tauri 桌面壳 + Web（File System Access API）两套入口，行为对齐。
- **现有 UI 壳**：数据集导航 + 列表 + 表单的布局保留，只换数据源 + 渲染逻辑。

### 一、数据集源（自动扫描）

- `dataset-scanner.js` 新建：递归扫描 `apps/game/data/**/*.json`，跳过 `desktop-dist/` `.snapshots/` `__pycache__/` `node_modules/`。
- 每个 JSON 文件 = 一个数据集。数据集 key 用相对路径（如 `balance/obsession`、`actions/npc-actions`）。
- 大数据集（map.json）单独标识，默认不展开 tile 详情，保留原 tileSummary 渲染。
- 排序：先按顶层目录字母，再按文件名。

### 二、Schema 自动推断

- `schema-inferrer.js` 新建：从样本 JSON 推字段类型，**避免手写 schema**。
- 推断规则：
  - `string` → `text`（含 enum 候选时降级为 `select`）
  - `number` → `number`，min/max 从同级样本取
  - `boolean` → `boolean`
  - `array<string>` → `tags`
  - `array<object>` → `objectArray`（每行一个对象，列从样本并集推，支持新增/删除/重排）
  - `object` → `object`（可折叠嵌套渲染）
  - `null` 允许
- 推断时抽样：最多前 100 个数组元素做 union。超深嵌套（>5 层）降级为 JSON 文本编辑。
- 老 `schema-registry.js` 仍导出 7 个 v1 schema 作为**显式 schema 覆盖**（用户可手动在数据集元数据里指定 `schemaKey: 'factions'` 走手写 schema，否则走推断）。

### 三、字段渲染（field-renderer 扩展）

- 现有类型保留：`text / number / range / boolean / color / textarea / select / tags / relations / reference / keyValueNumber / json / options / tileSummary`。
- 新增类型：
  - `object` 嵌套对象（标题+折叠面板）
  - `objectArray` 对象数组（表格行：列=字段，行=元素，"新增/删除/重排"按钮，列字段类型从样本推）
  - `nestedJson` 超深嵌套回退
- 嵌套层级：默认全展开（数据不深），折叠状态记在 localStorage。

### 四、写回 + 快照

- `data-store.js` 改：
  - `pickProjectDirectory()` 默认建议路径 `apps/game/data`（或 `<root>/game/data`，智能检测）。
  - `saveDataset(key, data)`：写回 `apps/game/data/<key>.json`（数组对象 → 数组写回，object 整体写回）。
  - **每次写回前**调用 `snapshotStore.backup(key, oldContent)`，**同步**完成（保证不丢）。
  - 返回 `{ mode: 'file', fileName, snapshotPath, byteSize }` 给 UI。
- `snapshot-store.js` 新建：
  - 路径：`apps/editor/.snapshots/<key>/<YYYYMMDD-HHmmss>-<random6>.json`。
  - 列表：`list(key)` → `[{ ts, path, size, byteHash }]` 按 ts 倒序。
  - 恢复：`restore(key, snapshotPath)` 读快照写回 game/data（同 saveDataset 流程，**也会备份当前为新快照**，保证不丢中间态）。
  - 清理：UI 提供"清空超过 N 天的快照"按钮；默认保留 30 天。
- **`.gitignore` 加**：`apps/editor/.snapshots/`（运行时数据不入库）。

### 五、UI 改动

- `data-editor.html`：
  - 新增**右侧"历史/快照"面板**（可折叠）。
  - 当前数据集历史快照列表 + 预览 + "恢复"按钮。
  - "清空旧快照" 按钮。
- `editor-app.js`：
  - 加载：先 `dataset-scanner.scan()` 拿到数据集列表，再按需懒加载 JSON。
  - 保存：`data-store.saveDataset()` 成功 → toast 显示"已保存到 game/data + 已备份到 .snapshots/..."。
  - **高风险警告**：第一次启动且未设置 projectDir 时，弹一次性提示"将直接修改 game/data，启用快照保护"。
  - 加载数据集前显示"文件路径 / 大小 / mtime"。
- `css/data-editor.css`：新增历史面板 + 大数据集 lazy-load 进度样式。

### 六、Tauri Rust 端

- `src-tauri/src/commands.rs`：
  - 新增 `list_datasets(root)`：扫描 game/data 全部 JSON。
  - 新增 `save_dataset(root, key, content)`：写前快照，写后返回 snapshot path。
  - 新增 `list_snapshots(root, key)` / `restore_snapshot(root, key, snapshot_path)`。
  - 已有 `pick_project_directory` 改默认推荐路径。
- `src-tauri/src/snapshot_store.rs` 新建：纯 Rust 快照管理（与 JS 端实现同样的 .snapshots/ 布局，便于互操作）。
- `src-tauri/src/validation.rs` 可选扩展：写回前跑 schema 校验（用 game 端 `config-loader.js` 的校验逻辑或简化版）。

### 七、保留不动的部分

- Tauri 桌面壳（`src-tauri/Cargo.toml`、icons、build.rs、tauri.conf.json）。
- 地图编辑器（`js/editor/map-editor/`）—— 老 map.json 结构不变，地图编辑能力保留。
- 老 schema-registry 的 7 个数据集定义（v1 factions/npcs/terrains/modifiers/rules/events/map）—— 保留作为"显式 schema 覆盖"和兼容层。
- 老的 `css/data-editor.css` 主题样式 —— 只追加，不重写。

## 数据契约（与 game/data 兼容性）

- **不修改 `apps/game/data/` 任何 JSON 格式**。编辑器读写必须保证 round-trip 字节一致（除末尾换行外）。
- 写回用 2 空格缩进 + 末尾换行（与现有文件一致），保留 key 顺序（用 sorted keys 模式），避免 diff 噪音。
- 注释：JSON 不支持注释，**不带任何注释**。如果未来需要元信息，用 sibling `.meta.json`（本 ADR 不做）。

## 文件清单

### 新建

- `apps/editor/js/editor/dataset-scanner.js`
- `apps/editor/js/editor/schema-inferrer.js`
- `apps/editor/js/editor/snapshot-store.js`
- `apps/editor/js/editor/history-panel.js`
- `apps/editor/tools/test-editor-dataset-scanner.mjs`
- `apps/editor/tools/test-editor-schema-inferrer.mjs`
- `apps/editor/tools/test-editor-snapshot.mjs`
- `apps/editor/tools/test-editor-roundtrip.mjs`
- `apps/editor/src-tauri/src/snapshot_store.rs`
- `docs/editor/editor-rewrite-plan.md`

### 修改

- `apps/editor/js/editor/data-store.js`（写回 + 快照集成）
- `apps/editor/js/editor/field-renderer.js`（新增 object / objectArray / nestedJson 渲染）
- `apps/editor/js/editor/editor-app.js`（数据集懒加载 + 历史面板）
- `apps/editor/data-editor.html`（加历史面板）
- `apps/editor/css/data-editor.css`（追加历史面板样式）
- `apps/editor/src-tauri/src/commands.rs`（加 4 个新命令）
- `apps/editor/src-tauri/src/lib.rs`（注册新命令）
- `apps/editor/.gitignore`（新增 `.snapshots/`）
- `apps/editor/package.json`（如果需要新 dev dep）

## 验收标准

1. **数据集全收录**：打开编辑器，能看到 `apps/game/data/` 下**所有** `.json` 文件（至少 14 个）出现在左侧导航。
2. **加载 round-trip**：每个数据集加载的 JSON 字节级等于原文件（除末尾换行外）。
3. **保存写回**：改一个值点保存，`apps/game/data/<key>.json` 立即更新；`apps/editor/.snapshots/<key>/<ts>.json` 出现新文件。
4. **回滚可用**：在历史面板点任一历史快照的"恢复"，`game/data` 文件回到该快照内容；当前内容被自动备份为新快照（不丢中间态）。
5. **嵌套渲染**：能正确渲染 `obsession.obsessions[]`（对象数组 + 多 type）、`cultivation.physique.types`（嵌套对象 + 数组）、`actions.npc-actions[].preconditions`（嵌套对象）等复杂结构。
6. **大数据集不卡**：`map.json`（约 90k tiles）打开不卡（lazy load / 摘要优先）。
7. **Tauri 桌面 + Web 都能跑**：双形态行为一致，Rust 端快照与 JS 端可互操作。
8. **仿真不受影响**：`node apps/game/tools/simulate-analysis.mjs --days=200` 默认跑无错；改完编辑器保存后跑仿真，能用上最新数据。
9. **测试通过**：`test-editor-dataset-scanner / schema-inferrer / snapshot / roundtrip` 全绿；老的 `test-editor-*` 不退化。
10. **不破坏老数据集**：`factions / npcs / terrains / modifiers / events / rules / map` 7 个 v1 schema 走显式 schema 路径仍可用。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 写坏 game/data 导致游戏跑不起来 | 高 | 写前必快照、UI 警告、首次启动明确告知 |
| JSON 序列化丢 key 顺序产生 diff 噪音 | 中 | 用稳定序列化（手写或保留顺序的 stringify） |
| 超大 JSON 加载卡 UI | 中 | lazy load、摘要视图、worker（可选） |
| schema 推断错（新样本小） | 中 | 任何字段不确定时降级为 JSON 文本编辑 |
| Tauri Rust 端与 JS 端快照格式不兼容 | 低 | 共用 `.snapshots/<key>/<ts>.json` 布局 + 字节级格式 |
| 老的 schema-registry 7 个数据集被忽略 | 低 | 保留为显式 schema 覆盖，dataset-scanner 也认 |
| 用户误恢复旧快照丢失新编辑 | 中 | 恢复前强制备份当前 → 新快照（不丢） |

## 后果

- 编辑器**真正可用**：能改 game/data 全部 14+ JSON，包括嵌套深的 balance/action/config。
- **调参闭环**：编辑器改 → 终端跑仿真 → 看报告（虽然没集成，但路径清晰）。
- **不破坏游戏**：写坏有快照兜底，回滚一秒恢复。
- **可扩展**：未来 game 加新数据集，编辑器自动认。
- **默认关闭不改变既有行为**：game/data 文件格式不动，仿真器读老 JSON 行为不变。

## 验证

- 单测：`test-editor-dataset-scanner.mjs`（扫描规则）、`test-editor-schema-inferrer.mjs`（推断矩阵）、`test-editor-snapshot.mjs`（备份/列表/恢复）、`test-editor-roundtrip.mjs`（load→save 字节一致）。
- 端到端：手动跑 `start-editor-web.cmd` → 打开浏览器 → 改 `obsession.json` 一个值 → 保存 → 跑 `simulate-analysis.mjs --days=50` → 报告里能看到新值生效。
- 回归：跑老 `test-editor-*` 8 个工具脚本全绿。

## 相关

- ADR-030（核心类重构）—— 同样"对外接口零破坏"原则。
- `docs/architecture/file-structure.md` —— 编辑器目录约定。
- `docs/architecture/design-patterns.md` —— 数据驱动 + 策略模式。
- `docs/data/data-config-rules.md` —— game/data 命名/分类规范。

