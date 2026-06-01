#!/usr/bin/env node
/**
 * 关系网系统单元测试（ADR-027）。
 * 覆盖：
 *   1) 有向边建立 / 对称类型自动反向 / 重复建边强度累加（clamp 0~100）。
 *   2) applyEvent 按 relationship.json eventBindings 落边（含 strengthDelta）。
 *   3) 每日衰减 tick：strength 向 decayFloor 回落，归零边清理。
 *   4) removeEntity 清理出边+入边（妖兽死亡/重生回收）。
 *   5) snapshot / loadFrom 往返一致。
 *   6) 兼容层：RelationshipGraph 绑定模式与独立模式行为等价（topGrudge/getGrudge），
 *      绑定模式下 grudge/gratitude 落入统一关系网为 grudge/gratitude 边。
 *   7) initRelationships：据 factionId+role 推导 same_sect / master-disciple 边。
 *
 * 用法：node tools/test-relationship.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RelationshipSystem, RelationType } = await imp('js/engine/world/relationship-system.js');
const { RelationshipGraph } = await imp('js/engine/npc/relationship.js');
const { initRelationships } = await imp('js/engine/world/relationship-init.js');

const relCfg = load('data/balance/relationship.json');

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

// —— 1) 有向边 / 对称 / 强度累加 ——
console.log('1) 边建立 / 对称 / 强度累加');
{
  const rs = new RelationshipSystem(relCfg);

  // 师徒：master 配置 symmetricType=disciple，应自动建反向 disciple 边
  rs.addEdge('npc_master', 'npc_disciple', RelationType.MASTER);
  assert(!!rs.getEdge('npc_master', 'npc_disciple', 'master'), 'master 边建立');
  assert(!!rs.getEdge('npc_disciple', 'npc_master', 'disciple'), '自动反向 disciple 边');

  // 道侣对称
  rs.addEdge('a', 'b', RelationType.DAO_COMPANION);
  assert(!!rs.getEdge('b', 'a', 'dao_companion'), '道侣对称双向');

  // 重复建 grudge 边，strength 累加（grudge 默认 strength 50）
  rs.addEdge('x', 'y', RelationType.GRUDGE, { strengthDelta: 30 });
  rs.addEdge('x', 'y', RelationType.GRUDGE, { strengthDelta: 40 });
  const g = rs.getEdge('x', 'y', 'grudge');
  assert(g && g.strength === 70, `重复建边强度累加 (${g && g.strength})`);

  // clamp 上限 100
  rs.addEdge('x', 'y', RelationType.GRUDGE, { strengthDelta: 50 });
  assert(rs.getEdge('x', 'y', 'grudge').strength === 100, '强度 clamp 到 100');

  // 自指 / 空参数不建边
  rs.addEdge('self', 'self', RelationType.ALLY);
  assert(rs.edgesFrom('self').length === 0, '自指边被拒绝');
}

// —— 2) applyEvent 事件绑定 ——
console.log('2) applyEvent 事件绑定');
{
  const rs = new RelationshipSystem(relCfg);
  // faction_war_attacked → enemy 边，strengthDelta 15（叠加在默认 strength 60 上？否，首次建边用 default strength 或 delta）
  const e = rs.applyEvent('faction_war_attacked', 'loser', 'winner', { tick: 5 });
  assert(!!e && e.type === 'enemy', 'faction_war_attacked 落 enemy 边');
  assert(e.originEventType === 'faction_war_attacked', '边记录触发事件类型');
  assert(e.originTick === 5, '边记录建边世界日');

  // dao_companion_matched → 对称道侣边
  rs.applyEvent('dao_companion_matched', 'm', 'f');
  assert(!!rs.getEdge('f', 'm', 'dao_companion'), 'dao_companion_matched 双向');

  // 未知事件不落边
  const none = rs.applyEvent('not_a_real_event', 'p', 'q');
  assert(none === null, '未知事件返回 null');
}

// —— 3) 衰减 tick ——
console.log('3) 每日衰减');
{
  const rs = new RelationshipSystem(relCfg);
  // enemy: decay 0.5, decayFloor 0；建边初始 strength 60
  rs.addEdge('p', 'q', RelationType.ENEMY);
  const before = rs.getEdge('p', 'q', 'enemy').strength;
  rs.tick();
  const after = rs.getEdge('p', 'q', 'enemy').strength;
  assert(after === before - 0.5, `enemy 边每日衰减 0.5 (${before}->${after})`);

  // master: decay 0，不衰减
  rs.addEdge('m1', 'd1', RelationType.MASTER);
  const mBefore = rs.getEdge('m1', 'd1', 'master').strength;
  rs.tick();
  assert(rs.getEdge('m1', 'd1', 'master').strength === mBefore, 'master 边不衰减(decay=0)');

  // 归零清理：rival decay 1 floor 0，从低强度衰减到 0 后边被删除
  rs.addEdge('r1', 'r2', RelationType.RIVAL, { strengthDelta: 2 });
  rs.tick(); // 2 -> 1
  rs.tick(); // 1 -> 0 -> 删除
  assert(rs.getEdge('r1', 'r2', 'rival') === null, '强度归零的边被清理');
}

// —— 4) removeEntity ——
console.log('4) removeEntity 清理出入边');
{
  const rs = new RelationshipSystem(relCfg);
  rs.addEdge('beast_1', 'npc_a', RelationType.BEAST_GRUDGE); // 出边
  rs.addEdge('npc_b', 'beast_1', RelationType.SPIRIT_PET);   // 入边
  rs.removeEntity('beast_1');
  assert(rs.edgesFrom('beast_1').length === 0, '出边已清理');
  assert(rs.getEdge('npc_b', 'beast_1', 'spirit_pet') === null, '入边已清理');
}

// —— 5) snapshot / loadFrom ——
console.log('5) snapshot / loadFrom 往返');
{
  const rs = new RelationshipSystem(relCfg);
  rs.addEdge('a', 'b', RelationType.DAO_COMPANION);
  rs.addEdge('c', 'd', RelationType.GRUDGE, { strengthDelta: 42 });
  const snap = rs.snapshot();

  const rs2 = new RelationshipSystem(relCfg);
  rs2.loadFrom(snap);
  assert(rs2.allEdges().length === rs.allEdges().length, '边总数一致');
  assert(!!rs2.getEdge('a', 'b', 'dao_companion'), '道侣边恢复');
  assert(rs2.getEdge('c', 'd', 'grudge').strength === 42, 'grudge 边强度恢复');
}

// —— 6) 兼容层等价 ——
console.log('6) RelationshipGraph 兼容层');
{
  // 独立模式（无 system）
  const standalone = new RelationshipGraph();
  standalone.addGrudge('enemy_1', 30);
  standalone.addGrudge('enemy_1', 20);
  standalone.addGrudge('enemy_2', 10);
  assert(standalone.getGrudge('enemy_1') === 50, '独立模式 grudge 累加');
  assert(standalone.topGrudge().actorId === 'enemy_1', '独立模式 topGrudge 取最深仇人');

  // 绑定模式（接世界级系统）
  const rs = new RelationshipSystem(relCfg);
  const bound = new RelationshipGraph({ system: rs, ownerId: 'npc_hero' });
  bound.addGrudge('enemy_1', 30);
  bound.addGrudge('enemy_1', 20);
  bound.addGrudge('enemy_2', 10);
  bound.addGratitude('savior', 70);
  assert(bound.getGrudge('enemy_1') === 50, '绑定模式 grudge 累加（与独立模式等价）');
  assert(bound.topGrudge().actorId === 'enemy_1', '绑定模式 topGrudge 等价');
  assert(bound.getGratitude('savior') === 70, '绑定模式 gratitude 等价');
  // 落入统一关系网为 grudge/gratitude 边
  assert(!!rs.getEdge('npc_hero', 'enemy_1', 'grudge'), '绑定模式 grudge 进入统一关系网');
  assert(!!rs.getEdge('npc_hero', 'savior', 'gratitude'), '绑定模式 gratitude 进入统一关系网');
  assert(rs.getEdge('npc_hero', 'enemy_1', 'grudge').strength === 50, '关系网 grudge 边强度等于累加值');
}

// —— 7) initRelationships ——
console.log('7) initRelationships 同门/师徒推导');
{
  // 构造轻量 NPC（模拟 npc-entity 的 state/staticData 取值接口）
  const mkNpc = (id, factionId, role, rankId = 'qi_refining') => ({
    id, alive: true,
    state: { _d: { factionId, currentRole: role, rankId }, get(k) { return this._d[k]; } },
    staticData: { _d: { initialRole: role }, get(k) { return this._d[k]; } },
  });
  const npcs = [
    mkNpc('leaderA', 'sect_1', 'leader', 'nascent_soul'),
    mkNpc('elderA', 'sect_1', 'elder', 'golden_core'),
    mkNpc('d1', 'sect_1', 'disciple'),
    mkNpc('d2', 'sect_1', 'disciple'),
    mkNpc('d3', 'sect_1', 'outer_disciple'),
    mkNpc('lone', null, 'wanderer'), // 散修不建边
  ];
  const rankOrderMap = { nascent_soul: 4, golden_core: 3, qi_refining: 1, mortal: 0 };
  const rs = new RelationshipSystem(relCfg);
  const stats = initRelationships(rs, npcs, relCfg, rankOrderMap);

  assert(stats.sameSectEdges > 0, `生成同门边 (${stats.sameSectEdges})`);
  assert(stats.masterDiscipleEdges > 0, `生成师徒边 (${stats.masterDiscipleEdges})`);
  // sect_1 内 5 人两两同门 = C(5,2)=10
  assert(stats.sameSectEdges === 10, '同门边数 = C(5,2)=10');
  // 同门对称：d1↔d2 双向
  assert(!!rs.getEdge('d1', 'd2', 'same_sect') && !!rs.getEdge('d2', 'd1', 'same_sect'), '同门边双向');
  // 师徒：leader/elder 为师，disciple/outer_disciple 为徒
  const masterEdges = rs.allEdges().filter(e => e.type === 'master');
  assert(masterEdges.length === 3, '3 名弟子各被收徒（master 边 3 条）');
  // 散修 lone 无任何边
  assert(rs.edgesFrom('lone').length === 0, '散修不建同门/师徒边');
}

if (failed === 0) { console.log('\n关系网系统单元测试全部通过'); process.exit(0); }
else { console.error(`\n关系网系统单元测试失败：${failed} 项`); process.exit(1); }
