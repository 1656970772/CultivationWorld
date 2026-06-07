#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { WorldEngine } = await imp('js/engine/world-engine.js');

function buildGameConfigs() {
  const combatEffects = load('data/effects/combat-effects.json');
  const coreEffects = load('data/effects/core-effects.json');
  return {
    seed: 12345,
    factions: load('data/entities/factions.json'),
    npcs: load('data/entities/npcs.json'),
    ranks: load('data/definitions/ranks.json'),
    items: load('data/definitions/macro-resources.json'),
    terrains: load('data/definitions/terrains.json'),
    factionNeeds: load('data/needs/faction-needs.json'),
    npcNeeds: load('data/needs/npc-needs.json'),
    factionActions: load('data/actions/faction-actions.json'),
    npcActions: load('data/actions/npc-actions.json'),
    npcJobActions: load('data/actions/npc-job-actions.json'),
    npcActionSets: load('data/actions/npc-action-sets.json'),
    reactionActions: load('data/actions/reaction-actions.json'),
    worldRules: load('data/actions/world-rules.json'),
    jobs: {
      jobs: [
        ...load('data/jobs/npc-dynamic-event-jobs.json').jobs,
        ...load('data/jobs/npc-economy-jobs.json').jobs,
        ...load('data/jobs/npc-social-jobs.json').jobs,
      ],
    },
    toils: {
      toils: [
        ...load('data/toils/core-toils.json').toils,
        ...load('data/toils/npc-dynamic-event-toils.json').toils,
        ...load('data/toils/npc-economy-toils.json').toils,
        ...load('data/toils/npc-social-toils.json').toils,
      ],
    },
    questTemplates: load('data/quests/quest-templates.json'),
    mapData: load('data/world/map.json'),
    modifierTemplates: load('data/world/modifiers.json'),
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
    gameConfig: load('data/config/game-config.json'),
    aiConfig: load('data/config/ai-config.json'),
    names: load('data/definitions/names.json'),
    monsters: load('data/definitions/monsters.json'),
    monsterAttributeTemplates: load('data/definitions/monster-attribute-templates.json'),
    monsterSpawn: load('data/balance/monster-spawn.json'),
    worldNews: load('data/world/news.json'),
    worldOpportunities: load('data/world/opportunities.json'),
    dynamicEvents: load('data/world/dynamic-events.json'),
    dynamicGoals: load('data/goals/dynamic-goals.json'),
    balanceCovet: load('data/balance/covet.json'),
    itemDefs: { items: ['currency', 'material', 'pill', 'artifact', 'talisman', 'technique'].flatMap(c => load(`data/items/${c}.json`).items) },
    tags: load('data/tags/tags.json'),
    effects: { effects: [...(combatEffects?.effects || []), ...(coreEffects?.effects || [])] },
    abilities: load('data/abilities/combat-abilities.json'),
  };
}

console.log('1) NPC 快照提供详细状态面板所需字段');
{
  const engine = new WorldEngine();
  engine.init(buildGameConfigs());
  const snap = engine.getWorldSnapshot();
  const npc = Object.values(snap.npcs).find(n => n.alive);

  assert.ok(npc, '存在存活 NPC');
  assert.equal(typeof npc.hp, 'number', '包含当前气血');
  assert.equal(typeof npc.maxHp, 'number', '包含气血上限');
  assert.equal(typeof npc.injuryLevel, 'number', '包含受伤程度');
  assert.equal(typeof npc.cultivation, 'number', '包含闭关修为');
  assert.equal(typeof npc.experienceCultivation, 'number', '包含历练修为');
  assert.equal(typeof npc.totalCultivation, 'number', '包含总修为');
  assert.ok('nextCultivationRequired' in npc, '包含下境界所需修为');
  assert.ok('rankStage' in npc, '包含当前小层');
  assert.equal(typeof npc.actionRemaining, 'number', '包含剩余行动天数');
  assert.equal(typeof npc.minCultivationRatio, 'number', '包含最低闭关占比');
  assert.ok('nextRankName' in npc, '包含下一境界名称');
  assert.ok('nextQiRequired' in npc, '包含突破所需真气');
  assert.equal(['cultivation', 'Progress'].join('') in npc, false, '不再输出旧闭关比例');
  assert.equal(['in', 'sight'].join('') in npc, false, '不再输出旧游历比例');
  assert.equal(['total', 'Progress'].join('') in npc, false, '不再输出旧突破比例');
  assert.equal(['cultivation', 'Cap'].join('') in npc, false, '不再输出旧闭关比例上限');
  assert.equal('retreatCultivationCap' in npc, false, '不再输出旧闭关修为上限');
  assert.equal(['max', 'Insight'].join('') in npc, false, '不再输出旧游历比例上限');
  assert.equal(typeof npc.spiritRootId, 'string', '包含灵根');
  assert.equal(typeof npc.physiqueId, 'string', '包含体质');
}

console.log('World snapshot NPC status field tests passed');
