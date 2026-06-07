#!/usr/bin/env node
/**
 * 三层关系平台单元测试。
 *
 * 覆盖：
 *   1) combat.kill public 写入势力层 wantedOrder 与声望变化。
 *   2) mark stacking 的 max / instance 语义。
 *   3) snapshot/load 恢复账本、mark、tag。
 *
 * 用法：node apps/game/tools/test-relationship-platform.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RelationshipSystem } = await imp('js/engine/world/relationship-system.js');

const relationshipConfig = {
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
  projections: {
    legacyEdges: load('data/relationships/projections/legacy-edge-projections.json'),
  },
};

let failed = 0;
const assert = (condition, message) => {
  if (!condition) { console.error('  FAIL:', message); failed++; }
  else console.log('  OK:', message);
};

console.log('1) combat.kill public 写势力通缉账本');
{
  const rs = new RelationshipSystem({ enabled: true, platform: relationshipConfig });
  rs.handleEvent({
    id: 'evt_kill_1',
    type: 'combat.kill',
    actor: { id: 'npc_killer', type: 'npc', factionId: 'sect_001', roleRank: 2 },
    target: { id: 'npc_victim', type: 'npc', factionId: 'sect_002', roleRank: 4 },
    visibility: 'public',
    witness: { count: 6 },
    day: 12,
    source: { type: 'action', id: 'act_npc_job_hunt_enemy' },
  });

  const ledger = rs.getFactionReputation('sect_002', 'npc_killer');
  assert(ledger && ledger.core.reputation < 0, '公开击杀降低受害者势力对凶手的声望');
  assert(ledger && ledger.marks.some(m => m.type === 'wantedOrder' && m.weight >= 50), '公开击杀写入 wantedOrder mark');
  assert(rs.stats().byLayer.faction === 1, '势力账本统计为 1');
}

console.log('2) mark stacking max / instance');
{
  const rs = new RelationshipSystem({ enabled: true, platform: relationshipConfig });
  rs.addMark({ layer: 'faction', factionId: 'sect_001', subjectId: 'npc_a', type: 'wantedOrder', weight: 40, day: 1 });
  rs.addMark({ layer: 'faction', factionId: 'sect_001', subjectId: 'npc_a', type: 'wantedOrder', weight: 75, day: 2 });
  rs.addMark({ layer: 'individual', subjectId: 'npc_b', objectId: 'npc_a', type: 'favorDebt', weight: 10, day: 2 });
  rs.addMark({ layer: 'individual', subjectId: 'npc_b', objectId: 'npc_a', type: 'favorDebt', weight: 15, day: 3 });

  const factionLedger = rs.getFactionReputation('sect_001', 'npc_a');
  const individualLedger = rs.getIndividualRelation('npc_b', 'npc_a');
  assert(factionLedger.marks.filter(m => m.type === 'wantedOrder').length === 1, 'wantedOrder 使用 max stacking 保留单条');
  assert(factionLedger.marks.find(m => m.type === 'wantedOrder').weight === 75, 'wantedOrder 保留最高权重');
  assert(individualLedger.marks.filter(m => m.type === 'favorDebt').length === 2, 'favorDebt 使用 instance stacking 保留多条');
}

console.log('3) snapshot/load 恢复账本');
{
  const rs = new RelationshipSystem({ enabled: true, platform: relationshipConfig });
  rs.addTag({ layer: 'individual', subjectId: 'npc_a', objectId: 'npc_b', type: 'sameSect', day: 1 });
  rs.addMark({ layer: 'individual', subjectId: 'npc_a', objectId: 'npc_c', type: 'bloodFeud', weight: 80, day: 1 });
  const snap = rs.snapshot();
  const restored = new RelationshipSystem({ enabled: true, platform: relationshipConfig });
  restored.loadFrom(snap);
  assert(restored.getIndividualRelation('npc_a', 'npc_b').tags.some(t => t.type === 'sameSect'), 'tag 恢复');
  assert(restored.getIndividualRelation('npc_a', 'npc_c').marks.some(m => m.type === 'bloodFeud'), 'mark 恢复');
}

console.log('4) 旧边 API 从账本投影 mark/tag');
{
  const rs = new RelationshipSystem({ enabled: true, platform: relationshipConfig });
  rs.addMark({ layer: 'individual', subjectId: 'npc_a', objectId: 'npc_b', type: 'bloodFeud', weight: 80, day: 3 });
  rs.addTag({ layer: 'individual', subjectId: 'npc_a', objectId: 'npc_c', type: 'sameSect', day: 4 });

  const grudges = rs.edgesOfType('npc_a', 'grudge');
  const topGrudge = rs.topEdgeOfType('npc_a', 'grudge');
  assert(grudges.some(e => e.toId === 'npc_b' && e.strength === 80), 'bloodFeud mark 投影为 grudge 边');
  assert(topGrudge && topGrudge.toId === 'npc_b' && topGrudge.strength === 80, 'topEdgeOfType 可读取 bloodFeud 投影');
  assert(rs.edgesOfType('npc_a', 'enemy').some(e => e.toId === 'npc_b' && e.strength === 80), 'bloodFeud mark 投影为 enemy 边');
  assert(rs.edgesOfType('npc_a', 'beast_grudge').some(e => e.toId === 'npc_b' && e.strength === 80), 'bloodFeud mark 投影为 beast_grudge 边');
  assert(rs.edgesOfType('npc_a', 'same_sect').some(e => e.toId === 'npc_c'), 'sameSect tag 投影为 same_sect 边');
  rs.addMark({ layer: 'individual', subjectId: 'npc_a', objectId: 'npc_d', type: 'resourceGrudge', weight: 55, day: 5 });
  rs.addMark({ layer: 'individual', subjectId: 'npc_a', objectId: 'npc_e', type: 'lifeDebt', weight: 45, day: 6 });
  rs.addMark({ layer: 'individual', subjectId: 'npc_a', objectId: 'npc_f', type: 'favorDebt', weight: 35, day: 7 });
  rs.addTag({ layer: 'individual', subjectId: 'npc_master', objectId: 'npc_disciple', type: 'masterDisciple', source: { edgeType: 'master' }, day: 8 });
  rs.addTag({ layer: 'individual', subjectId: 'npc_disciple', objectId: 'npc_master', type: 'masterDisciple', source: { edgeType: 'disciple' }, day: 8 });
  rs.addTag({ layer: 'individual', subjectId: 'npc_teacher', objectId: 'npc_student', type: 'masterDisciple', day: 9 });
  assert(rs.edgesOfType('npc_a', 'rival').some(e => e.toId === 'npc_d' && e.strength === 55), 'resourceGrudge mark 投影为 rival 边');
  assert(rs.edgesOfType('npc_a', 'beast_rival').some(e => e.toId === 'npc_d' && e.strength === 55), 'resourceGrudge mark 投影为 beast_rival 边');
  assert(rs.edgesOfType('npc_a', 'territory_threat').some(e => e.toId === 'npc_d' && e.strength === 55), 'resourceGrudge mark 投影为 territory_threat 边');
  assert(rs.edgesOfType('npc_a', 'gratitude').some(e => e.toId === 'npc_e' && e.strength === 45), 'lifeDebt mark 投影为 gratitude 边');
  assert(rs.edgesOfType('npc_a', 'benefactor').some(e => e.toId === 'npc_e' && e.strength === 45), 'lifeDebt mark 投影为 benefactor 边');
  assert(rs.edgesOfType('npc_a', 'gratitude').some(e => e.toId === 'npc_f' && e.strength === 35), 'favorDebt mark 投影为 gratitude 边');
  assert(rs.edgesOfType('npc_a', 'benefactor').some(e => e.toId === 'npc_f' && e.strength === 35), 'favorDebt mark 投影为 benefactor 边');
  assert(rs.edgesOfType('npc_master', 'master').some(e => e.toId === 'npc_disciple'), 'masterDisciple tag 可投影 master 边');
  assert(rs.edgesOfType('npc_disciple', 'disciple').some(e => e.toId === 'npc_master'), 'masterDisciple tag 可投影 disciple 边');
  assert(rs.edgesOfType('npc_teacher', 'master').some(e => e.toId === 'npc_student'), '无 source.edgeType 的 masterDisciple tag 可投影 master 边');
  assert(rs.edgesOfType('npc_teacher', 'disciple').some(e => e.toId === 'npc_student'), '无 source.edgeType 的 masterDisciple tag 可投影 disciple 边');
  assert(rs.allEdges().some(e => e.fromId === 'npc_a' && e.toId === 'npc_b' && e.type === 'grudge'), 'allEdges 包含 mark 投影');
  assert(rs.allEdges().some(e => e.fromId === 'npc_a' && e.toId === 'npc_c' && e.type === 'same_sect'), 'allEdges 包含 tag 投影');

  const restored = new RelationshipSystem({ enabled: true, platform: relationshipConfig });
  restored.loadFrom(rs.snapshot());
  assert(restored.edgesOfType('npc_a', 'grudge').some(e => e.toId === 'npc_b' && e.strength === 80), 'loadFrom 后保留 mark 投影');
  assert(restored.edgesOfType('npc_a', 'same_sect').some(e => e.toId === 'npc_c'), 'loadFrom 后保留 tag 投影');
  assert(restored.edgesOfType('npc_master', 'master').some(e => e.toId === 'npc_disciple'), 'loadFrom 后保留 master 投影');
  assert(restored.edgesOfType('npc_disciple', 'disciple').some(e => e.toId === 'npc_master'), 'loadFrom 后保留 disciple 投影');

  const mirrored = new RelationshipSystem({ enabled: true, platform: relationshipConfig });
  mirrored.addEdge('npc_edge', 'npc_target', 'grudge', { strengthDelta: 70, tick: 10 });
  assert(mirrored.edgesOfType('npc_edge', 'grudge').some(e => e.toId === 'npc_target' && e.strength === 70), 'addEdge grudge 保持 grudge 兼容边');
  assert(mirrored.edgesOfType('npc_edge', 'enemy').length === 0, 'source.edgeType 防止 grudge 镜像额外投影 enemy');
  assert(mirrored.edgesOfType('npc_edge', 'beast_grudge').length === 0, 'source.edgeType 防止 grudge 镜像额外投影 beast_grudge');
}

if (failed === 0) {
  console.log('\n三层关系平台单元测试全部通过');
  process.exit(0);
}
console.error(`\n三层关系平台单元测试失败：${failed} 项`);
process.exit(1);
