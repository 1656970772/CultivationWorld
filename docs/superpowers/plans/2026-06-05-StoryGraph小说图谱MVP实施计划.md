# StoryGraph 小说图谱 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `E:\AI_Projects\storygraph` 工具项目，针对单部小说生成并查询 `CultivationWorld\.storygraph\storygraph.db`，让 agent 能快速查询小说证据、角色卡、时间线和世界观设定。

**Architecture:** 参考 `E:\AI_Projects\codegraph` 的本地 SQLite + CLI + MCP 架构，但 StoryGraph 使用小说语义节点与证据锚点。MVP 先实现可测试的单作品扫描、切分、索引、查询和 MCP 工具，并以短 fixture 与《一念永恒》目录作为试点入口。索引产物保存在被服务项目的 `.storygraph/`，不污染 `docs/世界观参考/`。

**Tech Stack:** TypeScript 5、Node.js `node:sqlite`、Vitest、Commander、Model Context Protocol stdio server、PowerShell、SQLite FTS5。

---

## Scope Check

本计划实现 StoryGraph MVP：项目骨架、SQLite schema、单作品扫描切分、规则抽取、查询、CLI、MCP 和当前项目试点命令。MVP 的 `index` 运行必须以 `--work` 指定单部作品；完整 15 部小说批量抽取、LLM 深度抽取、跨作品高级比较、多作品同库强一致性和可视化面板属于 MVP 之后的独立计划。本计划会保留 `work_id` 等稳定接口，确保后续扩展不需要推翻数据模型。

## Scope Update 2026-06-05

用户已确认“单作品就行”。因此 Task 2 质量审查中发现的多作品 parent-side update 绕过风险不作为当前 MVP 阻塞项：当前实现只需保证正常索引路径与查询路径服务单部作品。后续如果要支持多作品同库、跨作品比较或跨作品同名处理，需要新增计划专门补齐数据库强约束、迁移和测试。

## File Structure

### Create under `E:\AI_Projects\storygraph`

```text
storygraph/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── .gitignore
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── paths.ts
│   ├── cli.ts
│   ├── db/
│   │   ├── schema.sql
│   │   ├── connection.ts
│   │   └── queries.ts
│   ├── scanner/
│   │   └── scan.ts
│   ├── segmenter/
│   │   ├── encoding.ts
│   │   ├── text.ts
│   │   └── markdown.ts
│   ├── extraction/
│   │   └── rules.ts
│   ├── indexing/
│   │   └── indexer.ts
│   ├── query/
│   │   ├── search.ts
│   │   ├── entity.ts
│   │   ├── timeline.ts
│   │   └── evidence.ts
│   └── mcp/
│       ├── server.ts
│       └── tools.ts
└── __tests__/
    ├── fixtures/
    │   └── cultivation-world/
    │       └── docs/
    │           └── 世界观参考/
    │               └── 一念永恒/
    │                   ├── 一念永恒.txt
    │                   └── 人物关系与事件分析.md
    ├── db.test.ts
    ├── scanner.test.ts
    ├── segmenter.test.ts
    ├── indexing.test.ts
    ├── query.test.ts
    ├── cli.test.ts
    └── mcp-tools.test.ts
```

### Modify under `E:\AI_Projects\CultivationWorld`

```text
docs/
├── README.md
└── superpowers/
    └── plans/
        └── 2026-06-05-StoryGraph小说图谱MVP实施计划.md
```

## Shared Command Prefix

Windows / PowerShell 命令默认使用以下编码前置设置：

```powershell
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
chcp 65001 > $null
```

---

### Task 1: Project Skeleton

**Files:**
- Create: `E:\AI_Projects\storygraph\package.json`
- Create: `E:\AI_Projects\storygraph\tsconfig.json`
- Create: `E:\AI_Projects\storygraph\vitest.config.ts`
- Create: `E:\AI_Projects\storygraph\.gitignore`
- Create: `E:\AI_Projects\storygraph\README.md`
- Create: `E:\AI_Projects\storygraph\src\index.ts`
- Test: `E:\AI_Projects\storygraph\__tests__\foundation.test.ts`

- [ ] **Step 1: Create the project directory and initialize git**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
New-Item -ItemType Directory -Force -LiteralPath 'E:\AI_Projects\storygraph'
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git init -b main
New-Item -ItemType Directory -Force -LiteralPath 'src'
New-Item -ItemType Directory -Force -LiteralPath '__tests__'
```

Expected: `E:\AI_Projects\storygraph` exists and `git status --short` returns no tracked files yet.

- [ ] **Step 2: Write the foundation test**

Create `E:\AI_Projects\storygraph\__tests__\foundation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STORYGRAPH_VERSION } from '../src/index';

describe('StoryGraph foundation', () => {
  it('exports a version string', () => {
    expect(STORYGRAPH_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 3: Write project metadata and build config**

Create `E:\AI_Projects\storygraph\package.json`:

```json
{
  "name": "@cultivation-world/storygraph",
  "version": "0.1.0",
  "description": "Local-first story knowledge graph for novel evidence, character cards, timelines, and worldbuilding references.",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "storygraph": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "clean": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\""
  },
  "engines": {
    "node": ">=22.5.0 <25.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.13.0",
    "commander": "^14.0.2"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.1.9"
  },
  "license": "MIT"
}
```

Create `E:\AI_Projects\storygraph\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts", "__tests__/**/*.ts", "vitest.config.ts"]
}
```

Create `E:\AI_Projects\storygraph\vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 10000
  }
});
```

Create `E:\AI_Projects\storygraph\.gitignore`:

```gitignore
node_modules/
dist/
.storygraph/
coverage/
*.log
```

Create `E:\AI_Projects\storygraph\README.md`:

```md
# StoryGraph

StoryGraph is a local-first story knowledge graph for novel evidence, character cards, timelines, and worldbuilding references.

Default target for CultivationWorld:

```powershell
storygraph init E:\AI_Projects\CultivationWorld
storygraph index E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒
storygraph search E:\AI_Projects\CultivationWorld "白小纯 筑基"
```
```

Create `E:\AI_Projects\storygraph\src\index.ts`:

```ts
export const STORYGRAPH_VERSION = '0.1.0';
```

- [ ] **Step 4: Install dependencies**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm install
```

Expected: `node_modules` and `package-lock.json` are created.

- [ ] **Step 5: Run tests and build**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test
npm run build
```

Expected: test output contains `1 passed`; build exits with code 0.

- [ ] **Step 6: Commit skeleton**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "chore: scaffold storygraph project"
```

Expected: commit succeeds on branch `main`.

---

### Task 2: Types, Paths, and SQLite Schema

**Files:**
- Create: `E:\AI_Projects\storygraph\src\types.ts`
- Create: `E:\AI_Projects\storygraph\src\paths.ts`
- Create: `E:\AI_Projects\storygraph\src\db\schema.sql`
- Create: `E:\AI_Projects\storygraph\src\db\connection.ts`
- Create: `E:\AI_Projects\storygraph\src\db\queries.ts`
- Modify: `E:\AI_Projects\storygraph\src\index.ts`
- Test: `E:\AI_Projects\storygraph\__tests__\db.test.ts`

- [ ] **Step 1: Write failing database tests**

Create `E:\AI_Projects\storygraph\__tests__\db.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseConnection } from '../src/db/connection';
import { StoryGraphQueries } from '../src/db/queries';
import { getStoryGraphDir, getStoryGraphDbPath } from '../src/paths';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-db-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('database foundation', () => {
  it('resolves project-local .storygraph paths', () => {
    const root = makeRoot();
    expect(getStoryGraphDir(root)).toBe(join(root, '.storygraph'));
    expect(getStoryGraphDbPath(root)).toBe(join(root, '.storygraph', 'storygraph.db'));
  });

  it('initializes schema and reports empty stats', () => {
    const root = makeRoot();
    const db = DatabaseConnection.initialize(root);
    const queries = new StoryGraphQueries(db);
    expect(queries.getStats()).toEqual({
      works: 0,
      sourceFiles: 0,
      chunks: 0,
      nodes: 0,
      edges: 0,
      evidenceAnchors: 0,
      assertions: 0
    });
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/db.test.ts
```

Expected: failure mentions missing `src/db/connection` or missing exported classes.

- [ ] **Step 3: Define shared types and paths**

Create `E:\AI_Projects\storygraph\src\types.ts`:

```ts
export const STORY_NODE_KINDS = [
  'work',
  'chapter',
  'chunk',
  'character',
  'faction',
  'location',
  'item',
  'technique',
  'realm',
  'creature',
  'event',
  'concept',
  'evidence'
] as const;

export type StoryNodeKind = (typeof STORY_NODE_KINDS)[number];

export const STORY_EDGE_KINDS = [
  'appears_in',
  'supports',
  'contradicts',
  'alias_of',
  'member_of',
  'leader_of',
  'master_of',
  'ally_of',
  'enemy_of',
  'obtains',
  'practices',
  'breaks_through_to',
  'located_in',
  'participates_in',
  'causes',
  'precedes',
  'similar_to',
  'derived_to_game_rule'
] as const;

export type StoryEdgeKind = (typeof STORY_EDGE_KINDS)[number];
export type SourceType = 'original_text' | 'analysis_md' | 'inference';
export type Confidence = 'high' | 'medium' | 'low';
export type AssertionStatus = 'observed' | 'inferred' | 'disputed' | 'needs_review';

export interface WorkRecord {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface SourceFileRecord {
  id: string;
  workId: string;
  path: string;
  kind: 'text' | 'markdown';
  encoding: string;
  contentHash: string;
  size: number;
  modifiedAt: number;
  indexedAt: number;
  errors?: string[];
}

export interface ChunkRecord {
  id: string;
  workId: string;
  sourceFileId: string;
  title: string;
  ordinal: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  text: string;
  summary: string;
  contentHash: string;
}

export interface StoryNode {
  id: string;
  workId: string;
  kind: StoryNodeKind;
  name: string;
  canonicalName: string;
  summary: string;
  metadata?: Record<string, unknown>;
  updatedAt: number;
}

export interface StoryEdge {
  id: string;
  workId: string;
  source: string;
  target: string;
  kind: StoryEdgeKind;
  label: string;
  metadata?: Record<string, unknown>;
  evidenceId?: string;
  confidence: Confidence;
  updatedAt: number;
}

export interface EvidenceAnchor {
  id: string;
  workId: string;
  sourceFileId: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
  quote: string;
  note: string;
  sourceType: SourceType;
  contentHash: string;
}

export interface AssertionRecord {
  id: string;
  workId: string;
  subjectNodeId: string;
  predicate: string;
  objectNodeId?: string;
  literalObject?: string;
  evidenceId?: string;
  sourceType: SourceType;
  confidence: Confidence;
  status: AssertionStatus;
  note: string;
  updatedAt: number;
}

export interface GraphStats {
  works: number;
  sourceFiles: number;
  chunks: number;
  nodes: number;
  edges: number;
  evidenceAnchors: number;
  assertions: number;
}
```

Create `E:\AI_Projects\storygraph\src\paths.ts`:

```ts
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const STORYGRAPH_DIR = '.storygraph';
export const STORYGRAPH_DB = 'storygraph.db';

export function resolveProjectRoot(projectRoot: string): string {
  return resolve(projectRoot);
}

export function getStoryGraphDir(projectRoot: string): string {
  return resolve(resolveProjectRoot(projectRoot), STORYGRAPH_DIR);
}

export function getStoryGraphDbPath(projectRoot: string): string {
  return resolve(getStoryGraphDir(projectRoot), STORYGRAPH_DB);
}

export function ensureStoryGraphDir(projectRoot: string): string {
  const dir = getStoryGraphDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 4: Write schema and database connection**

Create `E:\AI_Projects\storygraph\src\db\schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial StoryGraph schema');

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_files (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  encoding TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  errors TEXT,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  text TEXT NOT NULL,
  summary TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS story_nodes (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS story_edges (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  metadata TEXT,
  evidence_id TEXT,
  confidence TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
  FOREIGN KEY (source) REFERENCES story_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target) REFERENCES story_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES evidence_anchors(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS evidence_anchors (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  quote TEXT NOT NULL,
  note TEXT NOT NULL,
  source_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  node_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES story_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assertions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  subject_node_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_node_id TEXT,
  literal_object TEXT,
  evidence_id TEXT,
  source_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_node_id) REFERENCES story_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (object_node_id) REFERENCES story_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (evidence_id) REFERENCES evidence_anchors(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_source_files_work ON source_files(work_id);
CREATE INDEX IF NOT EXISTS idx_chunks_work ON chunks(work_id);
CREATE INDEX IF NOT EXISTS idx_nodes_work_kind ON story_nodes(work_id, kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON story_nodes(name);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON story_edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON story_edges(target, kind);
CREATE INDEX IF NOT EXISTS idx_evidence_work ON evidence_anchors(work_id);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias);
CREATE INDEX IF NOT EXISTS idx_assertions_subject ON assertions(subject_node_id);

CREATE VIRTUAL TABLE IF NOT EXISTS story_nodes_fts USING fts5(
  id,
  work_id,
  kind,
  name,
  canonical_name,
  summary,
  content='story_nodes',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS story_nodes_ai AFTER INSERT ON story_nodes BEGIN
  INSERT INTO story_nodes_fts(rowid, id, work_id, kind, name, canonical_name, summary)
  VALUES (NEW.rowid, NEW.id, NEW.work_id, NEW.kind, NEW.name, NEW.canonical_name, NEW.summary);
END;

CREATE TRIGGER IF NOT EXISTS story_nodes_ad AFTER DELETE ON story_nodes BEGIN
  INSERT INTO story_nodes_fts(story_nodes_fts, rowid, id, work_id, kind, name, canonical_name, summary)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.work_id, OLD.kind, OLD.name, OLD.canonical_name, OLD.summary);
END;

CREATE TRIGGER IF NOT EXISTS story_nodes_au AFTER UPDATE ON story_nodes BEGIN
  INSERT INTO story_nodes_fts(story_nodes_fts, rowid, id, work_id, kind, name, canonical_name, summary)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.work_id, OLD.kind, OLD.name, OLD.canonical_name, OLD.summary);
  INSERT INTO story_nodes_fts(rowid, id, work_id, kind, name, canonical_name, summary)
  VALUES (NEW.rowid, NEW.id, NEW.work_id, NEW.kind, NEW.name, NEW.canonical_name, NEW.summary);
END;
```

Create `E:\AI_Projects\storygraph\src\db\connection.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ensureStoryGraphDir, getStoryGraphDbPath } from '../paths.js';

function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'schema.sql');
}

export class DatabaseConnection {
  static initialize(projectRoot: string): DatabaseSync {
    ensureStoryGraphDir(projectRoot);
    const db = new DatabaseSync(getStoryGraphDbPath(projectRoot));
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(readFileSync(schemaPath(), 'utf8'));
    return db;
  }

  static open(projectRoot: string): DatabaseSync {
    const db = new DatabaseSync(getStoryGraphDbPath(projectRoot));
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  }
}
```

Create `E:\AI_Projects\storygraph\src\db\queries.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import type { GraphStats } from '../types.js';

export class StoryGraphQueries {
  constructor(private readonly db: DatabaseSync) {}

  getStats(): GraphStats {
    const count = (table: string): number => {
      const stmt = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`);
      return Number((stmt.get() as { count: number }).count);
    };

    return {
      works: count('works'),
      sourceFiles: count('source_files'),
      chunks: count('chunks'),
      nodes: count('story_nodes'),
      edges: count('story_edges'),
      evidenceAnchors: count('evidence_anchors'),
      assertions: count('assertions')
    };
  }
}
```

Modify `E:\AI_Projects\storygraph\src\index.ts`:

```ts
export const STORYGRAPH_VERSION = '0.1.0';

export * from './types.js';
export * from './paths.js';
export * from './db/connection.js';
export * from './db/queries.js';
```

- [ ] **Step 5: Copy schema into dist during build**

Modify `E:\AI_Projects\storygraph\package.json` scripts:

```json
{
  "build": "tsc && node -e \"const fs=require('fs');fs.mkdirSync('dist/src/db',{recursive:true});fs.copyFileSync('src/db/schema.sql','dist/src/db/schema.sql')\"",
  "test": "vitest run",
  "clean": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\""
}
```

Keep every other `package.json` field unchanged.

- [ ] **Step 6: Run tests and build**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/db.test.ts
npm run build
```

Expected: database tests pass and build exits with code 0.

- [ ] **Step 7: Commit database foundation**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "feat: add storygraph database schema"
```

Expected: commit succeeds.

---

### Task 3: Source Scanner and Encoding Detection

**Files:**
- Create: `E:\AI_Projects\storygraph\src\scanner\scan.ts`
- Create: `E:\AI_Projects\storygraph\src\segmenter\encoding.ts`
- Modify: `E:\AI_Projects\storygraph\src\index.ts`
- Test: `E:\AI_Projects\storygraph\__tests__\scanner.test.ts`
- Test Fixture: `E:\AI_Projects\storygraph\__tests__\fixtures\cultivation-world\docs\世界观参考\一念永恒\一念永恒.txt`
- Test Fixture: `E:\AI_Projects\storygraph\__tests__\fixtures\cultivation-world\docs\世界观参考\一念永恒\人物关系与事件分析.md`

- [ ] **Step 1: Write scanner fixture files**

Create `E:\AI_Projects\storygraph\__tests__\fixtures\cultivation-world\docs\世界观参考\一念永恒\一念永恒.txt`:

```text
第一章 灵溪宗少年
白小纯来到灵溪宗，结识李青候。
第二章 凝气起步
白小纯开始修炼紫气驭鼎功。
第三章 宗门冲突
杜凌菲与白小纯一同经历宗门风波。
```

Create `E:\AI_Projects\storygraph\__tests__\fixtures\cultivation-world\docs\世界观参考\一念永恒\人物关系与事件分析.md`:

```md
# 《一念永恒》人物关系与事件分析

> 最后更新：2026-06-05
> 资料来源：`docs/世界观参考/一念永恒/一念永恒.txt`

## 角色关系

| 角色 | 关系对象 | 关系 | 证据 |
|------|----------|------|------|
| 白小纯 | 李青候 | 师长/引路人 | 第一章 灵溪宗少年 |
| 白小纯 | 杜凌菲 | 同门/共同经历风波 | 第三章 宗门冲突 |

## 关键事件

- 白小纯来到灵溪宗。
- 白小纯开始修炼紫气驭鼎功。
```

- [ ] **Step 2: Write failing scanner tests**

Create `E:\AI_Projects\storygraph\__tests__\scanner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { decodeTextFile } from '../src/segmenter/encoding';
import { scanStorySources } from '../src/scanner/scan';

const fixtureRoot = resolve('__tests__/fixtures/cultivation-world');

describe('source scanner', () => {
  it('finds the selected work directory and source files', () => {
    const result = scanStorySources(fixtureRoot, 'docs/世界观参考', { work: '一念永恒' });
    expect(result.works).toHaveLength(1);
    expect(result.works[0].name).toBe('一念永恒');
    expect(result.files.map((f) => f.kind).sort()).toEqual(['markdown', 'text']);
  });

  it('throws when the requested work does not exist', () => {
    expect(() => scanStorySources(fixtureRoot, 'docs/世界观参考', { work: '不存在的作品' })).toThrow(
      'Story work does not exist: 不存在的作品'
    );
  });

  it('decodes text files with stable line access', () => {
    const file = resolve(fixtureRoot, 'docs/世界观参考/一念永恒/一念永恒.txt');
    const decoded = decodeTextFile(file);
    expect(decoded.encoding).toBe('utf8');
    expect(decoded.text).toContain('白小纯来到灵溪宗');
    expect(decoded.lines[0]).toBe('第一章 灵溪宗少年');
  });
});
```

- [ ] **Step 3: Run scanner tests to verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/scanner.test.ts
```

Expected: failure mentions missing scanner and encoding modules.

- [ ] **Step 4: Implement encoding detection**

Create `E:\AI_Projects\storygraph\src\segmenter\encoding.ts`:

```ts
import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

export interface DecodedText {
  text: string;
  encoding: string;
  lines: string[];
}

function decodeWith(buffer: Buffer, encoding: string): string {
  if (encoding === 'utf8') return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (encoding === 'gb18030') return new TextDecoder('gb18030', { fatal: false }).decode(buffer);
  return new TextDecoder(encoding, { fatal: false }).decode(buffer);
}

function scoreDecoded(text: string): number {
  const replacement = (text.match(/\uFFFD/g) || []).length;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk * 2 - replacement * 10;
}

export function decodeTextFile(filePath: string): DecodedText {
  const buffer = readFileSync(filePath);
  const candidates = ['utf8', 'gb18030'];
  const decoded = candidates
    .map((encoding) => ({ encoding, text: decodeWith(buffer, encoding) }))
    .sort((a, b) => scoreDecoded(b.text) - scoreDecoded(a.text))[0];
  const text = decoded.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return {
    text,
    encoding: decoded.encoding,
    lines: text.split('\n')
  };
}
```

- [ ] **Step 5: Implement source scanning**

Create `E:\AI_Projects\storygraph\src\scanner\scan.ts`:

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

export interface ScannedWork {
  id: string;
  name: string;
  rootPath: string;
}

export interface ScannedSourceFile {
  workId: string;
  workName: string;
  path: string;
  relativePath: string;
  kind: 'text' | 'markdown';
  size: number;
  modifiedAt: number;
}

export interface ScanResult {
  root: string;
  sourceRoot: string;
  works: ScannedWork[];
  files: ScannedSourceFile[];
}

export interface ScanOptions {
  work?: string;
}

function normalizeId(name: string): string {
  return `work_${Buffer.from(name).toString('hex')}`;
}

function isSourceFile(name: string): 'text' | 'markdown' | null {
  if (name.toLowerCase().endsWith('.txt')) return 'text';
  if (name.toLowerCase().endsWith('.md')) return 'markdown';
  return null;
}

export function scanStorySources(projectRoot: string, sourceDir = 'docs/世界观参考', options: ScanOptions = {}): ScanResult {
  const root = resolve(projectRoot);
  const sourceRoot = resolve(root, sourceDir);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Story source directory does not exist: ${sourceRoot}`);
  }

  const works: ScannedWork[] = [];
  const files: ScannedSourceFile[] = [];

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (options.work && entry.name !== options.work) continue;
    const workRoot = resolve(sourceRoot, entry.name);
    const work: ScannedWork = {
      id: normalizeId(entry.name),
      name: entry.name,
      rootPath: workRoot
    };
    works.push(work);

    for (const child of readdirSync(workRoot, { withFileTypes: true })) {
      if (!child.isFile()) continue;
      const kind = isSourceFile(child.name);
      if (!kind) continue;
      const filePath = resolve(workRoot, child.name);
      const stat = statSync(filePath);
      files.push({
        workId: work.id,
        workName: work.name,
        path: filePath,
        relativePath: relative(root, filePath).replace(/\\/g, '/'),
        kind,
        size: stat.size,
        modifiedAt: stat.mtimeMs
      });
    }
  }

  if (options.work && works.length === 0) {
    throw new Error(`Story work does not exist: ${options.work}`);
  }

  return { root, sourceRoot, works, files };
}
```

Modify `E:\AI_Projects\storygraph\src\index.ts`:

```ts
export const STORYGRAPH_VERSION = '0.1.0';

export * from './types.js';
export * from './paths.js';
export * from './db/connection.js';
export * from './db/queries.js';
export * from './scanner/scan.js';
export * from './segmenter/encoding.js';
```

- [ ] **Step 6: Run scanner tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/scanner.test.ts
npm run build
```

Expected: scanner tests pass and build succeeds.

- [ ] **Step 7: Commit scanner**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "feat: scan story source directories"
```

Expected: commit succeeds.

---

### Task 4: Text and Markdown Segmenters

**Files:**
- Create: `E:\AI_Projects\storygraph\src\segmenter\text.ts`
- Create: `E:\AI_Projects\storygraph\src\segmenter\markdown.ts`
- Modify: `E:\AI_Projects\storygraph\src\index.ts`
- Test: `E:\AI_Projects\storygraph\__tests__\segmenter.test.ts`

- [ ] **Step 1: Write failing segmenter tests**

Create `E:\AI_Projects\storygraph\__tests__\segmenter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { segmentMarkdown, segmentText } from '../src/segmenter/text';
import { segmentMarkdownDocument } from '../src/segmenter/markdown';

describe('segmenters', () => {
  it('segments chapter-style text by Chinese chapter headings', () => {
    const chunks = segmentText('work_a', 'file_a', '第一章 开始\n甲出现。\n第二章 转折\n乙出现。');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].title).toBe('第一章 开始');
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(2);
    expect(chunks[1].title).toBe('第二章 转折');
  });

  it('segments markdown by headings', () => {
    const chunks = segmentMarkdownDocument('work_a', 'file_md', '# 标题\n\n## 角色关系\n\n- 白小纯来到灵溪宗。');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].title).toBe('标题');
    expect(chunks[1].title).toBe('标题 > 角色关系');
    expect(chunks[1].text).toContain('白小纯');
  });

  it('exports markdown segmenter from text barrel for convenience', () => {
    expect(segmentMarkdown).toBe(segmentMarkdownDocument);
  });
});
```

- [ ] **Step 2: Run segmenter tests to verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/segmenter.test.ts
```

Expected: failure mentions missing segmenter modules.

- [ ] **Step 3: Implement text segmenter**

Create `E:\AI_Projects\storygraph\src\segmenter\text.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ChunkRecord } from '../types.js';
import { segmentMarkdownDocument } from './markdown.js';

export const segmentMarkdown = segmentMarkdownDocument;

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function chunkId(workId: string, sourceFileId: string, ordinal: number): string {
  return `chunk_${hash(`${workId}:${sourceFileId}:${ordinal}`).slice(0, 24)}`;
}

function summarize(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 120);
}

function isChapterHeading(line: string): boolean {
  return /^第[一二三四五六七八九十百千万零〇0-9]+[章节卷部集]\s*\S*/.test(line.trim());
}

export function segmentText(workId: string, sourceFileId: string, text: string): ChunkRecord[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (isChapterHeading(line)) starts.push(index);
  });

  if (starts.length === 0) starts.push(0);

  const chunks: ChunkRecord[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const endExclusive = starts[i + 1] ?? lines.length;
    const selected = lines.slice(start, endExclusive);
    const chunkText = selected.join('\n').trim();
    const title = isChapterHeading(lines[start]) ? lines[start].trim() : `文本片段 ${i + 1}`;
    chunks.push({
      id: chunkId(workId, sourceFileId, i + 1),
      workId,
      sourceFileId,
      title,
      ordinal: i + 1,
      startLine: start + 1,
      endLine: endExclusive,
      startOffset: lines.slice(0, start).join('\n').length,
      endOffset: lines.slice(0, endExclusive).join('\n').length,
      text: chunkText,
      summary: summarize(chunkText),
      contentHash: hash(chunkText)
    });
  }
  return chunks;
}
```

- [ ] **Step 4: Implement markdown segmenter**

Create `E:\AI_Projects\storygraph\src\segmenter\markdown.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ChunkRecord } from '../types.js';

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function chunkId(workId: string, sourceFileId: string, ordinal: number): string {
  return `chunk_${hash(`${workId}:${sourceFileId}:md:${ordinal}`).slice(0, 24)}`;
}

function heading(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  return match ? { level: match[1].length, title: match[2].trim() } : null;
}

function summarize(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 120);
}

export function segmentMarkdownDocument(workId: string, sourceFileId: string, text: string): ChunkRecord[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const chunks: ChunkRecord[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let currentStart = 0;
  let currentTitle = 'Markdown 文档';
  let ordinal = 1;

  function flush(endExclusive: number): void {
    const selected = lines.slice(currentStart, endExclusive).join('\n').trim();
    if (!selected) return;
    chunks.push({
      id: chunkId(workId, sourceFileId, ordinal),
      workId,
      sourceFileId,
      title: currentTitle,
      ordinal,
      startLine: currentStart + 1,
      endLine: endExclusive,
      startOffset: lines.slice(0, currentStart).join('\n').length,
      endOffset: lines.slice(0, endExclusive).join('\n').length,
      text: selected,
      summary: summarize(selected),
      contentHash: hash(selected)
    });
    ordinal += 1;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const h = heading(lines[i]);
    if (!h) continue;
    if (i > currentStart) flush(i);
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
    currentTitle = stack.map((item) => item.title).join(' > ');
    currentStart = i;
  }

  flush(lines.length);
  return chunks;
}
```

Modify `E:\AI_Projects\storygraph\src\index.ts`:

```ts
export const STORYGRAPH_VERSION = '0.1.0';

export * from './types.js';
export * from './paths.js';
export * from './db/connection.js';
export * from './db/queries.js';
export * from './scanner/scan.js';
export * from './segmenter/encoding.js';
export * from './segmenter/text.js';
export * from './segmenter/markdown.js';
```

- [ ] **Step 5: Run segmenter tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/segmenter.test.ts
npm run build
```

Expected: segmenter tests pass and build succeeds.

- [ ] **Step 6: Commit segmenters**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "feat: segment story source files"
```

Expected: commit succeeds.

---

### Task 5: Indexer and Rule Extraction

**Files:**
- Create: `E:\AI_Projects\storygraph\src\extraction\rules.ts`
- Create: `E:\AI_Projects\storygraph\src\indexing\indexer.ts`
- Modify: `E:\AI_Projects\storygraph\src\db\queries.ts`
- Modify: `E:\AI_Projects\storygraph\src\index.ts`
- Test: `E:\AI_Projects\storygraph\__tests__\indexing.test.ts`

- [ ] **Step 1: Write failing indexing test**

Create `E:\AI_Projects\storygraph\__tests__\indexing.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseConnection } from '../src/db/connection';
import { StoryGraphQueries } from '../src/db/queries';
import { indexStorySources } from '../src/indexing/indexer';

const roots: string[] = [];

async function copyFixture(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-index-'));
  roots.push(root);
  await cp(resolve('__tests__/fixtures/cultivation-world'), root, { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('indexer', () => {
  it('indexes works, files, chunks, nodes, evidence, and assertions', async () => {
    const root = await copyFixture();
    const db = DatabaseConnection.initialize(root);
    const queries = new StoryGraphQueries(db);
    const result = indexStorySources(root, { sourceDir: 'docs/世界观参考', work: '一念永恒' });
    expect(result.indexedWorks).toEqual(['一念永恒']);
    const stats = queries.getStats();
    expect(stats.works).toBe(1);
    expect(stats.sourceFiles).toBe(2);
    expect(stats.chunks).toBeGreaterThanOrEqual(4);
    expect(stats.nodes).toBeGreaterThanOrEqual(5);
    expect(stats.evidenceAnchors).toBeGreaterThanOrEqual(3);
    expect(stats.assertions).toBeGreaterThanOrEqual(3);
    db.close();
  });
});
```

- [ ] **Step 2: Run indexing test to verify it fails**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/indexing.test.ts
```

Expected: failure mentions missing `indexStorySources`.

- [ ] **Step 3: Extend queries with upsert methods**

Modify `E:\AI_Projects\storygraph\src\db\queries.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import type {
  AssertionRecord,
  ChunkRecord,
  EvidenceAnchor,
  GraphStats,
  SourceFileRecord,
  StoryEdge,
  StoryNode,
  WorkRecord
} from '../types.js';

function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export class StoryGraphQueries {
  constructor(private readonly db: DatabaseSync) {}

  getStats(): GraphStats {
    const count = (table: string): number => {
      const stmt = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`);
      return Number((stmt.get() as { count: number }).count);
    };

    return {
      works: count('works'),
      sourceFiles: count('source_files'),
      chunks: count('chunks'),
      nodes: count('story_nodes'),
      edges: count('story_edges'),
      evidenceAnchors: count('evidence_anchors'),
      assertions: count('assertions')
    };
  }

  clearWork(workId: string): void {
    this.db.prepare('DELETE FROM works WHERE id = ?').run(workId);
  }

  upsertWork(work: WorkRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO works (id, name, root_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(work.id, work.name, work.rootPath, work.createdAt, work.updatedAt);
  }

  upsertSourceFile(file: SourceFileRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO source_files
      (id, work_id, path, kind, encoding, content_hash, size, modified_at, indexed_at, errors)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(file.id, file.workId, file.path, file.kind, file.encoding, file.contentHash, file.size, file.modifiedAt, file.indexedAt, json(file.errors));
  }

  insertChunk(chunk: ChunkRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO chunks
      (id, work_id, source_file_id, title, ordinal, start_line, end_line, start_offset, end_offset, text, summary, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(chunk.id, chunk.workId, chunk.sourceFileId, chunk.title, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.startOffset, chunk.endOffset, chunk.text, chunk.summary, chunk.contentHash);
  }

  upsertNode(node: StoryNode): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO story_nodes
      (id, work_id, kind, name, canonical_name, summary, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(node.id, node.workId, node.kind, node.name, node.canonicalName, node.summary, json(node.metadata), node.updatedAt);
  }

  upsertEdge(edge: StoryEdge): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO story_edges
      (id, work_id, source, target, kind, label, metadata, evidence_id, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(edge.id, edge.workId, edge.source, edge.target, edge.kind, edge.label, json(edge.metadata), edge.evidenceId ?? null, edge.confidence, edge.updatedAt);
  }

  upsertEvidence(anchor: EvidenceAnchor): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO evidence_anchors
      (id, work_id, source_file_id, chunk_id, line_start, line_end, quote, note, source_type, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(anchor.id, anchor.workId, anchor.sourceFileId, anchor.chunkId, anchor.lineStart, anchor.lineEnd, anchor.quote, anchor.note, anchor.sourceType, anchor.contentHash);
  }

  upsertAssertion(assertion: AssertionRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO assertions
      (id, work_id, subject_node_id, predicate, object_node_id, literal_object, evidence_id, source_type, confidence, status, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(assertion.id, assertion.workId, assertion.subjectNodeId, assertion.predicate, assertion.objectNodeId ?? null, assertion.literalObject ?? null, assertion.evidenceId ?? null, assertion.sourceType, assertion.confidence, assertion.status, assertion.note, assertion.updatedAt);
  }
}
```

- [ ] **Step 4: Implement deterministic rule extraction**

Create `E:\AI_Projects\storygraph\src\extraction\rules.ts`:

```ts
import { createHash } from 'node:crypto';
import type { AssertionRecord, ChunkRecord, EvidenceAnchor, StoryEdge, StoryNode } from '../types.js';

export interface ExtractedGraph {
  nodes: StoryNode[];
  edges: StoryEdge[];
  evidence: EvidenceAnchor[];
  assertions: AssertionRecord[];
}

const NAME_RE = /[\u4e00-\u9fff]{2,6}/g;
const STOP_WORDS = new Set(['第一章', '第二章', '第三章', '角色关系', '关键事件', '资料来源', '最后更新']);
const REALM_WORDS = ['凝气', '筑基', '金丹', '元婴', '化神'];
const TECHNIQUE_SUFFIX = /(功|诀|法|术|经|典)$/;

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function id(prefix: string, value: string): string {
  return `${prefix}_${hash(value).slice(0, 24)}`;
}

function uniqueNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(NAME_RE)) {
    const value = match[0];
    if (STOP_WORDS.has(value)) continue;
    if (/^[一二三四五六七八九十百千万零〇]+$/.test(value)) continue;
    names.add(value);
  }
  return Array.from(names).slice(0, 30);
}

function nodeKind(name: string): StoryNode['kind'] {
  if (REALM_WORDS.includes(name)) return 'realm';
  if (TECHNIQUE_SUFFIX.test(name)) return 'technique';
  if (/(宗|门|谷|宫|国|族)$/.test(name)) return 'faction';
  return 'character';
}

export function extractChunkGraph(workId: string, sourceFileId: string, chunk: ChunkRecord): ExtractedGraph {
  const now = Date.now();
  const evidenceId = id('evidence', `${chunk.id}:primary`);
  const evidence: EvidenceAnchor = {
    id: evidenceId,
    workId,
    sourceFileId,
    chunkId: chunk.id,
    lineStart: chunk.startLine,
    lineEnd: chunk.endLine,
    quote: chunk.text.slice(0, 160),
    note: chunk.title,
    sourceType: sourceFileId.endsWith('.md') ? 'analysis_md' : 'original_text',
    contentHash: chunk.contentHash
  };

  const nodes: StoryNode[] = uniqueNames(`${chunk.title}\n${chunk.text}`).map((name) => ({
    id: id('node', `${workId}:${name}`),
    workId,
    kind: nodeKind(name),
    name,
    canonicalName: name,
    summary: `${name} 出现于 ${chunk.title}`,
    metadata: { firstChunkId: chunk.id },
    updatedAt: now
  }));

  const chunkNode: StoryNode = {
    id: id('node', `${workId}:${chunk.id}`),
    workId,
    kind: 'chunk',
    name: chunk.title,
    canonicalName: chunk.title,
    summary: chunk.summary,
    metadata: { chunkId: chunk.id },
    updatedAt: now
  };
  nodes.push(chunkNode);

  const edges: StoryEdge[] = [];
  const assertions: AssertionRecord[] = [];

  for (const node of nodes.filter((n) => n.kind !== 'chunk')) {
    edges.push({
      id: id('edge', `${node.id}:${chunkNode.id}:appears_in`),
      workId,
      source: node.id,
      target: chunkNode.id,
      kind: 'appears_in',
      label: '出现于',
      evidenceId,
      confidence: 'medium',
      updatedAt: now
    });
    assertions.push({
      id: id('assertion', `${node.id}:appears_in:${chunk.id}`),
      workId,
      subjectNodeId: node.id,
      predicate: 'appears_in',
      objectNodeId: chunkNode.id,
      evidenceId,
      sourceType: evidence.sourceType,
      confidence: 'medium',
      status: 'observed',
      note: `${node.name} 出现于 ${chunk.title}`,
      updatedAt: now
    });
  }

  return { nodes, edges, evidence: [evidence], assertions };
}
```

- [ ] **Step 5: Implement indexer orchestration**

Create `E:\AI_Projects\storygraph\src\indexing\indexer.ts`:

```ts
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';
import { extractChunkGraph } from '../extraction/rules.js';
import { scanStorySources } from '../scanner/scan.js';
import { decodeTextFile } from '../segmenter/encoding.js';
import { segmentMarkdownDocument } from '../segmenter/markdown.js';
import { segmentText } from '../segmenter/text.js';
import type { SourceFileRecord, WorkRecord } from '../types.js';

export interface IndexOptions {
  sourceDir?: string;
  work?: string;
}

export interface IndexResult {
  indexedWorks: string[];
  indexedFiles: number;
  indexedChunks: number;
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function id(prefix: string, value: string): string {
  return `${prefix}_${hash(value).slice(0, 24)}`;
}

export function indexStorySources(projectRoot: string, options: IndexOptions = {}): IndexResult {
  const db = DatabaseConnection.initialize(projectRoot);
  const queries = new StoryGraphQueries(db);
  const scan = scanStorySources(projectRoot, options.sourceDir ?? 'docs/世界观参考');
  const selectedWorks = new Set(scan.works.filter((work) => !options.work || work.name === options.work).map((work) => work.id));
  let indexedFiles = 0;
  let indexedChunks = 0;
  const indexedWorks: string[] = [];

  for (const work of scan.works.filter((item) => selectedWorks.has(item.id))) {
    queries.clearWork(work.id);
    const now = Date.now();
    const workRecord: WorkRecord = {
      id: work.id,
      name: work.name,
      rootPath: work.rootPath,
      createdAt: now,
      updatedAt: now
    };
    queries.upsertWork(workRecord);
    indexedWorks.push(work.name);
  }

  for (const file of scan.files.filter((item) => selectedWorks.has(item.workId))) {
    const decoded = decodeTextFile(file.path);
    const sourceFileId = id('source', file.relativePath);
    const stat = statSync(file.path);
    const sourceFile: SourceFileRecord = {
      id: sourceFileId,
      workId: file.workId,
      path: file.relativePath,
      kind: file.kind,
      encoding: decoded.encoding,
      contentHash: hash(decoded.text),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      indexedAt: Date.now()
    };
    queries.upsertSourceFile(sourceFile);
    indexedFiles += 1;

    const chunks = file.kind === 'markdown'
      ? segmentMarkdownDocument(file.workId, sourceFileId, decoded.text)
      : segmentText(file.workId, sourceFileId, decoded.text);

    for (const chunk of chunks) {
      queries.insertChunk(chunk);
      indexedChunks += 1;
      const graph = extractChunkGraph(file.workId, sourceFileId, chunk);
      for (const anchor of graph.evidence) queries.upsertEvidence(anchor);
      for (const node of graph.nodes) queries.upsertNode(node);
      for (const edge of graph.edges) queries.upsertEdge(edge);
      for (const assertion of graph.assertions) queries.upsertAssertion(assertion);
    }
  }

  db.close();
  return { indexedWorks, indexedFiles, indexedChunks };
}
```

Modify `E:\AI_Projects\storygraph\src\index.ts`:

```ts
export const STORYGRAPH_VERSION = '0.1.0';

export * from './types.js';
export * from './paths.js';
export * from './db/connection.js';
export * from './db/queries.js';
export * from './scanner/scan.js';
export * from './segmenter/encoding.js';
export * from './segmenter/text.js';
export * from './segmenter/markdown.js';
export * from './extraction/rules.js';
export * from './indexing/indexer.js';
```

- [ ] **Step 6: Run indexing tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/indexing.test.ts
npm run build
```

Expected: indexing tests pass and build succeeds.

- [ ] **Step 7: Commit indexer**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "feat: index story sources into graph"
```

Expected: commit succeeds.

---

### Task 6: Search, Entity Card, Timeline, and Evidence Queries

**Files:**
- Create: `E:\AI_Projects\storygraph\src\query\search.ts`
- Create: `E:\AI_Projects\storygraph\src\query\entity.ts`
- Create: `E:\AI_Projects\storygraph\src\query\timeline.ts`
- Create: `E:\AI_Projects\storygraph\src\query\evidence.ts`
- Modify: `E:\AI_Projects\storygraph\src\db\queries.ts`
- Modify: `E:\AI_Projects\storygraph\src\index.ts`
- Test: `E:\AI_Projects\storygraph\__tests__\query.test.ts`

- [ ] **Step 1: Write failing query tests**

Create `E:\AI_Projects\storygraph\__tests__\query.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexStorySources } from '../src/indexing/indexer';
import { searchStoryGraph } from '../src/query/search';
import { getEntityCard } from '../src/query/entity';
import { getTimeline } from '../src/query/timeline';
import { getEvidence } from '../src/query/evidence';

const roots: string[] = [];

async function indexedRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-query-'));
  roots.push(root);
  await cp(resolve('__tests__/fixtures/cultivation-world'), root, { recursive: true });
  indexStorySources(root, { sourceDir: 'docs/世界观参考', work: '一念永恒' });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('query surface', () => {
  it('searches story nodes', async () => {
    const root = await indexedRoot();
    const results = searchStoryGraph(root, '白小纯');
    expect(results[0].name).toBe('白小纯');
  });

  it('builds an entity card with evidence', async () => {
    const root = await indexedRoot();
    const card = getEntityCard(root, '白小纯', { work: '一念永恒' });
    expect(card?.name).toBe('白小纯');
    expect(card?.evidence.length).toBeGreaterThan(0);
  });

  it('returns timeline entries for an entity', async () => {
    const root = await indexedRoot();
    const timeline = getTimeline(root, { character: '白小纯', work: '一念永恒' });
    expect(timeline.entries.length).toBeGreaterThan(0);
    expect(timeline.entries[0].title).toContain('第一章');
  });

  it('returns evidence anchors for a concept', async () => {
    const root = await indexedRoot();
    const evidence = getEvidence(root, '灵溪宗', { work: '一念永恒' });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].quote).toContain('灵溪宗');
  });
});
```

- [ ] **Step 2: Run query tests to verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/query.test.ts
```

Expected: failure mentions missing query modules.

- [ ] **Step 3: Add read queries**

Append these methods inside `StoryGraphQueries` in `E:\AI_Projects\storygraph\src\db\queries.ts`:

```ts
  searchNodes(query: string, work?: string): Array<{ id: string; workId: string; kind: string; name: string; summary: string }> {
    const like = `%${query}%`;
    if (work) {
      return this.db.prepare(`
        SELECT n.id, n.work_id AS workId, n.kind, n.name, n.summary
        FROM story_nodes n
        JOIN works w ON w.id = n.work_id
        WHERE w.name = ? AND (n.name LIKE ? OR n.summary LIKE ?)
        ORDER BY CASE WHEN n.name = ? THEN 0 ELSE 1 END, n.name
        LIMIT 20
      `).all(work, like, like, query) as Array<{ id: string; workId: string; kind: string; name: string; summary: string }>;
    }
    return this.db.prepare(`
      SELECT id, work_id AS workId, kind, name, summary
      FROM story_nodes
      WHERE name LIKE ? OR summary LIKE ?
      ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, name
      LIMIT 20
    `).all(like, like, query) as Array<{ id: string; workId: string; kind: string; name: string; summary: string }>;
  }

  getNodeByName(name: string, work?: string): { id: string; workId: string; kind: string; name: string; summary: string } | null {
    return this.searchNodes(name, work)[0] ?? null;
  }

  getEvidenceForNode(nodeId: string): Array<{ id: string; quote: string; note: string; sourceType: string; lineStart: number; lineEnd: number; sourcePath: string }> {
    return this.db.prepare(`
      SELECT e.id, e.quote, e.note, e.source_type AS sourceType, e.line_start AS lineStart, e.line_end AS lineEnd, sf.path AS sourcePath
      FROM assertions a
      JOIN evidence_anchors e ON e.id = a.evidence_id
      JOIN source_files sf ON sf.id = e.source_file_id
      WHERE a.subject_node_id = ?
      ORDER BY e.line_start
      LIMIT 20
    `).all(nodeId) as Array<{ id: string; quote: string; note: string; sourceType: string; lineStart: number; lineEnd: number; sourcePath: string }>;
  }

  getTimelineForNode(nodeId: string): Array<{ title: string; summary: string; lineStart: number; sourcePath: string; quote: string }> {
    return this.db.prepare(`
      SELECT c.title, c.summary, e.line_start AS lineStart, sf.path AS sourcePath, e.quote
      FROM assertions a
      JOIN story_nodes chunk_node ON chunk_node.id = a.object_node_id
      JOIN chunks c ON json_extract(chunk_node.metadata, '$.chunkId') = c.id
      JOIN evidence_anchors e ON e.id = a.evidence_id
      JOIN source_files sf ON sf.id = e.source_file_id
      WHERE a.subject_node_id = ? AND a.predicate = 'appears_in'
      ORDER BY c.ordinal
      LIMIT 50
    `).all(nodeId) as Array<{ title: string; summary: string; lineStart: number; sourcePath: string; quote: string }>;
  }
```

- [ ] **Step 4: Implement query modules**

Create `E:\AI_Projects\storygraph\src\query\search.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';

export interface SearchResult {
  id: string;
  workId: string;
  kind: string;
  name: string;
  summary: string;
}

export function searchStoryGraph(projectRoot: string, query: string, options: { work?: string } = {}): SearchResult[] {
  const db = DatabaseConnection.open(projectRoot);
  const queries = new StoryGraphQueries(db);
  const results = queries.searchNodes(query, options.work);
  db.close();
  return results;
}
```

Create `E:\AI_Projects\storygraph\src\query\entity.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';

export interface EntityCard {
  id: string;
  name: string;
  kind: string;
  summary: string;
  evidence: Array<{ quote: string; note: string; sourceType: string; sourcePath: string; lineStart: number; lineEnd: number }>;
}

export function getEntityCard(projectRoot: string, name: string, options: { work?: string } = {}): EntityCard | null {
  const db = DatabaseConnection.open(projectRoot);
  const queries = new StoryGraphQueries(db);
  const node = queries.getNodeByName(name, options.work);
  if (!node) {
    db.close();
    return null;
  }
  const evidence = queries.getEvidenceForNode(node.id);
  db.close();
  return { id: node.id, name: node.name, kind: node.kind, summary: node.summary, evidence };
}
```

Create `E:\AI_Projects\storygraph\src\query\timeline.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';

export interface TimelineResult {
  subject: string;
  entries: Array<{ title: string; summary: string; lineStart: number; sourcePath: string; quote: string }>;
}

export function getTimeline(projectRoot: string, options: { character: string; work?: string }): TimelineResult {
  const db = DatabaseConnection.open(projectRoot);
  const queries = new StoryGraphQueries(db);
  const node = queries.getNodeByName(options.character, options.work);
  if (!node) {
    db.close();
    return { subject: options.character, entries: [] };
  }
  const entries = queries.getTimelineForNode(node.id);
  db.close();
  return { subject: node.name, entries };
}
```

Create `E:\AI_Projects\storygraph\src\query\evidence.ts`:

```ts
import { getEntityCard } from './entity.js';

export interface EvidenceResult {
  quote: string;
  note: string;
  sourceType: string;
  sourcePath: string;
  lineStart: number;
  lineEnd: number;
}

export function getEvidence(projectRoot: string, query: string, options: { work?: string } = {}): EvidenceResult[] {
  const card = getEntityCard(projectRoot, query, options);
  return card ? card.evidence : [];
}
```

Modify `E:\AI_Projects\storygraph\src\index.ts`:

```ts
export const STORYGRAPH_VERSION = '0.1.0';

export * from './types.js';
export * from './paths.js';
export * from './db/connection.js';
export * from './db/queries.js';
export * from './scanner/scan.js';
export * from './segmenter/encoding.js';
export * from './segmenter/text.js';
export * from './segmenter/markdown.js';
export * from './extraction/rules.js';
export * from './indexing/indexer.js';
export * from './query/search.js';
export * from './query/entity.js';
export * from './query/timeline.js';
export * from './query/evidence.js';
```

- [ ] **Step 5: Run query tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/query.test.ts
npm run build
```

Expected: query tests pass and build succeeds.

- [ ] **Step 6: Commit query surface**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "feat: query story graph context"
```

Expected: commit succeeds.

---

### Task 7: CLI Commands

**Files:**
- Create: `E:\AI_Projects\storygraph\src\cli.ts`
- Modify: `E:\AI_Projects\storygraph\package.json`
- Test: `E:\AI_Projects\storygraph\__tests__\cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Create `E:\AI_Projects\storygraph\__tests__\cli.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

async function copyFixture(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-cli-'));
  roots.push(root);
  await cp(resolve('__tests__/fixtures/cultivation-world'), root, { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('cli', () => {
  it('indexes and searches from the command line', async () => {
    const root = await copyFixture();
    execFileSync('node', ['dist/cli.js', 'init', root], { encoding: 'utf8' });
    execFileSync('node', ['dist/cli.js', 'index', root, '--source', 'docs/世界观参考', '--work', '一念永恒'], { encoding: 'utf8' });
    const output = execFileSync('node', ['dist/cli.js', 'search', root, '白小纯'], { encoding: 'utf8' });
    expect(output).toContain('白小纯');
  });
});
```

- [ ] **Step 2: Run CLI test to verify it fails**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm run build
npm test -- __tests__/cli.test.ts
```

Expected: failure mentions missing `dist/cli.js`.

- [ ] **Step 3: Implement CLI**

Create `E:\AI_Projects\storygraph\src\cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { DatabaseConnection } from './db/connection.js';
import { StoryGraphQueries } from './db/queries.js';
import { indexStorySources } from './indexing/indexer.js';
import { getEvidence } from './query/evidence.js';
import { getEntityCard } from './query/entity.js';
import { searchStoryGraph } from './query/search.js';
import { getTimeline } from './query/timeline.js';
import { STORYGRAPH_VERSION } from './index.js';

const program = new Command();
program.name('storygraph').version(STORYGRAPH_VERSION);

program.command('init')
  .argument('<projectRoot>')
  .description('Initialize .storygraph in a project')
  .action((projectRoot: string) => {
    const db = DatabaseConnection.initialize(projectRoot);
    db.close();
    console.log(`Initialized StoryGraph at ${projectRoot}`);
  });

program.command('index')
  .argument('<projectRoot>')
  .option('--source <sourceDir>', 'Source directory', 'docs/世界观参考')
  .option('--work <work>', 'Single work name')
  .description('Index story sources')
  .action((projectRoot: string, options: { source: string; work?: string }) => {
    const result = indexStorySources(projectRoot, { sourceDir: options.source, work: options.work });
    console.log(JSON.stringify(result, null, 2));
  });

program.command('status')
  .argument('<projectRoot>')
  .option('--json', 'Print JSON')
  .description('Show index status')
  .action((projectRoot: string, options: { json?: boolean }) => {
    const db = DatabaseConnection.open(projectRoot);
    const stats = new StoryGraphQueries(db).getStats();
    db.close();
    if (options.json) console.log(JSON.stringify(stats, null, 2));
    else console.log(`works=${stats.works} files=${stats.sourceFiles} nodes=${stats.nodes} edges=${stats.edges}`);
  });

program.command('search')
  .argument('<projectRoot>')
  .argument('<query>')
  .option('--work <work>', 'Work name')
  .description('Search story graph')
  .action((projectRoot: string, query: string, options: { work?: string }) => {
    const results = searchStoryGraph(projectRoot, query, { work: options.work });
    for (const result of results) {
      console.log(`${result.kind}\t${result.name}\t${result.summary}`);
    }
  });

program.command('entity')
  .argument('<projectRoot>')
  .argument('<name>')
  .option('--work <work>', 'Work name')
  .description('Show an entity card')
  .action((projectRoot: string, name: string, options: { work?: string }) => {
    console.log(JSON.stringify(getEntityCard(projectRoot, name, { work: options.work }), null, 2));
  });

program.command('timeline')
  .argument('<projectRoot>')
  .requiredOption('--character <character>', 'Character name')
  .option('--work <work>', 'Work name')
  .description('Show timeline entries')
  .action((projectRoot: string, options: { character: string; work?: string }) => {
    console.log(JSON.stringify(getTimeline(projectRoot, { character: options.character, work: options.work }), null, 2));
  });

program.command('evidence')
  .argument('<projectRoot>')
  .argument('<query>')
  .option('--work <work>', 'Work name')
  .description('Show evidence anchors')
  .action((projectRoot: string, query: string, options: { work?: string }) => {
    console.log(JSON.stringify(getEvidence(projectRoot, query, { work: options.work }), null, 2));
  });

program.parse();
```

Modify `E:\AI_Projects\storygraph\package.json` build script:

```json
{
  "build": "tsc && node -e \"const fs=require('fs');fs.mkdirSync('dist/src/db',{recursive:true});fs.copyFileSync('src/db/schema.sql','dist/src/db/schema.sql');fs.chmodSync('dist/src/cli.js',0o755);fs.copyFileSync('dist/src/cli.js','dist/cli.js')\""
}
```

Keep every other `package.json` field unchanged.

- [ ] **Step 4: Run CLI tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm run build
npm test -- __tests__/cli.test.ts
```

Expected: CLI test passes.

- [ ] **Step 5: Smoke test against CultivationWorld**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
node dist/cli.js init 'E:\AI_Projects\CultivationWorld'
node dist/cli.js index 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒'
node dist/cli.js status 'E:\AI_Projects\CultivationWorld' --json
```

Expected: `.storygraph\storygraph.db` is created in CultivationWorld and status JSON reports at least one work. Do not treat extracted facts as final game canon.

- [ ] **Step 6: Commit CLI**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "feat: add storygraph cli"
```

Expected: commit succeeds.

---

### Task 8: MCP Tool Surface

**Files:**
- Create: `E:\AI_Projects\storygraph\src\mcp\tools.ts`
- Create: `E:\AI_Projects\storygraph\src\mcp\server.ts`
- Modify: `E:\AI_Projects\storygraph\package.json`
- Test: `E:\AI_Projects\storygraph\__tests__\mcp-tools.test.ts`

- [ ] **Step 1: Write failing MCP tool tests**

Create `E:\AI_Projects\storygraph\__tests__\mcp-tools.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexStorySources } from '../src/indexing/indexer';
import { handleStoryGraphTool, listStoryGraphTools } from '../src/mcp/tools';

const roots: string[] = [];

async function indexedRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-mcp-'));
  roots.push(root);
  await cp(resolve('__tests__/fixtures/cultivation-world'), root, { recursive: true });
  indexStorySources(root, { sourceDir: 'docs/世界观参考', work: '一念永恒' });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('mcp tools', () => {
  it('lists storygraph tools', () => {
    expect(listStoryGraphTools().map((tool) => tool.name)).toEqual([
      'storygraph_status',
      'storygraph_search',
      'storygraph_entity',
      'storygraph_timeline',
      'storygraph_evidence'
    ]);
  });

  it('handles search tool calls', async () => {
    const root = await indexedRoot();
    const result = await handleStoryGraphTool('storygraph_search', { projectRoot: root, query: '白小纯', work: '一念永恒' });
    expect(result.content[0].text).toContain('白小纯');
  });
});
```

- [ ] **Step 2: Run MCP tests to verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/mcp-tools.test.ts
```

Expected: failure mentions missing MCP modules.

- [ ] **Step 3: Implement MCP tool handlers**

Create `E:\AI_Projects\storygraph\src\mcp\tools.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';
import { getEvidence } from '../query/evidence.js';
import { getEntityCard } from '../query/entity.js';
import { searchStoryGraph } from '../query/search.js';
import { getTimeline } from '../query/timeline.js';

type JsonObject = Record<string, unknown>;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

const PROJECT_ROOT = {
  type: 'string',
  description: 'Absolute project root containing .storygraph or docs/世界观参考'
};

export function listStoryGraphTools(): McpToolDef[] {
  return [
    {
      name: 'storygraph_status',
      description: 'Show StoryGraph index status.',
      inputSchema: { type: 'object', properties: { projectRoot: PROJECT_ROOT }, required: ['projectRoot'] }
    },
    {
      name: 'storygraph_search',
      description: 'Search story entities, events, concepts, and evidence summaries.',
      inputSchema: { type: 'object', properties: { projectRoot: PROJECT_ROOT, query: { type: 'string' }, work: { type: 'string' } }, required: ['projectRoot', 'query'] }
    },
    {
      name: 'storygraph_entity',
      description: 'Return an entity card with evidence anchors.',
      inputSchema: { type: 'object', properties: { projectRoot: PROJECT_ROOT, name: { type: 'string' }, work: { type: 'string' } }, required: ['projectRoot', 'name'] }
    },
    {
      name: 'storygraph_timeline',
      description: 'Return timeline entries for a character.',
      inputSchema: { type: 'object', properties: { projectRoot: PROJECT_ROOT, character: { type: 'string' }, work: { type: 'string' } }, required: ['projectRoot', 'character'] }
    },
    {
      name: 'storygraph_evidence',
      description: 'Return evidence anchors for a query.',
      inputSchema: { type: 'object', properties: { projectRoot: PROJECT_ROOT, query: { type: 'string' }, work: { type: 'string' } }, required: ['projectRoot', 'query'] }
    }
  ];
}

function text(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function requireString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing string argument: ${key}`);
  return value;
}

export async function handleStoryGraphTool(name: string, args: JsonObject): Promise<McpToolResult> {
  const projectRoot = requireString(args, 'projectRoot');
  const work = typeof args.work === 'string' ? args.work : undefined;
  if (name === 'storygraph_status') {
    const db = DatabaseConnection.open(projectRoot);
    const stats = new StoryGraphQueries(db).getStats();
    db.close();
    return text(stats);
  }
  if (name === 'storygraph_search') return text(searchStoryGraph(projectRoot, requireString(args, 'query'), { work }));
  if (name === 'storygraph_entity') return text(getEntityCard(projectRoot, requireString(args, 'name'), { work }));
  if (name === 'storygraph_timeline') return text(getTimeline(projectRoot, { character: requireString(args, 'character'), work }));
  if (name === 'storygraph_evidence') return text(getEvidence(projectRoot, requireString(args, 'query'), { work }));
  throw new Error(`Unknown StoryGraph tool: ${name}`);
}
```

- [ ] **Step 4: Implement MCP stdio server**

Create `E:\AI_Projects\storygraph\src\mcp\server.ts`:

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleStoryGraphTool, listStoryGraphTools } from './tools.js';

const server = new Server(
  { name: 'storygraph', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: listStoryGraphTools()
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleStoryGraphTool(request.params.name, request.params.arguments ?? {});
});

await server.connect(new StdioServerTransport());
```

Modify `E:\AI_Projects\storygraph\package.json` bin field:

```json
{
  "bin": {
    "storygraph": "./dist/cli.js",
    "storygraph-mcp": "./dist/mcp/server.js"
  }
}
```

Modify `E:\AI_Projects\storygraph\package.json` build script:

```json
{
  "build": "tsc && node -e \"const fs=require('fs');fs.mkdirSync('dist/src/db',{recursive:true});fs.copyFileSync('src/db/schema.sql','dist/src/db/schema.sql');fs.chmodSync('dist/src/cli.js',0o755);fs.copyFileSync('dist/src/cli.js','dist/cli.js');fs.mkdirSync('dist/mcp',{recursive:true});fs.copyFileSync('dist/src/mcp/server.js','dist/mcp/server.js')\""
}
```

Keep every other `package.json` field unchanged.

- [ ] **Step 5: Run MCP tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/mcp-tools.test.ts
npm run build
```

Expected: MCP tests pass and build succeeds.

- [ ] **Step 6: Commit MCP surface**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "feat: expose storygraph mcp tools"
```

Expected: commit succeeds.

---

### Task 9: CultivationWorld Trial Index and Documentation

**Files:**
- Modify: `E:\AI_Projects\storygraph\README.md`
- Modify: `E:\AI_Projects\CultivationWorld\docs\README.md`
- Test: real CLI smoke commands against `E:\AI_Projects\CultivationWorld`

- [ ] **Step 1: Add real-project usage to StoryGraph README**

Append this section to `E:\AI_Projects\storygraph\README.md`:

```md
## CultivationWorld MVP Trial

Use one work first:

```powershell
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
chcp 65001 > $null

Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm run build
node dist/cli.js init 'E:\AI_Projects\CultivationWorld'
node dist/cli.js index 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒'
node dist/cli.js status 'E:\AI_Projects\CultivationWorld' --json
node dist/cli.js search 'E:\AI_Projects\CultivationWorld' '白小纯' --work '一念永恒'
node dist/cli.js entity 'E:\AI_Projects\CultivationWorld' '白小纯' --work '一念永恒'
node dist/cli.js timeline 'E:\AI_Projects\CultivationWorld' --character '白小纯' --work '一念永恒'
```

The `.storygraph/storygraph.db` file is generated data. It is an index, not game canon.
```

- [ ] **Step 2: Ensure CultivationWorld ignores generated StoryGraph index**

Modify `E:\AI_Projects\CultivationWorld\.gitignore` by adding:

```gitignore
.storygraph/
```

Expected: future trial indexing does not add generated SQLite files to git status.

- [ ] **Step 3: Update CultivationWorld docs navigation**

Modify `E:\AI_Projects\CultivationWorld\docs\README.md` key documents table so it includes both StoryGraph documents:

```md
| StoryGraph 小说图谱设计 | `superpowers/specs/2026-06-05-StoryGraph小说图谱设计.md` |
| StoryGraph 小说图谱 MVP 实施计划 | `superpowers/plans/2026-06-05-StoryGraph小说图谱MVP实施计划.md` |
```

- [ ] **Step 4: Run full StoryGraph tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test
npm run build
```

Expected: all tests pass and build succeeds.

- [ ] **Step 5: Run CultivationWorld trial**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
node dist/cli.js init 'E:\AI_Projects\CultivationWorld'
node dist/cli.js index 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒'
node dist/cli.js status 'E:\AI_Projects\CultivationWorld' --json
node dist/cli.js search 'E:\AI_Projects\CultivationWorld' '白小纯' --work '一念永恒'
```

Expected:

```text
status JSON reports works >= 1
search output includes 白小纯 when the source corpus contains that name
```

If the real local corpus lacks the trial name or uses different wording, use a known name from `docs\世界观参考\一念永恒\一念永恒.txt` and record the actual query in the final report.

- [ ] **Step 6: Commit docs and ignore rule**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\CultivationWorld'
git status --short -- .gitignore docs/README.md docs/superpowers/specs/2026-06-05-StoryGraph小说图谱设计.md docs/superpowers/plans/2026-06-05-StoryGraph小说图谱MVP实施计划.md
```

Expected: only StoryGraph-related files are in scope for any CultivationWorld commit. Because this workspace already has unrelated dirty changes, do not commit CultivationWorld docs until the user confirms the commit scope.

Run in StoryGraph:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add .
git commit -m "docs: document cultivationworld trial"
```

Expected: StoryGraph docs commit succeeds.

---

## Verification Checklist

- [ ] `E:\AI_Projects\storygraph\npm test` passes.
- [ ] `E:\AI_Projects\storygraph\npm run build` passes.
- [ ] `storygraph init` creates `E:\AI_Projects\CultivationWorld\.storygraph\storygraph.db`.
- [ ] `storygraph status --json` reports nonzero `works`, `sourceFiles`, `chunks`, and `nodes` after trial indexing.
- [ ] `storygraph search` returns structured rows, not raw whole chapters.
- [ ] `storygraph entity` returns evidence anchors with source path and line range.
- [ ] `storygraph timeline` returns ordered chunk titles for a character.
- [ ] MCP handler tests pass without launching a long-running server.
- [ ] `docs/世界观参考/` files are not modified by indexing.
- [ ] `.storygraph/` is ignored by CultivationWorld git.

## Self-Review

### Spec Coverage

- Storage location: Task 1 and Task 2 create `E:\AI_Projects\storygraph`; Task 7 and Task 9 create `.storygraph/storygraph.db` in CultivationWorld.
- Schema: Task 2 defines `works`, `source_files`, `chunks`, `story_nodes`, `story_edges`, `evidence_anchors`, `aliases`, `assertions`, and FTS.
- Scanning and encoding: Task 3 covers source scanning and UTF-8/GB18030 detection.
- Text and Markdown chunking: Task 4 covers chapter headings and Markdown headings.
- Rule extraction: Task 5 creates deterministic MVP extraction with evidence anchors and assertions.
- Query surface: Task 6 covers search, entity card, timeline, and evidence.
- CLI: Task 7 covers init, index, status, search, entity, timeline, and evidence commands.
- MCP: Task 8 covers status, search, entity, timeline, and evidence tools.
- Current project trial: Task 9 covers real indexing against CultivationWorld and generated index ignore rules.

### Quality Check

- Each task lists exact files.
- Each code-changing task includes concrete test, implementation, command, expected result, and commit step.
- Commands use PowerShell-compatible sequencing and `-LiteralPath` where paths are handled by PowerShell.
- No step requires changing `docs/世界观参考/` source files.
- The MVP is useful on its own while leaving full-corpus and advanced extraction for a separate expansion plan.
