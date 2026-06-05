export const JobStatus = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted',
});

export const JobResultStatus = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  REPLAN: 'replan',
  ABORT: 'abort',
});

let nextJobInstanceSeq = 1;

export class JobDefinition {
  constructor(config) {
    if (!config?.id || !config.id.startsWith('job_')) {
      throw new Error(`Job id must start with job_: ${config?.id}`);
    }
    if (!Array.isArray(config.toils) || config.toils.length === 0) {
      throw new Error(`Job ${config.id} must define non-empty toils`);
    }

    this.id = config.id;
    this.name = config.name || config.id;
    this.category = config.category || 'general';
    this.input = config.input || {};
    this.successEffects = config.successEffects || {};
    this.interrupt = config.interrupt || {};
    this.toils = config.toils.map((toil, index) => {
      if (!toil?.id) {
        throw new Error(`Job ${config.id} toil at index ${index} missing id`);
      }
      if (!toil?.type || !toil.type.startsWith('toil_')) {
        throw new Error(`Job ${config.id} toil ${toil.id} type must start with toil_`);
      }
      return { params: {}, ...toil };
    });
  }
}

export class JobInstance {
  constructor(definition, input = {}) {
    this.id = `${definition.id}#${nextJobInstanceSeq++}`;
    this.definition = definition;
    this.definitionId = definition.id;
    this.name = definition.name;
    this.status = JobStatus.RUNNING;
    this.currentToilIndex = 0;
    this.context = { ...(definition.input || {}), ...(input || {}) };
    this.lastResult = null;
  }

  get currentToil() {
    return this.definition.toils[this.currentToilIndex] || null;
  }
}
