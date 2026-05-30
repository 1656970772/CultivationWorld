export class SaveManager {
  constructor() {
    this.db = null;
    this.DB_NAME = 'WorldDynamicDB';
    this.STORE_NAME = 'saves';
    this.DB_VERSION = 1;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async save(name, worldSnapshot, logHistory = []) {
    const saveData = {
      id: `save_${Date.now()}`,
      name: name || `存档 - 第${worldSnapshot.currentDay || 0}天`,
      timestamp: Date.now(),
      currentDay: worldSnapshot.currentDay || 0,
      version: '1.0.0',
      worldSnapshot: JSON.parse(JSON.stringify(worldSnapshot)),
      logHistory: [...logHistory]
    };

    return this._put(saveData);
  }

  async load(saveId) {
    return this._get(saveId);
  }

  async list() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const saves = request.result.sort((a, b) => b.timestamp - a.timestamp);
        resolve(saves);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async delete(saveId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.delete(saveId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async exportToFile(saveId) {
    const saveData = await this.load(saveId);
    if (!saveData) throw new Error('存档不存在');

    const json = JSON.stringify(saveData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${saveData.name}_day${saveData.currentDay}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const saveData = JSON.parse(e.target.result);
          saveData.id = `save_imported_${Date.now()}`;
          saveData.name = `[导入] ${saveData.name}`;
          saveData.timestamp = Date.now();
          await this._put(saveData);
          resolve(saveData);
        } catch (err) {
          reject(new Error('无效的存档文件'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async autoSave(worldSnapshot, logHistory = []) {
    const saveData = {
      id: 'auto_save',
      name: `自动存档 - 第${worldSnapshot.currentDay || 0}天`,
      timestamp: Date.now(),
      currentDay: worldSnapshot.currentDay || 0,
      version: '1.0.0',
      worldSnapshot: JSON.parse(JSON.stringify(worldSnapshot)),
      logHistory: [...logHistory]
    };
    return this._put(saveData);
  }

  async _put(data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  async _get(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
}
