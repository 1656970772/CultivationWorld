/**
 * DataStore —— 统一数据加载/保存 + 快照集成（ADR-031）
 *
 * 数据源：默认指向 apps/game/data/ 下的全部 JSON（由 dataset-scanner 发现）。
 * 写回：直接覆盖 game/data/<key>.json，写前自动 snapshot 旧字节。
 * 快照：.snapshots/<keyDir>/<ts>-<rand6>.json（在 editorRoot/.snapshots/）。
 *
 * 跨平台：
 * - Tauri 桌面：通过 tauriStore（Tauri Rust 命令读写 + 快照）。
 * - Web File System Access API：用户授权 game/data 目录读写；快照降级（无 editorRoot）。
 * - Node 工具脚本：直接用 fs。
 *
 * 关键不变量：
 * 1. 写回前必先 snapshot 旧字节（即使新内容相等也 snapshot，留 trail）。
 * 2. snapshot 是字节级，写 game/data 是 parse → modify → stringify → write，
 *    这中间可能丢 key 顺序或末尾换行；本 store 写回用 stableStringify 减少 diff 噪音。
 * 3. 任何 saveDataset 失败，必须不破坏旧文件。
 */
import { TauriStore, hasTauriApi } from './tauri-store.js';
import {
  scanDatasets,
  buildDatasetsFromFileList,
  // eslint-disable-next-line no-unused-vars
  scanLocalFilesystem,
} from './dataset-scanner.js';
import {
  backup as snapshotBackup,
  list as snapshotList,
  read as snapshotRead,
  prune as snapshotPrune,
  pruneOlderThan as snapshotPruneOlderThan,
} from './snapshot-store.js';

/** game/data 默认相对路径（相对于仓库根） */
export const DEFAULT_GAME_DATA_RELPATH = ['apps', 'game', 'data'];
/** editor 根默认相对路径 */
export const DEFAULT_EDITOR_RELPATH = ['apps', 'editor'];

/**
 * 路径拼接，跨平台。
 * @param {string[]} parts
 */
function joinPath(parts) {
  if (typeof window !== 'undefined' && window.__TAURI__?.path?.join) {
    // 走 Tauri 的 path.join（保证原生分隔符）
    return window.__TAURI__.path.join(...parts);
  }
  const sep = navigator?.platform?.startsWith?.('Win') ? '\\' : '/';
  return parts.filter(Boolean).join(sep);
}

/**
 * 把对象用稳定方式序列化（保留 key 顺序，2 空格缩进，末尾换行）。
 * 写回的字节与 game 端一致，避免 diff 噪音。
 * @param {*} value
 */
export function stableStringify(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export class DataStore {
  /**
   * @param {Object} opts
   * @param {string} [opts.gameDataDir] game/data 绝对路径（默认自动检测）
   * @param {string} [opts.editorRoot]  editor 根绝对路径（用于 .snapshots/；FSA 模式可空）
   * @param {Object} [opts.schemas]     显式 schema-registry（v1 兼容）；可空
   * @param {boolean} [opts.disableSnapshots] FSA 模式默认 true；Tauri/Node 默认 false
   */
  constructor(opts = {}) {
    this._explicitGameDataDir = opts.gameDataDir || null;
    this._editorRoot = opts.editorRoot || null;
    this._schemas = opts.schemas || {};
    this._disableSnapshots = !!opts.disableSnapshots;
    this.tauriStore = hasTauriApi() ? new TauriStore() : null;
    /** @type {Map<string, any>} key → 已加载数据 */
    this._loaded = new Map();
    /** @type {string} 当前打开的 game/data 目录 */
    this.gameDataDir = this._explicitGameDataDir;
    this.sourceLabel = '未打开项目';
    this.snapshotsAvailable = false; // 启动后由 ensureSnapshotsAvailable 更新
  }

  get hasOpenProject() {
    if (this.tauriStore?.isAvailable) return this.tauriStore.hasOpenProject;
    return Boolean(this.gameDataDir);
  }

  get canUseDirectoryPicker() {
    if (this.tauriStore?.isAvailable) return true;
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  /**
   * 尝试自动检测 game/data 路径（相对当前页面 URL）。
   * 浏览器：fetch 一个 sentinel 文件，命中即可推断。
   * Node：直接根据 cwd + 默认相对路径。
   */
  async autoDetectGameData() {
    if (this.tauriStore?.isAvailable) {
      // Tauri 模式由 Rust 端给路径
      return null;
    }
    // 浏览器：先尝试 ./apps/game/data/，再 ../apps/game/data/
    const candidates = [
      'apps/game/data/',
      '../apps/game/data/',
      '../../apps/game/data/',
    ];
    for (const c of candidates) {
      try {
        const r = await fetch(c + 'entities/factions.json', { cache: 'no-store' });
        if (r.ok) {
          // 拿到相对路径
          return c.replace(/data\/$/, 'data');
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  /**
   * 列出数据集（数据集元信息）。
   * @returns {Promise<Dataset[]>}
   */
  async listDatasets() {
    if (this.tauriStore?.isAvailable) {
      // Tauri 模式由 Rust 端 list_datasets 返回
      return this.tauriStore.listDatasets(this.gameDataDir);
    }
    // 浏览器/N：使用 dataset-scanner
    if (!this.gameDataDir) {
      this.gameDataDir = await this.autoDetectGameData();
    }
    if (!this.gameDataDir) return [];
    try {
      return scanDatasets(this.gameDataDir);
    } catch (e) {
      console.warn('listDatasets failed', e);
      return [];
    }
  }

  /**
   * 加载单个数据集。
   * @param {string} key
   * @returns {Promise<{ data: any, byteSize: number, byteHash: string, mtime: number }>}
   */
  async loadDataset(key) {
    if (this.tauriStore?.hasOpenProject) {
      return this.tauriStore.loadDataset(key);
    }
    if (!this.gameDataDir) throw new Error('未打开 game/data 目录');
    const file = this._resolveFilePath(key);
    const res = await fetch(file, { cache: 'no-store' });
    if (!res.ok) throw new Error(`读取 ${file} 失败：${res.status}`);
    const text = await res.text();
    const data = JSON.parse(text);
    const byteSize = new Blob([text]).size;
    const info = { data, byteSize, byteHash: await quickHash(text), mtime: 0 };
    this._loaded.set(key, info);
    return info;
  }

  /**
   * 加载全部数据集（用于批量编辑场景）。
   */
  async loadAll() {
    const datasets = await this.listDatasets();
    const out = {};
    for (const d of datasets) {
      try {
        const info = await this.loadDataset(d.key);
        out[d.key] = info.data;
      } catch (e) {
        console.warn(`load ${d.key} failed`, e);
        out[d.key] = null;
      }
    }
    return { datasets, data: out };
  }

  /**
   * 保存单个数据集。写 game/data/<key>.json，写前自动 snapshot 旧字节。
   * @param {string} key
   * @param {any} data
   * @returns {Promise<{ mode: string, fileName: string, snapshot: SnapshotInfo|null, byteSize: number }>}
   */
  async saveDataset(key, data) {
    if (this.tauriStore?.hasOpenProject) {
      return this.tauriStore.saveDataset(key, data);
    }
    if (!this.gameDataDir) throw new Error('未打开 game/data 目录');

    const file = this._resolveFilePath(key);
    const newContent = stableStringify(data);

    // 写前 snapshot：拉旧字节
    let snapshot = null;
    if (!this._disableSnapshots && this._editorRoot) {
      try {
        const oldRes = await fetch(file, { cache: 'no-store' });
        if (oldRes.ok) {
          const oldBuf = BufferFromString(await oldRes.text());
          snapshot = snapshotBackup(this._editorRoot, key, oldBuf);
        }
      } catch (e) {
        console.warn('snapshot before save failed', e);
      }
    }

    // 写新内容
    if (this._useFsa) {
      const blob = new Blob([newContent], { type: 'application/json;charset=utf-8' });
      await this._writeFsaFile(key, blob);
    } else {
      // 默认：触发浏览器下载（兜底，用户应已选目录）
      this._download(file.split('/').pop(), newContent);
      return { mode: 'download', fileName: file.split('/').pop(), snapshot, byteSize: newContent.length };
    }

    this._loaded.set(key, { data, byteSize: newContent.length, byteHash: await quickHash(newContent), mtime: Date.now() });
    return { mode: 'file', fileName: file.split('/').pop(), snapshot, byteSize: newContent.length };
  }

  /**
   * 把数据集恢复到一个历史快照。
   * 恢复前会先把当前 game/data 字节备份为新快照（不丢中间态）。
   * @param {string} key
   * @param {string} snapshotName
   * @returns {Promise<{ mode: string, fileName: string, newSnapshot: SnapshotInfo, restoredFrom: string }>}
   */
  async restoreDataset(key, snapshotName) {
    if (this.tauriStore?.hasOpenProject) {
      return this.tauriStore.restoreDataset(key, snapshotName);
    }
    if (!this.gameDataDir) throw new Error('未打开 game/data 目录');
    if (!this._editorRoot) throw new Error('当前模式不支持恢复（无 editorRoot）');

    const file = this._resolveFilePath(key);
    const snapBuf = snapshotRead(this._editorRoot, key, snapshotName);
    if (!snapBuf) throw new Error(`快照不存在：${key} / ${snapshotName}`);

    // 写前 snapshot 当前
    let newSnap = null;
    try {
      const oldRes = await fetch(file, { cache: 'no-store' });
      if (oldRes.ok) {
        const oldBuf = BufferFromString(await oldRes.text());
        newSnap = snapshotBackup(this._editorRoot, key, oldBuf);
      }
    } catch { /* ignore */ }

    // 写回快照内容
    if (this._useFsa) {
      const blob = new Blob([snapBuf], { type: 'application/json;charset=utf-8' });
      await this._writeFsaFile(key, blob);
    } else {
      this._download(file.split('/').pop'), snapBuf.toString('utf-8'));
    }

    return {
      mode: 'restored',
      fileName: file.split('/').pop(),
      newSnapshot: newSnap,
      restoredFrom: snapshotName,
    };
  }

  /**
   * 列出某数据集的所有快照。
   * @param {string} key
   */
  listSnapshots(key) {
    if (!this._editorRoot) return [];
    return snapshotList(this._editorRoot, key);
  }

  /**
   * 清理某数据集的旧快照。
   * @param {string} key
   * @param {number} daysOld
   */
  pruneSnapshots(key, daysOld) {
    if (!this._editorRoot) return 0;
    return snapshotPruneOlderThan(this._editorRoot, key, daysOld);
  }

  /**
   * 用户选 game/data 目录（FSA 模式）。
   */
  async pickProjectDirectory() {
    if (this.tauriStore?.isAvailable) {
      const r = await this.tauriStore.pickProjectDirectory();
      this.gameDataDir = r?.gameDataDir || this.gameDataDir;
      this.sourceLabel = r?.sourceLabel || 'Tauri 项目';
      return r;
    }
    if (!this.canUseDirectoryPicker) {
      throw new Error('当前浏览器不支持目录授权，请用 Tauri 桌面版。');
    }
    this._rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    this._dataDirHandle = await this._resolveDataDir(this._rootHandle);
    this.gameDataDir = this._dataDirHandle.name;
    this.sourceLabel = this._dataDirHandle.name;
    this._useFsa = true;
    // FSA 模式下 .snapshots/ 不可达，自动禁用
    this._disableSnapshots = true;
    return { datasets: await this.listDatasets(), data: null };
  }

  async _resolveDataDir(root) {
    try { return await root.getDirectoryHandle('data'); }
    catch {
      try {
        await root.getFileHandle('factions.json');
        return root;
      } catch {
        throw new Error('请选择项目根目录或 data 目录。');
      }
    }
  }

  async _writeFsaFile(key, blob) {
    if (!this._dataDirHandle) throw new Error('未授权 data 目录');
    const parts = key.split('/');
    const fileName = parts.pop() + '.json';
    let dir = this._dataDirHandle;
    for (const sub of parts) {
      dir = await dir.getDirectoryHandle(sub, { create: true });
    }
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  _resolveFilePath(key) {
    const rel = key + '.json';
    return this.gameDataDir.replace(/\\/g, '/').replace(/\/$/, '') + '/' + rel;
  }

  _download(fileName, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** 浏览器里把字符串转 Uint8Array（用于 snapshot 字节） */
function BufferFromString(s) {
  return new TextEncoder().encode(s);
}

/** 快速 hash（djb2） */
async function quickHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}
