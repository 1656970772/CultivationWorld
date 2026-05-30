import { DataStore } from './data-store.js';
import { FieldRenderer, createElement } from './field-renderer.js';
import {
  DATASET_ORDER,
  DATASET_SCHEMAS,
  cloneEmptyItem,
  getDatasetSchema,
  getSchemaKey
} from './schema-registry.js';
import { validateAllData } from './validation.js';

class DataEditorApp {
  constructor() {
    this.store = new DataStore(DATASET_SCHEMAS);
    this.datasets = {};
    this.issues = [];
    this.dirtyDatasets = new Set();
    this.activeDataset = 'factions';
    this.selectedIndex = 0;
    this.searchText = '';
    this.fieldRenderer = new FieldRenderer(this.datasets);

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
      deleteRecordBtn: document.getElementById('delete-record-btn')
    };
  }

  async init() {
    this.bindEvents();
    await this.reloadData();
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
  }

  async reloadData() {
    try {
      this.setBusy(true);
      this.datasets = await this.store.loadAll();
      this.fieldRenderer.updateDatasets(this.datasets);
      this.runValidation();
      this.selectedIndex = 0;
      this.dirtyDatasets.clear();
      this.renderAll();
      this.toast('数据已加载。');
    } catch (error) {
      this.toast(error.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async pickDirectory() {
    try {
      this.setBusy(true);
      const pickedDatasets = await this.store.pickProjectDirectory();
      if (pickedDatasets === null) return;
      this.datasets = pickedDatasets;
      this.fieldRenderer.updateDatasets(this.datasets);
      this.runValidation();
      this.selectedIndex = 0;
      this.dirtyDatasets.clear();
      this.renderAll();
      this.toast('已打开项目。');
    } catch (error) {
      this.toast(error.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  renderAll() {
    this.elements.sourceLabel.textContent = this.store.sourceLabel;
    this.renderDatasetNav();
    this.renderRecordList();
    this.renderEditor();
    this.renderDetailCard();
    this.updateActionState();
  }

  renderDatasetNav() {
    this.elements.datasetNav.replaceChildren();

    for (const datasetKey of DATASET_ORDER) {
      const schema = getDatasetSchema(datasetKey);
      const count = this.getDatasetCount(datasetKey);
      const issueCount = this.countIssues(datasetKey);
      const button = createElement('button', datasetKey === this.activeDataset ? 'dataset-tab active' : 'dataset-tab');
      button.type = 'button';

      const icon = createElement('span', 'dataset-icon', schema.icon);
      const textWrap = createElement('span', 'dataset-tab-text');
      const label = createElement('span', 'dataset-label', schema.label);
      const meta = createElement('span', 'dataset-meta', `${count} 条`);
      textWrap.append(label, meta);

      const markers = createElement('span', 'dataset-markers');
      if (this.dirtyDatasets.has(datasetKey)) {
        markers.append(createElement('span', 'dirty-dot', '改'));
      }
      if (issueCount > 0) {
        markers.append(createElement('span', 'issue-dot', String(issueCount)));
      }

      button.append(icon, textWrap, markers);
      button.addEventListener('click', () => this.selectDataset(datasetKey));
      this.elements.datasetNav.append(button);
    }
  }

  renderRecordList() {
    const schema = this.activeSchema;
    const list = this.elements.recordList;
    list.replaceChildren();

    const records = this.getVisibleRecords();
    if (records.length === 0) {
      list.append(createElement('div', 'empty-state', '没有匹配记录'));
      return;
    }

    for (const record of records) {
      const item = record.item;
      const button = createElement('button', record.index === this.selectedIndex ? 'record-item active' : 'record-item');
      button.type = 'button';
      const title = createElement('span', 'record-name', this.getRecordName(schema, item, record.index));
      const meta = createElement('span', 'record-meta', schema.summary ? schema.summary(item) : getSchemaKey(schema, item));
      const issues = this.countIssues(`${this.activeDataset}[${record.index}]`);
      button.append(title, meta);
      if (issues > 0) {
        button.append(createElement('span', 'record-issue', String(issues)));
      }
      button.addEventListener('click', () => {
        this.selectedIndex = record.index;
        this.renderRecordList();
        this.renderEditor();
        this.renderDetailCard();
        this.updateActionState();
      });
      list.append(button);
    }
  }

  renderEditor() {
    const schema = this.activeSchema;
    const item = this.activeItem;
    const hasRecord = this.hasActiveRecord;

    this.elements.datasetKicker.textContent = `${schema.label} · ${schema.file}`;
    this.elements.recordTitle.textContent = hasRecord ? this.getRecordName(schema, item, this.selectedIndex) : '暂无记录';
    this.elements.recordSubtitle.textContent = hasRecord ? schema.description : '点击“新增”创建第一条记录。';
    this.elements.dirtyIndicator.textContent = this.dirtyDatasets.has(this.activeDataset) ? '有未保存修改' : '未修改';
    this.elements.dirtyIndicator.classList.toggle('dirty', this.dirtyDatasets.has(this.activeDataset));

    this.elements.formFields.replaceChildren();
    if (!hasRecord) {
      this.elements.formFields.append(createElement('div', 'empty-state', '当前卷宗暂无记录。'));
      return;
    }

    for (const field of schema.fields || []) {
      this.elements.formFields.append(this.fieldRenderer.renderField(field, item, (options = {}) => {
        this.markDirty(this.activeDataset);
        this.runValidation();
        if (options.rerender) {
          this.renderEditor();
        }
        this.renderDatasetNav();
        this.renderDetailCard();
        this.updateActionState();
      }));
    }
  }

  renderDetailCard() {
    const placeholder = createElement('div', 'detail-card-empty');
    placeholder.append(
      createElement('strong', '', '详情卡预留区'),
      createElement('span', '', '后续用于角色卡、势力卡、地图卡')
    );
    this.elements.detailCard.replaceChildren(placeholder);
  }

  selectDataset(datasetKey) {
    this.activeDataset = datasetKey;
    this.selectedIndex = 0;
    this.searchText = '';
    this.elements.recordSearch.value = '';
    this.renderAll();
  }

  addRecord() {
    const schema = this.activeSchema;
    if (schema.collection !== 'array') return;

    const nextItem = cloneEmptyItem(schema);
    this.assignUniqueKey(nextItem, schema);
    this.datasets[this.activeDataset].push(nextItem);
    this.selectedIndex = this.datasets[this.activeDataset].length - 1;
    this.markDirty(this.activeDataset);
    this.runValidation();
    this.renderAll();
  }

  duplicateRecord() {
    const schema = this.activeSchema;
    if (schema.collection !== 'array' || !this.hasActiveRecord) return;

    const copy = JSON.parse(JSON.stringify(this.activeItem));
    this.assignUniqueKey(copy, schema);
    if (copy.name) copy.name = `${copy.name} 副本`;
    this.datasets[this.activeDataset].push(copy);
    this.selectedIndex = this.datasets[this.activeDataset].length - 1;
    this.markDirty(this.activeDataset);
    this.runValidation();
    this.renderAll();
  }

  deleteRecord() {
    const schema = this.activeSchema;
    if (schema.collection !== 'array' || !this.hasActiveRecord) return;
    const item = this.activeItem;
    const name = this.getRecordName(schema, item, this.selectedIndex);
    if (!window.confirm(`确定删除「${name}」吗？`)) return;

    this.datasets[this.activeDataset].splice(this.selectedIndex, 1);
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.markDirty(this.activeDataset);
    this.runValidation();
    this.renderAll();
  }

  async saveActiveDataset() {
    await this.saveDataset(this.activeDataset);
  }

  async saveAllDatasets() {
    const errors = this.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0 && !window.confirm(`当前共有 ${errors.length} 个错误，仍然保存全部数据吗？`)) {
      return;
    }

    try {
      this.setBusy(true);
      const results = await this.store.saveAll(this.datasets);
      const wroteFiles = results.every((result) => this.isWriteBackResult(result));
      if (wroteFiles) {
        this.dirtyDatasets.clear();
        const backupResult = results.find((result) => result.mode === 'tauri' && result.backupPath);
        this.toast(`全部数据已写回文件${this.getBackupHint(backupResult)}。`);
      } else {
        this.toast('浏览器未授权目录，已逐个下载 JSON。');
      }
      this.renderAll();
    } catch (error) {
      this.toast(error.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async saveDataset(datasetKey) {
    const activeErrors = this.issues.filter((issue) =>
      issue.severity === 'error' && issue.path.startsWith(datasetKey)
    );
    if (activeErrors.length > 0 && !window.confirm(`当前卷宗有 ${activeErrors.length} 个错误，仍然保存吗？`)) {
      return;
    }

    try {
      this.setBusy(true);
      const result = await this.store.saveDataset(datasetKey, this.datasets[datasetKey]);
      if (this.isWriteBackResult(result)) {
        this.dirtyDatasets.delete(datasetKey);
        this.toast(`${result.fileName} 已写回文件${this.getBackupHint(result)}。`);
      } else {
        this.toast(`${result.fileName} 已下载，原文件未自动覆盖。`);
      }
      this.renderAll();
    } catch (error) {
      this.toast(error.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  runValidation() {
    this.issues = validateAllData(this.datasets, DATASET_SCHEMAS);
  }

  get activeSchema() {
    return getDatasetSchema(this.activeDataset);
  }

  get activeItem() {
    const data = this.datasets[this.activeDataset];
    if (Array.isArray(data)) {
      return data[this.selectedIndex] || data[0] || null;
    }
    return data || {};
  }

  get hasActiveRecord() {
    const data = this.datasets[this.activeDataset];
    if (Array.isArray(data)) {
      return data.length > 0 && this.selectedIndex >= 0 && this.selectedIndex < data.length;
    }
    return data != null;
  }

  getVisibleRecords() {
    const schema = this.activeSchema;
    const data = this.datasets[this.activeDataset];

    if (!Array.isArray(data)) {
      return [{ index: 0, item: data || {} }];
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
          schema.summary ? schema.summary(record.item) : ''
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(this.searchText);
      });
  }

  getDatasetCount(datasetKey) {
    const data = this.datasets[datasetKey];
    if (Array.isArray(data)) return data.length;
    if (data?.tiles) return data.tiles.length;
    return data ? 1 : 0;
  }

  getRecordName(schema, item, index) {
    if (!item) return '空记录';
    return item.name || item.id || item.type || `${schema.itemName || '记录'} ${index + 1}`;
  }

  countIssues(pathPrefix) {
    return this.issues.filter((issue) => issue.path.startsWith(pathPrefix)).length;
  }

  assignUniqueKey(item, schema) {
    if (!schema.keyField) return;
    const existing = new Set((this.datasets[this.activeDataset] || []).map((entry) => entry[schema.keyField]));
    const rawBase = item[schema.keyField] || `${this.activeDataset}_new`;
    const base = rawBase.replace(/_\d+$/, '');
    let candidate = rawBase;
    let index = 1;
    while (existing.has(candidate)) {
      candidate = `${base}_${String(index).padStart(3, '0')}`;
      index++;
    }
    item[schema.keyField] = candidate;
  }

  markDirty(datasetKey) {
    this.dirtyDatasets.add(datasetKey);
  }

  isWriteBackResult(result) {
    return result.mode === 'file' || result.mode === 'tauri';
  }

  getBackupHint(result) {
    if (result?.mode !== 'tauri' || !result.backupPath) return '';
    const backupFile = String(result.backupPath).split(/[\\/]/).pop();
    return backupFile ? `（已备份：${backupFile}）` : '（已备份）';
  }

  updateActionState() {
    const schema = this.activeSchema;
    const isArray = schema.collection === 'array';
    const canUseRecordAction = isArray && this.hasActiveRecord;
    this.elements.addRecordBtn.disabled = !isArray;
    this.elements.duplicateRecordBtn.disabled = !canUseRecordAction;
    this.elements.deleteRecordBtn.disabled = !canUseRecordAction;
    this.elements.pickDirBtn.disabled = !this.store.canUseDirectoryPicker;
  }

  setBusy(isBusy) {
    document.body.classList.toggle('is-busy', isBusy);
  }

  toast(message, type = 'info') {
    const toast = createElement('div', `toast ${type}`, message);
    this.elements.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }
}

const app = new DataEditorApp();
app.init();
