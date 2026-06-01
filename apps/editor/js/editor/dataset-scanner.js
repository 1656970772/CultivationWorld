/**
 * DatasetScanner —— 自动发现 apps/game/data/ 下的所有 JSON 数据集
 *
 * 设计目标（ADR-031）：
 * 1. 不依赖 schema-registry 硬编码，自动从文件系统发现数据集。
 * 2. 跨平台：核心函数 buildDatasetsFromFileList 接受相对路径列表，
 *    浏览器/File System Access API/Tauri/Rust 各自负责 IO，传入相对路径。
 * 3. 可测试：纯函数，Node/浏览器/测试都能跑。
 *
 * 跳过：路径中任一段在 SKIP_DIR_NAMES。
 * 排序：category 按 CATEGORY_ORDER，relativePath 字母序。
 */
import { createRequire } from 'node:module';
const _nodeRequire = createRequire(import.meta.url);


/** 跳过规则：路径中任一段命中即跳过 */
export const SKIP_DIR_NAMES = new Set([
  'desktop-dist',
  '.snapshots',
  '__pycache__',
  'node_modules',
  '.git',
]);

/** 顶层目录 → 友好分类（用于 UI 分组 + 排序） */
export const CATEGORY_ORDER = [
  'balance',      // 数值平衡（核心调参盘）
  'actions',      // 行为定义
  'config',       // 引擎/AI/世界配置
  'data',         // 静态数据（境界、妖兽等）
  'definitions',  // 老 v1 定义（terrains）
  'entities',     // 老 v1 实体（factions、npcs）
  'world',        // 老 v1 世界（map、modifiers）
  'quests',       // 任务
  'other',        // 兜底
];

/**
 * 把任意斜杠风格的相对路径归一化为 POSIX 风格（用 '/'）。
 * @param {string} relPath
 * @returns {string}
 */
export function normalizeRelPath(relPath) {
  if (!relPath) return '';
  return String(relPath).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * 提取文件名（含后缀）。
 * @param {string} relPath
 */
export function baseName(relPath) {
  const norm = normalizeRelPath(relPath);
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/**
 * 去掉 .json 后缀的文件名。
 * @param {string} relPath
 */
export function baseNameNoExt(relPath) {
  const n = baseName(relPath);
  return n.replace(/\.json$/i, '');
}

/**
 * 给定一个相对路径，推断分类（顶层目录）。
 * @param {string} relPath
 * @returns {string}
 */
export function categorize(relPath) {
  const norm = normalizeRelPath(relPath);
  const top = norm.split('/')[0] || 'other';
  return CATEGORY_ORDER.includes(top) ? top : 'other';
}

/**
 * 给一个数据集 key 推断显示名。
 * 规则：取文件名（去后缀），驼峰/下划线/连字符转空格。
 * @param {string} key 数据集 key（如 'balance/obsession'）
 * @returns {string}
 */
export function defaultLabel(key) {
  const file = baseNameNoExt(key);
  return file
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/**
 * 推断一个数据集是否"大文件"（默认 lazy load，仅展示摘要）。
 * 触发：路径含 'map' 或 size > 500_000。
 * @param {string} relPath
 * @param {number} [size=0]
 */
export function isLargeDataset(relPath, size = 0) {
  const lower = normalizeRelPath(relPath).toLowerCase();
  if (lower.endsWith('/map.json') || lower.endsWith('/tiles.json')) return true;
  if (lower.includes('map.json')) return true;
  return size > 500_000;
}

/**
 * 核心纯函数：把相对路径列表转为数据集元信息。
 *
 * @param {string[]} relPaths POSIX 风格的相对路径（必须以 .json 结尾）
 * @param {Record<string, { size?: number, mtime?: number }>} [metaByRel] 可选的文件元信息
 * @returns {Dataset[]}
 */
export function buildDatasetsFromFileList(relPaths, metaByRel = {}) {
  /** @type {Dataset[]} */
  const out = [];
  for (const rel of relPaths || []) {
    if (!rel || !rel.toLowerCase().endsWith('.json')) continue;
    const norm = normalizeRelPath(rel);
    const segs = norm.split('/');
    if (segs.some(s => SKIP_DIR_NAMES.has(s))) continue;
    // 跳过根目录文件（无分类）
    if (segs.length < 2) continue;
    const key = norm.replace(/\.json$/i, '');
    const meta = metaByRel[norm] || {};
    const category = categorize(norm);
    out.push({
      key,
      relativePath: norm,
      label: defaultLabel(key),
      category,
      fileName: baseName(norm),
      size: meta.size ?? 0,
      mtime: meta.mtime ?? 0,
      isLarge: isLargeDataset(norm, meta.size ?? 0),
      inferred: true,
    });
  }
  const catIndex = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  out.sort((a, b) => {
    const ca = catIndex.get(a.category) ?? 999;
    const cb = catIndex.get(b.category) ?? 999;
    if (ca !== cb) return ca - cb;
    return a.relativePath.localeCompare(b.relativePath);
  });
  return out;
}

/* eslint-disable */
/**
 * Node 专用：递归扫描 rootAbs 下所有 .json，返回 POSIX 相对路径列表。
 * 跳过：.snapshots / desktop-dist / __pycache__ / node_modules / .git / 隐藏目录。
 * Web 端用 File System Access API 自行实现等价函数传入 buildDatasetsFromFileList。
 *
 * @param {string} rootAbs
 * @param {{ skipHidden?: boolean, maxDepth?: number }} [opts]
 * @returns {string[]}
 */
export function scanLocalFilesystem(rootAbs, opts = {}) {
  const { skipHidden = true, maxDepth = 16 } = opts;
  const fs = _nodeRequire('node:fs');
  const path = _nodeRequire('node:path');
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { return; }
    for (const e of entries) {
      const name = e.name;
      if (skipHidden && name.startsWith('.')) continue;
      if (SKIP_DIR_NAMES.has(name)) continue;
      const full = path.join(dir, name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && name.toLowerCase().endsWith('.json')) {
        const rel = path.relative(rootAbs, full).split(path.sep).join('/');
        out.push(rel);
      }
    }
  }
  walk(rootAbs, 0);
  return out;
}

/**
 * Node 专用：读每个相对路径对应文件的 size/mtime。
 * @param {string} rootAbs
 * @param {string[]} relPaths POSIX 相对路径
 * @returns {Record<string, { size: number, mtime: number }>}
 */
export function statAll(rootAbs, relPaths) {
  const fs = _nodeRequire('node:fs');
  const path = _nodeRequire('node:path');
  /** @type {Record<string, { size: number, mtime: number }>} */
  const out = {};
  for (const rel of relPaths) {
    const abs = path.join(rootAbs, ...rel.split('/'));
    try {
      const s = fs.statSync(abs);
      out[rel] = { size: s.size, mtime: Math.floor(s.mtimeMs) };
    } catch (_e) { /* ignore */ }
  }
  return out;
}

/**
 * Node 端一站式：扫描 + 元信息 + 排序。
 * @param {string} rootAbs
 * @returns {Dataset[]}
 */
export function scanDatasets(rootAbs) {
  const files = scanLocalFilesystem(rootAbs);
  const meta = statAll(rootAbs, files);
  return buildDatasetsFromFileList(files, meta);
}
/* eslint-enable */

/**
 * @typedef {Object} Dataset
 * @property {string} key            // 数据集唯一 ID（相对路径去掉 .json）
 * @property {string} relativePath   // POSIX 相对路径
 * @property {string} label          // 推断显示名
 * @property {string} category       // 顶层目录分类
 * @property {string} fileName       // 文件名含后缀
 * @property {number} size           // 字节
 * @property {number} mtime          // 毫秒时间戳（floor）
 * @property {boolean} isLarge       // 是否大文件（lazy load 候选）
 * @property {boolean} inferred      // 来自自动扫描（vs 显式 schema-registry）
 */
