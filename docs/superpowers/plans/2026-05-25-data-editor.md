# 数据编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个独立、可扩展、美观易用的纯前端 `data/` JSON 数据编辑器。

**Architecture:** 新增 `data-editor.html` 作为独立入口，编辑器逻辑拆分到 `js/editor/`。数据集通过 schema registry 驱动，校验与存储能力从 UI 中分离，方便后续新增数据文件和字段说明。

**Tech Stack:** 原生 JavaScript ES Module、HTML、CSS、File System Access API、Node 脚本测试、Browser 插件视觉检查。

---

### Task 1: 文档与计划

**Files:**
- Create: `docs/superpowers/specs/2026-05-25-data-editor-design.md`
- Create: `docs/superpowers/plans/2026-05-25-data-editor.md`
- Modify: `docs/README.md`

- [x] **Step 1: 写入数据编辑器设计文档**

记录目标、范围、架构、界面、保存策略、校验和测试方式。

- [x] **Step 2: 写入实施计划**

记录文件结构、任务拆分和验证方式。

- [x] **Step 3: 更新文档导航**

在 `docs/README.md` 中加入 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`。

### Task 2: 数据校验测试

**Files:**
- Create: `tools/test-editor-validation.mjs`
- Create: `js/editor/schema-registry.js`
- Create: `js/editor/validation.js`

- [x] **Step 1: 先写测试**

测试现有数据可以通过校验、重复主键会报错、断裂引用会报错、数值越界会报错。

- [x] **Step 2: 运行测试并确认失败**

Run: `node tools/test-editor-validation.mjs`

Expected: 因为 `js/editor/validation.js` 尚不存在而失败。

- [x] **Step 3: 实现 schema registry 与 validation**

提供数据集配置、字段元信息、引用校验和范围校验。

- [x] **Step 4: 运行测试并确认通过**

Run: `node tools/test-editor-validation.mjs`

Expected: 输出 `editor validation tests passed`。

### Task 3: 编辑器 UI 与存储

**Files:**
- Create: `data-editor.html`
- Create: `css/data-editor.css`
- Create: `js/editor/data-store.js`
- Create: `js/editor/field-renderer.js`
- Create: `js/editor/editor-app.js`

- [x] **Step 1: 创建独立 HTML 入口**

入口只加载编辑器 CSS 与 `editor-app.js`，不加载游戏主入口。

- [x] **Step 2: 创建数据存储模块**

支持 fetch 默认读取、目录授权读取、写回授权目录、下载降级。

- [x] **Step 3: 创建字段渲染模块**

根据 schema 渲染文本、数字、滑杆、布尔、枚举、颜色、标签、嵌套对象、JSON 子编辑器。

- [x] **Step 4: 创建主编辑器应用**

实现数据集导航、记录列表、搜索、表单编辑、增删复制、校验面板、JSON 预览、保存/导出。

- [x] **Step 5: 创建视觉样式**

实现“天机阁案牍房”工作台风格，保证桌面和移动宽度可用。

### Task 4: 验证与记录

**Files:**
- Modify: `Memory/2026-05-25_16-30-33.md`

- [x] **Step 1: 运行校验测试**

Run: `node tools/test-editor-validation.mjs`

- [x] **Step 2: 运行引擎回归测试**

Run: `node tools/test-engine.mjs`

- [x] **Step 3: 启动本地服务**

Run: `python serve.py`

- [x] **Step 4: 使用 Browser 打开编辑器检查**

Open: `http://localhost:8888/data-editor.html`

检查桌面与移动宽度没有空白、溢出或遮挡。

- [x] **Step 5: 更新对话记录**

记录新增文件、测试结果和检查结果。
