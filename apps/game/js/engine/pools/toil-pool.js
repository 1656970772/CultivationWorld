import { ToilDefinition, ToilExecutor } from '../abstract/toil.js';

class ToilPoolClass {
  constructor() {
    this._definitions = new Map();
    this._executors = new Map();
  }

  loadFromConfig(config) {
    const toils = Array.isArray(config) ? config : (config?.toils || []);
    for (const toil of toils) this.registerDefinition(toil);
  }

  registerDefinition(config) {
    const def = new ToilDefinition(config);
    if (this._definitions.has(def.id)) {
      throw new Error(`Duplicate toil definition: ${def.id}`);
    }
    this._definitions.set(def.id, def);
  }

  registerExecutor(id, executor) {
    if (!(executor instanceof ToilExecutor)) {
      throw new Error(`Toil executor must extend ToilExecutor: ${id}`);
    }
    this._executors.set(id, executor);
  }

  getDefinition(id) {
    return this._definitions.get(id) || null;
  }

  getExecutor(id) {
    const def = this.getDefinition(id);
    if (!def) return null;
    return this._executors.get(def.executorId) || null;
  }

  clear() {
    this._definitions.clear();
    this._executors.clear();
  }
}

export const ToilPool = new ToilPoolClass();
