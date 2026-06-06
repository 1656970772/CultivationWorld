#!/usr/bin/env node
/**
 * 信息传播 / 机会点 / 怀璧其罪系统验证（ADR-024/025）。
 *
 * 验证点：
 *   1) 默认 enabled=false 时不产生任何新闻/机会/觊觎事件。
 *   2) 激活态下：事件→新闻→传播→NPC 知晓；机会点生成；怀璧其罪暴露与抢夺/放过可触发。
 *
 * 用法：node tools/test-info-propagation.mjs
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
    worldRules: load('data/actions/world-rules.json'),
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
    gameConfig: load('data/config/game-config.json'),
    aiConfig: load('data/config/ai-config.json'),
    names: load('data/definitions/names.json'),
    monsters: load('data/definitions/monsters.json'),
    monsterAttributeTemplates: load('data/definitions/monster-attribute-templates.json'),
    monsterSpawn: load('data/balance/monster-spawn.json'),
    worldNews: load('data/world/news.json'),
    worldOpportunities: load('data/world/opportunities.json'),
    balanceCovet: load('data/balance/covet.json'),
    itemDefs: { items: ['currency','material','pill','artifact','talisman','technique'].flatMap(c => load(`data/items/${c}.json`).items) },
  };
}

const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);
const { InfoPropagationSystem } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/info-propagation.js')).href);
const { OpportunitySystem } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/opportunity.js')).href);
const { computeAssetScore, decideCovet } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/info-actions.js')).href);

let failures = 0;
function ok(cond, msg) {
  console.log(`  ${cond ? 'OK' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
}

// ── 单元 1：传播半径扩散 + 知晓 ───────────────────────
console.log('1) WorldNews 半径传播与 NPC 知晓');
{
  const info = new InfoPropagationSystem({
    enabled: true,
    newsTypes: { tribulation: { importance: 100, spreadSpeed: 50, maxRadius: 500, baseReliability: 1.0, decayRate: 0.01, ttlDays: 10 } },
    channels: { radius: { enabled: true } },
    defaultBeliefThreshold: 0.1,
  });
  const mkNpc = (id, x, y) => ({ id, name: id, spatial: { tileX: x, tileY: y }, state: { personality: {} } });
  const near = mkNpc('near', 110, 100);
  const far = mkNpc('far', 400, 100);
  const npcs = [near, far];
  info.publishNews({ type: 'tribulation', origin: { x: 100, y: 100 }, day: 0, value: 1000, text: '渡劫异象' });
  info.tick({ currentDay: 1, npcs }); // radius=50 → near(dist10)知晓
  ok(near._knownNews && near._knownNews.size === 1, '近处 NPC 第1天即知晓渡劫消息');
  ok(!far._knownNews || far._knownNews.size === 0, '远处 NPC 尚未知晓');
  for (let d = 2; d <= 8; d++) info.tick({ currentDay: d, npcs }); // radius 增长覆盖 far(dist300)
  ok(far._knownNews && far._knownNews.size === 1, '随天数推进，远处 NPC 最终也知晓（由近及远扩散）');
}

// ── 单元 2：机会点生成与过期 ───────────────────────
console.log('2) WorldOpportunity 生成与过期');
{
  const opp = new OpportunitySystem({
    enabled: true,
    types: { monster_corpse: { value: 600, lifespanDays: 5, maxClaims: 2 } },
  });
  const o = opp.spawn({ type: 'monster_corpse', pos: { x: 50, y: 50 }, currentDay: 0 });
  ok(o && o.value === 600, '机会点生成成功，价值取配置默认值');
  ok(opp.tick(3).length === 0, '未过期时无过期事件');
  const expired = opp.tick(5);
  ok(expired.length === 1 && opp.opportunities.length === 0, '到期后机会点被移除并产出过期事件');
}

// ── 单元 3：身家估值 ───────────────────────
console.log('3) computeAssetScore 身家估值');
{
  const npc = {
    inventory: { getAll: () => ({ low_spirit_stone: 100, artifact_void_cauldron: 1 }) },
    state: { get: (k) => (k === 'equippedArtifactId' ? null : null) },
  };
  const { ItemRegistry } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/items/item-registry.js')).href);
  ItemRegistry.loadFromArray(baseConfigs().itemDefs.items);
  const score = computeAssetScore(npc, null);
  ok(score === 100 + 30000, `背包灵石+古宝估值正确（实际 ${score}）`);
}

// ── 单元 4：觊觎决策（抢夺 vs 放他一马）───────────────────────
console.log('4) decideCovet 觊觎/放过决策');
{
  const covetCfg = baseConfigs().balanceCovet;
  const powerFn = (n) => n._power;
  const mk = (id, opts) => ({ id, staticData: { name: id }, _power: opts.power,
    relationships: { getGratitude: (tid) => opts.gratitude?.[tid] ?? 0 },
    state: { personality: opts.personality || {}, get: (k) => opts[k] ?? null } });

  // 贪婪强者 vs 弱小富户、无关系 → 抢
  const greedy = mk('greedy', { power: 50, personality: { courage: 90, justice: 10, diplomacy: 10 } });
  const richWeak = mk('rich', { power: 5, factionId: 'fA', currentRole: 'disciple' });
  const d1 = decideCovet(greedy, richWeak, 5000, covetCfg, powerFn);
  ok(d1.act && !d1.spare, '贪婪强者对无关系弱小富户起贪念（抢夺）');

  // 同门长老 → 放他一马
  const sameSect = mk('elder', { power: 50, factionId: 'fA', personality: { courage: 90, justice: 60, diplomacy: 80 } });
  const sameSectTarget = mk('junior', { power: 5, factionId: 'fA', currentRole: 'elder' });
  const d2 = decideCovet(sameSect, sameSectTarget, 5000, covetCfg, powerFn);
  ok(d2.spare, '同门 + 受保护职位 + 高德性 → 放他一马');

  // 实力不足 → 不动手
  const weak = mk('weak', { power: 4, personality: { courage: 90, justice: 10 } });
  const d3 = decideCovet(weak, richWeak, 5000, covetCfg, powerFn);
  ok(!d3.act, '实力不足者不敢起贪念');
}

// ── 集成：激活态引擎跑若干天，应观测到信息系统事件 ───────────────────────
console.log('5) 激活态引擎集成（事件→消息→机会→决策涌现）');
{
  const configs = baseConfigs();
  configs.worldNews = { ...configs.worldNews, enabled: true };
  configs.worldOpportunities = { ...configs.worldOpportunities, enabled: true };
  configs.balanceReward = { ...configs.balanceReward, enabled: true };
  configs.balanceCovet = { ...configs.balanceCovet, enabled: true };
  configs.seed = 1337;
  const engine = new WorldEngine();
  engine.init(configs);

  const tags = {};
  for (let i = 0; i < 30; i++) {
    const tickLog = engine.tick();
    for (const e of (tickLog.infoEvents || [])) {
      tags[e.type] = (tags[e.type] || 0) + 1;
    }
  }
  console.log('     信息系统事件统计:', JSON.stringify(tags));
  const total = Object.values(tags).reduce((s, n) => s + n, 0);
  ok(total > 0, `激活态下信息系统产生事件（共 ${total} 条）`);
  const infoSys = engine.tickManager.infoSystem;
  ok(infoSys.activeNews.length >= 0 && infoSys.enabled, '信息传播系统已启用');
  ok(engine.tickManager.opportunitySystem.enabled, '机会点系统已启用');
}

// ── 集成：默认禁用态不产生信息事件 ───────────────────────
console.log('6) 默认禁用态（不产生信息系统事件）');
{
  const configs = baseConfigs(); // 全部默认 enabled=false
  configs.seed = 1337;
  const engine = new WorldEngine();
  engine.init(configs);
  let infoCount = 0;
  for (let i = 0; i < 5; i++) {
    const tickLog = engine.tick();
    for (const e of (tickLog.infoEvents || [])) {
      if (['news_born', 'news_spread', 'wealth_exposed', 'covet_rob', 'covet_spare', 'opportunity_expired'].includes(e.type)) infoCount++;
    }
  }
  ok(infoCount === 0, `禁用态下无任何信息系统专属事件（实际 ${infoCount}）`);
}

console.log(failures === 0 ? '\n信息传播/机会/怀璧其罪系统测试全部通过' : `\n有 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
