import { eventBus } from '../core/event-bus.js';
import { EVENTS } from '../core/constants.js';

export class SavePanel {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.saveManager = null;
    this.isVisible = false;
    this.onSave = null;
    this.onLoad = null;
  }

  setSaveManager(saveManager) {
    this.saveManager = saveManager;
  }

  toggle() {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'block' : 'none';
    if (this.isVisible) this.refresh();
  }

  async refresh() {
    if (!this.saveManager) return;
    const saves = await this.saveManager.list();
    this.render(saves);
  }

  render(saves) {
    let html = `<h3 style="color:#a29bfe;margin-bottom:12px;">存档管理</h3>`;

    html += `<div style="display:flex;gap:8px;margin-bottom:12px;">`;
    html += `<button class="save-btn" id="save-new">新建存档</button>`;
    html += `<button class="save-btn" id="save-import">导入</button>`;
    html += `<button class="save-btn" id="save-close">关闭</button>`;
    html += `</div>`;

    html += `<div class="save-list">`;
    if (saves.length === 0) {
      html += `<p style="color:#6c6c8a;text-align:center;">暂无存档</p>`;
    }
    for (const save of saves) {
      const date = new Date(save.timestamp).toLocaleString('zh-CN');
      const isAuto = save.id === 'auto_save';
      html += `<div class="save-item" data-save-id="${save.id}">
        <div class="save-info">
          <span class="save-name">${isAuto ? '🔄 ' : ''}${save.name}</span>
          <span class="save-meta">第${save.currentDay}天 · ${date}</span>
        </div>
        <div class="save-actions">
          <button class="save-action-btn load-btn" data-id="${save.id}">读取</button>
          <button class="save-action-btn export-btn" data-id="${save.id}">导出</button>
          <button class="save-action-btn delete-btn" data-id="${save.id}">删除</button>
        </div>
      </div>`;
    }
    html += `</div>`;

    html += `<input type="file" id="import-file-input" accept=".json" style="display:none;">`;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  bindEvents() {
    this.container.querySelector('#save-new')?.addEventListener('click', async () => {
      const name = prompt('存档名称：');
      if (name !== null && this.onSave) {
        const snapshot = this.onSave();
        await this.saveManager.save(name, snapshot);
        this.refresh();
        eventBus.publish(EVENTS.SAVE_COMPLETE, {});
      }
    });

    this.container.querySelector('#save-import')?.addEventListener('click', () => {
      this.container.querySelector('#import-file-input')?.click();
    });

    this.container.querySelector('#import-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await this.saveManager.importFromFile(file);
        this.refresh();
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    });

    this.container.querySelector('#save-close')?.addEventListener('click', () => this.toggle());

    this.container.querySelectorAll('.load-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const saveData = await this.saveManager.load(btn.dataset.id);
        if (saveData && this.onLoad) {
          this.onLoad(saveData);
          this.toggle();
          eventBus.publish(EVENTS.LOAD_COMPLETE, { saveId: saveData.id });
        }
      });
    });

    this.container.querySelectorAll('.export-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await this.saveManager.exportToFile(btn.dataset.id);
      });
    });

    this.container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('确定要删除这个存档吗？')) {
          await this.saveManager.delete(btn.dataset.id);
          this.refresh();
        }
      });
    });
  }
}
