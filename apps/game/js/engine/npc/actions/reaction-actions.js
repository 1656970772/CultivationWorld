/**
 * reaction-actions —— 反应层行为执行器（四层 AI 架构 Reaction 层，ADR-048）。
 *
 * 这些行为由 ReactiveNode 在「被攻击」刺激命中后抢占执行，体现修士遭袭时的本能反应：
 *   - NPCReactFleeExecutor（act_npc_react_flee）：重伤/濒死时逃命——脱离战斗、奔向安全锚点（本势力总部附近），并清除追踪态。
 *   - NPCReactRetreatExecutor（act_npc_react_retreat）：血量尚可但打不过时主动撤往安全处（不如逃命急迫）。
 *   - NPCReactHealExecutor（act_npc_react_heal）：血量偏低时优先服丹/疗伤回血（消耗回血丹，无丹则静养减伤）。
 *   - NPCReactCounterExecutor（act_npc_react_counter）：判断敌弱（order 差达阈值）时就地反击，走统一伤害管线 applyDamage。
 *
 * 设计：执行器只负责「做这件事」，要不要做、做哪件由 ReactiveNode 的反应决策树判定（单一职责）。
 * 全程随机走实体 _rng / worldContext.rng（确定性，ADR-038）。逃命/撤退靠 requiresTravel 到达安全锚点。
 */
import { ActionExecutor } from '../../abstract/action.js';
import { applyDamage } from '../../combat/combat-pipeline.js';
import { applyItemEffects } from '../npc-economy.js';

/** 读取反应层配置（balance/reaction.json），缺省回退默认。 */
function getReactionConfig(worldContext) {
  return worldContext?.balanceConfig?.reaction || {};
}

/** 解析本势力总部附近的安全锚点坐标；无则回退当前位置。供逃命/撤退落点用（复用遁地符锚点思路）。 */
function resolveSafeAnchor(entity, worldContext) {
  const sp = entity.spatial;
  if (!sp) return null;
  const factionId = entity.state?.get('factionId');
  if (factionId && worldContext?.entityRegistry?.getById) {
    const hq = worldContext.entityRegistry.getById(factionId)?.staticData?.headquarters;
    if (hq && typeof hq.x === 'number') return { x: hq.x, y: hq.y };
  }
  return { x: sp.tileX, y: sp.tileY };
}

/**
 * 逃命：脱离战斗，奔向安全锚点并清除被追踪态（ADR-048）。
 * 实际位移由行为生命周期 requiresTravel（safe_retreat resolver）完成，本执行器在抵达后清理战斗态。
 */
export class NPCReactFleeExecutor extends ActionExecutor {
  run(entity, worldContext, _action) {
    // 清除追踪态：仇人/妖兽在各自 tick 重新感知时自然失去锁定（与遁地符脱离逻辑一致）。
    entity.state.set('nearRevengeTarget', false);
    if (worldContext?.infoEvents) {
      worldContext.infoEvents.push({
        type: 'react_flee',
        day: worldContext.currentDay ?? worldContext.day ?? 0,
        npcId: entity.id,
        npcName: entity.name,
        x: entity.spatial?.tileX ?? null,
        y: entity.spatial?.tileY ?? null,
        description: `${entity.staticData?.name || entity.id} 遭袭重伤，仓皇逃离战场奔向安全处`,
      });
    }
    return { success: true, outcome: 'fled', description: `${entity.staticData?.name || entity.id} 脱离战斗逃向安全处` };
  }
}

/**
 * 撤退：血量尚可但自忖不敌，主动撤往安全处（ADR-048）。比逃命从容（duration 略短，描述不同）。
 */
export class NPCReactRetreatExecutor extends ActionExecutor {
  run(entity, worldContext, _action) {
    entity.state.set('nearRevengeTarget', false);
    if (worldContext?.infoEvents) {
      worldContext.infoEvents.push({
        type: 'react_retreat',
        day: worldContext.currentDay ?? worldContext.day ?? 0,
        npcId: entity.id,
        npcName: entity.name,
        description: `${entity.staticData?.name || entity.id} 遇袭后审时度势，暂避锋芒退往安全处`,
      });
    }
    return { success: true, outcome: 'retreated', description: `${entity.staticData?.name || entity.id} 退往安全处` };
  }
}

/**
 * 回血：血量偏低时优先服用回血丹回血（按 reaction.json healPillId / healAmount），
 * 无丹则静养减伤（与普通疗伤一致，降 injuryLevel）。回血走 hp，夹 maxHp（ADR-041）。
 */
export class NPCReactHealExecutor extends ActionExecutor {
  run(entity, worldContext, _action) {
    const cfg = getReactionConfig(worldContext);
    const healPillId = cfg.healPillId || null;
    const maxHp = entity.state.get('maxHp') || 0;
    const curHp = entity.state.get('hp') ?? maxHp;

    let pillUsed = false;
    let healed = 0;
    if (healPillId && entity.inventory && entity.inventory.getAmount(healPillId) > 0) {
      // 优先经统一物品效果入口结算回血丹（ADR-043：服用物品即生效，npc-economy.applyItemEffects）。
      const before = entity.state.get('hp') ?? maxHp;
      applyItemEffects(entity, healPillId);
      entity.inventory.remove(healPillId, 1);
      pillUsed = true;
      const after = entity.state.get('hp') ?? maxHp;
      healed = Math.max(0, after - before);
      // 若物品效果未改 hp（配置未含回血效果）则按配置 healAmount 兜底回血（夹 maxHp）。
      if (healed <= 0 && maxHp > 0) {
        const amount = cfg.healAmount ?? Math.round(maxHp * (cfg.healRatio ?? 0.3));
        const newHp = Math.min(maxHp, before + amount);
        entity.state.set('hp', newHp);
        healed = newHp - before;
      }
    } else if (maxHp > 0) {
      // 无丹：静养小幅回血（按 reaction.json restRatio，默认 0.1×maxHp）。
      const restRatio = cfg.restHealRatio ?? 0.1;
      const newHp = Math.min(maxHp, curHp + Math.round(maxHp * restRatio));
      entity.state.set('hp', newHp);
      healed = newHp - curHp;
    }

    // 同时减一级伤势（疗养语义）。
    const injury = entity.state.get('injuryLevel') || 0;
    if (injury > 0) entity.state.set('injuryLevel', Math.max(0, injury - 1));

    return {
      success: true,
      outcome: pillUsed ? 'heal_pill' : 'heal_rest',
      healed: Math.round(healed),
      description: pillUsed
        ? `${entity.staticData?.name || entity.id} 危急中服下回血丹药，伤势回稳`
        : `${entity.staticData?.name || entity.id} 就地静养调息，稍稍回血`,
    };
  }
}

/**
 * 反击：判断敌弱后就地反击来犯者一击（ADR-048）。走统一伤害管线 applyDamage（锁血/遁地通用）。
 * 来犯者由刺激 payload.killerId 定位（存入 state._reactCounterTargetId 供本执行器读取）。
 * 胜负不做多回合循环（本轮范围）：仅结算一次伤害，对方可能被打死/锁血/遁走。
 */
export class NPCReactCounterExecutor extends ActionExecutor {
  run(entity, worldContext, _action) {
    const targetId = entity.state.get('_reactCounterTargetId') || null;
    entity.state.set('_reactCounterTargetId', null);
    const target = targetId && worldContext?.entityRegistry?.getById
      ? worldContext.entityRegistry.getById(targetId)
      : null;
    if (!target || !target.alive) {
      return { success: false, outcome: 'no_target', description: `${entity.staticData?.name || entity.id} 欲反击，来犯者已遁去` };
    }

    const powerFn = typeof worldContext.npcCombatPower === 'function' ? worldContext.npcCombatPower : null;
    const myPower = powerFn ? powerFn(entity) : 1;
    const targetMaxHp = target.state?.get('maxHp') || 0;
    // 反击伤害：以战力折算一击伤害（reaction.json counterDamageRatio×战力）。
    const cfg = getReactionConfig(worldContext);
    const dmgRatio = cfg.counterDamageRatio ?? 0.5;
    const damage = Math.max(1, Math.round(myPower * dmgRatio));

    // 碾压判定交由 applyDamage 按伤害量/maxHp 比例自行裁定（不在此处算境界 order 差，保持解耦）。
    const result = applyDamage(target, {
      amount: damage,
      cause: 'react_counter',
      killer: entity,
    }, worldContext);

    let desc;
    if (result.died) desc = `${entity.staticData?.name || entity.id} 奋起反击，当场重创并击杀来犯者`;
    else if (result.escaped) desc = `${entity.staticData?.name || entity.id} 奋起反击，来犯者祭符遁走`;
    else if (result.locked) desc = `${entity.staticData?.name || entity.id} 奋起反击，来犯者锁血逃脱`;
    else desc = `${entity.staticData?.name || entity.id} 奋起反击，重创来犯者（伤害${result.damage}，敌余血${result.newHp}/${targetMaxHp}）`;

    return {
      success: result.died,
      outcome: result.died ? 'killed' : (result.escaped ? 'enemy_escaped' : 'enemy_wounded'),
      targetId: target.id,
      damage: result.damage,
      description: desc,
    };
  }
}
