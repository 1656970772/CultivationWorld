/**
 * DataStore —— 统一数据加载/保存 + 快照集成（ADR-031）
 *
 * 数据源默认指向 apps/game/data/**。数据集列表由文件扫描发现，再用
 * apps/editor/data/schemas 下的声明式注册表补充标签、分类、字段和模板信息。
 */
import { TauriStore, hasTauriApi } from './tauri-store.js';
import { loadDeclarativeRegistry } from './schema-registry.js';

/** game/data 默认相对路径（相对于仓库根） */
export const DEFAULT_GAME_DATA_RELPATH = ['apps', 'game', 'data'];
/** editor 根默认相对路径 */
export const DEFAULT_EDITOR_RELPATH = ['apps', 'editor'];

/**
 * 把对象用稳定方式序列化（保留 key 顺序，2 空格缩进，末尾换行）。
 * @param {*} value
 */
export function stableStringify(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export class DataStore {
  constructor(opts = {}) {
    this._explicitGameDataDir = opts.gameDataDir || null;
    this._editorRoot = opts.editorRoot || null;
    this._disableSnapshots = !!opts.disableSnapshots;
    this._datasetRegistry = null;
    this._tauriDataCache = null;
    this.tauriStore = hasTauriApi() ? new TauriStore() : null;
    /** @type {Map<string, any>} key → 已加载数据 */
    this._loaded = new Map();
    this.gameDataDir = this._explicitGameDataDir;
    this.sourceLabel = '未打开项目';
    this.snapshotsAvailable = false;
  }

  get hasOpenProject() {
    if (this.tauriStore?.isAvailable) return this.tauriStore.hasOpenProject;
    return Boolean(this.gameDataDir);
  }

  get canUseDirectoryPicker() {
    if (this.tauriStore?.isAvailable) return true;
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  async autoDetectGameData() {
    if (this.tauriStore?.isAvailable) return null;
    if (!isBrowserRuntime()) {
      return this.gameDataDir;
    }

    const candidates = [
      '../game/data/',
      'game/data/',
      '../../game/data/',
    ];
    for (const candidate of candidates) {
      try {
        const response = await fetch(`${candidate}entities/factions.json`, { cache: 'no-store' });
        if (response.ok) return candidate.replace(/\/$/, '');
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  async listDatasets() {
    if (this.tauriStore?.hasOpenProject) {
      if (!this._tauriDataCache) {
        this._tauriDataCache = await this.tauriStore.reloadAll();
      }
      return this._enrichDatasets(this._datasetsFromDataKeys(Object.keys(this._tauriDataCache || {})));
    }

    if (this._useFsa) {
      return this._enrichDatasets(await this._scanFsaDatasets());
    }

    if (isBrowserRuntime()) {
      try {
        const response = await fetch('/__api/datasets', { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json();
          if (payload.ok) {
            this.gameDataDir = '../game/data/';
            return this._enrichDatasets(payload.datasets);
          }
        }
      } catch (error) {
        console.warn('API listDatasets failed', error);
      }
    }

    if (!this.gameDataDir) {
      this.gameDataDir = await this.autoDetectGameData();
    }
    if (!this.gameDataDir) return [];

    try {
      const { scanDatasets } = await import('./dataset-scanner.js');
      return this._enrichDatasets(scanDatasets(this.gameDataDir));
    } catch (error) {
      console.warn('listDatasets failed', error);
      return [];
    }
  }

  async loadDataset(key) {
    if (this.tauriStore?.hasOpenProject) {
      if (!this._tauriDataCache) {
        this._tauriDataCache = await this.tauriStore.reloadAll();
      }
      if (!(key in this._tauriDataCache)) throw new Error(`读取 ${key} 失败：数据集不存在`);
      const data = this._tauriDataCache[key];
      const text = stableStringify(data);
      const info = { data, byteSize: text.length, byteHash: await quickHash(text), mtime: 0 };
      this._loaded.set(key, info);
      return info;
    }

    if (!this.gameDataDir) throw new Error('未打开 game/data 目录');

    if (this._useFsa) {
      const text = await this._readFsaFile(key);
      const info = {
        data: JSON.parse(text),
        byteSize: new Blob([text]).size,
        byteHash: await quickHash(text),
        mtime: 0,
      };
      this._loaded.set(key, info);
      return info;
    }

    if (isBrowserRuntime()) {
      const url = `/__api/file?path=${encodeURIComponent(`${key}.json`)}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`读取 ${key} 失败：${response.status}`);
      const text = await response.text();
      const info = {
        data: JSON.parse(text),
        byteSize: new Blob([text]).size,
        byteHash: await quickHash(text),
        mtime: 0,
      };
      this._loaded.set(key, info);
      return info;
    }

    const { readFile, stat } = await import('node:fs/promises');
    const file = this._resolveFilePath(key);
    const text = await readFile(file, 'utf-8');
    const info = {
      data: JSON.parse(text),
      byteSize: Buffer.byteLength(text, 'utf-8'),
      byteHash: await quickHash(text),
      mtime: (await stat(file)).mtimeMs,
    };
    this._loaded.set(key, info);
    return info;
  }

  async loadAll() {
    const datasets = await this.listDatasets();
    const out = {};
    for (const dataset of datasets) {
      try {
        const info = await this.loadDataset(dataset.key);
        out[dataset.key] = info.data;
      } catch (error) {
        console.warn(`load ${dataset.key} failed`, error);
        out[dataset.key] = null;
      }
    }
    return { datasets, data: out };
  }

  async saveDataset(key, data) {
    if (this.tauriStore?.hasOpenProject) {
      const result = await this.tauriStore.saveDataset(key, data);
      if (this._tauriDataCache) this._tauriDataCache[key] = data;
      return result;
    }

    if (!this.gameDataDir) throw new Error('未打开 game/data 目录');

    const fileName = `${key.split('/').pop()}.json`;
    const newContent = stableStringify(data);
    const snapshot = await this._snapshotBeforeWrite(key);

    if (this._useFsa) {
      const blob = new Blob([newContent], { type: 'application/json;charset=utf-8' });
      await this._writeFsaFile(key, blob);
    } else if (isBrowserRuntime()) {
      const response = await fetch(`/__api/file?path=${encodeURIComponent(`${key}.json`)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: new TextEncoder().encode(newContent),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(`写文件失败：${payload.error || response.status}`);
    } else if (this.gameDataDir) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      const file = this._resolveFilePath(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, newContent, 'utf-8');
    } else {
      this._download(fileName, newContent);
      return { mode: 'download', fileName, snapshot, byteSize: newContent.length };
    }

    this._loaded.set(key, {
      data,
      byteSize: newContent.length,
      byteHash: await quickHash(newContent),
      mtime: Date.now(),
    });
    return { mode: 'file', fileName, snapshot, byteSize: newContent.length };
  }

  async saveAll(datasets) {
    if (this.tauriStore?.hasOpenProject) {
      const result = await this.tauriStore.saveAll(datasets);
      if (this._tauriDataCache) {
        for (const [key, data] of Object.entries(datasets || {})) {
          this._tauriDataCache[key] = data;
        }
      }
      return result;
    }

    const results = [];
    for (const [key, data] of Object.entries(datasets || {})) {
      results.push(await this.saveDataset(key, data));
    }
    return results;
  }

  async restoreDataset(key, snapshotName) {
    if (this.tauriStore?.hasOpenProject) {
      throw new Error('当前 Tauri 后端尚未提供快照恢复命令。');
    }
    if (!this.gameDataDir) throw new Error('未打开 game/data 目录');

    if (isBrowserRuntime()) {
      const response = await fetch(`/__api/snapshot_restore?key=${encodeURIComponent(key)}&name=${encodeURIComponent(snapshotName)}`, {
        method: 'POST',
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || 'restore failed');
      return {
        mode: 'restored',
        fileName: `${key.split('/').pop()}.json`,
        newSnapshot: { name: payload.newBackup, path: '', size: payload.bytes, ts: new Date() },
        restoredFrom: snapshotName,
      };
    }

    if (!this._editorRoot) throw new Error('当前模式不支持恢复（无 editorRoot）');
    const { read: snapshotRead, backup: snapshotBackup } = await import('./snapshot-store.js');
    const { readFile, writeFile } = await import('node:fs/promises');
    const file = this._resolveFilePath(key);
    const snapshotBytes = snapshotRead(this._editorRoot, key, snapshotName);
    if (!snapshotBytes) throw new Error(`快照不存在：${key} / ${snapshotName}`);
    const current = await readFile(file);
    const newSnapshot = snapshotBackup(this._editorRoot, key, current);
    await writeFile(file, snapshotBytes);
    return {
      mode: 'restored',
      fileName: `${key.split('/').pop()}.json`,
      newSnapshot,
      restoredFrom: snapshotName,
    };
  }

  listSnapshots(key) {
    if (isBrowserRuntime() || !this._editorRoot) return [];
    return [];
  }

  async listSnapshotsAsync(key) {
    if (isBrowserRuntime()) {
      const response = await fetch(`/__api/snapshot?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!payload.ok) return [];
      return payload.snapshots.map((snapshot) => ({
        name: snapshot.name,
        path: '',
        size: snapshot.size,
        mtime: snapshot.mtime,
        ts: new Date(snapshot.mtime),
        byteHash: '',
      }));
    }
    if (!this._editorRoot) return [];
    const { list } = await import('./snapshot-store.js');
    return list(this._editorRoot, key);
  }

  async pruneSnapshotsAsync(key, daysOld) {
    if (!this._editorRoot || isBrowserRuntime()) return 0;
    const { pruneOlderThan } = await import('./snapshot-store.js');
    return pruneOlderThan(this._editorRoot, key, daysOld);
  }

  pruneSnapshots(key, daysOld) {
    void key;
    void daysOld;
    return 0;
  }

  async pickProjectDirectory() {
    if (this.tauriStore?.isAvailable) {
      const data = await this.tauriStore.pickProjectDirectory();
      if (data) {
        this._tauriDataCache = data;
        this.gameDataDir = this.tauriStore.project?.dataPath || this.gameDataDir;
        this.sourceLabel = this.tauriStore.sourceLabel || 'Tauri 项目';
      }
      return { datasets: await this.listDatasets(), data };
    }

    if (!this.canUseDirectoryPicker) {
      throw new Error('当前浏览器不支持目录授权，请用 Tauri 桌面版。');
    }
    this._rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const resolved = await this._resolveDataDir(this._rootHandle);
    this._dataDirHandle = resolved.handle;
    this.gameDataDir = resolved.label;
    this.sourceLabel = resolved.label;
    this._useFsa = true;
    this._disableSnapshots = true;
    return { datasets: await this.listDatasets(), data: null };
  }

  async _resolveDataDir(root) {
    const candidates = [
      {
        label: `${root.name}/apps/game/data`,
        resolve: async () => {
          const apps = await root.getDirectoryHandle('apps');
          const game = await apps.getDirectoryHandle('game');
          return game.getDirectoryHandle('data');
        },
      },
      {
        label: `${root.name}/data`,
        resolve: async () => root.getDirectoryHandle('data'),
      },
      {
        label: root.name,
        resolve: async () => root,
      },
    ];

    for (const candidate of candidates) {
      try {
        const handle = await candidate.resolve();
        if (await this._hasFsaDataSentinel(handle)) {
          return { handle, label: candidate.label };
        }
      } catch {
        // Try the next candidate.
      }
    }

    throw new Error('请选择仓库根目录、项目根目录或 game/data 目录。');
  }

  async _hasFsaDataSentinel(handle) {
    return (await this._fsaFileExists(handle, ['config', 'data-manifest.json']))
      || (await this._fsaFileExists(handle, ['entities', 'factions.json']));
  }

  async _fsaFileExists(handle, parts) {
    try {
      let dir = handle;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part);
      }
      await dir.getFileHandle(parts[parts.length - 1]);
      return true;
    } catch {
      return false;
    }
  }

  async _scanFsaDatasets() {
    if (!this._dataDirHandle) return [];
    const relPaths = [];
    const metaByRel = {};

    const walk = async (dir, prefix = []) => {
      for await (const [name, handle] of dir.entries()) {
        if (name.startsWith('.') || ['.backups', '.git', '.snapshots', '__pycache__', 'desktop-dist', 'node_modules'].includes(name)) {
          continue;
        }
        if (handle.kind === 'directory') {
          await walk(handle, [...prefix, name]);
        } else if (handle.kind === 'file' && name.toLowerCase().endsWith('.json')) {
          const relPath = [...prefix, name].join('/');
          const file = await handle.getFile();
          relPaths.push(relPath);
          metaByRel[relPath] = { size: file.size, mtime: file.lastModified || 0 };
        }
      }
    };

    await walk(this._dataDirHandle);
    const { buildDatasetsFromFileList } = await import('./dataset-scanner.js');
    return buildDatasetsFromFileList(relPaths, metaByRel);
  }

  async _readFsaFile(key) {
    const handle = await this._getFsaFileHandle(key);
    const file = await handle.getFile();
    return file.text();
  }

  async _writeFsaFile(key, blob) {
    const handle = await this._getFsaFileHandle(key, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async _getFsaFileHandle(key, { create = false } = {}) {
    if (!this._dataDirHandle) throw new Error('未授权 data 目录');
    const parts = key.split('/');
    const fileName = `${parts.pop()}.json`;
    let dir = this._dataDirHandle;
    for (const sub of parts) {
      dir = await dir.getDirectoryHandle(sub, { create });
    }
    return dir.getFileHandle(fileName, { create });
  }

  async _snapshotBeforeWrite(key) {
    if (this._disableSnapshots) return null;
    try {
      if (isBrowserRuntime()) {
        const oldResponse = await fetch(`/__api/file?path=${encodeURIComponent(`${key}.json`)}`, { cache: 'no-store' });
        if (!oldResponse.ok) return null;
        return this._writeSnapshotApi(key, new Uint8Array(await oldResponse.arrayBuffer()));
      }
      if (!this._editorRoot) return null;
      const { readFile } = await import('node:fs/promises');
      const { backup } = await import('./snapshot-store.js');
      return backup(this._editorRoot, key, await readFile(this._resolveFilePath(key)));
    } catch (error) {
      console.warn('snapshot before save failed', error);
      return null;
    }
  }

  async _writeSnapshotApi(key, oldBytes) {
    const name = snapshotName();
    const response = await fetch(`/__api/snapshot?key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: oldBytes,
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || 'snapshot write failed');
    return { name, path: payload.path, size: oldBytes.length, ts: new Date() };
  }

  _resolveFilePath(key) {
    return `${this.gameDataDir.replace(/\\/g, '/').replace(/\/$/, '')}/${key}.json`;
  }

  _download(fileName, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async _registry() {
    if (!this._datasetRegistry) {
      this._datasetRegistry = await loadDeclarativeRegistry();
    }
    return this._datasetRegistry;
  }

  async _enrichDatasets(datasets) {
    const registry = await this._registry();
    return datasets.map((dataset) => {
      const schema = registry.schemas[dataset.key];
      if (!schema) return dataset;
      return {
        ...dataset,
        label: schema.label || dataset.label,
        category: schema.category || dataset.category,
        icon: schema.icon,
        itemName: schema.itemName,
        keyField: schema.keyField,
        collection: schema.collection,
        description: schema.description,
        isLarge: Boolean(schema.isLarge || dataset.isLarge),
        declared: true,
      };
    });
  }

  _datasetsFromDataKeys(keys) {
    return keys.sort().map((key) => {
      const parts = key.split('/');
      const fileName = `${parts[parts.length - 1]}.json`;
      return {
        key,
        relativePath: `${key}.json`,
        label: parts[parts.length - 1].replace(/[_-]+/g, ' '),
        category: parts.length > 1 ? parts[0] : 'other',
        fileName,
        size: 0,
        mtime: 0,
        isLarge: key.endsWith('/map'),
        inferred: true,
      };
    });
  }
}

function isBrowserRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function snapshotName(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rand}.json`;
}

async function quickHash(s) {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16).padStart(8, '0');
}
