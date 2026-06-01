/**
 * SnapshotStore —— 编辑器保存前自动备份 + 一键回滚（ADR-031）
 *
 * 布局：<editorRoot>/.snapshots/<datasetKey>/<ts>-<rand6>.json
 *   例：apps/editor/.snapshots/balance__obsession/20260601-184523-a8c2f1.json
 *
 * 跨平台：
 * - Node / Tauri：直接用 fs（createRequire）。
 * - Web 纯 FSA：.snapshots/ 在 editor 目录下，浏览器无授权能力 → 走 Tauri 命令。
 * - Web + Tauri：snapshot-store 通过 Tauri 调 Rust 写盘；本模块的纯函数（路径生成、索引）可共用。
 *
 * 关键约束：
 * 1. backup() 同步写盘（sync 写），保证写 game/data 前快照已存在。
 * 2. restore() 内部会先把当前 game/data 备份为新快照（不丢中间态）。
 * 3. 快照内容是**写前的 game/data 字节**，不是内存中已 parse 的对象 → round-trip 字节级一致。
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const _nodeRequire = createRequire(import.meta.url);

/** 把 datasetKey（POSIX 相对路径，去后缀）的 '/' 转成 '__'，避免子目录嵌套 */
export function keyToDirName(key) {
  return String(key || '').replace(/^\/+|\/+$/g, '').replace(/\//g, '__');
}

/** 反向：从目录名恢复 dataset key（仅用于展示/迁移） */
export function dirNameToKey(dirName) {
  return String(dirName || '').replace(/__/g, '/');
}

/** 生成快照文件名：<YYYYMMDD-HHmmss>-<rand6>.json */
export function generateSnapshotName(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rand}.json`;
}

/** 解析快照文件名 → { ts: Date, rand } */
export function parseSnapshotName(name) {
  const m = String(name).match(/^(\d{8})-(\d{6})-([a-z0-9]{6})\.json$/i);
  if (!m) return null;
  const [, date, time] = m;
  const yyyy = +date.slice(0, 4), mo = +date.slice(4, 6) - 1, dd = +date.slice(6, 8);
  const hh = +time.slice(0, 2), mi = +time.slice(2, 4), ss = +time.slice(4, 6);
  return { ts: new Date(yyyy, mo, dd, hh, mi, ss), rand: m[3] };
}

/** 计算字节级 sha1（短哈希） */
export function byteHash(buf) {
  return createHash('sha1').update(buf).digest('hex').slice(0, 12);
}

/**
 * 把 dataset 当前的 game/data 字节备份到 .snapshots。
 * @param {string} editorRoot apps/editor 根目录（绝对路径）
 * @param {string} datasetKey
 * @param {Buffer|string} content 备份内容（推荐 Buffer 保留字节）
 * @returns {{ ts: Date, path: string, size: number, byteHash: string, name: string }}
 */
export function backup(editorRoot, datasetKey, content) {
  const fs = _nodeRequire('node:fs');
  const path = _nodeRequire('node:path');
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  const dir = path.join(editorRoot, '.snapshots', keyToDirName(datasetKey));
  fs.mkdirSync(dir, { recursive: true });
  const name = generateSnapshotName();
  const fullPath = path.join(dir, name);
  fs.writeFileSync(fullPath, buf);
  const stat = fs.statSync(fullPath);
  return {
    ts: parseSnapshotName(name).ts,
    path: fullPath,
    name,
    size: stat.size,
    byteHash: byteHash(buf),
  };
}

/**
 * 列出一个 dataset 的所有快照，按时间倒序。
 * @param {string} editorRoot
 * @param {string} datasetKey
 * @returns {SnapshotInfo[]}
 */
export function list(editorRoot, datasetKey) {
  const fs = _nodeRequire('node:fs');
  const path = _nodeRequire('node:path');
  const dir = path.join(editorRoot, '.snapshots', keyToDirName(datasetKey));
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.json'));
  /** @type {SnapshotInfo[]} */
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    let buf;
    try { buf = fs.readFileSync(full); } catch { continue; }
    const parsed = parseSnapshotName(name);
    out.push({
      name,
      path: full,
      ts: parsed ? parsed.ts : stat.mtime,
      size: stat.size,
      mtime: stat.mtimeMs,
      byteHash: byteHash(buf),
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/**
 * 删除一个或多个快照。
 * @param {string} editorRoot
 * @param {string} datasetKey
 * @param {string|string[]} namesOrAll
 * @returns {number} 删除数量
 */
export function prune(editorRoot, datasetKey, namesOrAll) {
  const fs = _nodeRequire('node:fs');
  const path = _nodeRequire('node:path');
  const dir = path.join(editorRoot, '.snapshots', keyToDirName(datasetKey));
  if (!fs.existsSync(dir)) return 0;
  let names;
  if (namesOrAll === 'all') {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.json'));
  } else if (Array.isArray(namesOrAll)) {
    names = namesOrAll;
  } else {
    names = [namesOrAll];
  }
  let n = 0;
  for (const name of names) {
    const full = path.join(dir, name);
    try { fs.unlinkSync(full); n++; } catch { /* ignore */ }
  }
  return n;
}

/**
 * 删除超过 daysOld 天的快照（按 mtime 算）。
 * @param {string} editorRoot
 * @param {string} datasetKey
 * @param {number} daysOld
 * @returns {number} 删除数量
 */
export function pruneOlderThan(editorRoot, datasetKey, daysOld) {
  const fs = _nodeRequire('node:fs');
  const path = _nodeRequire('node:path');
  const dir = path.join(editorRoot, '.snapshots', keyToDirName(datasetKey));
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - daysOld * 86400_000;
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.json'));
  let n = 0;
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        n++;
      }
    } catch { /* ignore */ }
  }
  return n;
}

/**
 * 读取快照字节。
 * @param {string} editorRoot
 * @param {string} datasetKey
 * @param {string} name
 * @returns {Buffer|null}
 */
export function read(editorRoot, datasetKey, name) {
  const fs = _nodeRequire('node:fs');
  const path = _nodeRequire('node:path');
  const full = path.join(editorRoot, '.snapshots', keyToDirName(datasetKey), name);
  try { return fs.readFileSync(full); }
  catch { return null; }
}

/**
 * @typedef {Object} SnapshotInfo
 * @property {string} name
 * @property {string} path
 * @property {Date} ts
 * @property {number} size
 * @property {number} mtime
 * @property {string} byteHash
 */
