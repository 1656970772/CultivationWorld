/**
 * DataEditorApp —— 编辑器主应用（ADR-031 重写版）
 *
 * 数据源：DataStore（自动扫描 game/data + 写回 + 快照）。
 * Schema：DataStore.listDatasets() 返回 Dataset 元信息；编辑器不依赖 schema-registry 硬编码。
 * 字段推断：用 schema-inferrer 从样本 JSON 推断 FieldDef 树。
 *
 * 主要 UI：
 * - 左侧卷宗导航（按 category 分组）
 * - 中间记录列表
 * - 右侧表单（递归渲染 FieldDef）
 * - 详情卡（预留）
 * - 顶部历史快照面板（可折叠）
 *
 * 跨平台：所有数据 IO 走 DataStore；DataStore 内部按 Tauri/FSA/Node 适配。
 */
import { DataStore, stableStringify } from './data-store.js';
import { FieldRenderer, createElement } from './field-renderer.js';
import { inferSchema } from './schema-inferrer.js';
import { scanDatasets } from './dataset-scanner.js';

class DataEditorApp {
  constructor() {
    this.store = new DataStore();
    /** @type {Dataset[]} */
    this.datasets = [];
    /** @type {Record<string, any>} key → 已加载数据 */
    this.data = {};
    /** @type {Record<string, SchemaTree>} key → 推断的 schema 树 */
    this.schemas = {};
    this.dirtyDatasets = new Set();
    this.activeDataset = null;
    this.selectedIndex = 0;
    this.searchText = '';
    this.fieldRenderer = new FieldRenderer(this.data);

    this.elements = {
      sourceLabel: document.getElementById('source-label'),
      datasetNav: document.getElementById('dataset-nav'),
      recordSearch: document.getElementById('record-search'),
      recordList: document.getElementById('record-list'),
      datasetKicker: document.getElementById('dataset-kicker'),
      recordTitle: document.getElementById('record-title'),
      recordSubtitle: document.getElementById('record-subtitle'),
      dirtyIndicator: document.getElementById('dirty-indicator'),
      formFields: document.getElementById('form-fields'),
      detailCard: document.getElementById('detail-card'),
      toastRegion: document.getElementById('toast-region'),
      pickDirBtn: document.getElementById('pick-dir-btn'),
      reloadBtn: document.getElementById('reload-btn'),
      saveDatasetBtn: document.getElementById('save-dataset-btn'),
      saveAllBtn: document.getElementById('save-all-btn'),
      addRecordBtn: document.getElementById('add-record-btn'),
      duplicateRecordBtn: document.getElementById('duplicate-record-btn'),
      deleteRecordBtn: document.getElementById('delete-record-btn'),
      // 新的（ADR-031）
      historyPanel: document.getElementById('history-panel'),
      historyToggle: document.getElementById('history-toggle'),
      historyList: document.getElementById('history-list'),
      snapshotCount: document.getElementById('snapshot-count'),
      pruneOldBtn: document.getElementById('prune-old-btn'),
    };
  }

  async init() {
    this.bindEvents();
    try {
      await this.reloadData();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  bindEvents() {
    this.elements.recordSearch.addEventListener('input', () => {
      this.searchText = this.elements.recordSearch.value.trim().toLowerCase();
      this.renderRecordList();
    });
    this.elements.pickDirBtn.addEventListener('click', () => this.pickDirectory());
    this.elements.reloadBtn.addEventListener('click', () => this.reloadData());
    this.elements.saveDatasetBtn.addEventListener('click', () => this.saveActiveDataset());
    this.elements.saveAllBtn.addEventListener('click', () => this.saveAllDatasets());
    this.elements.addRecordBtn.addEventListener('click', () => this.addRecord());
    this.elements.duplicateRecordBtn.addEventListener('click', () => this.duplicateRecord());
    this.elements.deleteRecordBtn.addEventListener('click', () => this.deleteRecord());
    if (this.elements.historyToggle) {
      this.elements.historyToggle.addEventListener('click', () => this.toggleHistoryPanel());
    }
    if (this.elements.pruneOldBtn) {
      this.elements.pruneOldBtn.addEventListener('click', () => this.pruneOldSnapshots());
    }
  }

  async reloadData() {
    this.setBusy(true);
    try {
      this.datasets = await this.store.listDatasets();
      if (this.datasets.length === 0) {
        this.toast('未发现任何 JSON 数据集，请检查 game/data 路径。', 'error');
        this.renderAll();
        return;
      }
      // 加载全部数据 + 推断 schema
      this.data = {};
      this.schemas = {};
      for (const d of this.datasets) {
        try {
          const info = await this.store.loadDataset(d.key);
          this.data[d.key] = info.data;
          this.schemas[d.key] = inferSchema(info.data);
        } catch (e) {
          console.warn(`load ${d.key} failed`, e);
          this.data[d.key] = null;
        }
      }
      this.fieldRenderer.updateDatasets(this.data);
      this.dirtyDatasets.clear();
      if (!this.activeDataset || !this.datasets.find(d => d.key === this.activeDataset)) {
        this.activeDataset = this.datasets[0].key;
      }
      this.selectedIndex = 0;
      this.renderAll();
      this.toast(`已加载 ${this.datasets.length} 个数据集。`);
    } finally {
      this.setBusy(false);
    }
  }

  async pickDirectory() {
    try {
      this.setBusy(true);
      await this.store.pickProjectDirectory();
      await this.reloadData();
    } catch (e) {
      this.toast(e.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  renderAll() {
    this.elements.sourceLabel.textContent = this.store.sourceLabel || '未打开项目';
    this.renderDatasetNav();
    this.renderRecordList();
    this.renderEditor();
    this.renderHistoryPanel();
    this.updateActionState();
  }

  renderDatasetNav() {
    this.elements.datasetNav.replaceChildren();
    // 按 category 分组
    const groups = new Map();
    for (const d of this.datasets) {
      if (!groups.has(d.category)) groups.set(d.category, []);
      groups.get(d.category).push(d);
    }
    const categoryLabels = {
      balance: '数值平衡',
      actions: '行为定义',
      config: '引擎配置',
      data: '静态数据',
      definitions: '老定义',
      entities: '老实体',
      world: '世界/地图',
      quests: '任务',
      other: '其他',
    };
    for (const [cat, ds] of groups) {
      const header = createElement('div', 'dataset-group-header', categoryLabels[cat] || cat);
      this.elements.datasetNav.append(header);
      for (const d of ds) {
        const button = createElement('button', d.key === this.activeDataset ? 'dataset-tab active' : 'dataset-tab');
        button.type = 'button';
        const count = this.getDatasetCount(d.key);
        const textWrap = createElement('span', 'dataset-tab-text');
        textWrap.append(
          createElement('span', 'dataset-label', d.label),
          createElement('span', 'dataset-meta', `${count} 条${d.isLarge ? ' · 大' : ''}`)
        );
        const markers = createElement('span', 'dataset-markers');
        if (this.dirtyDatasets.has(d.key)) markers.append(createElement('span', 'dirty-dot', '改'));
        button.append(textWrap, markers);
        button.addEventListener('click', () => this.selectDataset(d.key));
        this.elements.datasetNav.append(button);
      }
    }
  }

  renderRecordList() {
    const list = this.elements.recordList;
    list.replaceChildren();
    if (!this.activeDataset) {
      list.append(createElement('div', 'empty-state', '请选择一个数据集'));
      return;
    }
    const records = this.getVisibleRecords();
    if (records.length === 0) {
      list.append(createElement('div', 'empty-state', '没有匹配记录'));
      return;
    }
    for (const record of records) {
      const button = createElement('button', record.index === this.selectedIndex ? 'record-item active' : 'record-item');
      button.type = 'button';
      button.append(
        createElement('span', 'record-name', this.getRecordName(record.item, record.index)),
        createElement('span', 'record-meta', this.getRecordSummary(record.item))
      );
      button.addEventListener('click', () => {
        this.selectedIndex = record.index;
        this.renderRecordList();
        this.renderEditor();
        this.updateActionState();
      });
      list.append(button);
    }
  }

  renderEditor() {
    if (!this.activeDataset) {
      this.elements.formFields.replaceChildren();
      this.elements.recordTitle.textContent = '未选择数据集';
      this.elements.recordSubtitle.textContent = '';
      this.elements.datasetKicker.textContent = '';
      return;
    }
    const ds = this.datasets.find(d => d.key === this.activeDataset);
    const schema = this.schemas[this.activeDataset];
    const item = this.activeItem;
    this.elements.datasetKicker.textContent = `${ds.label} · ${ds.relativePath}`;
    this.elements.recordTitle.textContent = this.hasActiveRecord ? this.getRecordName(item, this.selectedIndex) : '暂无记录';
    this.elements.recordSubtitle.textContent = ds.isLarge ? '⚠ 大文件，仅展示摘要' : (this.hasActiveRecord ? '' : '点击「新增」创建第一条记录');
    this.elements.dirtyIndicator.textContent = this.dirtyDatasets.has(this.activeDataset) ? '有未保存修改' : '未修改';
    this.elements.dirtyIndicator.classList.toggle('dirty', this.dirtyDatasets.has(this.activeDataset));

    this.elements.formFields.replaceChildren();
    if (!this.hasActiveRecord) {
      this.elements.formFields.append(createElement('div', 'empty-state', '当前数据集暂无记录。'));
      return;
    }

    if (schema?.rootType === 'object' && schema.rootFields.length > 0) {
      // 顶层 object：把 item 当作 root 渲染
      for (const field of schema.rootFields) {
        this.elements.formFields.append(this.fieldRenderer.renderField(field, item, (options = {}) => {
          this.markDirty(this.activeDataset);
          if (options.rerender) this.renderEditor();
          this.renderDatasetNav();
        }));
      }
    } else if (schema?.rootType === 'objectArray' && schema.itemFields.length > 0) {
      // 顶层 array：把 schema.itemFields 渲染到当前 item
      for (const field of schema.itemFields) {
        this.elements.formFields.append(this.fieldRenderer.renderField(field, item, (options = {}) => {
          this.markDirty(this.activeDataset);
          if (options.rerender) this.renderEditor();
          this.renderDatasetNav();
        }));
      }
    } else {
      // 复杂/超深嵌套：回退 JSON 编辑
      this.elements.formFields.append(this.fallbackJsonEditor());
    }
  }

  fallbackJsonEditor() {
    const wrapper = createElement('div', 'json-fallback');
    const note = createElement('p', 'json-fallback-note', '该数据集结构复杂或无法自动推断，回退到 JSON 文本编辑。');
    const ta = createElement('textarea', 'textarea code-editor');
    ta.spellcheck = false;
    ta.rows = 20;
    ta.value = stableStringify(this.activeItem || {});
    ta.addEventListener('input', () => {
      try {
        const parsed = JSON.parse(ta.value || 'null');
        // 写回 this.data[this.activeDataset]（顶层 array 的话写回对应索引）
        const data = this.data[this.activeDataset];
        if (Array.isArray(data)) data[this.selectedIndex] = parsed;
        else this.data[this.activeDataset] = parsed;
        ta.classList.remove('invalid');
        this.markDirty(this.activeDataset);
        this.renderDatasetNav();
      } catch { ta.classList.add('invalid'); }
    });
    wrapper.append(note, ta);
    return wrapper;
  }

  async renderHistoryPanel() {
    if (!this.elements.historyList) return;
    const list = this.elements.historyList;
    list.replaceChildren();
    if (!this.activeDataset) {
      if (this.elements.snapshotCount) this.elements.snapshotCount.textContent = '0';
      return;
    }
    let snaps = [];
    try {
      snaps = (await this.store.listSnapshotsAsync(this.activeDataset)) || [];
    } catch (e) {
      console.warn('list snapshots failed', e);
    }
    if (this.elements.snapshotCount) this.elements.snapshotCount.textContent = String(snaps.length);
    if (snaps.length === 0) {
      list.append(createElement('div', 'empty-state', '暂无快照（首次保存后生成）'));
      return;
    }
    for (const s of snaps) {
      const row = createElement('div', 'history-row');
      const meta = createElement('div', 'history-meta');
      meta.append(
        createElement('strong', '', this.formatTs(s.ts)),
        createElement('span', '', ` · ${s.size}B`)
      );
      const restoreBtn = createElement('button', 'secondary-btn compact', '恢复此版本');
      restoreBtn.type = 'button';
      restoreBtn.addEventListener('click', () => this.restoreSnapshot(s.name));
      row.append(meta, restoreBtn);
      list.append(row);
    }
  }

  toggleHistoryPanel() {
    if (!this.elements.historyPanel) return;
    const collapsed = this.elements.historyPanel.classList.toggle('collapsed');
    if (this.elements.historyToggle) this.elements.historyToggle.textContent = collapsed ? '▶' : '▼';
  }

  async restoreSnapshot(snapshotName) {
    if (!this.activeDataset) return;
    if (!window.confirm(`确定把「${this.activeDataset}」恢复到快照 ${snapshotName} 吗？\n\n当前内容会自动备份为新快照。`)) return;
    try {
      this.setBusy(true);
      // 先把当前 in-memory 改动写回 game/data（如果是 dirty），触发最新快照
      if (this.dirtyDatasets.has(this.activeDataset)) {
        await this.store.saveDataset(this.activeDataset, this.data[this.activeDataset]);
        this.dirtyDatasets.delete(this.activeDataset);
      }
      const r = await this.store.restoreDataset(this.activeDataset, snapshotName);
      // 重新加载
      const info = await this.store.loadDataset(this.activeDataset);
      this.data[this.activeDataset] = info.data;
      this.schemas[this.activeDataset] = inferSchema(info.data);
      this.renderAll();
      this.toast(`已恢复。新备份：${r.newSnapshot?.name || '无'}`);
    } catch (e) {
      this.toast(`恢复失败：${e.message}`, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async pruneOldSnapshots() {
    if (!this.activeDataset) return;
    if (!window.confirm('清空当前数据集超过 30 天的快照？')) return;
    try {
      const n = await this.store.pruneSnapshotsAsync?.(this.activeDataset, 30) ?? 0;
      this.toast(`已清理 ${n} 个过期快照`);
      this.renderHistoryPanel();
    } catch (e) {
      this.toast(`清理失败：${e.message}`, 'error');
    }
  }

  formatTs(ts) {
    if (!(ts instanceof Date)) ts = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
  }

  selectDataset(datasetKey) {
    this.activeDataset = datasetKey;
    this.selectedIndex = 0;
    this.searchText = '';
    this.elements.recordSearch.value = '';
    this.renderAll();
  }

  get activeItem() {
    if (!this.activeDataset) return null;
    const data = this.data[this.activeDataset];
    if (Array.isArray(data)) return data[this.selectedIndex] || null;
    return data;
  }

  get hasActiveRecord() {
    if (!this.activeDataset) return false;
    const data = this.data[this.activeDataset];
    if (Array.isArray(data)) return data.length > 0 && this.selectedIndex >= 0 && this.selectedIndex < data.length;
    return data != null;
  }

  get isArrayDataset() {
    if (!this.activeDataset) return false;
    return Array.isArray(this.data[this.activeDataset]);
  }

  addRecord() {
    if (!this.isArrayDataset) return;
    const schema = this.schemas[this.activeDataset];
    let next = {};
    if (schema?.itemFields?.length) {
      for (const f of schema.itemFields) {
        if (f.path === 'id') {
          next.id = `${this.activeDataset.replace(/[\/]/g, '_')}_new_${Date.now().toString(36)}`;
        } else if (f.type === 'number' || f.type === 'range') next[f.path] = 0;
        else if (f.type === 'boolean') next[f.path] = false;
        else if (f.type === 'text' || f.type === 'textarea') next[f.path] = '';
        else if (f.type === 'tags') next[f.path] = [];
        else if (f.type === 'object') next[f.path] = {};
        else if (f.type === 'objectArray') next[f.path] = [];
      }
    }
    this.data[this.activeDataset].push(next);
    this.selectedIndex = this.data[this.activeDataset].length - 1;
    this.markDirty(this.activeDataset);
    this.renderAll();
  }

  duplicateRecord() {
    if (!this.isArrayDataset || !this.hasActiveRecord) return;
    const copy = JSON.parse(JSON.stringify(this.activeItem));
    if (copy.id) copy.id = `${copy.id}_copy`;
    this.data[this.activeDataset].push(copy);
    this.selectedIndex = this.data[this.activeDataset].length - 1;
    this.markDirty(this.activeDataset);
    this.renderAll();
  }

  deleteRecord() {
    if (!this.isArrayDataset || !this.hasActiveRecord) return;
    const item = this.activeItem;
    const name = this.getRecordName(item, this.selectedIndex);
    if (!window.confirm(`确定删除「${name}」吗？`)) return;
    this.data[this.activeDataset].splice(this.selectedIndex, 1);
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.markDirty(this.activeDataset);
    this.renderAll();
  }

  async saveActiveDataset() {
    await this.saveDataset(this.activeDataset);
  }

  async saveAllDatasets() {
    if (this.dirtyDatasets.size === 0) {
      this.toast('没有未保存的修改');
      return;
    }
    if (!window.confirm(`将覆盖写入 ${this.dirtyDatasets.size} 个数据集到 game/data（每次保存前会自动备份）。继续？`)) return;
    try {
      this.setBusy(true);
      let ok = 0, fail = 0;
      for (const key of this.dirtyDatasets) {
        try {
          await this.store.saveDataset(key, this.data[key]);
          this.dirtyDatasets.delete(key);
          ok++;
        } catch (e) {
          this.toast(`保存 ${key} 失败：${e.message}`, 'error');
          fail++;
        }
      }
      this.toast(`已保存 ${ok} 个${fail ? `, ${fail} 个失败` : ''}`);
      this.renderAll();
    } finally {
      this.setBusy(false);
    }
  }

  async saveDataset(datasetKey) {
    if (!datasetKey) return;
    if (!window.confirm(`将覆盖写入「${datasetKey}」到 game/data（写前自动备份）。继续？`)) return;
    try {
      this.setBusy(true);
      const r = await this.store.saveDataset(datasetKey, this.data[datasetKey]);
      this.dirtyDatasets.delete(datasetKey);
      this.toast(`已保存（备份：${r.snapshot?.name || '首次'}）`);
      this.renderAll();
    } catch (e) {
      this.toast(`保存失败：${e.message}`, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  getVisibleRecords() {
    const data = this.data[this.activeDataset];
    if (!Array.isArray(data)) {
      if (data == null) return [];
      return [{ index: 0, item: data }];
    }
    return data
      .map((item, index) => ({ item, index }))
      .filter((record) => {
        if (!this.searchText) return true;
        const haystack = [
          record.item.id,
          record.item.type,
          record.item.name,
          record.item.description,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(this.searchText);
      });
  }

  getDatasetCount(key) {
    const data = this.data[key];
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object' && Array.isArray(data.tiles)) return data.tiles.length;
    return data ? 1 : 0;
  }

  getRecordName(item, index) {
    if (!item) return '空记录';
    return item.name || item.id || item.type || `记录 ${index + 1}`;
  }

  getRecordSummary(item) {
    if (!item) return '';
    if (item.type) return String(item.type);
    if (item.id) return String(item.id);
    return '';
  }

  markDirty(key) {
    if (key) this.dirtyDatasets.add(key);
  }

  updateActionState() {
    const isArray = this.isArrayDataset;
    const has = this.hasActiveRecord;
    this.elements.addRecordBtn.disabled = !isArray;
    this.elements.duplicateRecordBtn.disabled = !(isArray && has);
    this.elements.deleteRecordBtn.disabled = !(isArray && has);
  }

  setBusy(isBusy) {
    document.body.classList.toggle('is-busy', isBusy);
  }

  toast(message, type = 'info') {
    if (!this.elements.toastRegion) {
      console.log(`[toast:${type}] ${message}`);
      return;
    }
    const toast = createElement('div', `toast ${type}`, message);
    this.elements.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }
}

const app = new DataEditorApp();
app.init().catch(e => {
  console.error('init failed', e);
  if (document.getElementById('toast-region')) {
    const t = createElement('div', 'toast error', `初始化失败：${e.message}`);
    document.getElementById('toast-region').append(t);
  }
});
