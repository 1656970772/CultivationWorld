#!/usr/bin/env node
/**
 * 关系驱动 Goal / 妖群 / 领地 单元测试（ADR-028，关系网二期）。
 *
 * 覆盖：
 *   1) NPC 关系驱动 Goal：
 *      - goalsEnabled=false → collectExtraGoals 不产出关系 Goal（零漂移回退）。
 *      - 高强度 same_sect 同门陷入争斗（hasRevengeTarget）且在驰援范围 → 产出 assist_sect_mate Goal，
 *        锁定 targetRelationshipId。
 *      - 高强度 enemy 边 + goalsEnabled → RelationshipSystem.topEdgeOfType('enemy') 达门槛
 *        （_resolveRevengeTarget 据此把 enemy 边纳入复仇目标）。
 *      - 关系对象失效 → _refreshRelationshipState 清空 targetRelationshipId。
 *   2) initMonsterRelationships：同 family + 老巢邻近建 pack_member（对称），最高 grade 建 pack_leader。
 *   3) MonsterSpawner swarmBehavior 物种成簇生成（monsterPackConfig 传入时）。
 *   4) territory_threat：territory_intrusion 事件建边 + decay=2 衰减。
 *
 * 用法：node tools/test-relationship-goals.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RelationshipSystem } = await imp('js/engine/world/relationship-system.js');
const { initMonsterRelationships } = await imp('js/engine/world/relationship-init.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');
const { GoalSource } = await imp('js/engine/abstract/goal.js');
const { MonsterEntity } = await imp('js/engine/monster/monster-entity.js');
const { MonsterSpawner } = await imp('js/engine/monster/monster-spawner.js');
const { ItemRegistry } = await imp('js/engine/items/item-registry.js');

const relationshipConfig = load('data/balance/relationship.json');
const ranks = load('data/definitions/ranks.json');
const cultivationConfig = load('data/balance/cultivation.json');
const gameConfig = load('data/config/game-config.json');
const monsterDefs = load('data/definitions/monsters.json');

ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/definitions/resources.json'));

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

/** 构造一个绑定到给定 RelationshipSystem 的 NPCEntity（带真实配置）。 */
function mkNpc(id, rs, relCfg, stateOverrides = {}, pos = { x: 0, y: 0 }) {
  const npc = new NPCEntity(
    { id, name: id, factionId: 'sect_001', role: 'disciple', rankId: 'foundation', alive: true },
    ranks,
    {
      gameConfig,
      cultivationConfig,
      relationshipSystem: rs,
      relationshipConfig: relCfg,
    },
  );
  npc.initSpatial({ x: pos.x, y: pos.y, speed: 3 });
  for (const [k, v] of Object.entries(stateOverrides)) npc.state.set(k, v);
  return npc;
}

/** 简易实体注册表（仅 getById/getAliveByType 供本测试用）。 */
function mkRegistry(entities) {
  const byId = new Map(entities.map(e => [e.id, e]));
  return {
    getById: (id) => byId.get(id) || null,
    getAliveByType: (type) => entities.filter(e => e.type === type && e.alive !== false),
  };
}

// —— 1) NPC 关系驱动 Goal ——
console.log('1) NPC 关系驱动 Goal');
{
  // (a) goalsEnabled=false → 不产出关系 Goal
  {
    const cfg = { ...relationshipConfig, goalsEnabled: false };
    const rs = new RelationshipSystem(cfg);
    const me = mkNpc('me_off', rs, cfg);
    const ally = mkNpc('ally_off', rs, cfg, { hasRevengeTarget: true }, { x: 3, y: 0 });
    rs.addEdge('me_off', 'ally_off', 'same_sect', { strengthDelta: 80 });
    const reg = mkRegistry([me, ally]);
    const goals = me.collectExtraGoals({ entityRegistry: reg });
    const relGoals = goals.filter(g => g.source === GoalSource.RELATIONSHIP);
    assert(relGoals.length === 0, 'goalsEnabled=false 时不产出关系 Goal（零漂移）');
  }

  // (b) 高强度同门遭袭 → 产出 assist_sect_mate Goal
  {
    const cfg = { ...relationshipConfig, goalsEnabled: true };
    const rs = new RelationshipSystem(cfg);
    const me = mkNpc('me1', rs, cfg);
    const ally = mkNpc('ally1', rs, cfg, { hasRevengeTarget: true }, { x: 5, y: 0 }); // 在 maxAssistRange(18) 内
    rs.addEdge('me1', 'ally1', 'same_sect', { strengthDelta: 80 });
    const reg = mkRegistry([me, ally]);
    const goals = me.collectExtraGoals({ entityRegistry: reg });
    const assist = goals.find(g => g.id === 'goal_assist_sect_mate');
    assert(!!assist, '高强度同门遭袭产出 assist_sect_mate Goal');
    assert(assist && assist.source === GoalSource.RELATIONSHIP, 'assist Goal source=relationship');
    assert(me.state.get('targetRelationshipId') === 'ally1', 'assist Goal 锁定 targetRelationshipId=ally1');
    assert(assist && assist.goalState.assistedAlly?.value === true, 'assist Goal goalState 对齐 assistedAlly=true');
  }

  // (b2) 同门未陷争斗（hasRevengeTarget=false）→ 不驰援
  {
    const cfg = { ...relationshipConfig, goalsEnabled: true };
    const rs = new RelationshipSystem(cfg);
    const me = mkNpc('me1b', rs, cfg);
    const ally = mkNpc('ally1b', rs, cfg, { hasRevengeTarget: false }, { x: 5, y: 0 });
    rs.addEdge('me1b', 'ally1b', 'same_sect', { strengthDelta: 80 });
    const reg = mkRegistry([me, ally]);
    const goals = me.collectExtraGoals({ entityRegistry: reg });
    assert(!goals.find(g => g.id === 'goal_assist_sect_mate'), '同门未陷争斗时不产出驰援 Goal');
  }

  // (b3) 同门遭袭但超出驰援范围 → 不驰援
  {
    const cfg = { ...relationshipConfig, goalsEnabled: true };
    const rs = new RelationshipSystem(cfg);
    const me = mkNpc('me1c', rs, cfg);
    const ally = mkNpc('ally1c', rs, cfg, { hasRevengeTarget: true }, { x: 100, y: 100 }); // 远超 maxAssistRange
    rs.addEdge('me1c', 'ally1c', 'same_sect', { strengthDelta: 80 });
    const reg = mkRegistry([me, ally]);
    const goals = me.collectExtraGoals({ entityRegistry: reg });
    assert(!goals.find(g => g.id === 'goal_assist_sect_mate'), '同门遭袭超出驰援范围时不产出 Goal');
  }

  // (c) 高强度 enemy 边 → topEdgeOfType 达门槛（_resolveRevengeTarget 据此纳入复仇目标）
  {
    const cfg = { ...relationshipConfig, goalsEnabled: true };
    const rs = new RelationshipSystem(cfg);
    rs.addEdge('hater', 'foe', 'enemy', { strengthDelta: 50 });
    const minEnemy = cfg.npcGoals?.relationRevenge?.minEnemyStrength ?? 40;
    const top = rs.topEdgeOfType('hater', 'enemy');
    assert(top && top.toId === 'foe', 'enemy 边经 topEdgeOfType 可取出');
    assert(top && top.strength >= minEnemy, `enemy 边强度(${top?.strength}) 达复仇门槛(${minEnemy})`);
  }

  // (d) 关系对象失效 → _refreshRelationshipState 清空锁定
  {
    const cfg = { ...relationshipConfig, goalsEnabled: true };
    const rs = new RelationshipSystem(cfg);
    const me = mkNpc('me2', rs, cfg);
    me.state.set('targetRelationshipId', 'gone_ally');
    const reg = mkRegistry([me]); // gone_ally 不在注册表 → 视为失效
    me._refreshRelationshipState({ entityRegistry: reg });
    assert(me.state.get('targetRelationshipId') === null, '关系对象失效后清空 targetRelationshipId');
  }
}

// —— 2) initMonsterRelationships 妖群建边 ——
console.log('2) initMonsterRelationships 妖群建边');
{
  const cfg = { ...relationshipConfig, goalsEnabled: true };
  const rs = new RelationshipSystem(cfg);
  // 取一个真实 family 的两个 grade 不同的物种？简化：用同一 def 造 3 只邻近 + 1 只远处。
  const wolfDef = monsterDefs.find(d => d.family) || monsterDefs[0];
  const fam = wolfDef.family;
  const mk = (id, x, y, grade) => new MonsterEntity(
    { ...wolfDef, grade: grade ?? wolfDef.grade },
    { id, name: id, x, y, wanderRadius: 12, rankOrderMap: {} },
  );
  const m1 = mk('mon_a', 10, 10, 3);
  const m2 = mk('mon_b', 12, 11, 2); // 距 m1 老巢 3 ≤ packRadius(12)
  const m3 = mk('mon_c', 14, 12, 4); // 最高 grade → 首领
  const m4 = mk('mon_far', 200, 200, 2); // 远处，不同群
  const res = initMonsterRelationships(rs, [m1, m2, m3, m4], cfg.monsterPack);
  assert(res.packEdges > 0, `同族邻近建 pack_member 边（${res.packEdges} 条）`);
  assert(!!rs.getEdge('mon_a', 'mon_b', 'pack_member'), 'mon_a↔mon_b 建 pack_member 边');
  assert(!!rs.getEdge('mon_b', 'mon_a', 'pack_member'), 'pack_member 边双向对称');
  assert(!rs.getEdge('mon_a', 'mon_far', 'pack_member'), '远处同族不建群边');
  if (cfg.monsterPack.buildPackLeader !== false) {
    assert(!!rs.getEdge('mon_a', 'mon_c', 'pack_leader') || !!rs.getEdge('mon_b', 'mon_c', 'pack_leader'),
      '群成员对最高 grade(mon_c) 建 pack_leader 臣服边');
  }
  // family 唯一性：同 family 才组群（构造同 def 已满足）
  assert(typeof fam === 'string' && fam.length > 0, `物种具有 family 字段(${fam})`);
}

// —— 3) MonsterSpawner 群居成簇生成 ——
console.log('3) MonsterSpawner 群居成簇生成');
{
  // 构造一张全平原小地图，单一 swarmBehavior 物种，验证成簇补刷。
  const W = 40, H = 40;
  const tileIndex = new Map();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) tileIndex.set(`${x},${y}`, { x, y, terrain: 'plain' });
  }
  const terrainIndex = new Map([['plain', { passable: true }]]);
  const swarmDef = {
    id: 'test_swarm', name: '群居测试兽', family: 'test_swarm_fam', type: 'beast',
    grade: 1, habitat: ['plain'], rarity: 'common', swarmBehavior: true,
    attributes: { speed: 1 }, drops: [],
  };
  const packCfg = { ...relationshipConfig.monsterPack, swarmClusterRadius: 5, swarmClusterSize: 4 };
  const spawnerOn = new MonsterSpawner({
    tileIndex, terrainIndex, monsterDefs: [swarmDef], factions: [],
    spawnConfig: { totalMonsters: 12, spawnSeed: 42, dangerByDistance: [{ maxDist: 9999, minGrade: 1, maxGrade: 9 }] },
    movementConfig: {}, rankOrderMap: {}, mapWidth: W, mapHeight: H,
    monsterPackConfig: packCfg,
  });
  const swarmMonsters = spawnerOn.spawn();
  assert(swarmMonsters.length > 0, `成簇生成产出妖兽（${swarmMonsters.length} 只）`);
  // 验证存在彼此邻近（≤ clusterRadius*2）的同种 → 成群
  let clustered = false;
  for (let i = 0; i < swarmMonsters.length && !clustered; i++) {
    for (let j = i + 1; j < swarmMonsters.length; j++) {
      const a = swarmMonsters[i].spatial, b = swarmMonsters[j].spatial;
      if (Math.abs(a.tileX - b.tileX) + Math.abs(a.tileY - b.tileY) <= packCfg.swarmClusterRadius * 2) {
        clustered = true; break;
      }
    }
  }
  assert(clustered, 'swarmBehavior 物种成簇（存在邻近同种）');

  // 对照：monsterPackConfig=null（一期）不强制成簇
  const spawnerOff = new MonsterSpawner({
    tileIndex, terrainIndex, monsterDefs: [swarmDef], factions: [],
    spawnConfig: { totalMonsters: 12, spawnSeed: 42, dangerByDistance: [{ maxDist: 9999, minGrade: 1, maxGrade: 9 }] },
    movementConfig: {}, rankOrderMap: {}, mapWidth: W, mapHeight: H,
    monsterPackConfig: null,
  });
  const offMonsters = spawnerOff.spawn();
  assert(offMonsters.length > 0, `关闭成簇时仍正常生成（${offMonsters.length} 只，零漂移）`);
}

// —— 4) territory_threat 建边 + 衰减 ——
console.log('4) territory_threat 建边 + 衰减');
{
  const cfg = { ...relationshipConfig, goalsEnabled: true };
  const rs = new RelationshipSystem(cfg);
  const edge = rs.applyEvent('territory_intrusion', 'mon_t', 'npc_intruder', { tick: 1 });
  assert(!!edge && edge.type === 'territory_threat', 'territory_intrusion 事件建 territory_threat 边');
  const s0 = edge.strength;
  rs.tick();
  const after = rs.getEdge('mon_t', 'npc_intruder', 'territory_threat');
  assert(after && after.strength < s0, `territory_threat 边每日衰减（${s0}->${after?.strength}, decay=2）`);
  // 多次衰减后归零清理（decayFloor=0）
  for (let i = 0; i < 30; i++) rs.tick();
  assert(!rs.getEdge('mon_t', 'npc_intruder', 'territory_threat'), '强度归零后 territory_threat 边被清理');
}

if (failed === 0) {
  console.log('\n关系驱动 Goal/妖群/领地 单元测试全部通过');
  process.exit(0);
} else {
  console.error(`\n关系驱动 Goal/妖群/领地 单元测试失败：${failed} 项`);
  process.exit(1);
}
