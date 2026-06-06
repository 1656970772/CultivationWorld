import { JobPool } from '../pools/job-pool.js';
import { ToilPool } from '../pools/toil-pool.js';
import { JobResultStatus, JobStatus } from './job.js';
import { ToilResultStatus } from './toil.js';

export class JobSystem {
  constructor() {
    this.currentJob = null;
    this.jobRemaining = 0;
    this.lastReason = null;
  }

  start(jobId, input = {}) {
    this.currentJob = JobPool.create(jobId, input);
    this.jobRemaining = 0;
    this.lastReason = null;
    return this.currentJob;
  }

  executeStep(entity, worldContext) {
    if (!this.currentJob) {
      return { status: JobResultStatus.FAILED, reason: 'no_current_job' };
    }

    const job = this.currentJob;
    if (job.status === JobStatus.PAUSED) {
      return {
        status: JobResultStatus.RUNNING,
        reason: 'job_paused',
        remaining: this.jobRemaining,
      };
    }

    const toil = job.currentToil;
    if (!toil) {
      return this.complete(entity);
    }

    const toilContext = {
      currentToilId: toil.id,
      currentToilType: toil.type,
      failedToilId: toil.id,
      failedToilType: toil.type,
    };
    const executor = ToilPool.getExecutor(toil.type);
    if (!executor) {
      return this.fail('missing_toil_executor', toilContext);
    }

    const result = executor.run(entity, worldContext, job, toil) || {};
    job.lastResult = result;
    this.lastReason = result.reason || null;

    if (result.contextPatch) {
      job.context = { ...job.context, ...result.contextPatch };
    }

    if (result.effects) {
      applyEffects(entity, result.effects);
    }

    this.jobRemaining = result.remaining ?? 0;

    switch (result.status) {
      case ToilResultStatus.SUCCESS:
        job.currentToilIndex += 1;
        this.jobRemaining = 0;
        if (!job.currentToil) {
          return this.complete(entity);
        }
        return {
          status: JobResultStatus.RUNNING,
          reason: result.reason,
          currentToilId: job.currentToil.id,
        };
      case ToilResultStatus.FAILED:
        return this.fail(result.reason || 'toil_failed', toilContext);
      case ToilResultStatus.REPLAN:
        {
          const reason = result.reason || 'toil_replan';
          const context = { ...job.context };
          job.status = JobStatus.ABORTED;
          job.lastResult = { ...context, ...toilContext, status: JobResultStatus.REPLAN, reason };
          this.jobRemaining = 0;
          this.lastReason = reason;
          this.currentJob = null;
          return { ...context, ...toilContext, status: JobResultStatus.REPLAN, reason };
        }
      case ToilResultStatus.ABORT:
        return this.abort(result.reason || 'toil_abort', toilContext);
      case ToilResultStatus.BLOCKED:
        return {
          status: JobResultStatus.RUNNING,
          reason: result.reason || 'toil_blocked',
          remaining: this.jobRemaining,
        };
      case ToilResultStatus.RUNNING:
      default:
        return {
          status: JobResultStatus.RUNNING,
          reason: result.reason,
          remaining: this.jobRemaining,
        };
    }
  }

  pause(reason) {
    if (!this.currentJob) return { status: JobResultStatus.FAILED, reason: 'no_current_job' };
    this.currentJob.status = JobStatus.PAUSED;
    this.lastReason = reason || null;
    return { status: JobResultStatus.RUNNING, reason };
  }

  resume(reason) {
    if (!this.currentJob) return { status: JobResultStatus.FAILED, reason: 'no_current_job' };
    this.currentJob.status = JobStatus.RUNNING;
    this.lastReason = reason || null;
    return { status: JobResultStatus.RUNNING, reason };
  }

  abort(reason, extraContext = {}) {
    const context = { ...(this.currentJob?.context || {}) };
    if (this.currentJob) {
      this.currentJob.status = JobStatus.ABORTED;
    }
    this.currentJob = null;
    this.jobRemaining = 0;
    this.lastReason = reason || null;
    return { ...context, ...extraContext, status: JobResultStatus.ABORT, reason };
  }

  complete(entity) {
    if (!this.currentJob) {
      return { status: JobResultStatus.FAILED, reason: 'no_current_job' };
    }
    const job = this.currentJob;
    const context = { ...job.context };
    applyEffects(entity, job.definition.successEffects || {});
    job.status = JobStatus.COMPLETED;
    this.currentJob = null;
    this.jobRemaining = 0;
    return { ...context, status: JobResultStatus.SUCCESS, reason: 'job_completed' };
  }

  fail(reason, extraContext = {}) {
    const context = { ...(this.currentJob?.context || {}) };
    if (this.currentJob) {
      this.currentJob.status = JobStatus.FAILED;
    }
    this.currentJob = null;
    this.jobRemaining = 0;
    this.lastReason = reason || null;
    return { ...context, ...extraContext, status: JobResultStatus.FAILED, reason };
  }

  hasJob() {
    return this.currentJob != null;
  }

  snapshot() {
    const job = this.currentJob;
    const toil = job?.currentToil || null;
    return {
      currentJobId: job?.definitionId || null,
      currentJobInstanceId: job?.id || null,
      currentToilId: toil?.id || null,
      currentToilIndex: job?.currentToilIndex ?? -1,
      jobStatus: job?.status || JobStatus.IDLE,
      jobRemaining: this.jobRemaining,
      jobContext: { ...(job?.context || {}) },
    };
  }
}

function applyEffects(entity, effects) {
  if (!entity?.state || !effects) return;
  for (const [key, effect] of Object.entries(effects)) {
    applyEffect(entity.state, key, effect);
  }
}

function applyEffect(state, key, effect) {
  const op = effect?.op || 'set';
  const value = effect?.value;
  const current = getStateValue(state, key);

  if (op === 'set') {
    setStateValue(state, key, value);
    return;
  }
  if (op === 'add') {
    setStateValue(state, key, (current || 0) + value);
    return;
  }
  if (op === 'min') {
    setStateValue(state, key, current == null ? value : Math.min(current, value));
    return;
  }
  if (op === 'max') {
    setStateValue(state, key, current == null ? value : Math.max(current, value));
  }
}

function getStateValue(state, key) {
  if (typeof state.get === 'function') return state.get(key);
  return state[key];
}

function setStateValue(state, key, value) {
  if (typeof state.set === 'function') {
    state.set(key, value);
    return;
  }
  state[key] = value;
}
