export function parseGateArgs(args = []) {
  const options = {
    minRecoveryRatio: 0.5,
    requireZeroJobFailures: false,
    useConfigDefaults: false,
    reportPath: null,
  };

  for (const arg of args) {
    let match;
    if ((match = /^--min-recovery=(.+)$/.exec(arg))) {
      const ratio = Number(match[1]);
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        throw new Error(`Invalid --min-recovery value: ${match[1]}`);
      }
      options.minRecoveryRatio = ratio;
    } else if (arg === '--require-zero-job-failures') {
      options.requireZeroJobFailures = true;
    } else if (arg === '--use-config-defaults') {
      options.useConfigDefaults = true;
    } else if ((match = /^--report=(.+)$/.exec(arg))) {
      options.reportPath = match[1];
    } else if (/^--days=\d+$/.test(arg) || /^--seeds=[\d,]+$/.test(arg)) {
      continue;
    } else {
      throw new Error(`Unknown verification argument: ${arg}`);
    }
  }
  return options;
}

export function recoveryRatioOf(stats) {
  const total = stats.dynamicActionNpcs?.size || 0;
  if (total === 0) return 1;
  return (stats.recoveredNpcs?.size || 0) / total;
}

function count(stats, path, fallback = 0) {
  let value = stats;
  for (const key of path.split('.')) value = value?.[key];
  return Number(value ?? fallback) || 0;
}

function hasAnyJob(stats, ids) {
  const byJobId = stats.jobActions?.byJobId || {};
  return ids.some(id => count(byJobId, id) > 0);
}

export function evaluateDefaultEnableGate(stats, options = {}) {
  const minRecoveryRatio = Number(options.minRecoveryRatio ?? 0.5);
  const recoveryRatio = recoveryRatioOf(stats);
  const nonImmediateInterrupts = count(stats, 'interruptByDecision.after_step')
    + count(stats, 'interruptByDecision.keep_current_queue')
    + count(stats, 'interruptByDecision.ignore');
  const totalDynamicActions = count(stats, 'dynamicActions.prepare') + count(stats, 'dynamicActions.join');
  const checks = [
    { key: 'phase_changes', ok: count(stats, 'phaseChanges') > 0, message: `动态事件阶段真实推进（阶段变化 ${count(stats, 'phaseChanges')} 次）` },
    { key: 'secret_realm_window', ok: count(stats, 'phaseByType.secret_realm') > 0, message: `默认天数覆盖秘境事件窗口（阶段变化 ${count(stats, 'phaseByType.secret_realm')} 次）` },
    { key: 'sect_tournament_window', ok: count(stats, 'phaseByType.sect_tournament') > 0, message: `默认天数覆盖宗门大比事件窗口（阶段变化 ${count(stats, 'phaseByType.sect_tournament')} 次）` },
    { key: 'awareness', ok: (stats.awareNpcs?.size || 0) > 0, message: `NPC 真实知晓动态事件（${stats.awareNpcs?.size || 0} 人，观察 ${count(stats, 'awarenessObservations')} 次）` },
    { key: 'candidate_goals', ok: count(stats, 'candidateGoalCount') > 0 && (stats.uniqueCandidateKeys?.size || 0) > 0, message: `DynamicGoalProvider 规则真实产出候选目标（观察 ${count(stats, 'candidateGoalCount')} 次，唯一 ${stats.uniqueCandidateKeys?.size || 0} 个）` },
    { key: 'prepare_tournament_candidates', ok: count(stats, 'candidateBySource.prepare_tournament') > 0, message: `宗门大比预告真实产出 prepare_tournament 候选目标（${count(stats, 'candidateBySource.prepare_tournament')} 次）` },
    { key: 'preparation_candidates', ok: count(stats, 'candidateByKind.preparation') > 0, message: `PreparationGoal 候选真实产出（${count(stats, 'candidateByKind.preparation')} 次）` },
    { key: 'window_candidates', ok: count(stats, 'candidateByKind.window') > 0, message: `WindowGoal 候选真实产出（${count(stats, 'candidateByKind.window')} 次）` },
    { key: 'dynamic_plan', ok: count(stats, 'dynamicPlanCount') > 0, message: `动态 Goal 真实进入 planResult（${count(stats, 'dynamicPlanCount')} 次）` },
    { key: 'preparation_plan', ok: count(stats, 'dynamicPlanByKind.preparation') > 0, message: `PreparationGoal 真实进入 planResult（${count(stats, 'dynamicPlanByKind.preparation')} 次）` },
    { key: 'window_plan', ok: count(stats, 'dynamicPlanByKind.window') > 0, message: `WindowGoal 真实进入 planResult（${count(stats, 'dynamicPlanByKind.window')} 次）` },
    { key: 'prepare_and_join_plan', ok: count(stats, 'dynamicPlanBySource.prepare_secret_realm') > 0 && count(stats, 'dynamicPlanBySource.join_secret_realm') > 0, message: `秘境准备目标可在开启后自然转为窗口目标（prepare=${count(stats, 'dynamicPlanBySource.prepare_secret_realm')}, join=${count(stats, 'dynamicPlanBySource.join_secret_realm')}）` },
    { key: 'interrupt_count', ok: count(stats, 'interruptCount') > 0, message: `InterruptPolicy 真实做出动态打断决策（${count(stats, 'interruptCount')} 次）` },
    { key: 'interrupt_policy', ok: nonImmediateInterrupts > 0, message: `动态目标不是无脑立即打断（after_step/queue/ignore 合计 ${nonImmediateInterrupts} 次）` },
    { key: 'dynamic_actions', ok: totalDynamicActions > 0, message: `准备/参与动态事件行为真实执行（${totalDynamicActions} 次）` },
    { key: 'prepare_actions', ok: count(stats, 'dynamicActions.prepare') > 0, message: `准备动态事件行为真实执行（${count(stats, 'dynamicActions.prepare')} 次）` },
    { key: 'join_actions', ok: count(stats, 'dynamicActions.join') > 0, message: `参与动态事件行为真实执行（${count(stats, 'dynamicActions.join')} 次）` },
    { key: 'prepare_effects', ok: count(stats, 'dynamicActions.prepareSucceeded') > 0, message: `准备动态事件副作用真实落地（成功 ${count(stats, 'dynamicActions.prepareSucceeded')} 次）` },
    { key: 'join_effects', ok: count(stats, 'dynamicActions.joinSucceeded') > 0, message: `参与动态事件副作用真实落地（成功 ${count(stats, 'dynamicActions.joinSucceeded')} 次）` },
    { key: 'job_planned', ok: count(stats, 'jobActions.planned') > 0, message: `JobAction 真实进入规划（${count(stats, 'jobActions.planned')} 次）` },
    { key: 'job_started', ok: count(stats, 'jobActions.started') > 0, message: `Job 真实启动（${count(stats, 'jobActions.started')} 次）` },
    { key: 'dynamic_job_executed', ok: hasAnyJob(stats, ['job_npc_prepare_dynamic_event', 'job_npc_prepare_secret_realm', 'job_npc_prepare_sect_tournament', 'job_npc_join_dynamic_event']), message: '动态事件准备或参与 Job 真实执行' },
    { key: 'job_completed', ok: count(stats, 'jobActions.completed') > 0, message: `至少有 Job 完成（${count(stats, 'jobActions.completed')} 次）` },
    { key: 'normal_behavior', ok: count(stats, 'normalPlanCount') > 0 && count(stats, 'normalActionCount') > 0, message: `动态目标开启后普通 plan/普通行为仍持续发生（plan=${count(stats, 'normalPlanCount')}, action=${count(stats, 'normalActionCount')}）` },
    { key: 'normal_behavior_after_dynamic', ok: count(stats, 'normalPlanAfterDynamic') > 0 && count(stats, 'normalActionAfterDynamic') > 0, message: `首次动态行动后普通 plan/普通行为仍持续发生（plan=${count(stats, 'normalPlanAfterDynamic')}, action=${count(stats, 'normalActionAfterDynamic')}）` },
    { key: 'recovery_ratio', ok: recoveryRatio >= minRecoveryRatio, message: `动态行动后普通行为恢复率不低于 ${(minRecoveryRatio * 100).toFixed(1)}%（恢复 ${stats.recoveredNpcs?.size || 0}/${stats.dynamicActionNpcs?.size || 0} 人，${(recoveryRatio * 100).toFixed(1)}%）` },
  ];

  if (options.requireZeroJobFailures === true) {
    checks.push({
      key: 'zero_job_failures',
      ok: count(stats, 'jobActions.failed') === 0
        && count(stats, 'jobActions.aborted') === 0
        && Object.keys(stats.jobActions?.failureReasons || {}).length === 0,
      message: `Job 失败/abort 为 0（failed=${count(stats, 'jobActions.failed')}，aborted=${count(stats, 'jobActions.aborted')}，failureReasons=${JSON.stringify(stats.jobActions?.failureReasons || {})}）`,
    });
  }

  return { ok: checks.every(check => check.ok), checks, recoveryRatio };
}

export function renderGateReport({ stats, days, seeds, options }) {
  const gate = evaluateDefaultEnableGate(stats, options);
  const totalDynamicActions = count(stats, 'dynamicActions.prepare') + count(stats, 'dynamicActions.join');
  const lines = [
    '# Job/Toil 默认启用验证报告',
    '',
    '> 最后更新：2026-06-05',
    '> 来源：`apps/game/tools/verify-dynamic-goals.mjs` 真实多种子长程模拟输出。',
    '',
    '## 验证参数',
    '',
    `- 天数：${days}`,
    `- 种子：${seeds.join(', ')}`,
    `- 使用默认配置：${options.useConfigDefaults === true ? '是' : '否'}`,
    `- 最低恢复率门槛：${((options.minRecoveryRatio ?? 0.5) * 100).toFixed(1)}%`,
    `- Job 失败/abort 零容忍：${options.requireZeroJobFailures === true ? '是' : '否'}`,
    '',
    '## 观察结果',
    '',
    `- 动态事件阶段变化：${count(stats, 'phaseChanges')}`,
    `- 动态 Goal 候选观察：${count(stats, 'candidateGoalCount')}，唯一候选：${stats.uniqueCandidateKeys?.size || 0}`,
    `- 动态 Goal plan 次数：${count(stats, 'dynamicPlanCount')}`,
    `- 动态行动：准备 ${count(stats, 'dynamicActions.prepare')}（成功 ${count(stats, 'dynamicActions.prepareSucceeded')}），参与 ${count(stats, 'dynamicActions.join')}（成功 ${count(stats, 'dynamicActions.joinSucceeded')}），合计 ${totalDynamicActions}`,
    `- JobAction：planned=${count(stats, 'jobActions.planned')}，started=${count(stats, 'jobActions.started')}，completed=${count(stats, 'jobActions.completed')}，failed=${count(stats, 'jobActions.failed')}，aborted=${count(stats, 'jobActions.aborted')}`,
    `- Job 分布：${JSON.stringify(stats.jobActions?.byJobId || {})}`,
    `- Toil 分布：${JSON.stringify(stats.jobActions?.byToilId || {})}`,
    `- failureReasons：${JSON.stringify(stats.jobActions?.failureReasons || {})}`,
    `- 发生过动态行动 NPC：${stats.dynamicActionNpcs?.size || 0}`,
    `- 后续恢复普通行为 NPC：${stats.recoveredNpcs?.size || 0}`,
    `- 恢复率：${(gate.recoveryRatio * 100).toFixed(1)}%`,
    '',
    '## Gate Checks',
    '',
    ...gate.checks.map(check => `- ${check.ok ? 'PASS' : 'FAIL'} ${check.key}：${check.message}`),
    '',
    '## 结论',
    '',
    gate.ok ? '通过默认启用门。' : '未通过默认启用门，必须先修复失败项。',
    '',
  ];
  return `${lines.join('\n')}\n`;
}
