import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';
import { killNPCByPvP } from '../actions/npc-action-utils.js';
import { resolveCombatEncounter } from '../../combat/combat-encounter.js';
import { applyCultivationExperience } from '../cultivation-experience.js';

export function readCombatState(entity, key, fallback = 0) {
  const value = typeof entity?.state?.get === 'function' ? entity.state.get(key) : entity?.state?.[key];
  return value ?? fallback;
}

export function writeCombatState(entity, key, value) {
  if (typeof entity?.state?.set === 'function') {
    entity.state.set(key, value);
    return;
  }
  if (entity?.state) entity.state[key] = value;
}

function spatialPosition(entity) {
  const sp = entity?.spatial;
  if (!sp) return null;
  const x = typeof sp.tileX === 'number' ? sp.tileX : (typeof sp.x === 'number' ? Math.round(sp.x) : null);
  const y = typeof sp.tileY === 'number' ? sp.tileY : (typeof sp.y === 'number' ? Math.round(sp.y) : null);
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

function moveToDistantRevengeTarget(entity, target) {
  const here = spatialPosition(entity);
  const there = spatialPosition(target);
  if (!here || !there) return null;
  const distance = Math.abs(here.x - there.x) + Math.abs(here.y - there.y);
  if (distance <= 2) return null;
  writeCombatState(entity, 'nearRevengeTarget', false);
  if (typeof entity?.spatial?.setDestination !== 'function') {
    return { status: ToilResultStatus.BLOCKED, reason: 'spatial_destination_unavailable' };
  }
  entity.spatial.setDestination(there.x, there.y);
  return {
    status: ToilResultStatus.RUNNING,
    reason: 'moving_to_revenge_target',
    contextPatch: { revengeTargetId: target.id },
  };
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inventoryAmount(entity, itemId) {
  return num(entity?.inventory?.getAmount?.(itemId), 0);
}

function hasEquippedArtifact(entity) {
  return readCombatState(entity, 'hasEquippedArtifact', false) === true
    || !!readCombatState(entity, 'equippedArtifactId', null)
    || inventoryAmount(entity, 'artifact_green_sword') > 0;
}

function resolveCompanion(entity, worldContext, context = {}) {
  const companion = context.companion || null;
  if (companion) return companion;
  const companionId = context.companionId
    || readCombatState(entity, 'huntCompanionId', null)
    || readCombatState(entity, 'lastCompanionId', null);
  return companionId && worldContext?.entityRegistry?.getById
    ? worldContext.entityRegistry.getById(companionId)
    : null;
}

function grantPvpExperience(entity, worldContext, input = {}) {
  if (entity?.alive === false || readCombatState(entity, 'alive', true) === false) {
    return { gain: 0, reason: 'pvp_actor_dead' };
  }
  return applyCultivationExperience(entity, worldContext, {
    sourceKind: 'pvp',
    value: input.value ?? input.enemyPower ?? 100,
    riskScore: input.riskScore ?? 1,
    durationDays: 1,
    outcome: input.outcome || 'success',
  });
}

function questValueScore(entity, context = {}) {
  return num(context.monsterGrade, 0)
    || num(context.difficulty, 0)
    || num(readCombatState(entity, 'activeQuestDifficulty', 0), 0)
    || Math.ceil(num(readCombatState(entity, 'activeQuestValue', 0), 0) / 100);
}

export function combatRiskBranchReason(result) {
  if (!result) return null;
  if (result.needsCombatRecovery) return 'combat_retreat_required';
  if (result.needsCombatSupply) return 'combat_supply_required';
  if (result.needsCompanion) return 'hunt_companion_required';
  if (result.needsEasierHuntTarget) return 'easier_hunt_target_required';
  if (result.monsterTooDangerous) return 'monster_too_dangerous';
  return null;
}

export function assessCombatRisk(entity, worldContext, context = {}) {
  const monster = context.monster || (context.monsterId ? worldContext?.entityRegistry?.getById?.(context.monsterId) : null);
  const powerFn = typeof worldContext?.npcCombatPower === 'function' ? worldContext.npcCombatPower : null;
  const npcPower = Math.max(1, num(powerFn ? powerFn(entity) : 1, 1));
  const monsterPower = Math.max(1, num(monster?.state?.get?.('power') ?? monster?.power ?? context.monsterPower, 1));
  const injury = num(readCombatState(entity, 'injuryLevel', 0), 0);
  const hp = num(readCombatState(entity, 'hp', 1), 1);
  const maxHp = Math.max(1, num(readCombatState(entity, 'maxHp', 1), 1));
  const hpRatio = hp / maxHp;
  const companion = resolveCompanion(entity, worldContext, context);
  const rawCompanionPower = companion && companion.alive !== false && powerFn ? Math.max(0, num(powerFn(companion), 0)) : 0;
  const companionPower = rawCompanionPower * 0.7;
  const huntPartyPower = npcPower + companionPower;
  const riskScore = monsterPower / Math.max(1, huntPartyPower) + injury * 0.2 + (hpRatio < 0.35 ? 1 : 0);
  const monsterTooDangerous = riskScore >= 8;
  const shouldRetreat = hpRatio < 0.35 || injury >= 3;
  const needsCombatRecovery = shouldRetreat || hpRatio < 0.45 || injury >= 2;
  const hasHealItem = inventoryAmount(entity, 'pill_rejuvenation') > 0;
  const hasArtifact = hasEquippedArtifact(entity);
  const qi = num(readCombatState(entity, 'qi', 0), 0);
  const minCombatQi = num(context.minCombatQi ?? 0, 0);
  const lowCombatQi = qi < minCombatQi;
  const supplyRiskThreshold = num(
    context.supplyRiskThreshold ?? worldContext?.balanceConfig?.economy?.monsterResources?.huntSupplyRiskThreshold ?? 4,
    4,
  );
  const supplyRiskRelevant = !monsterTooDangerous && riskScore >= supplyRiskThreshold;
  const needsCombatSupply = supplyRiskRelevant && (!hasHealItem || !hasArtifact || lowCombatQi);
  const hasHuntCompanion = readCombatState(entity, 'hasHuntCompanion', false) === true || companionPower > 0;
  const huntCompanionRequested = readCombatState(entity, 'huntCompanionRequested', false) === true;
  const highValueTarget = questValueScore(entity, context) >= 4;
  const needsCompanion = monsterTooDangerous && highValueTarget && !hasHuntCompanion && !huntCompanionRequested;
  const needsEasierHuntTarget = monsterTooDangerous;
  const combatReady = !needsCombatRecovery && !needsCombatSupply && !needsCompanion && !needsEasierHuntTarget;

  writeCombatState(entity, 'combatRiskScore', riskScore);
  writeCombatState(entity, 'monsterTooDangerous', monsterTooDangerous);
  writeCombatState(entity, 'shouldRetreat', shouldRetreat);
  writeCombatState(entity, 'needsCombatRecovery', needsCombatRecovery);
  writeCombatState(entity, 'needsCombatSupply', needsCombatSupply);
  writeCombatState(entity, 'needsCompanion', needsCompanion);
  writeCombatState(entity, 'needsEasierHuntTarget', needsEasierHuntTarget);
  writeCombatState(entity, 'combatReady', combatReady);
  writeCombatState(entity, 'huntPartyPower', huntPartyPower);
  writeCombatState(entity, 'lowCombatQi', lowCombatQi);

  return {
    monster,
    monsterPower,
    npcPower,
    rawCompanionPower,
    companionPower,
    huntPartyPower,
    riskScore,
    monsterTooDangerous,
    shouldRetreat,
    needsCombatRecovery,
    needsCombatSupply,
    needsCompanion,
    needsEasierHuntTarget,
    combatReady,
    lowCombatQi,
  };
}

export class NPCAssessCombatRiskToilExecutor extends ToilExecutor {
  run(entity, worldContext, job) {
    const result = assessCombatRisk(entity, worldContext, job?.context || {});
    const reason = combatRiskBranchReason(result);
    if (reason) {
      return {
        status: ToilResultStatus.REPLAN,
        reason,
        contextPatch: {
          combatRiskScore: result.riskScore,
          monsterPower: result.monsterPower,
          huntPartyPower: result.huntPartyPower,
        },
      };
    }
    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'combat_risk_assessed',
      contextPatch: {
        combatRiskScore: result.riskScore,
        monsterPower: result.monsterPower,
        huntPartyPower: result.huntPartyPower,
      },
    };
  }
}

export class NPCPrepareCombatSupplyToilExecutor extends ToilExecutor {
  run(entity, _worldContext, _job, toil) {
    const params = toil?.params || {};
    const healItemId = params.healItemId || 'pill_rejuvenation';
    const artifactItemId = params.artifactItemId || 'artifact_green_sword';
    const minQi = num(params.minQi ?? 0, 0);
    const hasHeal = inventoryAmount(entity, healItemId) > 0;
    const hasArtifact = hasEquippedArtifact(entity) || inventoryAmount(entity, artifactItemId) > 0;
    const qi = num(readCombatState(entity, 'qi', 0), 0);
    const lowCombatQi = qi < minQi;
    const ready = hasHeal && hasArtifact && !lowCombatQi;

    writeCombatState(entity, 'hasHealItem', hasHeal);
    writeCombatState(entity, 'hasEquippedArtifact', hasArtifact);
    writeCombatState(entity, 'lowCombatQi', lowCombatQi);
    writeCombatState(entity, 'needsCombatSupply', !ready);
    writeCombatState(entity, 'combatReady', ready);

    if (!hasHeal) {
      return { status: ToilResultStatus.REPLAN, reason: 'combat_supply_required', contextPatch: { missingCombatSupply: healItemId } };
    }
    if (!hasArtifact) {
      return { status: ToilResultStatus.REPLAN, reason: 'combat_supply_required', contextPatch: { missingCombatSupply: artifactItemId } };
    }
    if (lowCombatQi) {
      return { status: ToilResultStatus.REPLAN, reason: 'combat_qi_required', contextPatch: { minQi, qi } };
    }
    return { status: ToilResultStatus.SUCCESS, reason: 'combat_supply_ready' };
  }
}

export class NPCRetreatToSafePlaceToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const target = worldContext?.resolveTarget?.(entity, 'safe_retreat')
      || worldContext?.resolveTarget?.(entity, 'faction_hq');
    if (!entity?.spatial || !target) {
      writeCombatState(entity, 'shouldRetreat', false);
      return { status: ToilResultStatus.SUCCESS, reason: 'retreat_no_spatial' };
    }
    const x = target.x ?? target.tileX;
    const y = target.y ?? target.tileY;
    if (entity.spatial.tileX === x && entity.spatial.tileY === y) {
      writeCombatState(entity, 'shouldRetreat', false);
      return { status: ToilResultStatus.SUCCESS, reason: 'retreat_arrived' };
    }
    if (typeof entity.spatial.setDestination !== 'function') {
      return { status: ToilResultStatus.BLOCKED, reason: 'spatial_destination_unavailable' };
    }
    entity.spatial.setDestination(x, y);
    return { status: ToilResultStatus.RUNNING, reason: 'retreating' };
  }
}

export class NPCUseHealItemToilExecutor extends ToilExecutor {
  run(entity) {
    if ((entity?.inventory?.getAmount?.('pill_rejuvenation') || 0) > 0) {
      entity.inventory.remove?.('pill_rejuvenation', 1);
    }
    const injury = Number(readCombatState(entity, 'injuryLevel', 0));
    writeCombatState(entity, 'injuryLevel', Math.max(0, injury - 1));
    return { status: ToilResultStatus.SUCCESS, reason: 'heal_item_used' };
  }
}

export class NPCAbortOverdangerousTargetToilExecutor extends ToilExecutor {
  run(entity) {
    const monsterId = readCombatState(entity, 'questTargetMonsterId', null);
    const excluded = readCombatState(entity, 'excludedHuntMonsterIds', []);
    const nextExcluded = Array.isArray(excluded) ? [...excluded] : [];
    if (monsterId && !nextExcluded.includes(monsterId)) nextExcluded.push(monsterId);
    writeCombatState(entity, 'excludedHuntMonsterIds', nextExcluded);
    writeCombatState(entity, 'questTargetMonsterId', null);
    writeCombatState(entity, 'monsterTooDangerous', true);
    writeCombatState(entity, 'needsEasierHuntTarget', true);
    return { status: ToilResultStatus.ABORT, reason: 'overdangerous_target_aborted' };
  }
}

export class NPCHuntEnemyToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const target = typeof worldContext?.resolveRevengeTarget === 'function'
      ? worldContext.resolveRevengeTarget(entity)
      : null;
    if (!target) {
      writeCombatState(entity, 'nearRevengeTarget', false);
      return { status: ToilResultStatus.REPLAN, reason: 'revenge_target_missing' };
    }
    const move = moveToDistantRevengeTarget(entity, target);
    if (move) return move;
    writeCombatState(entity, 'nearRevengeTarget', true);
    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'revenge_target_tracked',
      contextPatch: { revengeTargetId: target.id },
    };
  }
}

export class NPCKillEnemyToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const target = typeof worldContext?.resolveRevengeTarget === 'function'
      ? worldContext.resolveRevengeTarget(entity)
      : null;
    if (!target) {
      writeCombatState(entity, 'nearRevengeTarget', false);
      return { status: ToilResultStatus.REPLAN, reason: 'revenge_target_missing' };
    }
    const move = moveToDistantRevengeTarget(entity, target);
    if (move) return move;

    const powerFn = typeof worldContext?.npcCombatPower === 'function'
      ? worldContext.npcCombatPower
      : null;
    const myPower = powerFn ? powerFn(entity) : 1;
    const enemyPower = powerFn ? powerFn(target) : 1;
    const encounter = resolveCombatEncounter({
      attacker: entity,
      defender: target,
      scene: 'pvp',
      power: myPower,
      defenderPower: enemyPower,
      value: enemyPower,
      riskScore: enemyPower / Math.max(1, myPower),
      worldContext,
    });
    const winChance = encounter.winChance;
    const rng = worldContext?.rng;
    const roll = typeof rng?.next === 'function' ? rng.next() : Math.random();
    const win = roll < winChance;

    if (win) {
      const kill = killNPCByPvP(target, entity, worldContext);
      writeCombatState(entity, 'nearRevengeTarget', false);
      if (!kill.died) {
        const cultivationExperience = grantPvpExperience(entity, worldContext, {
          value: enemyPower,
          riskScore: enemyPower / Math.max(1, myPower),
          outcome: 'partial',
        });
        return {
          status: ToilResultStatus.FAILED,
          reason: kill.escaped ? 'enemy_escaped' : 'enemy_survived',
          contextPatch: { revengeTargetId: target.id, winChance, cultivationExperience },
        };
      }
      writeCombatState(entity, 'enemyKilled', true);
      const cultivationExperience = grantPvpExperience(entity, worldContext, {
        value: enemyPower,
        riskScore: enemyPower / Math.max(1, myPower),
        outcome: 'success',
      });
      return {
        status: ToilResultStatus.SUCCESS,
        reason: 'enemy_slain',
        contextPatch: { revengeTargetId: target.id, winChance, cultivationExperience },
      };
    }

    const disadvantage = 1 - winChance;
    const lethalRoll = typeof rng?.next === 'function' ? rng.next() : Math.random();
    const lethal = disadvantage > 0.8 && lethalRoll < (disadvantage - 0.8) * 2.5;
    if (lethal) {
      const kill = killNPCByPvP(entity, target, worldContext);
      writeCombatState(entity, 'nearRevengeTarget', false);
      const cultivationExperience = grantPvpExperience(entity, worldContext, {
        value: enemyPower,
        riskScore: enemyPower / Math.max(1, myPower),
        outcome: kill.died ? 'failure' : 'partial',
      });
      return {
        status: ToilResultStatus.FAILED,
        reason: kill.died ? 'slain_by_enemy' : (kill.escaped ? 'escaped' : 'survived'),
        contextPatch: { revengeTargetId: target.id, winChance, cultivationExperience },
      };
    }

    const injury = 1 + Math.floor(disadvantage * 3);
    writeCombatState(entity, 'injuryLevel', Number(readCombatState(entity, 'injuryLevel', 0)) + injury);
    writeCombatState(entity, 'nearRevengeTarget', false);
    const cultivationExperience = grantPvpExperience(entity, worldContext, {
      value: enemyPower,
      riskScore: enemyPower / Math.max(1, myPower),
      outcome: 'failure',
    });
    return {
      status: ToilResultStatus.FAILED,
      reason: 'revenge_wounded',
      contextPatch: { revengeTargetId: target.id, winChance, injury, cultivationExperience },
    };
  }
}
