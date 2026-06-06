#!/usr/bin/env node
/**
 * 临时验证脚本：跑模拟，统计职位晋升/继任/大比事件与职位分布变化。
 * 用法: node apps/game/tools/verify-promotion.mjs [天数]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const loadJSON = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const configs = {
  factions: loadJSON('data/entities/factions.json'),
  npcs: loadJSON('data/entities/npcs.json'),
  ranks: loadJSON('data/definitions/ranks.json'),
  items: loadJSON('data/definitions/macro-resources.json'),
  itemDefs: { items: ['currency','material','pill','artifact','talisman','technique'].flatMap(c => loadJSON(`data/items/${c}.json`).items) },
  terrains: loadJSON('data/definitions/terrains.json'),
  factionNeeds: loadJSON('data/needs/faction-needs.json'),
  npcNeeds: loadJSON('data/needs/npc-needs.json'),
  factionActions: loadJSON('data/actions/faction-actions.json'),
  npcActions: loadJSON('data/actions/npc-actions.json'),
  worldRules: loadJSON('data/actions/world-rules.json'),
  questTemplates: loadJSON('data/quests/quest-templates.json'),
  mapData: loadJSON('data/world/map.json'),
  modifierTemplates: loadJSON('data/world/modifiers.json'),
  balanceCombat: loadJSON('data/balance/combat.json'),
  balanceEconomy: loadJSON('data/balance/economy.json'),
  balanceCultivation: loadJSON('data/balance/cultivation.json'),
  balanceSocial: loadJSON('data/balance/social.json'),
  balanceMovement: loadJSON('data/balance/movement.json'),
  balancePersonality: loadJSON('data/balance/personality.json'),
  gameConfig: loadJSON('data/config/game-config.json'),
  aiConfig: loadJSON('data/config/ai-config.json'),
  names: loadJSON('data/definitions/names.json'),
  monsters: loadJSON('data/definitions/monsters.json'),
  monsterAttributeTemplates: loadJSON('data/definitions/monster-attribute-templates.json'),
  monsterSpawn: loadJSON('data/balance/monster-spawn.json'),
};

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);

const DAYS = parseInt(process.argv[2], 10) || 720;
const engine = new WorldEngine();
engine.init(configs);

function roleDist() {
  const dist = {};
  for (const npc of engine.entityRegistry.getAliveByType('npc')) {
    const r = npc.state.get('currentRole');
    dist[r] = (dist[r] || 0) + 1;
  }
  return dist;
}

console.log('初始职位分布:', JSON.stringify(roleDist()));

for (let i = 0; i < DAYS; i++) engine.tick();

console.log(`第${DAYS}天职位分布:`, JSON.stringify(roleDist()));

const log = engine.tickManager.sectEventLog || [];
const byType = {};
for (const e of log) byType[e.type] = (byType[e.type] || 0) + 1;
console.log('门派事件统计:', JSON.stringify(byType));

// 大比按"届"（触发日）去重统计
const grandDays = [...new Set(log.filter(e => e.type === 'grand_competition').map(e => e.day))].sort((a, b) => a - b);
console.log(`大比届数: ${grandDays.length} 届，触发日: [${grandDays.join(', ')}]`);
console.log(`大比获奖记录总数: ${(byType['grand_competition'] || 0)} 条 → 平均每届 ${grandDays.length ? Math.round((byType['grand_competition'] || 0) / grandDays.length) : 0} 条`);

const promos = log.filter(e => e.type === 'promotion').slice(0, 8);
console.log('晋升样例:', promos.map(p => `${p.npcName} ${p.fromRole}->${p.toRole}(贡献${p.contribution}${p.viaChallenge ? ',挑战' : ''})`).join(' | ') || '(无)');

// 晋入稀缺顶层（elder/heir）的记录：补位 vs 挑战
const topPromos = log.filter(e => (e.type === 'promotion' || e.type === 'challenge_promote') && (e.toRole === 'elder' || e.toRole === 'heir'));
const filled = topPromos.filter(e => !e.viaChallenge).length;
const challenged = topPromos.filter(e => e.viaChallenge).length;
console.log(`晋入稀缺顶层(elder/heir): 共 ${topPromos.length} 次（补位 ${filled} / 挑战 ${challenged}）`);
console.log('稀缺顶层样例:', topPromos.slice(0, 8).map(e => `${e.npcName} ${e.fromRole}->${e.toRole}${e.viaChallenge ? '(挑战'+(e.displacedNpcId||'')+')' : '(补位)'}`).join(' | ') || '(无)');
console.log('挑战上位(challenge_promote)总数:', log.filter(e => e.type === 'challenge_promote').length);

const grand = log.filter(e => e.type === 'grand_competition' && e.promoted).slice(0, 5);
console.log('大比冠军晋升:', grand.map(g => `${g.npcName}@${g.factionId}`).join(' | ') || '(无)');

// 诊断：活着 NPC 的修为分布 + 高野心非顶层弟子中修为饱和的人数
const alive = engine.entityRegistry.getAliveByType('npc');
const buckets = { '<0.3': 0, '0.3-0.6': 0, '0.6-0.85': 0, '>=0.85': 0 };
let ambitiousReady = 0, ambitiousTotal = 0;
for (const n of alive) {
  const p = n.state.get('cultivationProgress') || 0;
  if (p < 0.3) buckets['<0.3']++; else if (p < 0.6) buckets['0.3-0.6']++;
  else if (p < 0.85) buckets['0.6-0.85']++; else buckets['>=0.85']++;
  const amb = n.staticData.personality?.ambition || 0;
  if (amb >= 60 && (n.state.get('roleRank') || 0) < 5 && n.state.get('factionId')) {
    ambitiousTotal++;
    if (p >= 0.85) ambitiousReady++;
  }
}
console.log('修为分布:', JSON.stringify(buckets));
console.log(`高野心(>=60)非顶层弟子: ${ambitiousTotal} 人，其中修为饱和(>=0.85)可触发野心: ${ambitiousReady} 人`);
