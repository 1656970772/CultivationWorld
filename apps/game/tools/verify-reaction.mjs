#!/usr/bin/env node
/**
 * 四层 AI 架构反应层验证（ADR-048）。真实多种子长程模拟，纯观察"新决策逻辑真实涌现的行为变化"。
 *
 * 不做指纹/一致性对照——本工具的目的就是看新逻辑改了行为：被攻击时 NPC 是否真的会
 * 逃命/暂避/回血/反击，以及被反应打断后能否正常落回修炼/游历（不会永久卡在反应循环）。
 *
 * 观察项：
 *   1. 反应层开启后，被攻击触发的反应行为按类型真实发生（逃命/暂避/回血/反击）。
 *   2. 被反应打断（含闭关）的 NPC，之后仍有正常行为结算 —— 即能从反应里恢复，不是永久卡死。
 *
 * 用法：node tools/verify-reaction.mjs            默认 3 种子 × 800 天
 *      node tools/verify-reaction.mjs --days=1200 --seeds=11,22,33
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

function baseConfigs() {
  return {
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
    itemDefs: { items: ['currency','material','pill','artifact','talisman','technique'].flatMap(c => load(`data/items/${c}.json`).items) },
    tags: load('data/tags/tags.json'),
    effects: { effects: [...(load('data/effects/combat-effects.json')?.effects || []), ...(load('data/effects/core-effects.json')?.effects || [])] },
    abilities: load('data/abilities/combat-abilities.json'),
  };
}

function parseArgs() {
  let days = 800;
  let seeds = [12345, 67890, 24680];
  for (const a of process.argv.slice(2)) {
    let m;
    if ((m = /^--days=(\d+)$/.exec(a))) days = parseInt(m[1], 10);
    else if ((m = /^--seeds=([\d,]+)$/.exec(a))) seeds = m[1].split(',').map(Number);
  }
  return { days, seeds };
}

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);

const { days, seeds } = parseArgs();
console.log(`[verify-reaction] seeds=${seeds.join(',')} days=${days}（reaction.enabled + eventReplan.enabled=true）`);

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

// 反应决策类型（来自 ReactiveNode 写入的 btTrace.reactedPath.decision，稳健且与 infoEvents 合并时机无关）。
const REACT_DECISIONS = ['flee', 'retreat', 'heal', 'counter'];

const agg = {
  byType: {},
  reactCount: 0,
  reactedNpcs: new Set(),
  recoveredNpcs: new Set(),
  interruptedCultivation: 0,
};
for (const t of REACT_DECISIONS) agg.byType[t] = 0;

for (const seed of seeds) {
  // 开启反应层 + 大事件立即重决策（仅内存覆盖，不写回数据，符合 AGENTS.md 验证规则）。
  const configs = { ...baseConfigs(), seed };
  configs.balanceReaction = {
    ...configs.balanceReaction,
    enabled: true,
    eventReplan: { ...(configs.balanceReaction.eventReplan || {}), enabled: true },
  };

  const engine = new WorldEngine();
  engine.init(configs);

  const seedByType = {};
  for (const t of REACT_DECISIONS) seedByType[t] = 0;
  let reactBehaviors = 0;
  let interruptedCultivation = 0;
  // 恢复跟踪：记录每个 NPC 最后一次发生反应的天，及其之后是否还有正常（非反应）行为结算。
  const lastReactDay = new Map();
  const recovered = new Set();
  const reacted = new Set();

  for (let t = 0; t < days; t++) {
    const log = engine.tick();
    for (const u of (log.npcUpdates || [])) {
      const id = u.entityId;
      if (!id) continue;
      const rp = u.btTrace?.reactedPath;
      const isReact = rp && rp.stimulus === 'attacked';
      if (isReact) {
        reactBehaviors++;
        reacted.add(id);
        lastReactDay.set(id, t);
        if (rp.decision && seedByType[rp.decision] != null) seedByType[rp.decision]++;
        // 被反应打断的是否为修炼/闭关类意图（说明反应确实抢占了长链行为）。
        if (rp.wasBusy && rp.interruptedGoal && /cultiv|seclusion|qi|breakthrough|闭关|修炼/i.test(String(rp.interruptedGoal))) {
          interruptedCultivation++;
        }
      } else {
        // 这一 tick 该 NPC 走的是正常（非反应）决策路径。若它此前发生过反应，则视为已从反应恢复。
        const exec = u.execution;
        const normalProgress = (exec && (exec.status === 'plan_complete' || exec.status === 'step_done'))
          || !!u.btTrace?.selectedGoal;
        if (normalProgress && lastReactDay.has(id) && t > lastReactDay.get(id)) {
          recovered.add(id);
        }
      }
    }
  }

  for (const t of REACT_DECISIONS) agg.byType[t] += seedByType[t];
  agg.reactCount += reactBehaviors;
  agg.interruptedCultivation += interruptedCultivation;
  for (const id of reacted) agg.reactedNpcs.add(`${seed}:${id}`);
  for (const id of recovered) agg.recoveredNpcs.add(`${seed}:${id}`);

  const alive = engine.entityRegistry.getAliveByType('npc').length;
  const totalReact = Object.values(seedByType).reduce((a, b) => a + b, 0);
  const stuck = [...reacted].filter((id) => !recovered.has(id) && lastReactDay.get(id) < days - 5);
  console.log(`\n  [seed=${seed}] 存活NPC=${alive}`);
  console.log(`    反应行为(按类型): ${JSON.stringify(seedByType)}（合计 ${totalReact}）`);
  console.log(`    发生过反应的NPC=${reacted.size}，其中之后恢复正常行为=${recovered.size}，疑似卡死=${stuck.length}`);
  console.log(`    被反应打断的修炼/闭关次数=${interruptedCultivation}`);
}

const totalReactAll = Object.values(agg.byType).reduce((a, b) => a + b, 0);
const stuckAll = agg.reactedNpcs.size - agg.recoveredNpcs.size;

console.log(`\n========== 多种子汇总（${seeds.length} 种子 × ${days} 天）==========`);
console.log(`反应行为分布(合计): ${JSON.stringify(agg.byType)}（合计 ${totalReactAll}）`);
console.log(`反应抢占总次数=${agg.reactCount}`);
console.log(`被反应打断的修炼/闭关总次数=${agg.interruptedCultivation}`);
console.log(`发生过反应的NPC(去重)=${agg.reactedNpcs.size}，之后恢复正常行为=${agg.recoveredNpcs.size}，未观察到恢复=${stuckAll}`);

assert(totalReactAll > 0, `新逻辑生效：被攻击真的触发了反应行为（逃命/暂避/回血/反击 合计 ${totalReactAll}）`);
assert(
  agg.reactedNpcs.size === 0 || agg.recoveredNpcs.size > 0,
  `反应可恢复：发生过反应的 NPC 之后能落回正常行为（恢复 ${agg.recoveredNpcs.size}/${agg.reactedNpcs.size}），非永久卡反应循环`,
);

if (failed === 0) { console.log('\n四层 AI 反应层验证通过'); process.exit(0); }
else { console.error(`\n验证失败：${failed} 项`); process.exit(1); }
