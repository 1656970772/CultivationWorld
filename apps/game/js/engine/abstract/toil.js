export const ToilResultStatus = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  REPLAN: 'replan',
  ABORT: 'abort',
});

export class ToilDefinition {
  constructor(config) {
    if (!config?.id || !config.id.startsWith('toil_')) {
      throw new Error(`Toil id must start with toil_: ${config?.id}`);
    }
    this.id = config.id;
    this.name = config.name || config.id;
    this.executorId = config.executorId || config.id;
    this.category = config.category || 'general';
  }
}

export class ToilExecutor {
  run(_entity, _worldContext, _job, _toil) {
    throw new Error('ToilExecutor.run() must be overridden');
  }
}
