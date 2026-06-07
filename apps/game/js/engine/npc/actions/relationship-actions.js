/**
 * relationship-actions —— 关系 / 师徒驱动行为执行器（从 npc-actions.js 拆分，ADR-024/028/029）。
 *
 * 含前往机缘 / 驰援同门 / 探望恩人 / 传功点化 / 护徒驰援 / 探望恩师：
 *   GotoOpportunity / AssistAlly / VisitBenefactor / TeachDisciple / ProtectDisciple / VisitMaster
 * 风险结算、奖励发放等共享工具统一从 ./npc-action-utils.js 引入。
 */
import { ActionExecutor } from '../../abstract/action.js';
import { ItemRegistry } from '../../items/item-registry.js';
import {
  settleRisk,
  rollAndGrantReward,
} from './npc-action-utils.js';
import { applyCultivationExperience } from '../cultivation-experience.js';
import { addExperienceCultivation } from '../numeric-cultivation.js';

function grantRelationshipExperience(entity, worldContext, sourceKind, input = {}) {
  return applyCultivationExperience(entity, worldContext, {
    sourceKind,
    value: input.value ?? 100,
    riskScore: input.riskScore ?? 0.2,
    durationDays: input.durationDays ?? 1,
    outcome: input.outcome || 'success',
  });
}

function grantDiscipleTeachingExperience(disciple, worldContext) {
  const teachCfg = worldContext.relationshipConfig?.masterDiscipleGoals?.teachDisciple || {};
  const experienceCultivationGain = teachCfg.experienceCultivationGain ?? 12;
  const totalCultivation = addExperienceCultivation(
    disciple,
    worldContext?.ranksData || disciple?._ranksData || [],
    experienceCultivationGain,
    worldContext?.balanceConfig?.cultivation || disciple?._cultivationConfig || {},
  );
  return { experienceCultivationGain, totalCultivation };
}

/**
 * 机会点前往执行器（ADR-024）：NPC 抵达 WorldOpportunity 后结算。
 * 按机会点 rewardSource 掉落真实物品（写入背包），按 riskKey 结算风险（受伤/陨落）。
 * 标记机会点已被本 NPC 领取（claimedBy），置 arrivedAtOpportunity=true。
 */
export class NPCGotoOpportunityExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const oppId = entity.state.get('targetOpportunityId');
    const opp = oppId && worldContext.opportunitySystem
      ? worldContext.opportunitySystem.getById(oppId)
      : null;
    entity.state.set('arrivedAtOpportunity', true);

    if (!opp) {
      entity.state.set('targetOpportunityId', null);
      return { success: false, outcome: 'gone', description: `${entity.staticData.name} 赶到时，机缘已逝` };
    }

    // 风险结算（按机会点 riskKey，无则不结算）
    let risk = { died: false, triggered: [] };
    if (opp.riskKey) {
      risk = settleRisk(entity, worldContext, opp.riskKey);
      if (risk.died) {
        return {
          success: false, outcome: 'death', oppType: opp.type,
          riskTriggered: risk.triggered,
          description: `${entity.staticData.name} 争夺${opp.name}时殒身`,
        };
      }
    }

    opp.claim(entity.id);
    entity.state.set('targetOpportunityId', null);

    // 收益：按 rewardSource 发放真实物品
    const rewardCfg = worldContext.balanceConfig?.reward;
    const grant = opp.rewardSource ? rollAndGrantReward(entity, rewardCfg, opp.rewardSource, worldContext.rng) : { grantedItems: [], qiGain: 0, outcome: null };
    const lootDesc = grant.grantedItems.length > 0
      ? grant.grantedItems.map(g => `${ItemRegistry.get(g.itemId)?.name || g.itemId}×${g.qty}`).join('、')
      : (grant.qiGain > 0 ? `真气+${grant.qiGain}` : '一无所获');
    const riskNote = risk.triggered.length > 0 ? `，途中${risk.triggered.map(r => r.risk).join('、')}` : '';
    const cultivationExperience = grantRelationshipExperience(entity, worldContext, 'opportunity', {
      value: opp.value ?? grant.outcome?.value ?? 500,
      riskScore: risk.triggered.length,
    });

    return {
      success: true, outcome: 'opportunity_claimed', oppType: opp.type,
      rewardId: grant.outcome?.id ?? null,
      grantedItems: grant.grantedItems,
      qiGain: grant.qiGain,
      riskTriggered: risk.triggered,
      cultivationExperience,
      description: `${entity.staticData.name} 赴${opp.name}，斩获${lootDesc}${riskNote}`,
    };
  }
}

/**
 * 关系驱动——驰援同门（ADR-028）。
 * requiresTravel 已把 NPC 移动到 relationship_target 解析的同门坐标。抵达后：
 *   - 同门仍陷争斗：加深双方 same_sect 情谊（关系边强度反馈），叙事上结成生死之交。
 *   - 同门已脱困/失联：空援，仅清空锁定目标。
 * effect 置 assistedAlly=true（结算后由决策周期复位）。
 */
export class NPCAssistAllyExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const allyId = entity.state.get('targetRelationshipId');
    entity.state.set('assistedAlly', true);
    entity.state.set('targetRelationshipId', null);
    const ally = allyId && worldContext.entityRegistry
      ? worldContext.entityRegistry.getById(allyId)
      : null;
    if (!ally || !ally.alive) {
      return { success: false, outcome: 'gone', description: `${entity.staticData.name} 赶到时，同门已不知所踪` };
    }
    // 并肩作战加深同门情谊（双向对称边由 RelationshipSystem 自动建反向）。
    const rs = worldContext.relationshipSystem;
    if (rs && typeof rs.addEdge === 'function') {
      rs.addEdge(entity.id, ally.id, 'same_sect', { strengthDelta: 8, tick: worldContext.currentDay ?? 0 });
    }
    const cultivationExperience = grantRelationshipExperience(entity, worldContext, 'social_travel');
    return {
      success: true,
      outcome: 'assisted',
      targetId: ally.id,
      cultivationExperience,
      description: `${entity.staticData.name} 赶来驰援同门 ${ally.staticData?.name || ally.id}，并肩御敌`,
    };
  }
}

/**
 * 关系驱动——探望恩人（ADR-028）。
 * requiresTravel 已把 NPC 移动到 relationship_target 解析的恩人坐标。抵达后加深恩义
 * （gratitude 边强度反馈），叙事上知恩图报。effect 置 visitedBenefactor=true（结算后复位）。
 */
export class NPCVisitBenefactorExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const benId = entity.state.get('targetRelationshipId');
    entity.state.set('visitedBenefactor', true);
    entity.state.set('targetRelationshipId', null);
    const ben = benId && worldContext.entityRegistry
      ? worldContext.entityRegistry.getById(benId)
      : null;
    if (!ben || !ben.alive) {
      return { success: false, outcome: 'gone', description: `${entity.staticData.name} 寻访恩人未果` };
    }
    // 报恩加深恩义（经 relationships 兼容视图写 gratitude 边，与记忆侧口径一致）。
    if (entity.relationships && typeof entity.relationships.addGratitude === 'function') {
      entity.relationships.addGratitude(ben.id, 5);
    }
    const cultivationExperience = grantRelationshipExperience(entity, worldContext, 'social_travel');
    return {
      success: true,
      outcome: 'visited',
      targetId: ben.id,
      cultivationExperience,
      description: `${entity.staticData.name} 携礼探望恩人 ${ben.staticData?.name || ben.id}，以报当年之德`,
    };
  }
}

/**
 * 师徒互动——师傅传功点化（ADR-029 第三期）。
 * requiresTravel 已把师傅移动到 relationship_target 解析的徒弟坐标。抵达后给徒弟一波历练修为
 * 助推数值修为成长，并加深师徒情谊（master 边强度反馈）。
 * effect 置 taughtDisciple=true（结算后复位）。体现『无私传承』（参考凡人修仙传 大衍神君传承）。
 */
export class NPCTeachDiscipleExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const discipleId = entity.state.get('targetRelationshipId');
    entity.state.set('taughtDisciple', true);
    entity.state.set('targetRelationshipId', null);
    const disciple = discipleId && worldContext.entityRegistry
      ? worldContext.entityRegistry.getById(discipleId)
      : null;
    if (!disciple || !disciple.alive) {
      return { success: false, outcome: 'gone', description: `${entity.staticData.name} 欲传功，徒弟却已不在` };
    }
    const teachingExperience = grantDiscipleTeachingExperience(disciple, worldContext);
    // 加深师徒情谊（master 边；symmetricType=disciple 自动建反向）。
    const rs = worldContext.relationshipSystem;
    if (rs && typeof rs.addEdge === 'function') {
      rs.addEdge(entity.id, disciple.id, 'master', { strengthDelta: 6, tick: worldContext.currentDay ?? 0 });
    }
    const cultivationExperience = grantRelationshipExperience(entity, worldContext, 'social_travel');
    return {
      success: true,
      outcome: 'taught',
      targetId: disciple.id,
      experienceCultivationGain: teachingExperience.experienceCultivationGain,
      totalCultivation: teachingExperience.totalCultivation,
      cultivationExperience,
      description: `${entity.staticData.name} 为徒弟 ${disciple.staticData?.name || disciple.id} 传功点化，助其历练修为精进`,
    };
  }
}

/**
 * 师徒互动——师傅护徒驰援（ADR-029 第三期）。
 * 徒弟遭袭时师傅赶来并肩御敌，抵达后加深师徒情谊。effect 置 protectedDisciple=true（结算后复位）。
 * 与驰援同门同构，但出于师徒纽带优先级/范围更高（见 collectExtraGoals）。
 */
export class NPCProtectDiscipleExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const discipleId = entity.state.get('targetRelationshipId');
    entity.state.set('protectedDisciple', true);
    entity.state.set('targetRelationshipId', null);
    const disciple = discipleId && worldContext.entityRegistry
      ? worldContext.entityRegistry.getById(discipleId)
      : null;
    if (!disciple || !disciple.alive) {
      return { success: false, outcome: 'gone', description: `${entity.staticData.name} 赶到时，徒弟已不知所踪` };
    }
    const rs = worldContext.relationshipSystem;
    if (rs && typeof rs.addEdge === 'function') {
      rs.addEdge(entity.id, disciple.id, 'master', { strengthDelta: 8, tick: worldContext.currentDay ?? 0 });
    }
    const cultivationExperience = grantRelationshipExperience(entity, worldContext, 'social_travel');
    return {
      success: true,
      outcome: 'protected',
      targetId: disciple.id,
      cultivationExperience,
      description: `${entity.staticData.name} 赶来护卫徒弟 ${disciple.staticData?.name || disciple.id}，并肩御敌`,
    };
  }
}

/**
 * 师徒互动——徒弟探望恩师尽孝（ADR-029 第三期）。
 * 抵达后加深师徒情谊（disciple 边强度反馈，对称建反向 master）。effect 置 visitedMaster=true（结算后复位）。
 */
export class NPCVisitMasterExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const masterId = entity.state.get('targetRelationshipId');
    entity.state.set('visitedMaster', true);
    entity.state.set('targetRelationshipId', null);
    const master = masterId && worldContext.entityRegistry
      ? worldContext.entityRegistry.getById(masterId)
      : null;
    if (!master || !master.alive) {
      return { success: false, outcome: 'gone', description: `${entity.staticData.name} 寻访恩师未果` };
    }
    const rs = worldContext.relationshipSystem;
    if (rs && typeof rs.addEdge === 'function') {
      rs.addEdge(entity.id, master.id, 'disciple', { strengthDelta: 5, tick: worldContext.currentDay ?? 0 });
    }
    const cultivationExperience = grantRelationshipExperience(entity, worldContext, 'social_travel');
    return {
      success: true,
      outcome: 'visited_master',
      targetId: master.id,
      cultivationExperience,
      description: `${entity.staticData.name} 探望恩师 ${master.staticData?.name || master.id}，执弟子礼侍奉`,
    };
  }
}
