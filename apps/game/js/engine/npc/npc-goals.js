/**
 * NPCGoalProvider —— NPC 额外目标抽取（执念/机会/关系/师徒，从 npc-entity.js 抽离）。
 *
 * 把"选目标"前的额外 Goal 产出收敛为纯函数（仿 npc-utility.js 范例），NPCEntity 仅保留一行转发：
 *   - collectExtraGoals          汇总执念 Goal + 机会 Goal + 关系 Goal（PlannerNode 鸭子调用）。
 *   - relationshipGoalsEnabled   关系驱动是否启用（ADR-028 数据/系统门控）。
 *   - buildRelationshipGoals     关系驱动 Goal（护短同门 / 报恩 / 师徒互动，单点锁定）。
 *   - considerMasterDiscipleGoals 师徒互动候选（传功/护徒/尽孝，ADR-029）。
 *   - checkSeizeDiscipleObsession 夺舍图谋执念（邪修师傅对高资质徒弟，复用复仇链）。
 *   - buildOpportunityGoal       机会点前往 Goal（ADR-024）。
 *
 * 全部以 entity 为首参，仅读写 entity 的 obsessions/state/relationships 与关系/执念配置，
 * 不改变随机序列或写入顺序。拆分边界见 ADR-030。
 */
import { Goal, GoalSource } from '../abstract/goal.js';
import { Obsession } from '../abstract/obsession-system.js';
import { nextCultivationRank } from './numeric-cultivation.js';

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cultivationCompletionRatio(entity) {
  const next = nextCultivationRank(entity, entity?._ranksData || []);
  const required = numeric(next?.cultivationRequired ?? next?.qiRequired, 0);
  if (required <= 0) return 1;
  return numeric(entity?.state?.get?.('totalCultivation'), 0) / required;
}

/**
 * 收集执念目标（ADR-019），与日常需求目标一起进入 PlannerNode 的 Utility 选择。
 * 强执念（intensity 高）会压过普通需求，驱动 NPC 长期围绕执念行动（如拼命变强）。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {Object} worldContext
 * @returns {import('../abstract/goal.js').Goal[]}
 */
export function collectExtraGoals(entity, worldContext) {
  const goals = entity.obsessions ? entity.obsessions.toGoals() : [];
  // 机会点目标（ADR-024）：基于已知消息评估出值得前往的机会点时，生成一个前往 Goal。
  // 仅在机会系统 enabled 且存在可行机会时产出，否则不影响既有规划。
  const oppGoal = buildOpportunityGoal(entity, worldContext);
  if (oppGoal) goals.push(oppGoal);
  // 关系驱动目标（ADR-028）：护短同门 / 报恩。goalsEnabled 关或无 qualifying 边时返回 []。
  const relGoal = buildRelationshipGoals(entity, worldContext);
  if (relGoal) goals.push(relGoal);
  if (typeof entity.collectDynamicGoals === 'function') {
    const dynamicGoals = entity.collectDynamicGoals(worldContext);
    if (Array.isArray(dynamicGoals) && dynamicGoals.length > 0) goals.push(...dynamicGoals);
  }
  return goals;
}

/** 关系驱动决策是否启用（ADR-028）：数据层 enabled 且 goalsEnabled 且世界级系统就绪。 */
export function relationshipGoalsEnabled(entity) {
  const cfg = entity._relationshipConfig || {};
  return cfg.enabled !== false
    && cfg.goalsEnabled !== false
    && !!entity._relationshipSystem
    && entity._relationshipSystem.enabled !== false;
}

/**
 * 关系驱动 Goal（ADR-028）：依本 NPC 关系边产出至多一个高优先级 Goal（仿机会 Goal 单点锁定）。
 * 候选（按优先级取最高一个）：
 *   - 护短同门 assist_sect_mate：高强度 same_sect/ally 对象正陷入争斗（hasRevengeTarget）且在驰援范围内。
 *   - 报恩 repay_benefactor：对高强度 benefactor/gratitude 对象低频产出探望/施援。
 * 关系复仇不在此另造 Goal——复用现有复仇链（_resolveRevengeTarget 已认 enemy 边）。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {Object} worldContext
 * @returns {import('../abstract/goal.js').Goal|null}
 */
export function buildRelationshipGoals(entity, worldContext) {
  if (!relationshipGoalsEnabled(entity)) {
    entity.state.set('targetRelationshipId', null);
    return null;
  }
  const registry = worldContext?.entityRegistry;
  if (!registry || typeof registry.getById !== 'function') return null;
  const rs = entity._relationshipSystem;
  const cfg = entity._relationshipConfig.npcGoals || {};
  const here = entity.hasSpatial && entity.hasSpatial() ? entity.spatial : null;

  /** @type {{ id:string, name:string, targetId:string, effectKey:string, priority:number }|null} */
  let best = null;
  const consider = (cand) => {
    if (!cand) return;
    if (!best || cand.priority > best.priority) best = cand;
  };

  // —— 护短同门：高强度 same_sect/ally 对象陷入争斗，前往支援 ——
  const assistCfg = cfg.assistSectMate || {};
  const minSect = assistCfg.minSectAffinityStrength ?? 30;
  const maxRange = assistCfg.maxAssistRange ?? 18;
  const assistPriority = assistCfg.priority ?? 6;
  for (const type of ['same_sect', 'ally']) {
    for (const edge of rs.edgesOfType(entity.id, type)) {
      if (edge.strength < minSect) break; // edgesOfType 已按强度降序，低于门槛即可停。
      const ally = registry.getById(edge.toId);
      if (!ally || !ally.alive || ally.id === entity.id) continue;
      if (!(ally.hasSpatial && ally.hasSpatial())) continue;
      // 盟友正陷入争斗（持有复仇目标）才驰援，避免无差别奔走（无人陷战即不产出）。
      if (ally.state?.get('hasRevengeTarget') !== true) continue;
      if (here) {
        const dist = Math.abs(ally.spatial.tileX - here.x) + Math.abs(ally.spatial.tileY - here.y);
        if (dist > maxRange) continue;
      }
      consider({
        id: 'goal_assist_sect_mate',
        name: `驰援${ally.name || '同门'}`,
        targetId: ally.id,
        effectKey: 'assistedAlly',
        priority: assistPriority,
      });
      break; // 每类取最近/最强一个即可。
    }
  }

  // —— 报恩：对高强度 benefactor/gratitude 对象低频探望/施援 ——
  const repayCfg = cfg.repayBenefactor || {};
  const minBen = repayCfg.minBenefactorStrength ?? 40;
  const visitChance = repayCfg.visitChancePerTick ?? 0.02;
  const repayPriority = repayCfg.priority ?? 3;
  if (worldContext.rng.next() < visitChance) {
    for (const type of ['benefactor', 'gratitude']) {
      const top = rs.topEdgeOfType(entity.id, type);
      if (!top || top.strength < minBen) continue;
      const ben = registry.getById(top.toId);
      if (!ben || !ben.alive || ben.id === entity.id) continue;
      if (!(ben.hasSpatial && ben.hasSpatial())) continue;
      consider({
        id: 'goal_repay_benefactor',
        name: `探望${ben.name || '恩人'}`,
        targetId: ben.id,
        effectKey: 'visitedBenefactor',
        priority: repayPriority,
      });
    }
  }

  // —— 师徒互动（ADR-029 第三期）：传功/护徒/尽孝。复用同款单点锁定模式。 ——
  considerMasterDiscipleGoals(entity, consider, registry, here, worldContext.rng);

  if (!best) {
    entity.state.set('targetRelationshipId', null);
    return null;
  }
  entity.state.set('targetRelationshipId', best.targetId);
  return new Goal({
    id: best.id,
    name: best.name,
    source: GoalSource.RELATIONSHIP,
    sourceId: best.id,
    goalState: { [best.effectKey]: { op: 'eq', value: true } },
    priority: best.priority,
    urgency: 0,
    tag: 'relationship',
  });
}

/**
 * 师徒互动候选 Goal（ADR-029 第三期）：把传功/护徒/尽孝三类师徒行为纳入 consider。
 * 复用二期关系 Goal 单点锁定模式（写 targetRelationshipId，relationship_target 解析坐标）。
 * 无 qualifying master/disciple 边即不产出。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {(cand:Object)=>void} consider 候选收集器（取最高 priority）。
 * @param {Object} registry 实体注册表（getById）。
 * @param {?{x:number,y:number}} here 本 NPC 当前坐标。
 * @param {import('../abstract/rng.js').Rng} rng 确定性随机源。
 */
export function considerMasterDiscipleGoals(entity, consider, registry, here, rng) {
  const rs = entity._relationshipSystem;
  const mdCfg = entity._relationshipConfig.masterDiscipleGoals || {};
  const dist = (other) => here
    ? Math.abs(other.spatial.tileX - here.x) + Math.abs(other.spatial.tileY - here.y)
    : 0;

  // —— 师傅传功（护徒·点化）：对修为偏低的徒弟低频前往点化（给历练修为增量）——
  const teachCfg = mdCfg.teachDisciple || {};
  const teachChance = teachCfg.teachChancePerTick ?? 0.04;
  if (rng.next() < teachChance) {
    const minMasterStr = teachCfg.minMasterStrength ?? 40;
    const maxRange = teachCfg.maxTeachRange ?? 20;
    const maxProg = teachCfg.discipleMaxTotalProgress ?? 0.6;
    for (const edge of rs.edgesOfType(entity.id, 'master')) {
      if (edge.strength < minMasterStr) break; // 已按强度降序。
      const disciple = registry.getById(edge.toId);
      if (!disciple || !disciple.alive || disciple.id === entity.id) continue;
      if (!(disciple.hasSpatial && disciple.hasSpatial())) continue;
      const dProg = cultivationCompletionRatio(disciple);
      if (dProg >= maxProg) continue; // 徒弟修为已足，无需点化。
      if (here && dist(disciple) > maxRange) continue;
      consider({
        id: 'goal_teach_disciple',
        name: `点化${disciple.name || '徒儿'}`,
        targetId: disciple.id,
        effectKey: 'taughtDisciple',
        priority: teachCfg.priority ?? 7,
      });
      break;
    }
  }

  // —— 师傅护徒（驰援）：徒弟遭袭（持有复仇目标）时前往护卫 ——
  const protectCfg = mdCfg.protectDisciple || {};
  const minMasterStr2 = protectCfg.minMasterStrength ?? 40;
  const maxProtectRange = protectCfg.maxProtectRange ?? 24;
  for (const edge of rs.edgesOfType(entity.id, 'master')) {
    if (edge.strength < minMasterStr2) break;
    const disciple = registry.getById(edge.toId);
    if (!disciple || !disciple.alive || disciple.id === entity.id) continue;
    if (!(disciple.hasSpatial && disciple.hasSpatial())) continue;
    if (disciple.state?.get('hasRevengeTarget') !== true) continue; // 徒弟未陷战则不驰援。
    if (here && dist(disciple) > maxProtectRange) continue;
    consider({
      id: 'goal_protect_disciple',
      name: `护卫${disciple.name || '徒儿'}`,
      targetId: disciple.id,
      effectKey: 'protectedDisciple',
      priority: protectCfg.priority ?? 8,
    });
    break;
  }

  // —— 徒弟尽孝（探望）：对师傅低频探望/侍奉 ——
  const visitCfg = mdCfg.visitMaster || {};
  const visitChance = visitCfg.visitChancePerTick ?? 0.02;
  if (rng.next() < visitChance) {
    const minDiscipleStr = visitCfg.minDiscipleStrength ?? 40;
    const maxVisitRange = visitCfg.maxVisitRange ?? 30;
    const top = rs.topEdgeOfType(entity.id, 'disciple');
    if (top && top.strength >= minDiscipleStr) {
      const master = registry.getById(top.toId);
      if (master && master.alive && master.id !== entity.id
          && master.hasSpatial && master.hasSpatial()
          && (!here || dist(master) <= maxVisitRange)) {
        consider({
          id: 'goal_visit_master',
          name: `探望恩师${master.name || ''}`,
          targetId: master.id,
          effectKey: 'visitedMaster',
          priority: visitCfg.priority ?? 4,
        });
      }
    }
  }
}

/**
 * 夺舍图谋执念检查（ADR-029 第三期，轻度）：邪修倾向(低 justice+低 loyalty)的高境界师傅，
 * 对高资质徒弟生『夺舍』执念→复用复仇行为链(追踪→击杀)。在 onPreTick 关系感知触发，
 * 需读 master 边锁定徒弟为 targetId（区别于无目标的条件执念）。仅 goalsEnabled 时生效。
 * 已有 seizure 执念则跳过（ObsessionSystem.add 去重）。默认 chance 极低且需邪修+高资质徒弟，几乎不触发。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {Object} worldContext
 */
export function checkSeizeDiscipleObsession(entity, worldContext) {
  if (!relationshipGoalsEnabled(entity)) return;
  const cfg = entity._obsessionConfig.seizeDisciple;
  if (!cfg || cfg.enabled === false) return;
  if (entity.obsessions.has(cfg.type || 'seizure')) return;
  const personality = entity.staticData?.personality || {};
  if ((personality.justice ?? 100) > (cfg.maxJustice ?? 35)) return;
  if ((personality.loyalty ?? 100) > (cfg.maxLoyalty ?? 35)) return;
  if ((entity.state.get('roleRank') || 0) < (cfg.minMasterRoleRank ?? 3)) return;
  if (worldContext.rng.next() >= (cfg.chancePerTick ?? 0.004)) return;

  const registry = worldContext?.entityRegistry;
  if (!registry || typeof registry.getById !== 'function') return;
  const minProg = cfg.minDiscipleTotalProgress ?? 0.5;
  // 在徒弟中挑选数值修为完成度最高者作为夺舍目标。
  let victim = null;
  let bestProg = minProg;
  for (const edge of entity._relationshipSystem.edgesOfType(entity.id, 'master')) {
    const disciple = registry.getById(edge.toId);
    if (!disciple || !disciple.alive || disciple.id === entity.id) continue;
    const dProg = cultivationCompletionRatio(disciple);
    if (dProg > bestProg) { bestProg = dProg; victim = disciple; }
  }
  if (!victim) return;
  entity.obsessions.add(new Obsession({
    type: cfg.type || 'seizure',
    name: cfg.name || '夺舍图谋',
    intensity: cfg.intensity ?? 85,
    targetId: victim.id,
    goalState: cfg.goalState || { enemyKilled: { op: 'eq', value: true } },
  }));
}

/**
 * 依世界上下文为本 NPC 构造一个"前往机会点"的 Goal（ADR-024）。
 * 把选中的机会点 id 写入 state.targetOpportunityId，供 nearest_opportunity 解析坐标。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {Object} worldContext
 * @returns {import('../abstract/goal.js').Goal|null}
 */
export function buildOpportunityGoal(entity, worldContext) {
  if (typeof worldContext?.bestOpportunityFor !== 'function') return null;
  const pick = worldContext.bestOpportunityFor(entity);
  if (!pick) {
    entity.state.set('targetOpportunityId', null);
    return null;
  }
  entity.state.set('targetOpportunityId', pick.opp.id);
  const decision = worldContext.opportunitySystem?.decision || {};
  const priority = decision.goalPriority ?? 55;
  return new Goal({
    id: 'goal_opportunity',
    name: `逐${pick.opp.name}`,
    source: GoalSource.OPPORTUNITY,
    sourceId: 'opportunity',
    goalState: { arrivedAtOpportunity: { op: 'eq', value: true } },
    priority,
    urgency: 0,
    tag: 'opportunity',
  });
}
