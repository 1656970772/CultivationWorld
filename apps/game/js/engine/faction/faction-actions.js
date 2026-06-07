/**
 * FactionActions - 势力行为执行器
 *
 * 每种势力行为的具体执行逻辑，注册到 ActionPool。
 *
 * 【资源真相源约定】（修复历史双轨 bug）
 * FactionEntity 的 tick 流程：onPreTick 把 state→inventory，Action.execute 依次跑
 * costs(扣 inventory)→executor→yields(加 inventory)→_applyEffects(改 state)，onPostTick 用
 * state 覆盖回 inventory。因此 state 是资源（low_spirit_stone/disciples/food）的**单一真相源**，
 * 而 inventory 的 costs/yields 增减会被 onPostTick 的 state 覆盖而丢失（历史 bug 根因）。
 *
 * 统一约定（每个资源键只被改一次）：
 *   - 资源（low_spirit_stone/disciples/food）的"消耗与产出"全部声明在 JSON 的 `effects`（走 state）；
 *     `costs`/`yields`（走 inventory）不再用于这三种资源，避免被 state 覆盖造成的双轨。
 *   - executor 只负责 effects 无法表达的逻辑：跨实体作用（贸易/结盟/论道）、世界调用（扩张/攻伐）、
 *     对本门 NPC 的批量影响（开放秘境）、以及非资源派生状态（formation/territory 等）。
 *     executor **不再重复增减上述三种资源**（除非该资源变化是动态、且对应 JSON 不含该键）。
 * 详见 docs/decisions/adr-015。
 */
import { ActionExecutor } from '../abstract/action.js';
import { ActionPool } from '../pools/action-pool.js';
import { addExperienceCultivation } from '../npc/numeric-cultivation.js';

export class FactionDevelopExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    // 资源产出已由 JSON effects 结算（灵石/粮草/弟子）；此处仅追加"领地灵脉规模红利"，
    // 该红利随 territoryCount 动态变化，JSON 无法表达，且 effects 不含此项，故无双计。
    const territoryCount = entity.state.get('territoryCount') || 1;
    const veinBonus = Math.floor(territoryCount * 0.5);
    if (veinBonus > 0) {
      entity.state.set('low_spirit_stone', (entity.state.get('low_spirit_stone') || 0) + veinBonus);
    }
    return { veinBonus, description: `内部发展完成，灵脉额外产出 ${veinBonus} 灵石` };
  }
}

export class FactionRecruitExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    // 弟子招募量由 JSON effects 固定结算；此处不再重复增减 disciples（修复双计）。
    return { description: '发布招募令，新弟子入门' };
  }
}

export class FactionExpandExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const territoryCount = entity.state.get('territoryCount') || 0;
    if (territoryCount >= 20) {
      return { success: false, description: '领地已达上限' };
    }
    if (!worldContext.expandTerritory) {
      return { success: false, description: '无法扩张：缺少世界上下文' };
    }
    const result = worldContext.expandTerritory(entity.id);
    if (result.success) {
      const territory = entity.state.get('territory') || [];
      territory.push(result.tileKey);
      entity.state.set('territory', territory);
    }
    return result;
  }
}

export class FactionDefendExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const stability = entity.state.get('stability') || 50;
    entity.state.set('stability', Math.min(100, stability + 5));
    const borderThreat = entity.state.get('borderThreat') || 0;
    entity.state.set('borderThreat', Math.max(0, borderThreat - 1));
    return { description: '加强了边境防御' };
  }
}

export class FactionAttackExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    if (!worldContext.attackEnemy) {
      return { success: false, description: '无法攻击：缺少世界上下文' };
    }
    // stability 变化已在 attackEnemy 内部处理（胜利 -5 / 失败 -10）
    return worldContext.attackEnemy(entity.id);
  }
}

export class FactionAllyExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    if (!worldContext.formAlliance) {
      return { success: false, description: '无法结盟：缺少世界上下文' };
    }
    const result = worldContext.formAlliance(entity.id);
    return result;
  }
}

export class FactionTradeExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const allFactions = worldContext.entityRegistry
      ? worldContext.entityRegistry.getByType('faction').filter(f => f.alive && f.id !== entity.id)
      : [];

    // 找到关系最好的盟友或友好势力
    let bestPartner = null;
    let bestRelation = 20; // 最低贸易关系门槛

    for (const f of allFactions) {
      const rel = entity.state.get('relations')?.[f.id] || 0;
      if (rel > bestRelation) {
        bestRelation = rel;
        bestPartner = f;
      }
    }

    if (!bestPartner) return { success: false, reason: '无合适贸易伙伴' };

    // 双方互利贸易：己方用灵石换粮草。资源统一走经济底座，
    // faction_state_resource 以 state 为真相源，并在账本留下证据。
    const myStone = entity.state.get('low_spirit_stone') || 0;
    const tradeAmount = Math.min(Math.floor(myStone * 0.1), 200);

    if (tradeAmount <= 0) return { success: false, reason: '灵石不足以贸易' };

    const partnerFood = bestPartner.state.get('food') || 0;
    const foodAmount = Math.min(tradeAmount * 2, partnerFood);
    if (foodAmount <= 0) return { success: false, reason: '贸易伙伴粮食不足' };

    let transactionId = null;
    if (worldContext?.settleTransaction) {
      const transaction = worldContext.settleTransaction({
        type: 'faction_trade',
        scenarioId: 'formal_market',
        parties: [
          { role: 'buyer', entity },
          { role: 'seller', entity: bestPartner },
        ],
        transfers: [
          { from: 'buyer', to: 'seller', asset: { kind: 'faction_state_resource', itemId: 'low_spirit_stone', quantity: tradeAmount } },
          { from: 'seller', to: 'buyer', asset: { kind: 'faction_state_resource', itemId: 'food', quantity: foodAmount } },
        ],
        source: { type: 'faction_action_trade', factionId: entity.id, partnerId: bestPartner.id },
        visibility: 'institution',
      });
      if (!transaction.success) {
        return { success: false, reason: transaction.reason || '贸易结算失败', transactionId: transaction.transactionId };
      }
      transactionId = transaction.transactionId || null;
    } else {
      entity.state.set('low_spirit_stone', myStone - tradeAmount);
      entity.state.set('food', (entity.state.get('food') || 0) + foodAmount);
      bestPartner.state.set('low_spirit_stone', (bestPartner.state.get('low_spirit_stone') || 0) + tradeAmount);
      bestPartner.state.set('food', Math.max(0, partnerFood - foodAmount));
    }

    // 贸易增进双方关系
    const currentRel = entity.state.get('relations')?.[bestPartner.id] || 0;
    const partnerRel = bestPartner.state.get('relations')?.[entity.id] || 0;

    const relations = entity.state.get('relations') || {};
    relations[bestPartner.id] = Math.min(currentRel + 3, 100);
    entity.state.set('relations', { ...relations });

    const partnerRelations = bestPartner.state.get('relations') || {};
    partnerRelations[entity.id] = Math.min(partnerRel + 3, 100);
    bestPartner.state.set('relations', { ...partnerRelations });

    return {
      success: true,
      partnerId: bestPartner.id,
      partnerName: bestPartner.name,
      tradeAmount,
      foodAmount,
      transactionId,
      description: `与 ${bestPartner.name} 完成贸易，交换 ${tradeAmount} 灵石`,
    };
  }
}

export class FactionStabilizeExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const stability = entity.state.get('stability') || 50;
    entity.state.set('stability', Math.min(100, stability + 10));
    return { description: '安抚了内部秩序' };
  }
}

export class FactionHostConferenceExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const allFactions = worldContext.entityRegistry
      ? worldContext.entityRegistry.getByType('faction').filter(f => f.alive && f.id !== entity.id)
      : [];

    let boostedCount = 0;
    for (const other of allFactions) {
      const myRelations = entity.state.get('relations') || {};
      const rel = myRelations[other.id] || 0;
      if (rel >= 20) {
        // 己方对对方关系 +5
        myRelations[other.id] = Math.min(rel + 5, 100);
        entity.state.set('relations', { ...myRelations });

        // 对方对己方关系 +5
        const otherRelations = other.state.get('relations') || {};
        otherRelations[entity.id] = Math.min((otherRelations[entity.id] || 0) + 5, 100);
        other.state.set('relations', { ...otherRelations });

        boostedCount++;
      }
    }

    return {
      success: true,
      boostedCount,
      description: `举办论道大会，与 ${boostedCount} 个友好势力增进了关系`,
    };
  }
}

export class FactionBuildFormationExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    entity.state.set('formationBuilt', true);
    entity.state.set('formationStrength', 3);
    return {
      success: true,
      description: '护山大阵布置完毕，门派防御大幅提升',
    };
  }
}

export class FactionOpenSecretRealmExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const allNpcs = worldContext.entityRegistry
      ? worldContext.entityRegistry.getAliveByType('npc').filter(
          n => n.state.get('factionId') === entity.id
        )
      : [];

    // ADR-040：秘境历练给弟子历练修为，作为闭关之外的外出成长来源。
    const cult = worldContext.balanceConfig?.cultivation || {};
    const baseExperienceGain = cult.actions?.secretRealm?.experienceCultivationGain ?? 3;

    for (const npc of allNpcs) {
      addExperienceCultivation(npc, worldContext?.ranksData || npc?._ranksData || [], baseExperienceGain, cult);
    }

    return {
      success: true,
      benefitCount: allNpcs.length,
      experienceCultivationGain: baseExperienceGain,
      description: `开放秘境，${allNpcs.length} 名弟子历练修为提升`,
    };
  }
}

/**
 * 注册所有势力行为执行器到 ActionPool
 */
export function registerFactionExecutors() {
  ActionPool.registerExecutor('faction_develop', new FactionDevelopExecutor());
  ActionPool.registerExecutor('faction_recruit', new FactionRecruitExecutor());
  ActionPool.registerExecutor('faction_expand', new FactionExpandExecutor());
  ActionPool.registerExecutor('faction_defend', new FactionDefendExecutor());
  ActionPool.registerExecutor('faction_attack', new FactionAttackExecutor());
  ActionPool.registerExecutor('faction_ally', new FactionAllyExecutor());
  ActionPool.registerExecutor('faction_trade', new FactionTradeExecutor());
  ActionPool.registerExecutor('faction_stabilize', new FactionStabilizeExecutor());
  ActionPool.registerExecutor('faction_host_conference', new FactionHostConferenceExecutor());
  ActionPool.registerExecutor('faction_build_formation', new FactionBuildFormationExecutor());
  ActionPool.registerExecutor('faction_open_secret_realm', new FactionOpenSecretRealmExecutor());
}
