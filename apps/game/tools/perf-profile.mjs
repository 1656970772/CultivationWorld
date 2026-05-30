#!/usr/bin/env node
/**
 * 性能基准 — 无头运行 WorldEngine，统计每天耗时与瓶颈分布。
 * 用法: node apps/game/tools/perf-profile.mjs [天数]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GAME_ROOT = resolve(__dirname, '..');
function loadJSON(p) { return JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8')); }

const configs = {
  factions: loadJSON('data/entities/factions.json'),
  npcs: loadJSON('data/entities/npcs.json'),
  ranks: loadJSON('data/definitions/ranks.json'),
  items: loadJSON('data/definitions/resources.json'),
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
  gameConfig: loadJSON('data/config/game-config.json'),
  aiConfig: loadJSON('data/config/ai-config.json'),
  names: loadJSON('data/definitions/names.json'),
  monsters: loadJSON('data/definitions/monsters.json'),
  monsterSpawn: loadJSON('data/balance/monster-spawn.json'),
};

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);

const DAYS = parseInt(process.argv[2], 10) || 700;
const engine = new WorldEngine();
const t0 = performance.now();
const initRes = engine.init(configs);
const tInit = performance.now() - t0;
console.log(`初始化 ${tInit.toFixed(0)}ms | 势力 ${initRes.totalFactions} NPC ${initRes.totalNPCs} 妖兽 ${initRes.totalMonsters} | 地图 ${engine._mapWidth}x${engine._mapHeight}`);

const tStart = performance.now();
let bucketStart = tStart;
const BUCKET = 100;
for (let d = 1; d <= DAYS; d++) {
  engine.tick();
  if (d % BUCKET === 0) {
    const now = performance.now();
    const npcs = engine.entityRegistry.getAliveByType('npc').length;
    const mon = engine.entityRegistry.getAliveByType('monster').length;
    console.log(`第${d}天 | 本${BUCKET}天 ${(now - bucketStart).toFixed(0)}ms (${((now - bucketStart) / BUCKET).toFixed(1)}ms/天) | 存活NPC ${npcs} 妖兽 ${mon}`);
    bucketStart = now;
  }
}
const total = performance.now() - tStart;
console.log(`\n总计 ${DAYS} 天: ${(total / 1000).toFixed(1)}s, 平均 ${(total / DAYS).toFixed(2)}ms/天`);
