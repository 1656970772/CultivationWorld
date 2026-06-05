import { JobDefinition, JobInstance } from '../abstract/job.js';

class JobPoolClass {
  constructor() {
    this._definitions = new Map();
  }

  loadFromConfig(config) {
    const jobs = Array.isArray(config) ? config : (config?.jobs || []);
    for (const job of jobs) this.register(job);
  }

  register(config) {
    const def = new JobDefinition(config);
    if (this._definitions.has(def.id)) {
      throw new Error(`Duplicate job definition: ${def.id}`);
    }
    this._definitions.set(def.id, def);
  }

  get(id) {
    return this._definitions.get(id) || null;
  }

  has(id) {
    return this._definitions.has(id);
  }

  create(id, input = {}) {
    const def = this.get(id);
    if (!def) throw new Error(`Job definition not found: ${id}`);
    return new JobInstance(def, input);
  }

  clear() {
    this._definitions.clear();
  }
}

export const JobPool = new JobPoolClass();
