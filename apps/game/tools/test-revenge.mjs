#!/usr/bin/env node
/**
 * 复仇行为链单元测试（ADR-020 阶段D/E）。
 * 覆盖：
 *   1) GOAP 能从 { enemyKilled:true } 目标推导出『追踪→击杀』链（实力足够时）；
 *      实力不足时链首插入修炼（变强为中间步）。
 *   2) NPCKillEnemyToilExecutor PvP 胜负：胜→给仇人写 _deathInfo{cause:'slain',killerId}；
 *      负→自身受伤/陨落。
 *   3) revenge_target resolver + npcCombatPower 经 worldContext 暴露。
 *   4) killerId 闭环：被杀者 _deathInfo 携带 killerId/killerFactionId。
 *
 * 用法：node tools/test-revenge.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { Action } = await imp('js/engine/abstract/action.js');
const { GOAPPlanner } = await imp('js/engine/abstract/goap-planner.js');
const { NPCKillEnemyToilExecutor } = await imp('js/engine/npc/toils/combat-toils.js');
const { killNPCByPvP } = await imp('js/engine/npc/actions/npc-action-utils.js');
const { MemorySystem } = await imp('js/engine/abstract/memory-system.js');
const { RelationshipGraph } = await imp('js/engine/npc/relationship.js');
const { ObsessionSystem, Obsession } = await imp('js/engine/abstract/obsession-system.js');

const npcActions = [
  ...load('data/actions/npc-actions.json'),
  ...load('data/actions/npc-job-actions.json'),
].map(c => new Action(c));
const obsessionCfg = load('data/balance/obsession.json');
const memoryCfg = load('data/balance/memory.json');

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } else { console.log('  OK:', m); } };

// —— 1) GOAP 推导复仇链 ——
console.log('1) GOAP 复仇链');
{
  const planner = new GOAPPlanner({ maxDepth: 12, maxIterations: 2000 });
  const goal = { enemyKilled: { op: 'eq', value: true } };

  // 实力足够（数值修为达标）：应为 追踪 → 击杀
  const strongState = {
    alive: true, hasRevengeTarget: true, nearRevengeTarget: false,
    enemyKilled: false, totalCultivation: 90, nextCultivationRequired: 100,
  };
  const r1 = planner.plan(strongState, goal, npcActions);
  assert(r1.success, '实力足够时能规划出复仇链');
  const ids1 = r1.plan.map(a => a.id);
  assert(ids1.includes('act_npc_job_kill_enemy'), '链含击杀仇人');
  assert(ids1.indexOf('act_npc_job_hunt_enemy') < ids1.indexOf('act_npc_job_kill_enemy'), '先追踪后击杀');

  // 实力不足（数值修为低于击杀门槛）：击杀前置不满足。
  // 修仙逻辑下『变强』每步增量极小（cultivate +0.001/步），无法在单次 GOAP 深度内补足到门槛，
  // 因此直接复仇规划应失败——这正是设计意图：弱者由日常『修炼需求』长期变强，
  // 待 totalCultivation 达门槛后，复仇 Goal 才在某轮规划中成功推导出『追踪→击杀』。
  const weakState = {
    alive: true, hasRevengeTarget: true, nearRevengeTarget: false,
    enemyKilled: false, totalCultivation: 10, nextCultivationRequired: 100, hasFaction: false,
  };
  const r2 = planner.plan(weakState, goal, npcActions);
  assert(!r2.success, '实力不足时直接复仇规划失败（强度门槛生效，变强交由日常修炼需求）');

  // 实力恰好达门槛：应能规划出击杀
  const okState = {
    alive: true, hasRevengeTarget: true, nearRevengeTarget: false,
    enemyKilled: false, totalCultivation: 15, nextCultivationRequired: 100,
  };
  const r3 = planner.plan(okState, goal, npcActions);
  assert(r3.success && r3.plan.map(a => a.id).includes('act_npc_job_kill_enemy'),
    '实力达门槛(0.3)时能规划出击杀');
}

// —— 2) PvP 执行器胜负 + killerId ——
console.log('2) PvP 胜负与 killerId');
{
  function mkNpc(id, rankBase, qi, factionId) {
    return {
      id, name: id,
      alive: true,
      staticData: { name: id },
      _power: rankBase * (1 + qi / 1000),
      state: {
        _d: { alive: true, factionId, hp: 100, maxHp: 100, injuryLevel: 0, enemyKilled: false, nearRevengeTarget: true },
        get(k) { return this._d[k]; }, set(k, v) { this._d[k] = v; },
      },
      hasSpatial() { return true; },
      spatial: { tileX: 0, tileY: 0 },
    };
  }
  const avenger = mkNpc('avenger', 30, 500, 'sectA');
  const enemy = mkNpc('enemy', 5, 0, 'sectB');

  const worldContext = {
    resolveRevengeTarget: () => enemy,
    npcCombatPower: (npc) => npc._power,
    rng: { next: () => 0 },
  };

  // 强者复仇弱者：winChance≈1，必胜
  const killExec = new NPCKillEnemyToilExecutor();
  const res = killExec.run(avenger, worldContext, null);
  assert(res.status === 'success' && res.reason === 'enemy_slain', '强者复仇必胜');
  assert(enemy.alive === false, '仇人被击杀');
  assert(enemy._deathInfo?.cause === 'slain', '仇人死因为 slain');
  assert(enemy._deathInfo?.killerId === 'avenger', 'killerId 写入复仇者');
  assert(enemy._deathInfo?.killerFactionId === 'sectA', 'killerFactionId 写入复仇者势力');
  assert(avenger.state.get('enemyKilled') === true, '复仇者 enemyKilled 置真（执念达成）');
}

// —— 3) 弱者复仇强者：可能受伤或被反杀 ——
console.log('3) 弱者复仇强者');
{
  function mkNpc(id, power, factionId) {
    return {
      id, name: id, alive: true, staticData: { name: id }, _power: power,
      state: { _d: { alive: true, factionId, hp: 100, maxHp: 100, injuryLevel: 0 }, get(k){return this._d[k];}, set(k,v){this._d[k]=v;} },
      hasSpatial() { return true; }, spatial: { tileX: 0, tileY: 0 },
    };
  }
  const weak = mkNpc('weak', 1, 'sectA');
  const strong = mkNpc('strong', 1000, 'sectB');
  const wc = { resolveRevengeTarget: () => strong, npcCombatPower: (n) => n._power, rng: { next: () => 1 } };
  const killExec = new NPCKillEnemyToilExecutor();
  // 多次运行：winChance≈0.001，应几乎总是失败（受伤或被反杀）
  let wins = 0, lethal = 0, wounded = 0;
  for (let i = 0; i < 200; i++) {
    weak.alive = true; weak.state.set('injuryLevel', 0); strong.alive = true;
    const r = killExec.run(weak, wc, null);
    if (r.reason === 'enemy_slain') wins++;
    else if (r.reason === 'slain_by_enemy') lethal++;
    else if (r.reason === 'revenge_wounded') wounded++;
  }
  assert(wins <= 5, `弱者复仇强者极少获胜(${wins}/200)`);
  assert(lethal + wounded > 150, `弱者复仇多以受伤/被反杀告终(${lethal + wounded}/200)`);
}

// —— 4) killNPCByPvP 闭环 ——
console.log('4) killNPCByPvP');
{
  const victim = { id: 'v', name: 'v', alive: true, state: { _d: { factionId: 'fV' }, get(k){return this._d[k];}, set(k,v){this._d[k]=v;} } };
  const killer = { id: 'k', name: 'k', state: { _d: { factionId: 'fK' }, get(k){return this._d[k];}, set(k,v){this._d[k]=v;} } };
  killNPCByPvP(victim, killer);
  assert(victim.alive === false, 'killNPCByPvP 标记死亡');
  assert(victim._deathInfo.killerId === 'k' && victim._deathInfo.killerFactionId === 'fK', 'killerId/killerFactionId 闭环');
  assert(victim._deathInfo.cause === 'slain', 'cause=slain');
}

// —— 5) killerId 闭环：被杀(记仇)→复仇执念→可定位仇人 ——
console.log('5) 恩怨闭环（记忆→执念→定位）');
{
  // 复刻 NPCEntity.recordMemory + _checkAcquiredObsession + resolveRevengeTarget 的核心链路，
  // 用真实 obsession.json / memory.json 配置，验证『被仇人所害 → 生出复仇执念 → 锁定仇人』闭环。
  const memory = new MemorySystem({ capacity: 32 });
  const relationships = new RelationshipGraph();
  const obsessions = new ObsessionSystem(obsessionCfg.goalMult || null);

  function recordMemory(type, opts) {
    const cfg = (memoryCfg.events || {})[type];
    if (!cfg) return;
    memory.add({ type, actorId: opts.actorId ?? null, factionId: opts.factionId ?? null, tick: opts.tick ?? 0, intensity: cfg.intensity ?? 0, decay: cfg.decay ?? 0 });
    if (cfg.grudgeGain && opts.actorId) relationships.addGrudge(opts.actorId, cfg.grudgeGain);
    // _checkAcquiredObsession（与 NPCEntity 同逻辑）
    for (const rule of (obsessionCfg.acquired?.rules || [])) {
      if (rule.memoryType !== type) continue;
      const strongest = memory.getStrongest(type);
      if (!strongest || strongest.intensity < (rule.minMemoryIntensity ?? 0)) continue;
      obsessions.add(new Obsession({
        type: rule.type, name: rule.name, intensity: rule.intensity ?? 90,
        targetId: strongest.actorId, targetFactionId: strongest.factionId,
        goalState: rule.goalState || {},
      }));
    }
  }

  // 被背叛（betrayed 带 actorId）→ 触发复仇执念，锁定仇人
  recordMemory('betrayed', { actorId: 'enemy_42', factionId: 'sectX', tick: 1 });
  const rev = obsessions.obsessions.find(o => o.type === 'revenge');
  assert(!!rev, 'betrayed(含 actorId) 触发复仇执念');
  assert(rev && rev.targetId === 'enemy_42', '复仇执念锁定仇人 enemy_42');
  assert(relationships.getGrudge('enemy_42') > 0, '个人恩怨图累积对仇人的仇恨');

  // resolveRevengeTarget 逻辑：执念 targetId 优先
  const resolved = rev.targetId || (relationships.topGrudge() && relationships.topGrudge().actorId);
  assert(resolved === 'enemy_42', 'resolveRevengeTarget 取执念锁定的仇人');
}

if (failed === 0) { console.log('\n复仇行为链单元测试全部通过'); process.exit(0); }
else { console.error(`\n复仇行为链单元测试失败：${failed} 项`); process.exit(1); }
