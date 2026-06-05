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
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

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
    reactionActions: load('data/actions/reaction-actions.json'),
    worldRules: load('data/actions/world-rules.json'),
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
    else if ((m = /^--seeds=([\d,]+)$/.exec(a))) seeds = m[1].split(',').map(Number).filter(Number.isFinite);
  }
  return { days, seeds };
}

function enabledConfigs(seed) {
  const configs = { ...baseConfigs(), seed };
  configs.dynamicEvents = { ...clone(configs.dynamicEvents), enabled: true };
  configs.dynamicGoals = { ...clone(configs.dynamicGoals), enabled: true };
  configs.worldNews = { ...clone(configs.worldNews), enabled: true };
  configs.worldOpportunities = { ...clone(configs.worldOpportunities), enabled: true };
  configs.balanceReward = { ...clone(configs.balanceReward), enabled: true };
  return configs;
}

function inc(map, key, n = 1) {
  map[key || 'unknown'] = (map[key || 'unknown'] || 0) + n;
}

function mergeCounts(dst, src) {
  for (const [k, v] of Object.entries(src)) inc(dst, k, v);
}

function sumCounts(map) {
  return Object.values(map).reduce((a, b) => a + b, 0);
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
    dynamicActionNpcs: new Set(),
    recoveredNpcs: new Set(),
  };
}

function mergeStats(agg, stats, seed) {
  agg.phaseChanges += stats.phaseChanges;
  mergeCounts(agg.phaseByPhase, stats.phaseByPhase);
  mergeCounts(agg.phaseByType, stats.phaseByType);
  mergeCounts(agg.phaseByPhaseType, stats.phaseByPhaseType);
  agg.awarenessObservations += stats.awarenessObservations;
  agg.dynamicPlanCount += stats.dynamicPlanCount;
  mergeCounts(agg.dynamicPlanBySource, stats.dynamicPlanBySource);
  mergeCounts(agg.dynamicPlanByKind, stats.dynamicPlanByKind);
  mergeCounts(agg.dynamicPlanByEventType, stats.dynamicPlanByEventType);
  mergeCounts(agg.dynamicPlanBySourceKindType, stats.dynamicPlanBySourceKindType);
  agg.interruptCount += stats.interruptCount;
  mergeCounts(agg.interruptByDecision, stats.interruptByDecision);
  mergeCounts(agg.interruptByReason, stats.interruptByReason);
  for (const id of stats.awareNpcs) agg.awareNpcs.add(`${seed}:${id}`);
  for (const id of stats.knownEventIds) agg.knownEventIds.add(id);
  for (const id of stats.dynamicPlanNpcs) agg.dynamicPlanNpcs.add(`${seed}:${id}`);
  for (const id of stats.dynamicActionNpcs) agg.dynamicActionNpcs.add(`${seed}:${id}`);
  for (const id of stats.recoveredNpcs) agg.recoveredNpcs.add(`${seed}:${id}`);
  for (const [k, v] of Object.entries(stats.dynamicActions)) {
    agg.dynamicActions[k] = (agg.dynamicActions[k] || 0) + v;
  }
}

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);

const { days, seeds } = parseArgs();
console.log(`[verify-dynamic-goals] seeds=${seeds.join(',')} days=${days}`);
console.log('  内存覆盖开关：dynamicEvents/dynamicGoals/worldNews/worldOpportunities/balanceReward.enabled=true');
console.log('  方式：真实多种子长程模拟，直接观察行为统计');

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
};

const agg = createStats();

for (const seed of seeds) {
  const configs = enabledConfigs(seed);
  const rules = ruleById(configs.dynamicGoals);
  const engine = new WorldEngine();
  engine.init(configs);

  const stats = createStats();
  const lastDynamicActionDay = new Map();
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
      const dynamicAction = actionId === 'act_npc_prepare_dynamic_event' || actionId === 'act_npc_join_dynamic_event';
      if (dynamicAction && isSettledExecution(update)) {
        stats.dynamicActionNpcs.add(npcId);
        lastDynamicActionDay.set(npcId, tick.day);
        const result = update.execution?.result || {};
        if (actionId === 'act_npc_prepare_dynamic_event') {
          stats.dynamicActions.prepare++;
          if (result.prepared === true) stats.dynamicActions.prepareSucceeded++;
        } else {
          stats.dynamicActions.join++;
          if (result.joined === true) stats.dynamicActions.joinSucceeded++;
        }
      } else if (lastDynamicActionDay.has(npcId) && tick.day > lastDynamicActionDay.get(npcId)) {
        const normalPlan = plan && plan.goalSource !== 'dynamic' && plan.failed !== true;
        const normalExecution = isSettledExecution(update) && actionId && !dynamicAction;
        if (normalPlan || normalExecution) stats.recoveredNpcs.add(npcId);
      }
    }
  }

  mergeStats(agg, stats, seed);

  console.log(`\n  [seed=${seed}] 存活NPC=${engine.entityRegistry.getAliveByType('npc').length}`);
  console.log(`    动态事件阶段变化=${stats.phaseChanges}，按 phase=${JSON.stringify(stats.phaseByPhase)}，按 type=${JSON.stringify(stats.phaseByType)}`);
  console.log(`    知晓动态事件：观察次数=${stats.awarenessObservations}，NPC人数=${stats.awareNpcs.size}，事件数=${stats.knownEventIds.size}`);
  console.log(`    动态 Goal plan 次数=${stats.dynamicPlanCount}，NPC人数=${stats.dynamicPlanNpcs.size}`);
  console.log(`      source=${JSON.stringify(stats.dynamicPlanBySource)}`);
  console.log(`      kind=${JSON.stringify(stats.dynamicPlanByKind)} type=${JSON.stringify(stats.dynamicPlanByEventType)}`);
  console.log(`    InterruptPolicy 决策=${stats.interruptCount}，分布=${JSON.stringify(stats.interruptByDecision)}`);
  console.log(`    动态行动：准备=${stats.dynamicActions.prepare}（成功${stats.dynamicActions.prepareSucceeded}），参与=${stats.dynamicActions.join}（成功${stats.dynamicActions.joinSucceeded}）`);
  console.log(`    发生过动态行动NPC=${stats.dynamicActionNpcs.size}，后续恢复普通行为NPC=${stats.recoveredNpcs.size}`);
}

const totalDynamicActions = agg.dynamicActions.prepare + agg.dynamicActions.join;

console.log(`\n========== 多种子汇总（${seeds.length} 种子 × ${days} 天）==========`);
console.log(`动态事件阶段变化=${agg.phaseChanges}`);
console.log(`  按 phase: ${JSON.stringify(agg.phaseByPhase)}`);
console.log(`  按 type: ${JSON.stringify(agg.phaseByType)}`);
console.log(`  phase×type: ${JSON.stringify(agg.phaseByPhaseType)}`);
console.log(`知晓动态事件：观察次数=${agg.awarenessObservations}，NPC人数=${agg.awareNpcs.size}，事件数=${agg.knownEventIds.size}`);
console.log(`动态 Goal plan 次数=${agg.dynamicPlanCount}，NPC人数=${agg.dynamicPlanNpcs.size}`);
console.log(`  source=${JSON.stringify(agg.dynamicPlanBySource)}`);
console.log(`  kind=${JSON.stringify(agg.dynamicPlanByKind)}`);
console.log(`  eventType=${JSON.stringify(agg.dynamicPlanByEventType)}`);
console.log(`  source×kind×type=${JSON.stringify(agg.dynamicPlanBySourceKindType)}`);
console.log(`InterruptPolicy 决策总数=${agg.interruptCount}，decision=${JSON.stringify(agg.interruptByDecision)}，reason=${JSON.stringify(agg.interruptByReason)}`);
console.log(`动态行动：准备=${agg.dynamicActions.prepare}（成功${agg.dynamicActions.prepareSucceeded}），参与=${agg.dynamicActions.join}（成功${agg.dynamicActions.joinSucceeded}），合计=${totalDynamicActions}`);
console.log(`发生过动态行动NPC=${agg.dynamicActionNpcs.size}，后续恢复普通行为NPC=${agg.recoveredNpcs.size}`);

assert(agg.phaseChanges > 0, `动态事件阶段真实推进（阶段变化 ${agg.phaseChanges} 次）`);
assert(agg.awareNpcs.size > 0, `NPC 真实知晓动态事件（${agg.awareNpcs.size} 人，观察 ${agg.awarenessObservations} 次）`);
assert(agg.dynamicPlanCount > 0, `动态 Goal 真实进入 planResult（${agg.dynamicPlanCount} 次）`);
assert(agg.interruptCount > 0, `InterruptPolicy 真实做出动态打断决策（${agg.interruptCount} 次）`);
assert(totalDynamicActions > 0, `准备/参与动态事件行为真实执行（${totalDynamicActions} 次）`);
assert(
  agg.dynamicActionNpcs.size === 0 || agg.recoveredNpcs.size > 0,
  `动态行动后可恢复普通行为（恢复 ${agg.recoveredNpcs.size}/${agg.dynamicActionNpcs.size} 人）`,
);

if (failed === 0) {
  console.log('\n动态世界事件 / 动态 Goal 真实模拟验证通过');
  process.exit(0);
} else {
  console.error(`\n验证失败：${failed} 项`);
  process.exit(1);
}
