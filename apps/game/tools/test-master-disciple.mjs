#!/usr/bin/env node
/**
 * 师徒互动单元测试（ADR-029，关系网三期）。
 *
 * 覆盖六类行为 + 开关：
 *   1) goalsEnabled=false → collectExtraGoals 不产出师徒 Goal。
 *   2) 师傅传功（护徒·点化）：高强度 master 边 + 徒弟修为偏低且在范围 → 产出 goal_teach_disciple，锁定徒弟。
 *   3) 师傅护徒（驰援）：徒弟遭袭（hasRevengeTarget）→ 产出 goal_protect_disciple（优先级高于传功）。
 *   4) 徒弟尽孝（探望）：高强度 disciple 边 → 产出 goal_visit_master。
 *   5) 继承遗志：inheritMasterLegacy → 徒弟对凶手生复仇执念 + 继承师傅未竟非复仇执念（折扣强度）。
 *   6) 夺舍图谋：邪修(低 justice+低 loyalty)高境界师傅 + 高资质徒弟 → seizure 执念锁定徒弟；revengeTarget 据此解析。
 *   7) 传功 executor：给徒弟 insight 增量并加深 master 边。
 *
 * 用法：node tools/test-master-disciple.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RelationshipSystem } = await imp('js/engine/world/relationship-system.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');
const { GoalSource } = await imp('js/engine/abstract/goal.js');
const { Obsession, ObsessionType } = await imp('js/engine/abstract/obsession-system.js');
const { ActionPool } = await imp('js/engine/pools/action-pool.js');
const { registerNPCExecutors } = await imp('js/engine/npc/npc-actions.js');
const { ItemRegistry } = await imp('js/engine/items/item-registry.js');

const relationshipConfig = load('data/balance/relationship.json');
const ranks = load('data/definitions/ranks.json');
const cultivationConfig = load('data/balance/cultivation.json');
const gameConfig = load('data/config/game-config.json');
const memoryConfig = load('data/balance/memory.json');
const obsessionConfig = load('data/balance/obsession.json');

ItemRegistry.clear();
ItemRegistry.loadFromArray(load('data/definitions/macro-resources.json'));
ItemRegistry.loadFromArray(['currency','material','pill','artifact','talisman','technique'].flatMap(c => load(`data/items/${c}.json`).items));
registerNPCExecutors();

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

/**
 * 构造一个绑定到给定 RelationshipSystem 的 NPCEntity。
 * @param {Object} [opts] role/rankId/personality 等覆盖。
 */
function mkNpc(id, rs, relCfg, stateOverrides = {}, pos = { x: 0, y: 0 }, opts = {}) {
  const npc = new NPCEntity(
    {
      id, name: id, factionId: 'sect_001',
      role: opts.role || 'disciple',
      rankId: opts.rankId || 'foundation',
      alive: true,
      personality: opts.personality || {},
    },
    ranks,
    {
      gameConfig,
      cultivationConfig,
      memoryConfig,
      obsessionConfig,
      relationshipSystem: rs,
      relationshipConfig: relCfg,
    },
  );
  npc.initSpatial({ x: pos.x, y: pos.y, speed: 3 });
  for (const [k, v] of Object.entries(stateOverrides)) npc.state.set(k, v);
  return npc;
}

function mkRegistry(entities) {
  const byId = new Map(entities.map(e => [e.id, e]));
  return { getById: (id) => byId.get(id) || null };
}

/** 强制师徒概率为 1，便于确定性测试低频 Goal。 */
function withForcedChances(cfg) {
  const md = cfg.masterDiscipleGoals || {};
  return {
    ...cfg,
    goalsEnabled: true,
    masterDiscipleGoals: {
      ...md,
      teachDisciple: { ...(md.teachDisciple || {}), teachChancePerTick: 1 },
      visitMaster: { ...(md.visitMaster || {}), visitChancePerTick: 1 },
    },
  };
}

// 关闭报恩/同门低频干扰：把 repay/assist 概率与传功并存时，仅断言师徒 Goal 出现即可。

// —— 1) goalsEnabled=false → 不产出师徒 Goal ——
console.log('1) goalsEnabled 开关');
{
  const cfg = { ...relationshipConfig, goalsEnabled: false };
  const rs = new RelationshipSystem(cfg);
  const master = mkNpc('m_off', rs, cfg, {}, { x: 0, y: 0 }, { role: 'elder', rankId: 'core' });
  const disc = mkNpc('d_off', rs, cfg, { hasRevengeTarget: true }, { x: 3, y: 0 });
  rs.addEdge('m_off', 'd_off', 'master', { strengthDelta: 80 });
  const reg = mkRegistry([master, disc]);
  const goals = master.collectExtraGoals({ entityRegistry: reg });
  const rel = goals.filter(g => g.source === GoalSource.RELATIONSHIP
    && ['goal_teach_disciple', 'goal_protect_disciple', 'goal_visit_master'].includes(g.id));
  assert(rel.length === 0, 'goalsEnabled=false 时不产出师徒 Goal');
}

// —— 2) 师傅传功（点化）——
console.log('2) 师傅传功（护徒·点化）');
{
  const cfg = withForcedChances(relationshipConfig);
  const rs = new RelationshipSystem(cfg);
  const master = mkNpc('m1', rs, cfg, {}, { x: 0, y: 0 }, { role: 'elder', rankId: 'core' });
  // 徒弟修为偏低（cultivationProgress+insight < discipleMaxTotalProgress 0.6），在范围内
  const disc = mkNpc('d1', rs, cfg, { cultivationProgress: 0.2, insight: 0 }, { x: 5, y: 0 });
  rs.addEdge('m1', 'd1', 'master', { strengthDelta: 80 });
  const reg = mkRegistry([master, disc]);
  const goals = master.collectExtraGoals({ entityRegistry: reg });
  const teach = goals.find(g => g.id === 'goal_teach_disciple');
  assert(!!teach, '高强度 master 边 + 徒弟修为偏低 → 产出 goal_teach_disciple');
  assert(teach && teach.source === GoalSource.RELATIONSHIP, 'teach Goal source=relationship');
  assert(master.state.get('targetRelationshipId') === 'd1', 'teach Goal 锁定 targetRelationshipId=d1');
  assert(teach && teach.goalState.taughtDisciple?.value === true, 'teach Goal goalState 对齐 taughtDisciple=true');

  // 徒弟修为已足 → 不点化
  const cfg2 = withForcedChances(relationshipConfig);
  const rs2 = new RelationshipSystem(cfg2);
  const master2 = mkNpc('m1b', rs2, cfg2, {}, { x: 0, y: 0 }, { role: 'elder', rankId: 'core' });
  const disc2 = mkNpc('d1b', rs2, cfg2, { cultivationProgress: 0.9, insight: 0.2 }, { x: 5, y: 0 });
  rs2.addEdge('m1b', 'd1b', 'master', { strengthDelta: 80 });
  const goals2 = master2.collectExtraGoals({ entityRegistry: mkRegistry([master2, disc2]) });
  assert(!goals2.find(g => g.id === 'goal_teach_disciple'), '徒弟修为已足时不产出传功 Goal');
}

// —— 3) 师傅护徒（驰援）：优先级高于传功 ——
console.log('3) 师傅护徒（驰援）');
{
  const cfg = withForcedChances(relationshipConfig);
  const rs = new RelationshipSystem(cfg);
  const master = mkNpc('m2', rs, cfg, {}, { x: 0, y: 0 }, { role: 'elder', rankId: 'core' });
  // 徒弟既修为偏低（满足传功）又遭袭（满足护徒）→ 护徒优先级(8) > 传功(7)
  const disc = mkNpc('d2', rs, cfg, { cultivationProgress: 0.2, hasRevengeTarget: true }, { x: 5, y: 0 });
  rs.addEdge('m2', 'd2', 'master', { strengthDelta: 80 });
  const reg = mkRegistry([master, disc]);
  const goals = master.collectExtraGoals({ entityRegistry: reg });
  const protect = goals.find(g => g.id === 'goal_protect_disciple');
  assert(!!protect, '徒弟遭袭 → 产出 goal_protect_disciple');
  // collectExtraGoals 返回单个关系 Goal（单点锁定）：应为护徒而非传功（优先级更高）
  const relGoals = goals.filter(g => g.source === GoalSource.RELATIONSHIP);
  assert(relGoals.length === 1 && relGoals[0].id === 'goal_protect_disciple',
    '护徒优先级(8)高于传功(7)，单点锁定取护徒');
  assert(master.state.get('targetRelationshipId') === 'd2', '护徒锁定 targetRelationshipId=d2');
}

// —— 4) 徒弟尽孝（探望）——
console.log('4) 徒弟尽孝（探望恩师）');
{
  const cfg = withForcedChances(relationshipConfig);
  const rs = new RelationshipSystem(cfg);
  const disc = mkNpc('d3', rs, cfg, {}, { x: 0, y: 0 });
  const master = mkNpc('m3', rs, cfg, {}, { x: 5, y: 0 }, { role: 'elder', rankId: 'core' });
  // 徒弟视角：disciple 边指向师傅
  rs.addEdge('d3', 'm3', 'disciple', { strengthDelta: 80 });
  const reg = mkRegistry([disc, master]);
  const goals = disc.collectExtraGoals({ entityRegistry: reg });
  const visit = goals.find(g => g.id === 'goal_visit_master');
  assert(!!visit, '高强度 disciple 边 → 产出 goal_visit_master');
  assert(disc.state.get('targetRelationshipId') === 'm3', '探望恩师锁定 targetRelationshipId=m3');
  assert(visit && visit.goalState.visitedMaster?.value === true, 'visit_master goalState 对齐 visitedMaster=true');
}

// —— 5) 继承遗志：复仇 + 执念延续 ——
console.log('5) 继承遗志（复仇 + 执念延续）');
{
  const cfg = { ...relationshipConfig, goalsEnabled: true };
  const rs = new RelationshipSystem(cfg);
  const disc = mkNpc('d4', rs, cfg, {}, { x: 0, y: 0 });
  const master = mkNpc('m4', rs, cfg, {}, { x: 5, y: 0 }, { role: 'elder', rankId: 'core' });
  // 给师傅一个未竟的可继承执念（夺宝 plunder）+ 一个不可继承执念（resurrection）
  master.obsessions.add(new Obsession({ type: ObsessionType.PLUNDER, name: '夺宝证道', intensity: 80, goalState: { treasureObtained: { op: 'eq', value: true } } }));
  master.obsessions.add(new Obsession({ type: ObsessionType.RESURRECTION, name: '复活道侣', intensity: 90, goalState: {} }));
  // 用规范方向建边（master→disciple，自动建反向 disciple→master）。死亡钩子据 edgesOfType(master,'master') 找徒弟。
  rs.addEdge('m4', 'd4', 'master', { strengthDelta: 80 });
  const masterEdgeDisciples = rs.edgesOfType('m4', 'master').map(e => e.toId);
  assert(masterEdgeDisciples.includes('d4'), 'edgesOfType(master,"master") 找到徒弟（死亡钩子遍历路径）');

  // 模拟死亡钩子：对师傅的每个 master 边对应徒弟调用 inheritMasterLegacy（凶手 killer_x）。
  for (const e of rs.edgesOfType('m4', 'master')) {
    const d = mkRegistry([disc, master]).getById(e.toId);
    if (d) d.inheritMasterLegacy(master, { killerId: 'killer_x', killerFactionId: 'foe_sect', tick: 10 });
  }

  const revenge = disc.obsessions.obsessions.find(o => o.type === 'revenge');
  assert(!!revenge, '师傅陨落 → 徒弟生复仇执念');
  assert(revenge && revenge.targetId === 'killer_x', '复仇执念锁定凶手 killer_x');

  const inherited = disc.obsessions.obsessions.find(o => o.type === ObsessionType.PLUNDER);
  assert(!!inherited, '徒弟继承师傅未竟的夺宝执念（意志延续）');
  const mult = cfg.masterDiscipleGoals.inheritWill.inheritObsessionIntensityMult ?? 0.7;
  assert(inherited && inherited.intensity === Math.round(80 * mult),
    `继承执念强度按折扣(${mult})计算（80→${Math.round(80 * mult)}）`);
  assert(!disc.obsessions.obsessions.find(o => o.type === ObsessionType.RESURRECTION),
    '复活类执念不继承（各有专属触发）');
}

// —— 6) 夺舍图谋（轻度）——
console.log('6) 夺舍图谋（邪修师傅夺高资质徒弟）');
{
  const cfg = { ...relationshipConfig, goalsEnabled: true };
  const rs = new RelationshipSystem(cfg);
  // 邪修师傅：低 justice + 低 loyalty + 高境界（roleRank 经 role=elder 推导）
  const seizeCfg = { ...obsessionConfig, seizeDisciple: { ...obsessionConfig.seizeDisciple, chancePerTick: 1 } };
  const master = new NPCEntity(
    { id: 'evil_m', name: 'evil_m', factionId: 'sect_001', role: 'elder', rankId: 'core', alive: true,
      personality: { justice: 10, loyalty: 10 } },
    ranks,
    { gameConfig, cultivationConfig, memoryConfig, obsessionConfig: seizeCfg, relationshipSystem: rs, relationshipConfig: cfg },
  );
  master.initSpatial({ x: 0, y: 0, speed: 3 });
  // 高资质徒弟（总进度 ≥ minDiscipleTotalProgress 0.5）
  const disc = mkNpc('genius_d', rs, cfg, { cultivationProgress: 0.6, insight: 0.1 }, { x: 5, y: 0 });
  rs.addEdge('evil_m', 'genius_d', 'master', { strengthDelta: 70 });
  const reg = mkRegistry([master, disc]);

  master._checkSeizeDiscipleObsession({ entityRegistry: reg });
  const seize = master.obsessions.obsessions.find(o => o.type === 'seizure');
  assert(!!seize, '邪修师傅 + 高资质徒弟 → 起夺舍执念');
  assert(seize && seize.targetId === 'genius_d', '夺舍执念锁定高资质徒弟 genius_d');
  assert(seize && seize.goalState.enemyKilled?.value === true, '夺舍执念 goalState 复用击杀链(enemyKilled)');

  // 正派师傅（高 justice）→ 不起夺舍执念
  const goodMaster = new NPCEntity(
    { id: 'good_m', name: 'good_m', factionId: 'sect_001', role: 'elder', rankId: 'core', alive: true,
      personality: { justice: 90, loyalty: 90 } },
    ranks,
    { gameConfig, cultivationConfig, memoryConfig, obsessionConfig: seizeCfg, relationshipSystem: rs, relationshipConfig: cfg },
  );
  goodMaster.initSpatial({ x: 0, y: 0, speed: 3 });
  rs.addEdge('good_m', 'genius_d', 'master', { strengthDelta: 70 });
  goodMaster._checkSeizeDiscipleObsession({ entityRegistry: mkRegistry([goodMaster, disc]) });
  assert(!goodMaster.obsessions.obsessions.find(o => o.type === 'seizure'), '正派师傅不起夺舍执念');
}

// —— 7) 传功 executor：给徒弟 insight 增量 ——
console.log('7) 传功 executor 结算');
{
  const cfg = { ...relationshipConfig, goalsEnabled: true };
  const rs = new RelationshipSystem(cfg);
  const master = mkNpc('m5', rs, cfg, {}, { x: 0, y: 0 }, { role: 'elder', rankId: 'core' });
  const disc = mkNpc('d5', rs, cfg, { cultivationProgress: 0.2, insight: 0.0 }, { x: 1, y: 0 });
  rs.addEdge('m5', 'd5', 'master', { strengthDelta: 60 });
  master.state.set('targetRelationshipId', 'd5');
  const reg = mkRegistry([master, disc]);
  const exec = ActionPool.getExecutor('npc_teach_disciple');
  const insightBefore = disc.state.get('insight');
  const strBefore = rs.getEdge('m5', 'd5', 'master')?.strength ?? 0;
  const res = exec.run(master, { entityRegistry: reg, relationshipSystem: rs, relationshipConfig: cfg, currentDay: 1 }, {});
  assert(res.success === true, '传功 executor 成功结算');
  const expectGain = cfg.masterDiscipleGoals.teachDisciple.insightGain ?? 0.12;
  assert(Math.abs((disc.state.get('insight') - insightBefore) - expectGain) < 1e-9,
    `徒弟获得 insight 增量(${expectGain})`);
  assert((rs.getEdge('m5', 'd5', 'master')?.strength ?? 0) > strBefore, '传功加深 master 边强度');
  assert(master.state.get('taughtDisciple') === true, 'taughtDisciple 置真');
  assert(master.state.get('targetRelationshipId') === null, '结算后清空 targetRelationshipId');
}

if (failed === 0) {
  console.log('\n师徒互动单元测试全部通过');
  process.exit(0);
} else {
  console.error(`\n师徒互动单元测试失败：${failed} 项`);
  process.exit(1);
}
