#!/usr/bin/env node
import { isAbsolute, resolve } from 'node:path';
import {
  applyVerificationConfigOverrides,
  evaluateDefaultEnableGate,
  parseGateArgs,
  renderGateReport,
  resolveReportPath,
  recoveryRatioOf,
} from './verify-dynamic-goals-gates.mjs';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

function assertThrows(fn, msg) {
  try {
    fn();
    assert(false, msg);
  } catch {
    assert(true, msg);
  }
}

function stats(overrides = {}) {
  return {
    phaseChanges: 3,
    phaseByType: { secret_realm: 2, sect_tournament: 1 },
    awarenessObservations: 10,
    awareNpcs: new Set(['npc_a']),
    candidateGoalCount: 8,
    uniqueCandidateKeys: new Set(['candidate_a']),
    candidateBySource: { prepare_tournament: 2 },
    candidateByKind: { preparation: 4, window: 4 },
    dynamicPlanCount: 6,
    dynamicPlanByKind: { preparation: 3, window: 3 },
    dynamicPlanBySource: { prepare_secret_realm: 3, join_secret_realm: 3 },
    interruptCount: 2,
    interruptByDecision: { after_step: 1, ignore: 1 },
    dynamicActions: { prepare: 2, join: 2, prepareSucceeded: 2, joinSucceeded: 2 },
    jobActions: {
      planned: 6,
      started: 4,
      completed: 4,
      failed: 0,
      aborted: 0,
      byJobId: { job_npc_prepare_secret_realm: 2, job_npc_join_dynamic_event: 2 },
      byToilId: { bind_event: 4, mark_prepared: 2, mark_participant: 2 },
      failureReasons: {},
    },
    dynamicActionNpcs: new Set(['npc_a', 'npc_b']),
    recoveredNpcs: new Set(['npc_a', 'npc_b']),
    normalPlanCount: 10,
    normalActionCount: 9,
    normalPlanAfterDynamic: 5,
    normalActionAfterDynamic: 4,
    ...overrides,
  };
}

console.log('1) parse strict gate args');
const parsed = parseGateArgs([
  '--days=900',
  '--seeds=12345,67890',
  '--min-recovery=0.9',
  '--require-zero-job-failures',
  '--use-config-defaults',
  '--report=docs/superpowers/reports/out.md',
]);
assert(parsed.minRecoveryRatio === 0.9, 'min recovery parsed as ratio');
assert(parsed.requireZeroJobFailures === true, 'require-zero-job-failures parsed');
assert(parsed.useConfigDefaults === true, 'use-config-defaults parsed');
assert(parsed.reportPath === 'docs/superpowers/reports/out.md', 'report path parsed');
assertThrows(() => parseGateArgs(['--min-recovery=1.1']), 'invalid min recovery is rejected');
assertThrows(() => parseGateArgs(['--unknown-gate']), 'unknown gate arg is rejected');

console.log('2) recovery ratio handles empty dynamic action set');
assert(recoveryRatioOf(stats({ dynamicActionNpcs: new Set(), recoveredNpcs: new Set() })) === 1, 'empty dynamic action set is fully recovered');
assert(recoveryRatioOf(stats({ dynamicActionNpcs: new Set(['a', 'b']), recoveredNpcs: new Set(['a']) })) === 0.5, 'partial recovery ratio is calculated');

console.log('3) strict gate passes healthy stats');
const healthy = evaluateDefaultEnableGate(stats(), {
  minRecoveryRatio: 0.9,
  requireZeroJobFailures: true,
});
assert(healthy.ok === true, 'healthy stats pass strict gate');
assert(healthy.recoveryRatio === 1, 'healthy gate exposes recovery ratio');

console.log('4) strict gate fails low recovery');
const lowRecovery = evaluateDefaultEnableGate(stats({
  dynamicActionNpcs: new Set(['a', 'b', 'c']),
  recoveredNpcs: new Set(['a']),
}), { minRecoveryRatio: 0.9, requireZeroJobFailures: true });
assert(lowRecovery.ok === false, 'low recovery fails strict gate');
assert(lowRecovery.checks.some(check => check.key === 'recovery_ratio' && check.ok === false), 'low recovery failure is named');

console.log('5) strict gate fails job failures and aborts');
const failedJobs = evaluateDefaultEnableGate(stats({
  jobActions: {
    planned: 6,
    started: 4,
    completed: 2,
    failed: 1,
    aborted: 1,
    byJobId: { job_npc_prepare_secret_realm: 2 },
    byToilId: {},
    failureReasons: { dynamic_event_missing: 1, replan: 1 },
  },
}), { minRecoveryRatio: 0.9, requireZeroJobFailures: true });
assert(failedJobs.ok === false, 'job failure stats fail strict gate');
assert(failedJobs.checks.some(check => check.key === 'zero_job_failures' && check.ok === false), 'job failure gate is named');

console.log('6) report includes source numbers and verification method');
const report = renderGateReport({
  stats: stats(),
  days: 900,
  seeds: [12345, 67890, 24680],
  options: { minRecoveryRatio: 0.9, requireZeroJobFailures: true, useConfigDefaults: true },
});
assert(report.includes('# Job/Toil 默认启用验证报告'), 'report has Chinese title');
assert(report.includes('恢复率：100.0%'), 'report prints recovery ratio');
assert(report.includes('真实多种子长程模拟输出'), 'report names direct simulation observation source');

console.log('7) report path resolves from repository root');
const relativeReportPath = resolveReportPath('docs/superpowers/reports/out.md');
assert(relativeReportPath === resolve(process.cwd(), '..', '..', 'docs/superpowers/reports/out.md'), 'docs report path resolves to repository root');
const absoluteReportPath = resolve(process.cwd(), 'tmp', 'out.md');
assert(isAbsolute(absoluteReportPath), 'absolute report test path is absolute');
assert(resolveReportPath(absoluteReportPath) === absoluteReportPath, 'absolute report path stays unchanged');

console.log('8) config defaults ignore active env overrides');
const defaultConfigs = {
  dynamicEvents: { enabled: true },
  dynamicGoals: { enabled: true },
  aiConfig: { npc: { jobs: { enabled: true } } },
  worldNews: { enabled: false },
  worldOpportunities: { enabled: false },
  balanceReward: { enabled: false },
};
const closedEnv = {
  DYNAMIC_EVENTS_ACTIVE: '0',
  DYNAMIC_GOALS_ACTIVE: '0',
  JOBS_ACTIVE: '0',
};
const configDefaults = applyVerificationConfigOverrides(defaultConfigs, { useConfigDefaults: true }, closedEnv);
assert(configDefaults === defaultConfigs, 'use-config-defaults returns original config object');
assert(configDefaults.dynamicEvents.enabled === true, 'use-config-defaults ignores DYNAMIC_EVENTS_ACTIVE=0');
assert(configDefaults.dynamicGoals.enabled === true, 'use-config-defaults ignores DYNAMIC_GOALS_ACTIVE=0');
assert(configDefaults.aiConfig.npc.jobs.enabled === true, 'use-config-defaults ignores JOBS_ACTIVE=0');

if (failed > 0) {
  console.error(`\nDynamic goal gate tests failed: ${failed}`);
  process.exit(1);
}
console.log('\nDynamic goal gate tests passed');
