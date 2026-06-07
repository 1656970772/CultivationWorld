/**
 * combat-pipeline - 统一伤害管线（ADR-042）
 *
 * applyDamage 是「造成伤害并可能致死」的【唯一入口】，取代此前散落在三处的独立实现：
 *   - monster-entity._attack（妖兽攻击）
 *   - npc-action-utils.applyRiskEffect 的 hp_damage（野外/厮杀风险）
 *   - npc-action-utils.killNPCByPvP（仇杀/劫掠/夺权 PvP 致死）
 *
 * 固定流程（见 docs/systems/gameplay-ability-system.md §6）：
 *   1. 计算伤害量 → 扣 hp
 *   2. hp>0：受伤存活（State.Injured）
 *   3. hp<=0（致死）：
 *      a. 碾压判定（orderGap≥crushOrderGap 或 dmg≥maxHp×crushHpMultiple）→ 授予 Immune.Crush
 *      b. 授予 Trigger.LethalDamage → AbilityComponent 尝试激活被动能力：
 *         - ga_lock_hp（未被 Immune.Crush 阻挡）→ ge_lock_hp(spec.lockRatio) → hp 锁到 lockRatio×maxHp + State.Dying
 *         - ga_escape_talisman（持 State.Dying 且有符）→ escape_teleport 瞬移逃脱
 *      c. 锁血生效 → 不死；否则真实死亡，写 _deathInfo
 *   4. 清除瞬时 Tag（Trigger.LethalDamage / Immune.Crush）
 *
 * 锁血/遁地从此【不区分攻击者】（妖兽/PvP/风险通用），补齐 ADR-041 阶段2B 的 PvP 前置缺口。
 * 确定性：随机走 worldContext.rng / 实体 _rng（ADR-038）。
 */
import { AbilityExecutorRegistry } from '../abstract/gameplay-ability.js';
import { isPassable, nearestPassable } from '../world/pathfinding.js';
import { StimulusType } from '../abstract/stimulus.js';

/**
 * 可选统计钩子（ADR-042 验证用，纯观察）。验证工具可注入 { onResult(cause, result) }，
 * 生产环境为 null 零开销。绝不影响伤害结算逻辑（不属于游戏机制）。
 */
let _statsHook = null;
export function setCombatStatsHook(hook) { _statsHook = hook || null; }

/** 锁血 Effect 把 hp 锁到的比例由 combat.json lockHp.lockRatio 统一控制（单一真相源）。 */
function getLockRatio(worldContext) {
  return worldContext?.balanceConfig?.combat?.lockHp?.lockRatio ?? 0.05;
}

/** GAS 机制层总开关（combat.json gas.enabled，默认 true）。关闭则锁血/遁地不生效。 */
function gasEnabled(worldContext) {
  return worldContext?.balanceConfig?.combat?.gas?.enabled !== false;
}

/**
 * 反应层总开关（reaction.json enabled，默认 false 不改变现有行为，ADR-048）。
 * 开启后被攻击会向受害者压入 attacked 刺激，触发其反应层决策（躲避/疗伤/逃跑/反击）。
 */
function reactionEnabled(worldContext) {
  return worldContext?.balanceConfig?.reaction?.enabled === true;
}

/**
 * 被攻击未死时向受害者压入 attacked 刺激（ADR-048 反应层入口）。
 * 纯同步、无随机，确定性可复现。受害者在自身 tick 反应层最先消费此刺激。
 * @param {Object} target 受害者实体
 * @param {Object} spec damageSpec（含 killer/orderGap）
 * @param {number} damage 实际伤害量
 * @param {Object} worldContext
 */
function pushAttackedStimulus(target, spec, damage, worldContext) {
  if (!reactionEnabled(worldContext)) return;
  if (typeof target?.pushStimulus !== 'function') return;
  const killer = spec.killer || null;
  target.pushStimulus(StimulusType.ATTACKED, {
    sourceId: killer ? killer.id : (spec.killerId ?? null),
    day: worldContext?.currentDay ?? worldContext?.day ?? 0,
    payload: {
      killerId: killer ? killer.id : (spec.killerId ?? null),
      damage: Math.round(damage),
      orderGap: spec.orderGap ?? 0,
      cause: spec.cause || 'unknown',
    },
  });
}

/**
 * 统一伤害入口。
 * @param {Object} target 被伤害实体（须有 state/abilityComponent；NPC/妖兽通用）
 * @param {Object} damageSpec {
 *   amount,                直接伤害量（优先）
 *   cause,                 死因（'monster'/'slain'/'explore'...）
 *   killer,                凶手实体（可空，PvP 时填）
 *   killerName, monsterName, monsterGrade,  附加叙事字段
 *   orderGap,              来袭者与目标 order 差（碾压判定）
 *   crushOrderGap, crushHpMultiple,  碾压阈值（缺省读 combat.json）
 *   allowLock,             是否允许锁血（默认 true；抽象秘境致死可设 false）
 *   extraDeathInfo,        额外并入 _deathInfo 的字段
 * }
 * @param {Object} worldContext
 * @returns {{ damage:number, newHp:number, lethal:boolean, locked:boolean, escaped:boolean, died:boolean }}
 */
export function applyDamage(target, damageSpec, worldContext) {
  const spec = damageSpec || {};
  const state = target?.state;
  if (!state) return { damage: 0, newHp: 0, lethal: false, locked: false, escaped: false, died: false };

  const maxHp = state.get('maxHp') || 0;
  const curHp = state.get('hp') ?? maxHp;
  const damage = Math.max(0, spec.amount ?? 0);
  const newHp = curHp - damage;

  // 受伤存活。
  if (newHp > 0 || maxHp <= 0) {
    if (maxHp > 0) state.set('hp', newHp);
    state.set('injuryLevel', (state.get('injuryLevel') || 0) + 1);
    const comp = target.abilityComponent;
    if (comp) comp.tags.add('State.Injured');
    // 反应层：被攻击未死 → 压入 attacked 刺激，受害者下次 tick 反应层据此决策（ADR-048）。
    pushAttackedStimulus(target, spec, damage, worldContext);
    return { damage: Math.round(damage), newHp: Math.max(0, newHp), lethal: false, locked: false, escaped: false, died: false };
  }

  // === 致死分支 ===
  const combatCfg = worldContext?.balanceConfig?.combat || {};
  const lockCfg = combatCfg.lockHp || {};
  const crushOrderGap = spec.crushOrderGap ?? lockCfg.crushOrderGap ?? 25;
  const crushHpMultiple = spec.crushHpMultiple ?? lockCfg.crushHpMultiple ?? 3.0;
  const orderGap = spec.orderGap ?? 0;
  const isCrush = orderGap >= crushOrderGap || (maxHp > 0 && damage >= maxHp * crushHpMultiple);

  const comp = target.abilityComponent;
  const allowLock = spec.allowLock !== false && gasEnabled(worldContext) && !!comp;

  let locked = false;
  let escaped = false;

  if (allowLock) {
    // 碾压：本次致死无法被锁血。
    if (isCrush) comp.tags.add('Immune.Crush');

    // 触发被动锁血能力；HP 覆写只能由 ga_lock_hp → ge_lock_hp → EffectEngine 完成。
    comp.tags.add('Trigger.LethalDamage');
    try {
      const lockResults = comp.tryActivateByTag('Trigger.LethalDamage', worldContext, {
        source: spec.killer || null,
        cause: spec.cause,
        effectSpecs: {
          ge_lock_hp: { magnitude: getLockRatio(worldContext) },
        },
      });
      locked = lockResults.some(r =>
        r.activated && r.result?.effects?.some(e => e.effectId === 'ge_lock_hp' && e.applied),
      ) && (state.get('hp') ?? 0) > 0;

      if (locked) {
        state.set('injuryLevel', (state.get('injuryLevel') || 0) + 1);

        // 锁血成功 → 持 State.Dying → 尝试遁地瞬移逃脱。
        const escResults = comp.tryActivateByTag('State.Dying', worldContext, {
          killer: spec.killer || null,
        });
        escaped = escResults.some(r => r.activated);
      }
    } finally {
      // 清除瞬时 Tag。
      comp.tags.remove('Trigger.LethalDamage');
      if (isCrush) comp.tags.remove('Immune.Crush');
    }
  }

  if (locked) {
    // 反应层：靠锁血保命存活（重伤濒死）→ 压入 attacked 刺激（ADR-048）。
    // 未遁走的情况下，受害者下次 tick 反应层会因濒死血量倾向逃跑/疗伤。
    if (!escaped) pushAttackedStimulus(target, spec, damage, worldContext);
    const res = { damage: Math.round(damage), newHp: state.get('hp'), lethal: true, locked: true, escaped, died: false };
    if (_statsHook) _statsHook(spec.cause || 'unknown', res);
    return res;
  }

  // 真实死亡。
  state.set('hp', 0);
  state.set('alive', false);
  target.alive = false;
  if (target.spatial?.clearDestination) target.spatial.clearDestination();

  const killer = spec.killer || null;
  target._deathInfo = {
    cause: spec.cause || 'unknown',
    npcId: target.id,
    npcName: target.name,
    factionId: state.get('factionId'),
    ageYears: state.get('ageYears'),
    maxAgeYears: state.get('maxAgeYears'),
    rankName: state.get('rankName'),
    killerId: killer ? killer.id : (spec.killerId ?? null),
    killerName: killer ? killer.name : (spec.killerName ?? null),
    killerFactionId: killer ? (killer.state?.get('factionId') ?? null) : (spec.killerFactionId ?? null),
    ...(spec.extraDeathInfo || {}),
  };

  const res = { damage: Math.round(damage), newHp: 0, lethal: true, locked: false, escaped: false, died: true };
  if (_statsHook) _statsHook(spec.cause || 'unknown', res);
  return res;
}

/**
 * 注册遁地符瞬移执行器（ga_escape_talisman 的 executor）。
 * 「遁入安全处脱险」：优先瞬移到【本势力总部附近的安全区】（safeRadius 内、低阶妖兽带），
 * 而非全图随机落点——避免残血遁走后立刻撞上远高于自身的妖兽被二次碾压（修正前的缺陷：
 * 全图随机会把低阶修士扔到危险区致死，使保命符反而害命）。取不到势力总部时兜底全图随机。
 * 同时清除自身被锁定状态（清濒死 Tag 由调用方/疗伤决定，这里仅脱离战斗）。
 * 随机走实体 _rng / worldContext.rng（ADR-038），确定性可复现。
 */
AbilityExecutorRegistry.register('escape_teleport', (entity, ability, worldContext) => {
  const sp = entity.spatial;
  if (!sp) return { teleported: false };

  const spawner = worldContext?.monsterSpawner || null;
  const w = spawner?.mapWidth || worldContext?.mapWidth || 300;
  const h = spawner?.mapHeight || worldContext?.mapHeight || 300;
  const safeRadius = spawner?.cfg?.safeRadius ?? 25;
  const tileIndex = worldContext?.tileIndex || null;
  const terrainIndex = worldContext?.terrainIndex || null;
  const rng = entity._rng || worldContext?.rng;
  const rand = rng ? () => rng.next() : Math.random;

  const passableAt = (x, y) => {
    if (!tileIndex) return true; // 无地形索引时不做可通行校验
    return isPassable(tileIndex.get(`${x},${y}`), terrainIndex);
  };

  // 目标安全锚点：本势力总部（无则兜底地图中心）。
  let anchor = null;
  const factionId = entity.state?.get('factionId');
  if (factionId && worldContext?.entityRegistry?.getById) {
    const hq = worldContext.entityRegistry.getById(factionId)?.staticData?.headquarters;
    if (hq && typeof hq.x === 'number') anchor = { x: hq.x, y: hq.y };
  }

  let nx;
  let ny;
  let toSafe = false;
  if (anchor) {
    // 在总部周围 safeRadius 内随机选一个可通行格（遁入安全带）。
    let picked = null;
    for (let i = 0; i < 24; i++) {
      const ox = Math.round((rand() * 2 - 1) * safeRadius);
      const oy = Math.round((rand() * 2 - 1) * safeRadius);
      const cx = Math.max(0, Math.min(w - 1, anchor.x + ox));
      const cy = Math.max(0, Math.min(h - 1, anchor.y + oy));
      if (passableAt(cx, cy)) { picked = { x: cx, y: cy }; break; }
    }
    if (!picked) {
      const fixed = tileIndex ? nearestPassable(anchor.x, anchor.y, tileIndex, terrainIndex) : null;
      picked = fixed || { x: anchor.x, y: anchor.y };
    }
    nx = picked.x; ny = picked.y; toSafe = true;
  } else {
    // 兜底：无所属势力总部时退回全图随机（用正确地图尺寸）。
    nx = Math.max(0, Math.min(w - 1, Math.floor(rand() * w)));
    ny = Math.max(0, Math.min(h - 1, Math.floor(rand() * h)));
  }
  sp.x = nx;
  sp.y = ny;
  sp.clearDestination();

  // 脱离锁定：清除自身追踪态，妖兽/仇人的锁定在其各自 tick 重新感知时自然失效。
  entity.state.set('hasRevengeTarget', false);
  entity.state.set('nearRevengeTarget', false);

  if (worldContext?.infoEvents) {
    worldContext.infoEvents.push({
      type: 'escape_talisman',
      day: worldContext.currentDay,
      npcId: entity.id,
      npcName: entity.name,
      x: nx, y: ny,
      toSafe,
      description: toSafe
        ? `${entity.name} 危急关头祭出遁地符，遁回宗门附近安全处脱险`
        : `${entity.name} 危急关头祭出遁地符，遁入地底脱险`,
    });
  }
  return { teleported: true, x: nx, y: ny, toSafe };
});
