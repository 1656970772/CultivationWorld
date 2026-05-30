export function getTauriApi() {
  if (typeof window === 'undefined') return null;
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return null;
  return tauri;
}

export function hasTauriApi() {
  return Boolean(getTauriApi());
}

export class TauriStore {
  constructor() {
    this.project = null;
    this.issues = [];
  }

  get isAvailable() {
    return hasTauriApi();
  }

  get hasOpenProject() {
    return Boolean(this.project);
  }

  get sourceLabel() {
    return this.project?.sourceLabel || this.project?.rootPath || 'Tauri 项目';
  }

  async pickProjectDirectory() {
    const tauri = this.requireTauri();
    if (!tauri.dialog?.open) {
      throw new Error('当前 Tauri 环境不支持目录选择。');
    }

    const selected = await tauri.dialog.open({ directory: true });
    const rootPath = Array.isArray(selected) ? selected[0] : selected;
    if (!rootPath) return null;

    return this.loadProjectDirectory(rootPath);
  }

  async loadProjectDirectory(rootPath) {
    const result = await this.invoke('load_project_directory', { rootPath });
    return this.applyLoadResult(result);
  }

  async reloadAll() {
    const result = await this.invoke('reload_all_datasets');
    return this.applyLoadResult(result);
  }

  async saveDataset(key, data) {
    return this.invoke('save_dataset', { key, data });
  }

  async saveAll(datasets) {
    return this.invoke('save_all_datasets', { datasets });
  }

  async validate(datasets) {
    return this.invoke('validate_datasets', { datasets });
  }

  async invoke(command, payload) {
    const tauri = this.requireTauri();
    return tauri.core.invoke(command, payload);
  }

  requireTauri() {
    const tauri = getTauriApi();
    if (!tauri) {
      throw new Error('当前环境不是 Tauri 应用。');
    }
    return tauri;
  }

  applyLoadResult(result) {
    this.project = result?.project || this.project;
    this.issues = result?.issues || [];
    return result?.datasets || {};
  }
}
