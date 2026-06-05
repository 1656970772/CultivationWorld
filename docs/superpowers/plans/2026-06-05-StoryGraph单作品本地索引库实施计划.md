# StoryGraph 单作品本地索引库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `E:\AI_Projects\storygraph` 从项目根目录 `.storygraph/storygraph.db` 迁移为每部作品目录自己的 `.storygraph/storygraph.db`，并让 CLI、TypeScript API 与 MCP 使用同一套定位规则。

**Architecture:** 新增共享路径解析层，先把 `projectRoot + sourceDir + work` 解析为 `workRoot`，再由数据库连接层统一初始化或打开 `workRoot\.storygraph\storygraph.db`。查询面在未显式传入 `work` 时支持从当前目录或最近父目录发现 `.storygraph/storygraph.db`，仅在没有 `work` 且没有当前目录索引时保留项目根目录兼容路径。

**Tech Stack:** TypeScript ESM、Node.js `node:sqlite`、Commander、MCP SDK、Vitest、PowerShell。

---

## 资料来源

- 规格：`E:\AI_Projects\CultivationWorld\docs\superpowers\specs\2026-06-05-StoryGraph单作品本地索引库规格.md`
- 现有设计：`E:\AI_Projects\CultivationWorld\docs\superpowers\specs\2026-06-05-StoryGraph小说图谱设计.md`
- 当前实现：`E:\AI_Projects\storygraph\src\paths.ts`、`E:\AI_Projects\storygraph\src\db\connection.ts`、`E:\AI_Projects\storygraph\src\indexing\indexer.ts`、`E:\AI_Projects\storygraph\src\cli.ts`、`E:\AI_Projects\storygraph\src\mcp\tools.ts`
- 当前测试：`E:\AI_Projects\storygraph\__tests__\db.test.ts`、`E:\AI_Projects\storygraph\__tests__\indexing.test.ts`、`E:\AI_Projects\storygraph\__tests__\query.test.ts`、`E:\AI_Projects\storygraph\__tests__\cli.test.ts`、`E:\AI_Projects\storygraph\__tests__\mcp-tools.test.ts`

## File Structure

- Create: `E:\AI_Projects\storygraph\__tests__\paths.test.ts`
  - 负责验证作品目录 DB 解析、当前目录发现、最近父目录发现、项目根兼容边界。
- Modify: `E:\AI_Projects\storygraph\src\paths.ts`
  - 负责定义默认来源目录、作品根解析、最近 `.storygraph/storygraph.db` 查找、缺失索引错误信息。
- Modify: `E:\AI_Projects\storygraph\src\db\connection.ts`
  - 负责按解析结果初始化或打开 SQLite，不再让 `open` 静默创建空 DB。
- Modify: `E:\AI_Projects\storygraph\src\indexing\indexer.ts`
  - 负责让 `indexStorySources` 写入 `workRoot\.storygraph\storygraph.db`。
- Modify: `E:\AI_Projects\storygraph\src\query\search.ts`
- Modify: `E:\AI_Projects\storygraph\src\query\entity.ts`
- Modify: `E:\AI_Projects\storygraph\src\query\timeline.ts`
- Modify: `E:\AI_Projects\storygraph\src\query\evidence.ts`
  - 负责让查询 API 支持 `sourceDir`、`work`、`cwd`，并使用统一 DB 连接。
- Modify: `E:\AI_Projects\storygraph\src\cli.ts`
  - 负责给 `init/status/search/entity/timeline/evidence` 增加 `--source` 与 `--work` 支持，并把当前工作目录传给查询定位。
- Modify: `E:\AI_Projects\storygraph\src\mcp\tools.ts`
  - 负责让 MCP 工具支持 `sourceDir`、`work`、`cwd`，并使用统一 DB 连接。
- Modify: `E:\AI_Projects\storygraph\README.md`
  - 负责更新 CultivationWorld 试点命令与生成 DB 路径说明。
- Modify: `E:\AI_Projects\storygraph\__tests__\db.test.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\indexing.test.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\query.test.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\cli.test.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\mcp-tools.test.ts`
  - 负责覆盖路径、数据库、索引、查询、CLI 和 MCP 的新行为。

---

### Task 1: 共享路径解析与数据库连接

**Files:**
- Create: `E:\AI_Projects\storygraph\__tests__\paths.test.ts`
- Modify: `E:\AI_Projects\storygraph\src\paths.ts`
- Modify: `E:\AI_Projects\storygraph\src\db\connection.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\db.test.ts`

- [ ] **Step 1: Write failing path resolver tests**

Create `E:\AI_Projects\storygraph\__tests__\paths.test.ts`:

```ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_DIR,
  findNearestStoryGraphRoot,
  getStoryGraphDbPath,
  resolveStoryGraphDbRoot,
  resolveWorkRoot
} from '../src/paths.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdirTempRoot();
  roots.push(root);
  return root;
}

function mkdirTempRoot(): string {
  const id = Math.random().toString(16).slice(2);
  const root = join(tmpdir(), `storygraph-paths-${Date.now()}-${id}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function createDbAt(root: string): string {
  const dbPath = getStoryGraphDbPath(root);
  mkdirSync(join(root, '.storygraph'), { recursive: true });
  writeFileSync(dbPath, '');
  return dbPath;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('StoryGraph DB path resolution', () => {
  it('resolves projectRoot sourceDir work to the work root', () => {
    const root = makeRoot();
    const workRoot = join(root, 'docs', '世界观参考', '一念永恒');

    expect(resolveWorkRoot(root, DEFAULT_SOURCE_DIR, '一念永恒')).toBe(workRoot);
    expect(resolveStoryGraphDbRoot({
      projectRoot: root,
      sourceDir: DEFAULT_SOURCE_DIR,
      work: '一念永恒'
    })).toBe(workRoot);
  });

  it('finds the nearest current-directory StoryGraph DB', () => {
    const root = makeRoot();
    const workRoot = join(root, 'docs', '世界观参考', '一念永恒');
    const nested = join(workRoot, 'chapters', '卷一');
    mkdirSync(nested, { recursive: true });
    createDbAt(workRoot);

    expect(findNearestStoryGraphRoot(nested)).toBe(workRoot);
    expect(resolveStoryGraphDbRoot({ cwd: nested })).toBe(workRoot);
  });

  it('uses the work root instead of the project root when work is provided', () => {
    const root = makeRoot();
    const workRoot = join(root, 'docs', '世界观参考', '一念永恒');
    mkdirSync(workRoot, { recursive: true });
    createDbAt(root);
    createDbAt(workRoot);

    expect(resolveStoryGraphDbRoot({
      projectRoot: root,
      sourceDir: 'docs/世界观参考',
      work: '一念永恒'
    })).toBe(workRoot);
  });

  it('keeps project-root fallback only when work and current DB are absent', () => {
    const root = makeRoot();

    expect(resolveStoryGraphDbRoot({
      projectRoot: root,
      allowProjectRootFallback: true
    })).toBe(root);
    expect(existsSync(getStoryGraphDbPath(root))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new resolver tests and verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/paths.test.ts
```

Expected: FAIL because `DEFAULT_SOURCE_DIR`, `resolveWorkRoot`, `findNearestStoryGraphRoot`, and `resolveStoryGraphDbRoot` are not implemented.

- [ ] **Step 3: Replace `src/paths.ts` with shared path resolution**

Replace `E:\AI_Projects\storygraph\src\paths.ts`:

```ts
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const STORYGRAPH_DIR = '.storygraph';
export const STORYGRAPH_DB = 'storygraph.db';
export const DEFAULT_SOURCE_DIR = 'docs/世界观参考';

export interface StoryGraphDbRootInput {
  projectRoot?: string;
  sourceDir?: string;
  work?: string;
  cwd?: string;
  allowProjectRootFallback?: boolean;
}

export interface StoryGraphDbLocation {
  root: string;
  graphDir: string;
  dbPath: string;
}

export function resolveProjectRoot(projectRoot: string): string {
  return resolve(projectRoot);
}

export function resolveWorkRoot(
  projectRoot: string,
  sourceDir = DEFAULT_SOURCE_DIR,
  work: string
): string {
  const normalizedWork = work.trim();
  if (normalizedWork.length === 0) {
    throw new Error('StoryGraph work must be a non-empty string');
  }

  return resolve(resolveProjectRoot(projectRoot), sourceDir, normalizedWork);
}

export function getStoryGraphDir(root: string): string {
  return resolve(root, STORYGRAPH_DIR);
}

export function getStoryGraphDbPath(root: string): string {
  return resolve(getStoryGraphDir(root), STORYGRAPH_DB);
}

export function ensureStoryGraphDir(root: string): string {
  const dir = getStoryGraphDir(root);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function findNearestStoryGraphRoot(startDir: string): string | undefined {
  let current = resolve(startDir);

  while (true) {
    if (existsSync(getStoryGraphDbPath(current))) return current;

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveStoryGraphDbRoot(input: StoryGraphDbRootInput): string {
  if (input.work !== undefined) {
    if (input.projectRoot === undefined) {
      throw new Error('StoryGraph projectRoot is required when work is provided');
    }

    return resolveWorkRoot(input.projectRoot, input.sourceDir ?? DEFAULT_SOURCE_DIR, input.work);
  }

  if (input.cwd !== undefined) {
    const discoveredRoot = findNearestStoryGraphRoot(input.cwd);
    if (discoveredRoot !== undefined) return discoveredRoot;
  }

  if (input.projectRoot !== undefined && input.allowProjectRootFallback === true) {
    return resolveProjectRoot(input.projectRoot);
  }

  throw new Error(
    'StoryGraph index not found. Provide work/sourceDir/projectRoot or run from a directory containing .storygraph/storygraph.db.'
  );
}

export function resolveStoryGraphDbLocation(input: StoryGraphDbRootInput): StoryGraphDbLocation {
  const root = resolveStoryGraphDbRoot(input);
  return {
    root,
    graphDir: getStoryGraphDir(root),
    dbPath: getStoryGraphDbPath(root)
  };
}

export function formatMissingStoryGraphIndex(input: StoryGraphDbRootInput, dbPath: string): string {
  if (input.work !== undefined && input.projectRoot !== undefined) {
    const sourceDir = input.sourceDir ?? DEFAULT_SOURCE_DIR;
    return [
      `StoryGraph index not found for work: ${input.work}`,
      `Expected: ${dbPath}`,
      `Run: storygraph index ${resolveProjectRoot(input.projectRoot)} --source ${sourceDir} --work ${input.work}`
    ].join('\n');
  }

  return [
    'StoryGraph index not found',
    `Expected: ${dbPath}`,
    'Run storygraph index with --source and --work, or run the query from an indexed work directory.'
  ].join('\n');
}
```

- [ ] **Step 4: Replace `src/db/connection.ts` so `open` requires an existing DB**

Replace `E:\AI_Projects\storygraph\src\db\connection.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import {
  ensureStoryGraphDir,
  formatMissingStoryGraphIndex,
  resolveStoryGraphDbLocation,
  type StoryGraphDbRootInput
} from '../paths.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export type DatabaseLocationOptions = Omit<StoryGraphDbRootInput, 'projectRoot'>;

function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'schema.sql');
}

function locationInput(projectRoot: string, options: DatabaseLocationOptions): StoryGraphDbRootInput {
  return {
    projectRoot,
    sourceDir: options.sourceDir,
    work: options.work,
    cwd: options.cwd,
    allowProjectRootFallback: options.allowProjectRootFallback ?? true
  };
}

export class DatabaseConnection {
  static initialize(projectRoot: string, options: DatabaseLocationOptions = {}): DatabaseSyncType {
    const input = locationInput(projectRoot, options);
    const location = resolveStoryGraphDbLocation(input);
    ensureStoryGraphDir(location.root);

    const db = new DatabaseSync(location.dbPath);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(readFileSync(schemaPath(), 'utf8'));
    return db;
  }

  static open(projectRoot: string, options: DatabaseLocationOptions = {}): DatabaseSyncType {
    const input = locationInput(projectRoot, options);
    const location = resolveStoryGraphDbLocation(input);

    if (!existsSync(location.dbPath)) {
      throw new Error(formatMissingStoryGraphIndex(input, location.dbPath));
    }

    const db = new DatabaseSync(location.dbPath);
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  }
}
```

- [ ] **Step 5: Add database tests for work-local initialization and missing-index errors**

Append these tests inside `describe('database foundation', ...)` in `E:\AI_Projects\storygraph\__tests__\db.test.ts` after the existing path test:

```ts
  it('initializes a work-local StoryGraph database when work is provided', () => {
    const root = makeRoot();
    const workRoot = join(root, 'docs', '世界观参考', '一念永恒');
    const db = DatabaseConnection.initialize(root, {
      sourceDir: 'docs/世界观参考',
      work: '一念永恒'
    });

    db.close();

    expect(getStoryGraphDbPath(workRoot)).toBe(join(workRoot, '.storygraph', 'storygraph.db'));
    expect(existsSync(getStoryGraphDbPath(workRoot))).toBe(true);
    expect(existsSync(getStoryGraphDbPath(root))).toBe(false);
  });

  it('does not create an empty database when opening a missing work-local index', () => {
    const root = makeRoot();
    const workRoot = join(root, 'docs', '世界观参考', '一念永恒');

    expect(() =>
      DatabaseConnection.open(root, {
        sourceDir: 'docs/世界观参考',
        work: '一念永恒'
      })
    ).toThrow('StoryGraph index not found for work: 一念永恒');
    expect(existsSync(getStoryGraphDbPath(workRoot))).toBe(false);
  });
```

Also update the imports at the top of `db.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
```

- [ ] **Step 6: Run resolver and database tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/paths.test.ts __tests__/db.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add src/paths.ts src/db/connection.ts __tests__/paths.test.ts __tests__/db.test.ts
git commit -m "feat: resolve storygraph work-local db paths"
```

Expected: commit succeeds and includes only Task 1 files.

---

### Task 2: 索引器与查询 API 迁移

**Files:**
- Modify: `E:\AI_Projects\storygraph\src\indexing\indexer.ts`
- Modify: `E:\AI_Projects\storygraph\src\query\search.ts`
- Modify: `E:\AI_Projects\storygraph\src\query\entity.ts`
- Modify: `E:\AI_Projects\storygraph\src\query\timeline.ts`
- Modify: `E:\AI_Projects\storygraph\src\query\evidence.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\indexing.test.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\query.test.ts`

- [ ] **Step 1: Replace indexing tests with work-local DB assertions**

Replace `E:\AI_Projects\storygraph\__tests__\indexing.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseConnection } from '../src/db/connection.js';
import { StoryGraphQueries } from '../src/db/queries.js';
import { indexStorySources } from '../src/indexing/indexer.js';
import { getStoryGraphDbPath } from '../src/paths.js';

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
  it('indexes one selected work into that work directory database', async () => {
    const root = await copyFixture();
    const workRoot = join(root, 'docs', '世界观参考', '一念永恒');
    const result = indexStorySources(root, { sourceDir: 'docs/世界观参考', work: '一念永恒' });

    expect(result.indexedWorks).toEqual(['一念永恒']);
    expect(result.indexedFiles).toBe(2);
    expect(result.indexedChunks).toBeGreaterThanOrEqual(4);
    expect(existsSync(getStoryGraphDbPath(workRoot))).toBe(true);
    expect(existsSync(getStoryGraphDbPath(root))).toBe(false);

    const db = DatabaseConnection.open(root, {
      sourceDir: 'docs/世界观参考',
      work: '一念永恒'
    });
    try {
      const queries = new StoryGraphQueries(db);
      const stats = queries.getStats();
      expect(stats.works).toBe(1);
      expect(stats.sourceFiles).toBe(2);
      expect(stats.chunks).toBeGreaterThanOrEqual(4);
      expect(stats.nodes).toBeGreaterThanOrEqual(5);
      expect(stats.edges).toBeGreaterThanOrEqual(3);
      expect(stats.evidenceAnchors).toBeGreaterThanOrEqual(3);
      expect(stats.assertions).toBeGreaterThanOrEqual(3);

      const node = db
        .prepare('SELECT name, kind FROM story_nodes WHERE work_id = ? AND name = ?')
        .get('work_e4b880e5bfb5e6b0b8e68192', '白小纯') as { name: string; kind: string } | undefined;
      expect(node).toEqual({ name: '白小纯', kind: 'character' });
    } finally {
      db.close();
    }
  });

  it('requires a single work for MVP indexing', async () => {
    const root = await copyFixture();
    expect(() => indexStorySources(root, { sourceDir: 'docs/世界观参考' })).toThrow(
      'StoryGraph MVP indexing requires --work'
    );
  });
});
```

- [ ] **Step 2: Replace query tests so all explicit work queries read the work-local DB**

Replace `E:\AI_Projects\storygraph\__tests__\query.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexStorySources } from '../src/indexing/indexer.js';
import { searchStoryGraph } from '../src/query/search.js';
import { getEntityCard } from '../src/query/entity.js';
import { getTimeline } from '../src/query/timeline.js';
import { getEvidence } from '../src/query/evidence.js';

const roots: string[] = [];
const sourceDir = 'docs/世界观参考';
const work = '一念永恒';

async function indexedRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-query-'));
  roots.push(root);
  await cp(resolve('__tests__/fixtures/cultivation-world'), root, { recursive: true });
  indexStorySources(root, { sourceDir, work });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('query surface', () => {
  it('searches story nodes from the selected work DB', async () => {
    const root = await indexedRoot();
    const results = searchStoryGraph(root, '白小纯', { sourceDir, work });
    expect(results[0].name).toBe('白小纯');
    expect(results.map((result) => result.name)).not.toContain('与白小纯');
  });

  it('discovers a work DB from the current directory when work is omitted', async () => {
    const root = await indexedRoot();
    const nested = join(root, sourceDir, work, 'notes', 'deep');
    mkdirSync(nested, { recursive: true });

    const results = searchStoryGraph(root, '白小纯', { cwd: nested });

    expect(results[0].name).toBe('白小纯');
  });

  it('builds an entity card with evidence', async () => {
    const root = await indexedRoot();
    const card = getEntityCard(root, '白小纯', { sourceDir, work });
    expect(card?.name).toBe('白小纯');
    expect(card?.evidence.length).toBeGreaterThan(0);
  });

  it('returns timeline entries for an entity', async () => {
    const root = await indexedRoot();
    const timeline = getTimeline(root, { character: '白小纯', sourceDir, work });
    expect(timeline.entries.length).toBeGreaterThan(0);
    expect(timeline.entries.length).toBeLessThanOrEqual(50);
    expect(timeline.entries[0].title).toContain('第一章');
    expect(timeline.entries[0].sourcePath).toContain('一念永恒.txt');
  });

  it('paginates timeline entries instead of hiding later entries', async () => {
    const root = await indexedRoot();
    const firstPage = getTimeline(root, { character: '白小纯', sourceDir, work, limit: 1 });
    const secondPage = getTimeline(root, {
      character: '白小纯',
      sourceDir,
      work,
      limit: 1,
      offset: 1
    });
    const allEntries = getTimeline(root, { character: '白小纯', sourceDir, work, limit: 0 });

    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.total).toBeGreaterThan(1);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.offset).toBe(1);
    expect(secondPage.entries[0].title).not.toBe(firstPage.entries[0].title);
    expect(allEntries.entries).toHaveLength(allEntries.total);
    expect(allEntries.hasMore).toBe(false);
  });

  it('returns evidence anchors for a concept', async () => {
    const root = await indexedRoot();
    const evidence = getEvidence(root, '灵溪宗', { sourceDir, work });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].quote).toContain('灵溪宗');
  });

  it('falls back to chunk evidence for terms that are not entity nodes', async () => {
    const root = await indexedRoot();
    const evidence = getEvidence(root, '来到', { sourceDir, work });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].quote).toContain('来到');
  });
});
```

- [ ] **Step 3: Run indexing and query tests and verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/indexing.test.ts __tests__/query.test.ts
```

Expected: FAIL because index and query still open the project root DB.

- [ ] **Step 4: Update `indexStorySources` to initialize the work-local DB**

In `E:\AI_Projects\storygraph\src\indexing\indexer.ts`, replace the beginning of `indexStorySources` through the `scanStorySources` call with:

```ts
export function indexStorySources(projectRoot: string, options: IndexOptions = {}): IndexResult {
  if (options.work === undefined) {
    throw new Error('StoryGraph MVP indexing requires --work');
  }

  const sourceDir = options.sourceDir ?? 'docs/世界观参考';
  const db = DatabaseConnection.initialize(projectRoot, {
    sourceDir,
    work: options.work
  });

  try {
    const queries = new StoryGraphQueries(db);
    const scan = scanStorySources(projectRoot, sourceDir, {
      work: options.work
    });
```

- [ ] **Step 5: Replace query API files with sourceDir/work/cwd-aware variants**

Replace `E:\AI_Projects\storygraph\src\query\search.ts`:

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

export interface StoryGraphQueryOptions {
  sourceDir?: string;
  work?: string;
  cwd?: string;
}

export function searchStoryGraph(
  projectRoot: string,
  query: string,
  options: StoryGraphQueryOptions = {}
): SearchResult[] {
  const db = DatabaseConnection.open(projectRoot, {
    sourceDir: options.sourceDir,
    work: options.work,
    cwd: options.cwd
  });

  try {
    const queries = new StoryGraphQueries(db);
    return queries.searchNodes(query, options.work);
  } finally {
    db.close();
  }
}
```

Replace `E:\AI_Projects\storygraph\src\query\entity.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';
import type { StoryGraphQueryOptions } from './search.js';

export interface EntityEvidence {
  id: string;
  quote: string;
  note: string;
  sourceType: string;
  sourcePath: string;
  lineStart: number;
  lineEnd: number;
}

export interface EntityCard {
  id: string;
  name: string;
  kind: string;
  summary: string;
  evidence: EntityEvidence[];
}

export function getEntityCard(
  projectRoot: string,
  name: string,
  options: StoryGraphQueryOptions = {}
): EntityCard | null {
  const db = DatabaseConnection.open(projectRoot, {
    sourceDir: options.sourceDir,
    work: options.work,
    cwd: options.cwd
  });

  try {
    const queries = new StoryGraphQueries(db);
    const node = queries.getNodeByName(name, options.work);
    if (node === null) return null;

    return {
      id: node.id,
      name: node.name,
      kind: node.kind,
      summary: node.summary,
      evidence: queries.getEvidenceForNode(node.id)
    };
  } finally {
    db.close();
  }
}
```

Replace `E:\AI_Projects\storygraph\src\query\timeline.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';
import type { StoryGraphQueryOptions } from './search.js';

const DEFAULT_TIMELINE_LIMIT = 50;

export interface TimelineEntry {
  title: string;
  summary: string;
  lineStart: number;
  sourcePath: string;
  quote: string;
}

export interface TimelineResult {
  subject: string;
  entries: TimelineEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TimelineOptions extends StoryGraphQueryOptions {
  character: string;
  limit?: number;
  offset?: number;
}

export function getTimeline(projectRoot: string, options: TimelineOptions): TimelineResult {
  const db = DatabaseConnection.open(projectRoot, {
    sourceDir: options.sourceDir,
    work: options.work,
    cwd: options.cwd
  });
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);

  try {
    const queries = new StoryGraphQueries(db);
    const node = queries.getNodeByName(options.character, options.work);
    if (node === null) {
      return { subject: options.character, entries: [], total: 0, limit, offset, hasMore: false };
    }

    const total = queries.countTimelineForNode(node.id);
    const entries = queries.getTimelineForNode(node.id, { limit, offset });

    return {
      subject: node.name,
      entries,
      total,
      limit,
      offset,
      hasMore: limit > 0 && offset + entries.length < total
    };
  } finally {
    db.close();
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMELINE_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_TIMELINE_LIMIT;
  return Math.max(0, Math.floor(value));
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
```

Replace `E:\AI_Projects\storygraph\src\query\evidence.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';
import type { StoryGraphQueryOptions } from './search.js';

export interface EvidenceResult {
  quote: string;
  note: string;
  sourceType: string;
  sourcePath: string;
  lineStart: number;
  lineEnd: number;
}

export function getEvidence(
  projectRoot: string,
  query: string,
  options: StoryGraphQueryOptions = {}
): EvidenceResult[] {
  const db = DatabaseConnection.open(projectRoot, {
    sourceDir: options.sourceDir,
    work: options.work,
    cwd: options.cwd
  });

  try {
    const queries = new StoryGraphQueries(db);
    const node = queries.getNodeByName(query, options.work);
    const evidence = node === null ? [] : queries.getEvidenceForNode(node.id);
    const rows = evidence.length > 0 ? evidence : queries.searchEvidence(query, options.work);

    return rows.map(({ quote, note, sourceType, sourcePath, lineStart, lineEnd }) => ({
      quote,
      note,
      sourceType,
      sourcePath,
      lineStart,
      lineEnd
    }));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 6: Run indexing and query tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/indexing.test.ts __tests__/query.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add src/indexing/indexer.ts src/query/search.ts src/query/entity.ts src/query/timeline.ts src/query/evidence.ts __tests__/indexing.test.ts __tests__/query.test.ts
git commit -m "feat: query storygraph work-local indexes"
```

Expected: commit succeeds and includes only Task 2 files.

---

### Task 3: CLI 迁移

**Files:**
- Modify: `E:\AI_Projects\storygraph\src\cli.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\cli.test.ts`

- [ ] **Step 1: Replace CLI tests with work-local command expectations**

Replace `E:\AI_Projects\storygraph\__tests__\cli.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const roots: string[] = [];
let cliRoot = '';
const sourceDir = 'docs/世界观参考';
const work = '一念永恒';

async function copyFixture(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-cli-'));
  roots.push(root);
  await cp(resolve('__tests__/fixtures/cultivation-world'), root, { recursive: true });
  return root;
}

function workDbPath(root: string): string {
  return join(root, 'docs', '世界观参考', '一念永恒', '.storygraph', 'storygraph.db');
}

beforeAll(() => {
  const cacheRoot = resolve('node_modules/.cache');
  mkdirSync(cacheRoot, { recursive: true });
  cliRoot = mkdtempSync(join(cacheRoot, 'storygraph-cli-'));
  const distRoot = join(cliRoot, 'dist');

  execFileSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--outDir', distRoot],
    { encoding: 'utf8' }
  );
  mkdirSync(join(distRoot, 'src/db'), { recursive: true });
  copyFileSync(resolve('src/db/schema.sql'), join(distRoot, 'src/db/schema.sql'));
  copyFileSync(join(distRoot, 'src/cli.js'), join(distRoot, 'cli.js'));
  chmodSync(join(distRoot, 'cli.js'), 0o755);
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  if (cliRoot !== '') rmSync(cliRoot, { recursive: true, force: true });
});

describe('cli', () => {
  it('initializes, indexes, and searches from the selected work directory DB', async () => {
    const root = await copyFixture();
    execFileSync('node', ['dist/cli.js', 'init', root, '--source', sourceDir, '--work', work], {
      cwd: cliRoot,
      encoding: 'utf8'
    });
    execFileSync('node', ['dist/cli.js', 'index', root, '--source', sourceDir, '--work', work], {
      cwd: cliRoot,
      encoding: 'utf8'
    });

    expect(existsSync(workDbPath(root))).toBe(true);
    expect(existsSync(join(root, '.storygraph', 'storygraph.db'))).toBe(false);

    const output = execFileSync(
      'node',
      ['dist/cli.js', 'search', root, '白小纯', '--source', sourceDir, '--work', work],
      { cwd: cliRoot, encoding: 'utf8' }
    );
    expect(output).toContain('白小纯');
  });

  it('reports status as JSON for a work-local DB', async () => {
    const root = await copyFixture();
    execFileSync('node', ['dist/cli.js', 'index', root, '--source', sourceDir, '--work', work], {
      cwd: cliRoot,
      encoding: 'utf8'
    });

    const output = execFileSync(
      'node',
      ['dist/cli.js', 'status', root, '--source', sourceDir, '--work', work, '--json'],
      { cwd: cliRoot, encoding: 'utf8' }
    );
    expect(JSON.parse(output)).toMatchObject({ works: 1, sourceFiles: 2 });
  });

  it('discovers the nearest work DB from the command current directory', async () => {
    const root = await copyFixture();
    const nested = join(root, sourceDir, work, 'notes', 'deep');
    mkdirSync(nested, { recursive: true });
    execFileSync('node', ['dist/cli.js', 'index', root, '--source', sourceDir, '--work', work], {
      cwd: cliRoot,
      encoding: 'utf8'
    });

    const output = execFileSync('node', [join(cliRoot, 'dist', 'cli.js'), 'search', root, '白小纯'], {
      cwd: nested,
      encoding: 'utf8'
    });

    expect(output).toContain('白小纯');
  });

  it('paginates timeline output from the command line', async () => {
    const root = await copyFixture();
    execFileSync('node', ['dist/cli.js', 'index', root, '--source', sourceDir, '--work', work], {
      cwd: cliRoot,
      encoding: 'utf8'
    });

    const output = execFileSync(
      'node',
      [
        'dist/cli.js',
        'timeline',
        root,
        '--character',
        '白小纯',
        '--source',
        sourceDir,
        '--work',
        work,
        '--limit',
        '1',
        '--offset',
        '1'
      ],
      { cwd: cliRoot, encoding: 'utf8' }
    );
    const timeline = JSON.parse(output) as { entries: unknown[]; limit: number; offset: number; total: number };

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.limit).toBe(1);
    expect(timeline.offset).toBe(1);
    expect(timeline.total).toBeGreaterThan(1);
  });

  it('surfaces a CLI error when index work is omitted', async () => {
    const root = await copyFixture();
    let stderr = '';

    try {
      execFileSync('node', ['dist/cli.js', 'index', root, '--source', sourceDir], {
        cwd: cliRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr);
    }

    expect(stderr).toContain("required option '--work <work>'");
  });
});
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/cli.test.ts
```

Expected: FAIL because CLI commands do not pass `sourceDir`, `work`, and `cwd` consistently.

- [ ] **Step 3: Replace `src/cli.ts` with work-local command routing**

Replace `E:\AI_Projects\storygraph\src\cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import {
  DEFAULT_SOURCE_DIR,
  DatabaseConnection,
  StoryGraphQueries,
  STORYGRAPH_VERSION,
  getEntityCard,
  getEvidence,
  getTimeline,
  indexStorySources,
  searchStoryGraph
} from './index.js';

const program = new Command();

interface WorkOptions {
  source: string;
  work?: string;
}

program.name('storygraph').version(STORYGRAPH_VERSION).description('StoryGraph CLI');

program
  .command('init')
  .argument('<projectRoot>', 'project root to initialize')
  .option('--source <sourceDir>', 'source directory relative to the project root', DEFAULT_SOURCE_DIR)
  .option('--work <work>', 'work name to initialize')
  .description('Initialize a StoryGraph database')
  .action((projectRoot: string, options: WorkOptions) => {
    const db = DatabaseConnection.initialize(projectRoot, {
      sourceDir: options.source,
      work: options.work
    });
    try {
      console.log('initialized .storygraph/storygraph.db');
    } finally {
      db.close();
    }
  });

program
  .command('index')
  .argument('<projectRoot>', 'project root to index')
  .requiredOption('--source <sourceDir>', 'source directory relative to the project root')
  .requiredOption('--work <work>', 'work name to index')
  .description('Index story source files')
  .action((projectRoot: string, options: Required<WorkOptions>) => {
    const result = indexStorySources(projectRoot, {
      sourceDir: options.source,
      work: options.work
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('status')
  .argument('<projectRoot>', 'project root to inspect')
  .option('--source <sourceDir>', 'source directory relative to the project root', DEFAULT_SOURCE_DIR)
  .option('--work <work>', 'work name to inspect')
  .option('--json', 'print JSON output')
  .description('Print StoryGraph database statistics')
  .action((projectRoot: string, options: WorkOptions & { json?: boolean }) => {
    const db = DatabaseConnection.open(projectRoot, {
      sourceDir: options.source,
      work: options.work,
      cwd: process.cwd()
    });
    try {
      const queries = new StoryGraphQueries(db);
      const stats = queries.getStats();
      if (options.json === true) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(
        `works=${stats.works} files=${stats.sourceFiles} nodes=${stats.nodes} edges=${stats.edges}`
      );
    } finally {
      db.close();
    }
  });

program
  .command('search')
  .argument('<projectRoot>', 'project root to search')
  .argument('<query>', 'search query')
  .option('--source <sourceDir>', 'source directory relative to the project root', DEFAULT_SOURCE_DIR)
  .option('--work <work>', 'work name to search')
  .description('Search StoryGraph nodes')
  .action((projectRoot: string, query: string, options: WorkOptions) => {
    const results = searchStoryGraph(projectRoot, query, {
      sourceDir: options.source,
      work: options.work,
      cwd: process.cwd()
    });
    const lines = results.map((result) => [result.kind, result.name, result.summary].join('\t'));
    if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  });

program
  .command('entity')
  .argument('<projectRoot>', 'project root to inspect')
  .argument('<name>', 'entity name')
  .option('--source <sourceDir>', 'source directory relative to the project root', DEFAULT_SOURCE_DIR)
  .option('--work <work>', 'work name to inspect')
  .description('Print an entity card')
  .action((projectRoot: string, name: string, options: WorkOptions) => {
    const card = getEntityCard(projectRoot, name, {
      sourceDir: options.source,
      work: options.work,
      cwd: process.cwd()
    });
    console.log(JSON.stringify(card, null, 2));
  });

program
  .command('timeline')
  .argument('<projectRoot>', 'project root to inspect')
  .requiredOption('--character <character>', 'character name')
  .option('--source <sourceDir>', 'source directory relative to the project root', DEFAULT_SOURCE_DIR)
  .option('--work <work>', 'work name to inspect')
  .option('--limit <limit>', 'maximum timeline entries to print; use 0 for all', parseNonNegativeInt, 50)
  .option('--offset <offset>', 'timeline entry offset for pagination', parseNonNegativeInt, 0)
  .option('--all', 'print all timeline entries')
  .description('Print a character timeline')
  .action((projectRoot: string, options: WorkOptions & {
    character: string;
    limit: number;
    offset: number;
    all?: boolean;
  }) => {
    const timeline = getTimeline(projectRoot, {
      character: options.character,
      sourceDir: options.source,
      work: options.work,
      cwd: process.cwd(),
      limit: options.all === true ? 0 : options.limit,
      offset: options.offset
    });
    console.log(JSON.stringify(timeline, null, 2));
  });

program
  .command('evidence')
  .argument('<projectRoot>', 'project root to inspect')
  .argument('<query>', 'entity or concept query')
  .option('--source <sourceDir>', 'source directory relative to the project root', DEFAULT_SOURCE_DIR)
  .option('--work <work>', 'work name to inspect')
  .description('Print evidence anchors')
  .action((projectRoot: string, query: string, options: WorkOptions) => {
    const evidence = getEvidence(projectRoot, query, {
      sourceDir: options.source,
      work: options.work,
      cwd: process.cwd()
    });
    console.log(JSON.stringify(evidence, null, 2));
  });

program.parse();

function parseNonNegativeInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got: ${value}`);
  }
  return parsed;
}
```

- [ ] **Step 4: Run CLI tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add src/cli.ts __tests__/cli.test.ts
git commit -m "feat: route storygraph cli to work-local indexes"
```

Expected: commit succeeds and includes only Task 3 files.

---

### Task 4: MCP 工具迁移

**Files:**
- Modify: `E:\AI_Projects\storygraph\src\mcp\tools.ts`
- Modify: `E:\AI_Projects\storygraph\__tests__\mcp-tools.test.ts`

- [ ] **Step 1: Replace MCP tests with sourceDir/work-aware expectations**

Replace `E:\AI_Projects\storygraph\__tests__\mcp-tools.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexStorySources } from '../src/indexing/indexer.js';
import { handleStoryGraphTool, listStoryGraphTools } from '../src/mcp/tools.js';

const roots: string[] = [];
const sourceDir = 'docs/世界观参考';
const work = '一念永恒';

async function indexedRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'storygraph-mcp-'));
  roots.push(root);
  await cp(resolve('__tests__/fixtures/cultivation-world'), root, { recursive: true });
  indexStorySources(root, { sourceDir, work });
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

  it('exposes sourceDir and work on query schemas', () => {
    const searchTool = listStoryGraphTools().find((tool) => tool.name === 'storygraph_search');

    expect(searchTool?.inputSchema.properties).toHaveProperty('sourceDir');
    expect(searchTool?.inputSchema.properties).toHaveProperty('work');
  });

  it('handles status tool calls for a work-local DB', async () => {
    const root = await indexedRoot();
    const result = await handleStoryGraphTool('storygraph_status', {
      projectRoot: root,
      sourceDir,
      work
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      works: 1,
      sourceFiles: 2
    });
  });

  it('handles search tool calls for a work-local DB', async () => {
    const root = await indexedRoot();
    const result = await handleStoryGraphTool('storygraph_search', {
      projectRoot: root,
      sourceDir,
      query: '白小纯',
      work
    });
    expect(result.content[0].text).toContain('白小纯');
  });
});
```

- [ ] **Step 2: Run MCP tests and verify they fail**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/mcp-tools.test.ts
```

Expected: FAIL because MCP schemas and handlers do not pass `sourceDir`.

- [ ] **Step 3: Replace `src/mcp/tools.ts`**

Replace `E:\AI_Projects\storygraph\src\mcp\tools.ts`:

```ts
import { DatabaseConnection } from '../db/connection.js';
import { StoryGraphQueries } from '../db/queries.js';
import { DEFAULT_SOURCE_DIR } from '../paths.js';
import { getEntityCard } from '../query/entity.js';
import { getEvidence } from '../query/evidence.js';
import { searchStoryGraph, type StoryGraphQueryOptions } from '../query/search.js';
import { getTimeline } from '../query/timeline.js';

interface JsonObjectSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

const stringSchema = { type: 'string' } as const;
const nonNegativeIntegerSchema = { type: 'integer', minimum: 0 } as const;

const commonProperties = {
  projectRoot: {
    ...stringSchema,
    description: 'Absolute path to the project root containing the story source directory.'
  },
  sourceDir: {
    ...stringSchema,
    description: `Source directory relative to projectRoot. Defaults to ${DEFAULT_SOURCE_DIR}.`
  },
  work: {
    ...stringSchema,
    description: 'Optional single work name to constrain the query.'
  },
  cwd: {
    ...stringSchema,
    description: 'Optional current directory used to discover the nearest .storygraph/storygraph.db.'
  }
} satisfies Record<string, unknown>;

const tools: McpToolDef[] = [
  {
    name: 'storygraph_status',
    description: 'Return StoryGraph database statistics for one project or work.',
    inputSchema: schema({
      properties: {
        projectRoot: commonProperties.projectRoot,
        sourceDir: commonProperties.sourceDir,
        work: commonProperties.work,
        cwd: commonProperties.cwd
      },
      required: ['projectRoot']
    })
  },
  {
    name: 'storygraph_search',
    description: 'Search indexed StoryGraph entities and concepts in one work.',
    inputSchema: schema({
      properties: {
        projectRoot: commonProperties.projectRoot,
        sourceDir: commonProperties.sourceDir,
        query: {
          ...stringSchema,
          description: 'Entity, concept, or keyword to search for.'
        },
        work: commonProperties.work,
        cwd: commonProperties.cwd
      },
      required: ['projectRoot', 'query']
    })
  },
  {
    name: 'storygraph_entity',
    description: 'Return an entity card with summary and supporting evidence.',
    inputSchema: schema({
      properties: {
        projectRoot: commonProperties.projectRoot,
        sourceDir: commonProperties.sourceDir,
        name: {
          ...stringSchema,
          description: 'Entity name to inspect.'
        },
        work: commonProperties.work,
        cwd: commonProperties.cwd
      },
      required: ['projectRoot', 'name']
    })
  },
  {
    name: 'storygraph_timeline',
    description: 'Return timeline entries for a character in one indexed work.',
    inputSchema: schema({
      properties: {
        projectRoot: commonProperties.projectRoot,
        sourceDir: commonProperties.sourceDir,
        character: {
          ...stringSchema,
          description: 'Character name to build the timeline for.'
        },
        work: commonProperties.work,
        cwd: commonProperties.cwd,
        limit: {
          ...nonNegativeIntegerSchema,
          description: 'Maximum timeline entries to return. Use 0 for all entries.'
        },
        offset: {
          ...nonNegativeIntegerSchema,
          description: 'Timeline entry offset for pagination.'
        }
      },
      required: ['projectRoot', 'character']
    })
  },
  {
    name: 'storygraph_evidence',
    description: 'Return evidence anchors for an entity or concept query.',
    inputSchema: schema({
      properties: {
        projectRoot: commonProperties.projectRoot,
        sourceDir: commonProperties.sourceDir,
        query: {
          ...stringSchema,
          description: 'Entity or concept query to collect evidence for.'
        },
        work: commonProperties.work,
        cwd: commonProperties.cwd
      },
      required: ['projectRoot', 'query']
    })
  }
];

export function listStoryGraphTools(): McpToolDef[] {
  return tools;
}

export async function handleStoryGraphTool(
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const projectRoot = requiredString(args, 'projectRoot');
  const options = locationOptions(args);

  switch (name) {
    case 'storygraph_status':
      return textResult(readStatus(projectRoot, options));

    case 'storygraph_search':
      return textResult(searchStoryGraph(projectRoot, requiredString(args, 'query'), options));

    case 'storygraph_entity':
      return textResult(getEntityCard(projectRoot, requiredString(args, 'name'), options));

    case 'storygraph_timeline':
      return textResult(getTimeline(projectRoot, {
        character: requiredString(args, 'character'),
        sourceDir: options.sourceDir,
        work: options.work,
        cwd: options.cwd,
        limit: optionalNonNegativeInteger(args, 'limit'),
        offset: optionalNonNegativeInteger(args, 'offset')
      }));

    case 'storygraph_evidence':
      return textResult(getEvidence(projectRoot, requiredString(args, 'query'), options));

    default:
      throw new Error(`Unknown StoryGraph tool: ${name}`);
  }
}

function schema(input: {
  properties: Record<string, unknown>;
  required: string[];
}): JsonObjectSchema {
  return {
    type: 'object',
    properties: input.properties,
    required: input.required,
    additionalProperties: false
  };
}

function locationOptions(args: Record<string, unknown>): StoryGraphQueryOptions {
  return {
    sourceDir: optionalString(args, 'sourceDir') ?? DEFAULT_SOURCE_DIR,
    work: optionalString(args, 'work'),
    cwd: optionalString(args, 'cwd')
  };
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing string argument: ${name}`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Missing string argument: ${name}`);
  }
  return value;
}

function optionalNonNegativeInteger(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`Missing non-negative integer argument: ${name}`);
  }
  return numberValue;
}

function readStatus(projectRoot: string, options: StoryGraphQueryOptions): unknown {
  const db = DatabaseConnection.open(projectRoot, options);

  try {
    const queries = new StoryGraphQueries(db);
    return queries.getStats();
  } finally {
    db.close();
  }
}

function textResult(value: unknown): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
```

- [ ] **Step 4: Run MCP tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test -- __tests__/mcp-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add src/mcp/tools.ts __tests__/mcp-tools.test.ts
git commit -m "feat: expose work-local storygraph mcp options"
```

Expected: commit succeeds and includes only Task 4 files.

---

### Task 5: 文档、构建与真实资料验收

**Files:**
- Modify: `E:\AI_Projects\storygraph\README.md`

- [ ] **Step 1: Update README commands and generated DB path**

Replace the `CultivationWorld MVP Trial` section in `E:\AI_Projects\storygraph\README.md` with:

````md
## CultivationWorld MVP Trial

Use one work first. The generated index is stored beside that work:

```powershell
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
chcp 65001 > $null

Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm run build
node dist/cli.js init 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒'
node dist/cli.js index 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒'
node dist/cli.js status 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒' --json
node dist/cli.js search 'E:\AI_Projects\CultivationWorld' '白小纯' --source 'docs\世界观参考' --work '一念永恒'
node dist/cli.js entity 'E:\AI_Projects\CultivationWorld' '白小纯' --source 'docs\世界观参考' --work '一念永恒'
node dist/cli.js timeline 'E:\AI_Projects\CultivationWorld' --character '白小纯' --source 'docs\世界观参考' --work '一念永恒' --limit 50 --offset 0
node dist/cli.js timeline 'E:\AI_Projects\CultivationWorld' --character '白小纯' --source 'docs\世界观参考' --work '一念永恒' --all
node dist/cli.js evidence 'E:\AI_Projects\CultivationWorld' '夺舍' --source 'docs\世界观参考' --work '一念永恒'
```

Expected generated DB:

```text
E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph\storygraph.db
```

The `.storygraph/storygraph.db` file is generated data. It is an index, not game canon.
Timeline output is paginated by default for readability; use `--offset` for later pages or `--all` for the full timeline.
````

- [ ] **Step 2: Run all StoryGraph tests**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm test
```

Expected: PASS for all Vitest suites.

- [ ] **Step 3: Run TypeScript build**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
npm run build
```

Expected: PASS and `dist\cli.js` plus `dist\mcp\server.js` exist.

- [ ] **Step 4: Run real CultivationWorld indexing acceptance**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
node dist\cli.js index 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒'
node dist\cli.js status 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒' --json
node dist\cli.js timeline 'E:\AI_Projects\CultivationWorld' --source 'docs\世界观参考' --work '一念永恒' --character '白小纯' --all
Test-Path -LiteralPath 'E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph\storygraph.db'
```

Expected:

```text
The index command reports indexedWorks containing 一念永恒.
The status JSON reports "works": 1.
The timeline JSON contains entries for 白小纯.
Test-Path returns True.
```

- [ ] **Step 5: Verify project-root DB was not created for this work**

Run:

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
Test-Path -LiteralPath 'E:\AI_Projects\CultivationWorld\.storygraph\storygraph.db'
```

Expected: False when the project root DB did not already exist before this task. If it returns True because historical generated data already exists, inspect its timestamp and do not delete it automatically.

- [ ] **Step 6: Check git scopes**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git status --short
Set-Location -LiteralPath 'E:\AI_Projects\CultivationWorld'
git status --short
```

Expected:

```text
StoryGraph shows source, test, and README changes already committed or ready to commit.
CultivationWorld does not show tracked generated .storygraph files.
```

- [ ] **Step 7: Commit Task 5**

Run:

```powershell
Set-Location -LiteralPath 'E:\AI_Projects\storygraph'
git add README.md
git commit -m "docs: document storygraph work-local trial"
```

Expected: commit succeeds and includes only `README.md`.

---

## Final Verification

- [ ] `E:\AI_Projects\storygraph\npm test` passes.
- [ ] `E:\AI_Projects\storygraph\npm run build` passes.
- [ ] `node dist\cli.js index E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒` writes `E:\AI_Projects\CultivationWorld\docs\世界观参考\一念永恒\.storygraph\storygraph.db`.
- [ ] `node dist\cli.js status E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒 --json` reports `"works": 1`.
- [ ] `node dist\cli.js search E:\AI_Projects\CultivationWorld 白小纯 --source docs\世界观参考 --work 一念永恒` returns structured search rows.
- [ ] `node dist\cli.js timeline E:\AI_Projects\CultivationWorld --source docs\世界观参考 --work 一念永恒 --character 白小纯 --all` returns timeline entries.
- [ ] `storygraph_status` MCP call with `{ projectRoot, sourceDir, work }` reads the same work-local DB.
- [ ] `storygraph_search` MCP call with `{ projectRoot, sourceDir, work, query }` returns matching entities from the same work-local DB.
- [ ] No new tracked generated DB files appear in `E:\AI_Projects\CultivationWorld`.

## Self-Review

- Spec coverage: 本计划覆盖作品目录 DB、当前目录发现、`--work` 优先、项目根兼容边界、CLI、TypeScript API、MCP、单元测试、集成测试和真实资料验收。
- Placeholder scan: 本计划没有未决占位内容；每个代码步骤都给出具体文件和代码。
- Type consistency: `StoryGraphQueryOptions`、`StoryGraphDbRootInput`、`sourceDir`、`work`、`cwd`、`DatabaseConnection.open/initialize` 在各任务中保持一致。
- Scope check: 本计划只迁移单作品本地索引库定位规则，不实现多作品同库、跨作品比较或抽取算法扩展。
