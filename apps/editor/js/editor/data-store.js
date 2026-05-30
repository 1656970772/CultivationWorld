import { TauriStore, hasTauriApi } from './tauri-store.js';

export class DataStore {
  constructor(schemas) {
    this.schemas = schemas;
    this.rootHandle = null;
    this.dataDirHandle = null;
    this.tauriStore = hasTauriApi() ? new TauriStore() : null;
    this.sourceLabel = '默认 data 目录';
  }

  get hasOpenProject() {
    if (this.tauriStore?.isAvailable) return this.tauriStore.hasOpenProject;
    return Boolean(this.dataDirHandle);
  }

  get canUseDirectoryPicker() {
    if (this.tauriStore?.isAvailable) return true;
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  async loadAll() {
    if (this.tauriStore?.hasOpenProject) {
      const datasets = await this.tauriStore.reloadAll();
      this.sourceLabel = this.tauriStore.sourceLabel;
      return datasets;
    }

    const datasets = {};
    for (const [key, schema] of Object.entries(this.schemas)) {
      datasets[key] = await this.loadDataset(key, schema);
    }
    return datasets;
  }

  async loadDataset(key, schema = this.schemas[key]) {
    if (!schema) throw new Error(`未知数据集：${key}`);

    if (this.dataDirHandle) {
      const fileName = schema.file.split('/').pop();
      const fileHandle = await this.dataDirHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      return JSON.parse(await file.text());
    }

    const response = await fetch(schema.file, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`读取 ${schema.file} 失败：${response.status}`);
    }
    return response.json();
  }

  async pickProjectDirectory() {
    if (this.tauriStore?.isAvailable) {
      const datasets = await this.tauriStore.pickProjectDirectory();
      if (datasets === null) return null;
      this.sourceLabel = this.tauriStore.sourceLabel;
      return datasets;
    }

    if (!this.canUseDirectoryPicker) {
      throw new Error('当前浏览器不支持目录授权。');
    }

    this.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    this.dataDirHandle = await this.resolveDataDirectory(this.rootHandle);
    this.sourceLabel = this.dataDirHandle === this.rootHandle
      ? `${this.rootHandle.name}`
      : `${this.rootHandle.name}/data`;
    return this.loadAll();
  }

  async resolveDataDirectory(rootHandle) {
    try {
      return await rootHandle.getDirectoryHandle('data');
    } catch (error) {
      try {
        await rootHandle.getFileHandle('factions.json');
        return rootHandle;
      } catch (innerError) {
        throw new Error('请选择项目根目录或 data 目录。');
      }
    }
  }

  async saveDataset(key, data) {
    const schema = this.schemas[key];
    if (!schema) throw new Error(`未知数据集：${key}`);

    if (this.tauriStore?.hasOpenProject) {
      return this.tauriStore.saveDataset(key, data);
    }

    const fileName = schema.file.split('/').pop();
    const content = `${JSON.stringify(data, null, 2)}\n`;

    if (!this.dataDirHandle) {
      this.download(fileName, content);
      return { mode: 'download', fileName };
    }

    const fileHandle = await this.dataDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return { mode: 'file', fileName };
  }

  async saveAll(datasets) {
    if (this.tauriStore?.hasOpenProject) {
      return this.tauriStore.saveAll(datasets);
    }

    const results = [];
    for (const key of Object.keys(this.schemas)) {
      results.push(await this.saveDataset(key, datasets[key]));
    }
    return results;
  }

  exportDataset(key, data) {
    const schema = this.schemas[key];
    const fileName = schema.file.split('/').pop();
    this.download(fileName, `${JSON.stringify(data, null, 2)}\n`);
  }

  download(fileName, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }
}
