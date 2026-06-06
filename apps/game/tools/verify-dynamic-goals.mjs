#!/usr/bin/env node
/**
 * 动态世界事件 / 动态 Goal 验证（ADR-048 Task6）。
 *
 * 真实多种子长程模拟，直接观察行为统计：动态事件阶段是否推进、NPC 是否知晓事件、
 * 动态 Goal 是否进入真实 planResult、InterruptPolicy 是否做出决策、准备/参与行为是否真实执行，
 * 以及动态行动后 NPC 能否回到普通行为。
 *
 * 用法：node tools/verify-dynamic-goals.mjs
 *      node tools/verify-dynamic-goals.mjs --days=900 --seeds=12345,67890,24680
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  applyVerificationConfigOverrides,
  evaluateDefaultEnableGate,
  parseGateArgs,
  renderGateReport,
  resolveReportPath,
  recoveryRatioOf,
} from './verify-dynamic-goals-gates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

function baseConfigs() {
  return {
    gameConfig: load('data/config/game-config.json'),
    aiConfig: load('data/config/ai-config.json'),
    names: load('data/definitions/names.json'),
    modifierTemplates: load('data/world/modifiers.json'),
    terrains: load('data/definitions/terrains.json'),
    factions: load('data/entities/factions.json'),
    npcs: load('data/entities/npcs.json'),
    ranks: load('data/definitions/ranks.json'),
    items: load('data/definitions/macro-resources.json'),
    factionNeeds: load('data/needs/faction-needs.json'),
    npcNeeds: load('data/needs/npc-needs.json'),
    factionActions: load('data/actions/faction-actions.json'),
    npcActions: load('data/actions/npc-actions.json'),
    npcJobActions: load('data/actions/npc-job-actions.json'),
    npcActionSets: load('data/actions/npc-action-sets.json'),
    reactionActions: load('data/actions/reaction-actions.json'),
    worldRules: load('data/actions/world-rules.json'),
    jobs: { jobs: [
      ...(load('data/jobs/npc-dynamic-event-jobs.json')?.jobs || []),
      ...(load('data/jobs/npc-economy-jobs.json')?.jobs || []),
      ...(load('data/jobs/npc-social-jobs.json')?.jobs || []),
    ] },
    toils: { toils: [
      ...(load('data/toils/core-toils.json')?.toils || []),
      ...(load('data/toils/npc-dynamic-event-toils.json')?.toils || []),
      ...(load('data/toils/npc-economy-toils.json')?.toils || []),
      ...(load('data/toils/npc-social-toils.json')?.toils || []),
    ] },
    questTemplates: load('data/quests/quest-templates.json'),
    mapData: load('data/world/map.json'),
    dynamicEvents: load('data/world/dynamic-events.json'),
    dynamicGoals: load('data/goals/dynamic-goals.json'),
    balanceCombat: load('data/balance/combat.json'),
    balanceEconomy: load('data/balance/economy.json'),
    balanceCultivation: load('data/balance/cultivation.json'),
    balanceSocial: load('data/balance/social.json'),
    balanceMovement: load('data/balance/movement.json'),
    balancePersonality: load('data/balance/personality.json'),
    balanceRisk: load('data/balance/risk.json'),
    balanceMemory: load('data/balance/memory.json'),
    balanceObsession: load('data/balance/obsession.json'),
    balanceEmotion: load('data/balance/emotion.json'),
    balanceUtility: load('data/balance/utility.json'),
    balanceReward: load('data/balance/reward.json'),
    balanceRelationship: load('data/balance/relationship.json'),
    balanceReaction: load('data/balance/reaction.json'),
    monsters: load('data/definitions/monsters.json'),
    monsterAttributeTemplates: load('data/definitions/monster-attribute-templates.json'),
    monsterSpawn: load('data/balance/monster-spawn.json'),
    worldNews: load('data/world/news.json'),
    worldOpportunities: load('data/world/opportunities.json'),
    balanceCovet: load('data/balance/covet.json'),
    itemDefs: { items: ['currency', 'material', 'pill', 'artifact', 'talisman', 'technique'].flatMap(c => load(`data/items/${c}.json`).items) },
    tags: load('data/tags/tags.json'),
    effects: { effects: [...(load('data/effects/combat-effects.json')?.effects || []), ...(load('data/effects/core-effects.json')?.effects || [])] },
    abilities: load('data/abilities/combat-abilities.json'),
  };
}

function parseArgs() {
  let days = 900;
  let seeds = [12345, 67890, 24680];
  for (const a of process.argv.slice(2)) {
    let m;
    if ((m = /^--days=(\d+)$/.exec(a))) days = parseInt(m[1], 10);
    else if ((m = /^--seeds=([\d,]+)$/.exec(a))) {
      seeds = [...new Set(
        m[1]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(Number)
          .filter(Number.isFinite)
      )];
    }
  }
  return { days, seeds };
}

function enabledConfigs(seed, gateOptions = {}) {
  const configs = { ...baseConfigs(), seed };
  return applyVerificationConfigOverrides(configs, gateOptions, process.env);
}

function inc(map, key, n = 1) {
  map[key || 'unknown'] = (map[key || 'unknown'] || 0) + n;
}

function mergeCounts(dst, src) {
  for (const [k, v] of Object.entries(src)) inc(dst, k, v);
}

function eventSnapshot(engine, eventId) {
  const event = eventId ? engine.worldEventSystem?.getById?.(eventId) : null;
  if (!event) return null;
  return typeof event.toJSON === 'function' ? event.toJSON() : event;
}

function eventTypeFor(engine, plan, eventTypesById, rule) {
  if (!plan?.dynamicEventId) return rule?.eventType || 'unknown';
  return eventSnapshot(engine, plan.dynamicEventId)?.type
    || eventTypesById.get(plan.dynamicEventId)
    || rule?.eventType
    || 'unknown';
}

function ruleById(config) {
  const out = new Map();
  for (const rule of (config.goals || config.rules || [])) {
    if (rule?.id) out.set(rule.id, rule);
  }
  return out;
}

function valueSet(...values) {
  const out = new Set();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) if (item) out.add(item);
    } else if (value) {
      out.add(value);
    }
  }
  return out.size > 0 ? out : null;
}

function minConfidenceFor(rule, config) {
  return Number(rule.requiredAwarenessConfidence ?? config.requiredAwarenessConfidence ?? 0) || 0;
}

function timeWindowMatches(rule, daysUntilStart) {
  const tw = rule.timeWindowDays;
  if (tw == null) return true;
  if (Array.isArray(tw)) {
    const min = Number(tw[0] ?? -Infinity);
    const max = Number(tw[1] ?? Infinity);
    return daysUntilStart >= min && daysUntilStart <= max;
  }
  if (typeof tw === 'object') {
    const min = Number(tw.min ?? tw.from ?? -Infinity);
    const max = Number(tw.max ?? tw.to ?? Infinity);
    return daysUntilStart >= min && daysUntilStart <= max;
  }
  return true;
}

function candidateEvent(entry) {
  const event = entry?.event || {};
  return {
    ...event,
    id: event.id || entry?.eventId,
    type: event.type || entry?.eventType,
  };
}

function recordCandidateGoals(stats, known, rules, config, day, npcId, eventTypesById) {
  for (const entry of known) {
    const event = candidateEvent(entry);
    if (!event.id || !event.type || !event.phase) continue;
    eventTypesById.set(event.id, event.type);
    const confidence = Number(entry.confidence ?? 0) || 0;
    const daysUntilStart = Number(event.startDay ?? day) - day;

    for (const rule of rules.values()) {
      if (rule.enabled === false) continue;
      const eventTypes = valueSet(rule.eventType, rule.eventTypes, rule.types);
      if (eventTypes && !eventTypes.has(event.type)) continue;
      const phases = valueSet(rule.phase, rule.phases);
      if (phases && !phases.has(event.phase)) continue;
      if (confidence < minConfidenceFor(rule, config)) continue;
      if (!timeWindowMatches(rule, daysUntilStart)) continue;

      const sourceId = rule.id || 'unknown';
      const kind = rule.kind || 'unknown';
      const key = `${npcId}:${event.id}:${sourceId}:${event.phase}`;
      stats.candidateGoalCount++;
      stats.uniqueCandidateKeys.add(key);
      stats.candidateGoalNpcs.add(npcId);
      inc(stats.candidateBySource, sourceId);
      inc(stats.candidateByKind, kind);
      inc(stats.candidateByEventType, event.type);
      inc(stats.candidateBySourceKindType, `${sourceId}:${kind}:${event.type}`);
    }
  }
}

function recordPhaseItem(stats, item, eventTypesById, isBirth = false) {
  const event = item?.event || item;
  if (!event) return;
  const phase = item?.phase || item?.to || event.phase || (isBirth ? 'birth' : 'unknown');
  const type = item?.eventType || event.type || 'unknown';
  if (event.id && type !== 'unknown') eventTypesById.set(event.id, type);
  inc(stats.phaseByPhase, phase);
  inc(stats.phaseByType, type);
  inc(stats.phaseByPhaseType, `${phase}:${type}`);
  stats.phaseChanges++;
}

function actionIdOf(update) {
  return update?.execution?.action?.id
    || update?.execution?.result?.actionId
    || update?.execution?.actionId
    || null;
}

function jobIdOf(update) {
  return update?.execution?.job?.currentJobId
    || update?.execution?.result?.jobId
    || update?.execution?.jobId
    || null;
}

function jobInstanceIdOf(update) {
  return update?.execution?.job?.currentJobInstanceId
    || update?.execution?.result?.jobInstanceId
    || update?.execution?.jobInstanceId
    || null;
}

function toilIdOf(update) {
  return update?.execution?.job?.currentToilId
    || update?.execution?.result?.currentToilId
    || null;
}

const DYNAMIC_JOB_ACTION_IDS = new Set([
  'act_npc_prepare_dynamic_event',
  'act_npc_join_dynamic_event',
  'act_npc_prepare_secret_realm',
  'act_npc_prepare_sect_tournament',
]);

const DYNAMIC_JOB_IDS = new Set([
  'job_npc_prepare_dynamic_event',
  'job_npc_join_dynamic_event',
  'job_npc_prepare_secret_realm',
  'job_npc_prepare_sect_tournament',
]);

function dynamicJobActionIdsInPlan(plan) {
  return (plan?.actions || []).filter(id => DYNAMIC_JOB_ACTION_IDS.has(id));
}

function isDynamicJobAction(actionId, jobId = null) {
  return DYNAMIC_JOB_ACTION_IDS.has(actionId) || DYNAMIC_JOB_IDS.has(jobId);
}

function isSettledExecution(update) {
  const status = update?.execution?.status;
  return status === 'step_done' || status === 'plan_complete';
}

function createStats() {
  return {
    phaseChanges: 0,
    phaseByPhase: {},
    phaseByType: {},
    phaseByPhaseType: {},
    awarenessObservations: 0,
    awareNpcs: new Set(),
    knownEventIds: new Set(),
    candidateGoalCount: 0,
    uniqueCandidateKeys: new Set(),
    candidateGoalNpcs: new Set(),
    candidateBySource: {},
    candidateByKind: {},
    candidateByEventType: {},
    candidateBySourceKindType: {},
    dynamicPlanCount: 0,
    dynamicPlanNpcs: new Set(),
    dynamicPlanBySource: {},
    dynamicPlanByKind: {},
    dynamicPlanByEventType: {},
    dynamicPlanBySourceKindType: {},
    interruptCount: 0,
    interruptByDecision: {},
    interruptByReason: {},
    interruptKeys: new Set(),
    dynamicActions: {
      prepare: 0,
      join: 0,
      prepareSucceeded: 0,
      joinSucceeded: 0,
    },
    jobActions: {
      planObservations: 0,
      planned: 0,
      started: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
      byJobId: {},
      byToilId: {},
      failureReasons: {},
    },
    jobActionPlanKeys: new Set(),
    jobInstanceKeys: new Set(),
    jobToilKeys: new Set(),
    dynamicActionNpcs: new Set(),
    recoveredNpcs: new Set(),
    normalPlanCount: 0,
    normalPlanNpcs: new Set(),
    normalPlanBySource: {},
    normalActionCount: 0,
    normalActionNpcs: new Set(),
    normalPlanAfterDynamic: 0,
    normalActionAfterDynamic: 0,
    normalPlanAfterDynamicNpcs: new Set(),
    normalActionAfterDynamicNpcs: new Set(),
  };
}

function mergeStats(agg, stats, seed) {
  agg.phaseChanges += stats.phaseChanges;
  mergeCounts(agg.phaseByPhase, stats.phaseByPhase);
  mergeCounts(agg.phaseByType, stats.phaseByType);
  mergeCounts(agg.phaseByPhaseType, stats.phaseByPhaseType);
  agg.awarenessObservations += stats.awarenessObservations;
  agg.candidateGoalCount += stats.candidateGoalCount;
  for (const key of stats.uniqueCandidateKeys) agg.uniqueCandidateKeys.add(`${seed}:${key}`);
  mergeCounts(agg.candidateBySource, stats.candidateBySource);
  mergeCounts(agg.candidateByKind, stats.candidateByKind);
  mergeCounts(agg.candidateByEventType, stats.candidateByEventType);
  mergeCounts(agg.candidateBySourceKindType, stats.candidateBySourceKindType);
  agg.dynamicPlanCount += stats.dynamicPlanCount;
  mergeCounts(agg.dynamicPlanBySource, stats.dynamicPlanBySource);
  mergeCounts(agg.dynamicPlanByKind, stats.dynamicPlanByKind);
  mergeCounts(agg.dynamicPlanByEventType, stats.dynamicPlanByEventType);
  mergeCounts(agg.dynamicPlanBySourceKindType, stats.dynamicPlanBySourceKindType);
  agg.interruptCount += stats.interruptCount;
  mergeCounts(agg.interruptByDecision, stats.interruptByDecision);
  mergeCounts(agg.interruptByReason, stats.interruptByReason);
  for (const id of stats.awareNpcs) agg.awareNpcs.add(`${seed}:${id}`);
  for (const id of stats.candidateGoalNpcs) agg.candidateGoalNpcs.add(`${seed}:${id}`);
  for (const id of stats.knownEventIds) agg.knownEventIds.add(id);
  for (const id of stats.dynamicPlanNpcs) agg.dynamicPlanNpcs.add(`${seed}:${id}`);
  for (const id of stats.dynamicActionNpcs) agg.dynamicActionNpcs.add(`${seed}:${id}`);
  for (const id of stats.recoveredNpcs) agg.recoveredNpcs.add(`${seed}:${id}`);
  agg.normalPlanCount += stats.normalPlanCount;
  mergeCounts(agg.normalPlanBySource, stats.normalPlanBySource);
  agg.normalActionCount += stats.normalActionCount;
  agg.normalPlanAfterDynamic += stats.normalPlanAfterDynamic;
  agg.normalActionAfterDynamic += stats.normalActionAfterDynamic;
  for (const id of stats.normalPlanNpcs) agg.normalPlanNpcs.add(`${seed}:${id}`);
  for (const id of stats.normalActionNpcs) agg.normalActionNpcs.add(`${seed}:${id}`);
  for (const id of stats.normalPlanAfterDynamicNpcs) agg.normalPlanAfterDynamicNpcs.add(`${seed}:${id}`);
  for (const id of stats.normalActionAfterDynamicNpcs) agg.normalActionAfterDynamicNpcs.add(`${seed}:${id}`);
  for (const [k, v] of Object.entries(stats.dynamicActions)) {
    agg.dynamicActions[k] = (agg.dynamicActions[k] || 0) + v;
  }
  agg.jobActions.planned += stats.jobActions.planned;
  agg.jobActions.planObservations += stats.jobActions.planObservations;
  agg.jobActions.started += stats.jobActions.started;
  agg.jobActions.completed += stats.jobActions.completed;
  agg.jobActions.failed += stats.jobActions.failed;
  agg.jobActions.aborted += stats.jobActions.aborted;
  mergeCounts(agg.jobActions.byJobId, stats.jobActions.byJobId);
  mergeCounts(agg.jobActions.byToilId, stats.jobActions.byToilId);
  mergeCounts(agg.jobActions.failureReasons, stats.jobActions.failureReasons);
  for (const key of stats.jobActionPlanKeys) agg.jobActionPlanKeys.add(`${seed}:${key}`);
  for (const key of stats.jobInstanceKeys) agg.jobInstanceKeys.add(`${seed}:${key}`);
  for (const key of stats.jobToilKeys) agg.jobToilKeys.add(`${seed}:${key}`);
}

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);
const { ActionPool } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/pools/action-pool.js')).href);
const { NeedPool } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/pools/need-pool.js')).href);
const { JobPool } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/pools/job-pool.js')).href);
const { ToilPool } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/pools/toil-pool.js')).href);
const { EffectPool } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/pools/effect-pool.js')).href);
const { AbilityPool } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/pools/ability-pool.js')).href);
const { ItemRegistry } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/items/item-registry.js')).href);
const { GameplayTagRegistry } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/abstract/gameplay-tag.js')).href);

function resetGlobalPoolsForSeed() {
  ActionPool.clear();
  NeedPool.clear();
  JobPool.clear();
  ToilPool.clear();
  EffectPool.clear();
  AbilityPool.clear();
  ItemRegistry.clear();
  GameplayTagRegistry.clear();
}

const { days, seeds } = parseArgs();
const gateOptions = parseGateArgs(process.argv.slice(2));
console.log(`[verify-dynamic-goals] seeds=${seeds.join(',')} days=${days}`);
console.log(`  环境开关：DYNAMIC_EVENTS_ACTIVE=${process.env.DYNAMIC_EVENTS_ACTIVE || '(default-on)'} DYNAMIC_GOALS_ACTIVE=${process.env.DYNAMIC_GOALS_ACTIVE || '(default-on)'} JOBS_ACTIVE=${process.env.JOBS_ACTIVE || '(config-default)'}`);
console.log(`  默认配置路径：${gateOptions.useConfigDefaults === true ? '是' : '否'}`);
console.log(`  启用门：minRecovery=${gateOptions.minRecoveryRatio} requireZeroJobFailures=${gateOptions.requireZeroJobFailures}`);
console.log(gateOptions.useConfigDefaults === true
  ? '  内存覆盖开关：关闭；完全使用配置文件默认 enabled 状态'
  : '  内存覆盖开关：dynamicEvents/dynamicGoals/worldNews/worldOpportunities/balanceReward.enabled=true；jobs 使用配置默认，JOBS_ACTIVE=1 时强制开启');
console.log('  方式：真实多种子长程模拟，直接观察行为统计');

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
};

const agg = createStats();

for (const seed of seeds) {
  resetGlobalPoolsForSeed();
  const configs = enabledConfigs(seed, gateOptions);
  const rules = ruleById(configs.dynamicGoals);
  const engine = new WorldEngine();
  engine.init(configs);

  const stats = createStats();
  const lastDynamicActionDay = new Map();
  let firstDynamicActionDay = null;
  const eventTypesById = new Map();

  for (let i = 0; i < days; i++) {
    const tick = engine.tick();
    for (const item of (tick.dynamicEvents || [])) recordPhaseItem(stats, item, eventTypesById, false);
    for (const item of (tick.dynamicEventBirths || [])) recordPhaseItem(stats, item, eventTypesById, true);

    for (const update of (tick.npcUpdates || [])) {
      const npcId = update.entityId;
      if (!npcId) continue;

      const known = update.mind?.knownDynamicEvents || [];
      if (known.length > 0) {
        stats.awareNpcs.add(npcId);
        stats.awarenessObservations += known.length;
        for (const entry of known) {
          if (entry?.eventId) stats.knownEventIds.add(entry.eventId);
          const knownType = entry?.eventType || entry?.event?.type;
          if (entry?.eventId && knownType) eventTypesById.set(entry.eventId, knownType);
        }
        recordCandidateGoals(stats, known, rules, configs.dynamicGoals, tick.day, npcId, eventTypesById);
      }

      const plan = update.plan || update.btTrace?.selectedGoal || null;
      const isDynamicPlan = plan?.goalSource === 'dynamic';
      if (isDynamicPlan) {
        const sourceId = plan.needId || 'unknown';
        const rule = rules.get(sourceId) || {};
        const kind = rule.kind || 'unknown';
        const eventType = eventTypeFor(engine, plan, eventTypesById, rule);
        stats.dynamicPlanCount++;
        stats.dynamicPlanNpcs.add(npcId);
        inc(stats.dynamicPlanBySource, sourceId);
        inc(stats.dynamicPlanByKind, kind);
        inc(stats.dynamicPlanByEventType, eventType);
        inc(stats.dynamicPlanBySourceKindType, `${sourceId}:${kind}:${eventType}`);
        const dynamicJobActionIds = dynamicJobActionIdsInPlan(plan);
        if (dynamicJobActionIds.length > 0) {
          stats.jobActions.planObservations++;
          const planKey = [
            npcId,
            tick.day,
            plan.needId || 'no_need',
            plan.dynamicEventId || 'no_event',
            dynamicJobActionIds.join(','),
          ].join('|');
          if (!stats.jobActionPlanKeys.has(planKey)) {
            stats.jobActionPlanKeys.add(planKey);
            stats.jobActions.planned++;
          }
        }
      } else if (plan && plan.failed !== true && (plan.needId || plan.goalSource)) {
        const sourceId = plan.needId || plan.goalSource || 'unknown';
        stats.normalPlanCount++;
        stats.normalPlanNpcs.add(npcId);
        inc(stats.normalPlanBySource, sourceId);
        if (firstDynamicActionDay != null && tick.day > firstDynamicActionDay) {
          stats.normalPlanAfterDynamic++;
          stats.normalPlanAfterDynamicNpcs.add(npcId);
        }
      }

      const interrupt = update.mind?.dynamicInterrupt || null;
      if (interrupt?.decision) {
        const key = [
          npcId,
          interrupt.day ?? tick.day,
          interrupt.eventId || 'no_event',
          interrupt.goalId || 'no_goal',
          interrupt.decision,
        ].join('|');
        if (!stats.interruptKeys.has(key)) {
          stats.interruptKeys.add(key);
          stats.interruptCount++;
          inc(stats.interruptByDecision, interrupt.decision);
          inc(stats.interruptByReason, interrupt.reason || 'unknown');
        }
      }

      const actionId = actionIdOf(update);
      const jobId = jobIdOf(update);
      const jobInstanceId = jobInstanceIdOf(update);
      const toilId = toilIdOf(update);
      const dynamicAction = isDynamicJobAction(actionId, jobId);
      if (update.execution?.phase === 'job' || update.execution?.phase === 'job_paused') {
        const instanceKey = jobInstanceId || `${npcId}:${jobId}:missing_instance:${tick.day}`;
        if (!stats.jobInstanceKeys.has(instanceKey)) {
          stats.jobInstanceKeys.add(instanceKey);
          stats.jobActions.started++;
          inc(stats.jobActions.byJobId, jobId);
        }
        if (toilId) {
          const toilKey = `${instanceKey}:${toilId}`;
          if (!stats.jobToilKeys.has(toilKey)) {
            stats.jobToilKeys.add(toilKey);
            inc(stats.jobActions.byToilId, toilId);
          }
        }
      }
      if (update.execution?.result?.jobId) {
        const result = update.execution.result;
        const resultInstanceKey = result.jobInstanceId || `${npcId}:${result.jobId}:terminal_missing_instance:${tick.day}`;
        if (!stats.jobInstanceKeys.has(resultInstanceKey)) {
          stats.jobInstanceKeys.add(resultInstanceKey);
          stats.jobActions.started++;
          inc(stats.jobActions.byJobId, result.jobId);
        }
        const status = result.status;
        if (status === 'success') {
          stats.jobActions.completed++;
        } else if (status === 'failed') {
          stats.jobActions.failed++;
          inc(stats.jobActions.failureReasons, result.reason || update.execution.reason || 'unknown');
        } else if (status === 'abort' || status === 'replan') {
          stats.jobActions.aborted++;
          inc(stats.jobActions.failureReasons, result.reason || update.execution.reason || status);
        }
      } else if (update.execution?.jobId && update.execution?.status === 'replan') {
        stats.jobActions.failed++;
        inc(stats.jobActions.failureReasons, update.execution.reason || 'replan');
      }
      if (dynamicAction && isSettledExecution(update)) {
        stats.dynamicActionNpcs.add(npcId);
        lastDynamicActionDay.set(npcId, tick.day);
        if (firstDynamicActionDay == null) firstDynamicActionDay = tick.day;
        const result = update.execution?.result || {};
        const jobSucceeded = result.status === 'success';
        if (actionId === 'act_npc_prepare_dynamic_event'
          || actionId === 'act_npc_prepare_secret_realm'
          || actionId === 'act_npc_prepare_sect_tournament') {
          stats.dynamicActions.prepare++;
          if (result.prepared === true || jobSucceeded) stats.dynamicActions.prepareSucceeded++;
        } else if (actionId === 'act_npc_join_dynamic_event') {
          stats.dynamicActions.join++;
          if (result.joined === true || jobSucceeded) stats.dynamicActions.joinSucceeded++;
        }
      } else if (lastDynamicActionDay.has(npcId) && tick.day > lastDynamicActionDay.get(npcId)) {
        const normalPlan = plan && plan.goalSource !== 'dynamic' && plan.failed !== true;
        const normalExecution = isSettledExecution(update) && actionId && !dynamicAction;
        if (normalPlan || normalExecution) stats.recoveredNpcs.add(npcId);
      }
      if (isSettledExecution(update) && actionId && !dynamicAction) {
        stats.normalActionCount++;
        stats.normalActionNpcs.add(npcId);
        if (firstDynamicActionDay != null && tick.day > firstDynamicActionDay) {
          stats.normalActionAfterDynamic++;
          stats.normalActionAfterDynamicNpcs.add(npcId);
        }
      }
    }
  }

  mergeStats(agg, stats, seed);

  console.log(`\n  [seed=${seed}] 存活NPC=${engine.entityRegistry.getAliveByType('npc').length}`);
  console.log(`    动态事件阶段变化=${stats.phaseChanges}，按 phase=${JSON.stringify(stats.phaseByPhase)}，按 type=${JSON.stringify(stats.phaseByType)}`);
  console.log(`    知晓动态事件：观察次数=${stats.awarenessObservations}，NPC人数=${stats.awareNpcs.size}，事件数=${stats.knownEventIds.size}`);
  console.log(`    动态 Goal 候选观察=${stats.candidateGoalCount}，唯一候选=${stats.uniqueCandidateKeys.size}，NPC人数=${stats.candidateGoalNpcs.size}`);
  console.log(`      candidate source=${JSON.stringify(stats.candidateBySource)}`);
  console.log(`      candidate kind=${JSON.stringify(stats.candidateByKind)} type=${JSON.stringify(stats.candidateByEventType)}`);
  console.log(`    动态 Goal plan 次数=${stats.dynamicPlanCount}，NPC人数=${stats.dynamicPlanNpcs.size}`);
  console.log(`      source=${JSON.stringify(stats.dynamicPlanBySource)}`);
  console.log(`      kind=${JSON.stringify(stats.dynamicPlanByKind)} type=${JSON.stringify(stats.dynamicPlanByEventType)}`);
  console.log(`    InterruptPolicy 决策=${stats.interruptCount}，分布=${JSON.stringify(stats.interruptByDecision)}`);
  console.log(`    动态行动：准备=${stats.dynamicActions.prepare}（成功${stats.dynamicActions.prepareSucceeded}），参与=${stats.dynamicActions.join}（成功${stats.dynamicActions.joinSucceeded}）`);
  console.log(`    JobAction：planned=${stats.jobActions.planned}，planObservations=${stats.jobActions.planObservations}，started=${stats.jobActions.started}，completed=${stats.jobActions.completed}，failed=${stats.jobActions.failed}，aborted=${stats.jobActions.aborted}`);
  console.log(`      byJobId=${JSON.stringify(stats.jobActions.byJobId)}`);
  console.log(`      byToilId=${JSON.stringify(stats.jobActions.byToilId)}`);
  console.log(`      failureReasons=${JSON.stringify(stats.jobActions.failureReasons)}`);
  console.log(`    发生过动态行动NPC=${stats.dynamicActionNpcs.size}，后续恢复普通行为NPC=${stats.recoveredNpcs.size}`);
  console.log(`    普通 plan=${stats.normalPlanCount}，普通行为结算=${stats.normalActionCount}`);
  console.log(`    首次动态行动后：普通 plan=${stats.normalPlanAfterDynamic}，普通行为结算=${stats.normalActionAfterDynamic}`);
}

const totalDynamicActions = agg.dynamicActions.prepare + agg.dynamicActions.join;
const recoveryRatio = recoveryRatioOf(agg);

console.log(`\n========== 多种子汇总（${seeds.length} 种子 × ${days} 天）==========`);
console.log(`动态事件阶段变化=${agg.phaseChanges}`);
console.log(`  按 phase: ${JSON.stringify(agg.phaseByPhase)}`);
console.log(`  按 type: ${JSON.stringify(agg.phaseByType)}`);
console.log(`  phase×type: ${JSON.stringify(agg.phaseByPhaseType)}`);
console.log(`知晓动态事件：观察次数=${agg.awarenessObservations}，NPC人数=${agg.awareNpcs.size}，事件数=${agg.knownEventIds.size}`);
console.log(`动态 Goal 候选观察=${agg.candidateGoalCount}，唯一候选=${agg.uniqueCandidateKeys.size}，NPC人数=${agg.candidateGoalNpcs.size}`);
console.log(`  candidate source=${JSON.stringify(agg.candidateBySource)}`);
console.log(`  candidate kind=${JSON.stringify(agg.candidateByKind)}`);
console.log(`  candidate eventType=${JSON.stringify(agg.candidateByEventType)}`);
console.log(`  candidate source×kind×type=${JSON.stringify(agg.candidateBySourceKindType)}`);
console.log(`动态 Goal plan 次数=${agg.dynamicPlanCount}，NPC人数=${agg.dynamicPlanNpcs.size}`);
console.log(`  source=${JSON.stringify(agg.dynamicPlanBySource)}`);
console.log(`  kind=${JSON.stringify(agg.dynamicPlanByKind)}`);
console.log(`  eventType=${JSON.stringify(agg.dynamicPlanByEventType)}`);
console.log(`  source×kind×type=${JSON.stringify(agg.dynamicPlanBySourceKindType)}`);
console.log(`InterruptPolicy 决策总数=${agg.interruptCount}，decision=${JSON.stringify(agg.interruptByDecision)}，reason=${JSON.stringify(agg.interruptByReason)}`);
console.log(`动态行动：准备=${agg.dynamicActions.prepare}（成功${agg.dynamicActions.prepareSucceeded}），参与=${agg.dynamicActions.join}（成功${agg.dynamicActions.joinSucceeded}），合计=${totalDynamicActions}`);
console.log(`JobAction：planned=${agg.jobActions.planned}，planObservations=${agg.jobActions.planObservations}，started=${agg.jobActions.started}，completed=${agg.jobActions.completed}，failed=${agg.jobActions.failed}，aborted=${agg.jobActions.aborted}`);
console.log(`  byJobId=${JSON.stringify(agg.jobActions.byJobId)}`);
console.log(`  byToilId=${JSON.stringify(agg.jobActions.byToilId)}`);
console.log(`  failureReasons=${JSON.stringify(agg.jobActions.failureReasons)}`);
console.log(`发生过动态行动NPC=${agg.dynamicActionNpcs.size}，后续恢复普通行为NPC=${agg.recoveredNpcs.size}，恢复率=${(recoveryRatio * 100).toFixed(1)}%`);
console.log(`普通行为保持：普通 plan=${agg.normalPlanCount}（NPC ${agg.normalPlanNpcs.size}），普通行为结算=${agg.normalActionCount}（NPC ${agg.normalActionNpcs.size}）`);
console.log(`首次动态行动后普通行为：普通 plan=${agg.normalPlanAfterDynamic}（NPC ${agg.normalPlanAfterDynamicNpcs.size}），普通行为结算=${agg.normalActionAfterDynamic}（NPC ${agg.normalActionAfterDynamicNpcs.size}）`);

const gate = evaluateDefaultEnableGate(agg, gateOptions);
for (const check of gate.checks) {
  assert(check.ok, check.message);
}

if (gateOptions.reportPath) {
  const reportPath = resolveReportPath(gateOptions.reportPath, { gameRoot: GAME_ROOT });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderGateReport({
    stats: agg,
    days,
    seeds,
    options: gateOptions,
  }), 'utf-8');
  console.log(`\n验证报告已写入：${gateOptions.reportPath}`);
}

if (failed === 0) {
  console.log('\n动态世界事件 / 动态 Goal 真实模拟验证通过');
  process.exit(0);
} else {
  console.error(`\n验证失败：${failed} 项`);
  process.exit(1);
}
