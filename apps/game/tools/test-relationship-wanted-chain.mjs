#!/usr/bin/env node
/**
 * 追杀令链关系信号测试。
 *
 * 覆盖：
 *   1) wantedOrder 对同势力成员输出追杀 gate / modifier / target preference。
 *   2) lifeDebt 降低追杀倾向并输出求情/放水信号。
 *   3) bloodFeud 在势力通缉之外增强个人追杀倾向。
 *
 * 用法：node apps/game/tools/test-relationship-wanted-chain.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RelationshipSystem } = await imp('js/engine/world/relationship-system.js');
const { TickManager } = await imp('js/engine/world/tick-manager.js');
const { DeathCollector } = await imp('js/engine/world/services/death-collector.js');

function loadRelationshipPlatform() {
  return {
    schemas: { ledgers: load('data/relationships/schemas/ledgers.json') },
    dictionaries: {
      marks: load('data/relationships/dictionaries/marks.json'),
      tags: load('data/relationships/dictionaries/tags.json'),
      signals: load('data/relationships/dictionaries/signal-keys.json'),
      eventTypes: load('data/relationships/dictionaries/relation-event-types.json'),
      groupTypes: load('data/relationships/dictionaries/group-types.json'),
    },
    eventHooks: [load('data/relationships/event-hooks/legacy-events.json')],
    impactRules: [
      load('data/relationships/impact-rules/combat.json'),
      load('data/relationships/impact-rules/social.json'),
      load('data/relationships/impact-rules/faction.json'),
    ],
    signalRules: [load('data/relationships/signal-rules/wanted-chain.json')],
    groups: load('data/relationships/groups/groups.json'),
  };
}

let failed = 0;
const assert = (condition, message) => {
  if (!condition) { console.error('  FAIL:', message); failed++; }
  else console.log('  OK:', message);
};

console.log('1) wantedOrder 输出追杀信号');
{
  const rs = new RelationshipSystem({ enabled: true, platform: loadRelationshipPlatform() });
  rs.addMark({ layer: 'faction', factionId: 'sect_001', subjectId: 'npc_wanted', type: 'wantedOrder', weight: 80, day: 1 });
  const signals = rs.getSignals({
    actor: { id: 'npc_hunter', factionId: 'sect_001' },
    target: { id: 'npc_wanted' },
    contextType: 'action',
    actionId: 'act_npc_job_hunt_enemy',
  });
  assert(signals.facts.isWantedByFaction === true, '输出 isWantedByFaction fact');
  assert(signals.gates.canTriggerWantedHunt === true, '输出 canTriggerWantedHunt gate');
  assert(signals.modifiers.huntWeight > 1, '通缉提高 huntWeight');
  assert(signals.targetPreferences.revengeTargetBonus >= 80, '通缉提高复仇目标偏好');
}

console.log('2) lifeDebt 降低追杀信号');
{
  const rs = new RelationshipSystem({ enabled: true, platform: loadRelationshipPlatform() });
  rs.addMark({ layer: 'faction', factionId: 'sect_001', subjectId: 'npc_wanted', type: 'wantedOrder', weight: 80, day: 1 });
  rs.addMark({ layer: 'individual', subjectId: 'npc_hunter', objectId: 'npc_wanted', type: 'lifeDebt', weight: 70, day: 1 });
  const signals = rs.getSignals({
    actor: { id: 'npc_hunter', factionId: 'sect_001' },
    target: { id: 'npc_wanted' },
    contextType: 'action',
    actionId: 'act_npc_job_hunt_enemy',
  });
  assert(signals.facts.hasLifeDebt === true, '救命恩输出 hasLifeDebt fact');
  assert(signals.modifiers.huntWeight < 3, '救命恩降低追杀权重');
  assert(signals.gates.canIntercede === true, '救命恩允许求情/放水信号');
}

console.log('3) bloodFeud 增强个人追杀偏好');
{
  const rs = new RelationshipSystem({ enabled: true, platform: loadRelationshipPlatform() });
  rs.addMark({ layer: 'individual', subjectId: 'npc_hunter', objectId: 'npc_enemy', type: 'bloodFeud', weight: 90, day: 1 });
  const signals = rs.getSignals({
    actor: { id: 'npc_hunter', factionId: 'sect_001' },
    target: { id: 'npc_enemy' },
    contextType: 'action',
    actionId: 'act_npc_job_hunt_enemy',
  });
  assert(signals.facts.hasBloodFeud === true, '输出 hasBloodFeud fact');
  assert(signals.modifiers.huntWeight > 2, '血仇提高 huntWeight');
  assert(signals.targetPreferences.revengeTargetBonus >= 90, '血仇提高目标偏好');
}

console.log('4) TickManager 复仇目标解析消费势力通缉信号');
{
  const rs = new RelationshipSystem({ enabled: true, platform: loadRelationshipPlatform() });
  const hunter = {
    id: 'npc_hunter',
    obsessions: { obsessions: [] },
    relationships: { topGrudge() { return null; } },
    state: { get(key) { return key === 'factionId' ? 'sect_001' : null; } },
  };
  const wanted = {
    id: 'npc_wanted',
    alive: true,
    hasSpatial() { return true; },
    spatial: { tileX: 10, tileY: 12 },
  };
  const host = {
    relationshipSystem: rs,
    relationshipConfig: { enabled: true, goalsEnabled: true },
    _relationGoalsEnabled() { return true; },
    entityRegistry: { getById(id) { return id === wanted.id ? wanted : null; } },
  };

  rs.addMark({ layer: 'faction', factionId: 'sect_001', subjectId: wanted.id, type: 'wantedOrder', weight: 80, day: 1 });
  const resolved = TickManager.prototype._resolveRevengeTarget.call(host, hunter);
  assert(resolved?.id === wanted.id, '势力通缉目标进入既有 revenge_target 解析');

  rs.addMark({ layer: 'individual', subjectId: hunter.id, objectId: wanted.id, type: 'lifeDebt', weight: 80, day: 1 });
  const softened = TickManager.prototype._resolveRevengeTarget.call(host, hunter);
  assert(softened === null, '救命恩会让通缉目标从追杀解析中跳过');
}

console.log('5) DeathCollector 把真实死亡管线接入关系事件');
{
  const rs = new RelationshipSystem({ enabled: true, platform: loadRelationshipPlatform() });
  const victim = {
    id: 'npc_victim',
    name: '受害者',
    alive: false,
    _deathInfo: {
      cause: 'slain',
      killerId: 'npc_killer',
      killerName: '凶手',
      killerFactionId: 'sect_002',
      factionId: 'sect_001',
      roleRank: 3,
      witnessCount: 2,
    },
    state: {
      get(key) {
        const values = {
          factionId: 'sect_001',
          roleRank: 3,
          rankName: '长老',
          ageYears: 80,
          maxAgeYears: 200,
        };
        return values[key];
      },
    },
  };
  const host = {
    entityRegistry: { getByType(type) { return type === 'npc' ? [victim] : []; } },
    relationshipSystem: rs,
    worldEntity: { currentDay: 42 },
    worldEventSystem: null,
    _entityPos() { return null; },
    _resolveLocationName() { return null; },
    _relationGoalsEnabled() { return false; },
  };
  const tickLog = { deaths: [], monsterDeaths: [] };
  new DeathCollector({ host }).collect(tickLog);
  const reputation = rs.getFactionReputation('sect_001', 'npc_killer');
  const wantedWeight = (reputation?.marks || [])
    .filter(mark => mark.type === 'wantedOrder' && mark.consumed !== true)
    .reduce((sum, mark) => sum + mark.weight, 0);
  assert(tickLog.deaths.length === 1, '死亡仍写入 tickLog.deaths');
  assert(wantedWeight > 0, '真实死亡管线写入势力 wantedOrder 标记');
}

if (failed === 0) {
  console.log('\n追杀令链关系信号测试全部通过');
  process.exit(0);
}
console.error(`\n追杀令链关系信号测试失败：${failed} 项`);
process.exit(1);
