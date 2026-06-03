/**
 * NPCLifecycleService —— NPC 生命周期逻辑（突破/死亡/继任，从 npc-entity.js 抽离）。
 *
 * 把境界突破与死亡继任收敛为纯函数（仿 npc-utility.js 范例），NPCEntity 仅保留一行转发：
 *   - tryBreakthrough     境界突破判定（总进度+真气达标→按成功率掷骰，含资质/功法/丹药/年龄修正）。
 *   - getBreakthroughRate 基础突破成功率（读 cultivation.json successRates，回退默认）。
 *   - handleDeath         死亡处理：掌门陨落触发继任。
 *   - triggerSuccession   按 social.json rolePriority + successionScore + 忠诚 + id 选继任者。
 *   - successionScoreOf   候选人继任分数（ranks.json successionScore，回退 order）。
 *
 * 全部以 entity 为首参，仅读写 entity 的 state/_cultivationConfig/_ranksData 与回调其自身方法
 * （refreshCultivationCapPreconditions/_rollBreakthroughPathOrder），不改变随机序列。
 * 拆分边界见 ADR-030。
 */
import { readTraitBreakthroughBonus, readTraitLifespanBonus } from './npc-traits.js';

/**
 * 境界突破判定。
 *
 * 突破条件：cultivationProgress >= 1.0 且 qi >= 目标境界 qiRequired。
 * 成功率基于目标境界递减，寿元接近上限时额外惩罚。
 * 成功后：消耗真气、更新 rankId/rankName、按新境界寿元延长寿命。
 * 失败后：回退修炼进度至 0.3，真气损失 30%。
 * @param {import('./npc-entity.js').NPCEntity} entity
 */
export function tryBreakthrough(entity) {
  // 突破以总进度为准：闭关进度(受境界 cultivationCap 上限)+ 游历感悟(insight)。
  const cultivationProgress = entity.state.get('cultivationProgress') || 0;
  const progress = cultivationProgress + (entity.state.get('insight') || 0);
  if (progress < 1.0) return;

  // 闭关进度至少占最低比例(minCultivationRatio，默认 0.3)才允许突破：
  // 防止纯靠游历感悟“速成”，确保根基（闭关）达标。见 ADR-017。
  const minCultivationRatio = entity._cultivationConfig.minCultivationRatio ?? 0.3;
  if (cultivationProgress < minCultivationRatio) return;

  const currentRankId = entity.state.get('rankId') || 'mortal';
  const ranks = entity._ranksData;
  if (!ranks || ranks.length === 0) return;

  const currentRank = ranks.find(r => r.id === currentRankId);
  if (!currentRank) return;

  const currentOrder = currentRank.order;
  const cultivationRanks = ranks
    .filter(r => r.category === 'cultivation')
    .sort((a, b) => a.order - b.order);

  const nextRank = cultivationRanks.find(r => r.order > currentOrder);
  if (!nextRank) return;

  const currentQi = entity.state.get('qi') || 0;
  const qiRequired = nextRank.qiRequired || 0;
  if (currentQi < qiRequired) return;

  const successRate = getBreakthroughRate(entity, currentRankId, nextRank.id);
  const breakthroughCfg = entity._cultivationConfig.breakthrough || {};

  // 先天资质突破加成：灵根 + 体质 breakthroughBonus 累加进基础成功率（ADR-012/042）。
  // 经 AttributeSet traitBreakthroughBonus 生效（开关关则回退直接读 config）。
  const talentBonus = readTraitBreakthroughBonus(entity);
  const techniqueBonus = entity.state.get('techniqueBreakthroughBonus') || 0;
  const aidBonus = entity.state.get('breakthroughAidBonus') || 0;

  const ageDays = entity.state.get('ageDays') || 0;
  const maxAgeDays = entity.state.get('maxAgeDays') || 1;
  const agePenaltyThreshold = breakthroughCfg.agePenaltyThreshold ?? 0.8;
  const agePenaltyMultiplier = breakthroughCfg.agePenaltyMultiplier ?? 0.7;
  const ageModifier = ageDays > maxAgeDays * agePenaltyThreshold ? agePenaltyMultiplier : 1.0;

  const baseRate = Math.max(0, Math.min(1, successRate + talentBonus + techniqueBonus + aidBonus));
  const finalRate = baseRate * ageModifier;
  const roll = entity._rng.next();
  if (aidBonus !== 0) entity.state.set('breakthroughAidBonus', 0);

  if (roll < finalRate) {
    entity.state.set('rankId', nextRank.id);
    entity.state.set('rankName', nextRank.name);
    entity.state.set('cultivationProgress', 0);
    entity.state.set('insight', 0);
    entity.state.set('qi', currentQi - qiRequired);

    const lifespan = nextRank.lifespan;
    if (lifespan) {
      const variance = (entity._rng.next() - 0.5) * 2 * lifespan.varianceYears;
      // 体质寿元加成：先天道体等特殊体质额外延长寿元（ADR-012/042，经 AttributeSet traitLifespanBonus）。
      const physiqueLifeBonus = readTraitLifespanBonus(entity);
      const newMaxAgeYears = (lifespan.baseYears + variance) * (1 + physiqueLifeBonus);
      const newMaxAgeDays = Math.floor(newMaxAgeYears * 360);
      if (newMaxAgeDays > maxAgeDays) {
        entity.state.set('maxAgeDays', newMaxAgeDays);
        entity.state.set('maxAgeYears', Math.floor(newMaxAgeYears));
        entity.state.set('lifeRatio', ageDays / newMaxAgeDays);
      }
    }

    // 境界提升后血量大增：重算 maxHp（抬上限，默认不回满）。
    if (typeof entity.refreshMaxHpOnBreakthrough === 'function') {
      entity.refreshMaxHpOnBreakthrough();
    }
    // 破境回元（ADR-042 阶段2）：持 Trait.BreakthroughFullHeal Tag 的实体（特殊功法/体质授予）
    // 突破成功时回满血。默认无 NPC 持该 Tag → 不触发。
    if (typeof entity.tryBreakthroughFullHeal === 'function') {
      entity.tryBreakthroughFullHeal();
    }
    // 境界提升后，闭关 cap 随之变化（通常更低，更依赖游历），刷新行为前置。
    entity.refreshCultivationCapPreconditions();
    // 新境界开始：随机本境界的游历/闭关先后偏好（顺序随机，ADR-017）。
    entity._rollBreakthroughPathOrder();

    entity._breakthroughInfo = {
      npcId: entity.id,
      npcName: entity.name,
      fromRank: currentRank.name,
      toRank: nextRank.name,
      success: true,
      qiConsumed: qiRequired,
      aidBonus,
    };
  } else {
    const failureProgress = breakthroughCfg.failureProgressReset ?? 0.3;
    const failureQiRetention = breakthroughCfg.failureQiRetention ?? 0.7;
    // 突破失败：闭关进度回退、游历感悟清零（机缘已逝），真气损失。
    // failureProgress 不应超过当前境界 cultivationCap，避免回退值反而高于闭关上限。
    const capMap = entity._cultivationConfig.cultivationCap || {};
    const cap = capMap[currentRankId] ?? 1.0;
    entity.state.set('cultivationProgress', Math.min(failureProgress, cap));
    entity.state.set('insight', 0);
    entity.state.set('qi', Math.floor(currentQi * failureQiRetention));
    entity._breakthroughInfo = {
      npcId: entity.id,
      npcName: entity.name,
      fromRank: currentRank.name,
      targetRank: nextRank.name,
      success: false,
      qiLost: Math.floor(currentQi * (1 - failureQiRetention)),
      aidBonus,
    };
  }
}

/**
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @returns {number} 基础突破成功率
 * 优先读取 cultivationConfig.breakthrough.successRates，回退到内置默认值。
 */
export function getBreakthroughRate(entity, fromRankId, toRankId) {
  const breakthroughCfg = entity._cultivationConfig.breakthrough || {};
  const rateMap = breakthroughCfg.successRates || {
    'mortal_to_qi_refining': 0.80,
    'qi_refining_to_foundation_building': 0.60,
    'foundation_building_to_golden_core': 0.40,
    'golden_core_to_nascent_soul': 0.25,
    'nascent_soul_to_spirit_transformation': 0.15,
  };
  const key = `${fromRankId}_to_${toRankId}`;
  return rateMap[key] ?? (breakthroughCfg.defaultRate ?? 0.10);
}

/**
 * 死亡处理：掌门陨落时触发继任。
 * @param {import('./npc-entity.js').NPCEntity} entity
 * @param {Object} worldContext
 */
export function handleDeath(entity, worldContext) {
  const factionId = entity.state.get('factionId');
  const role = entity.state.get('currentRole');

  if (role === 'leader' && factionId && worldContext.entityRegistry) {
    triggerSuccession(entity, factionId, worldContext);
  }
}

/**
 * 触发掌门继任：按 social.json rolePriority + successionScore + 忠诚 + id 字典序择优。
 * 无合格继任者则势力覆灭。
 * @param {import('./npc-entity.js').NPCEntity} entity 陨落的掌门
 * @param {string} factionId
 * @param {Object} worldContext
 */
export function triggerSuccession(entity, factionId, worldContext) {
  const registry = worldContext.entityRegistry;
  const npcs = registry.getAliveByType('npc');
  const candidates = npcs.filter(n =>
    n.state.get('factionId') === factionId && n.id !== entity.id
  );

  // 数据驱动的继任优先级（来自 social.json）；缺省与 Wiki 一致。
  const rolePriority = worldContext.balanceConfig?.social?.succession?.rolePriority
    || ['heir', 'elder', 'general', 'officer', 'core_disciple'];

  let successor = null;
  for (const role of rolePriority) {
    const roleCandidates = candidates.filter(n => n.state.get('currentRole') === role);
    if (roleCandidates.length > 0) {
      // 同一职位优先级内：先比 ranks.json 的 successionScore（境界越高/职分越重越优先），
      // 再比 personality.loyalty（忠诚），最后用 id 字典序兜底保证可复现。与 wiki/rules/leader-succession.md 一致。
      roleCandidates.sort((a, b) => {
        const sa = successionScoreOf(entity, a);
        const sb = successionScoreOf(entity, b);
        if (sb !== sa) return sb - sa;
        const la = a.staticData?.personality?.loyalty ?? 0;
        const lb = b.staticData?.personality?.loyalty ?? 0;
        if (lb !== la) return lb - la;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
      successor = roleCandidates[0];
      break;
    }
  }

  const faction = registry.getById(factionId);
  if (!faction) return;

  if (successor) {
    successor.state.set('currentRole', 'leader');
    successor.state.set('isLeader', true);
    successor.state.set('isElder', false);
    successor.state.set('roleRank', 6);
    faction.state.set('leaderNpcId', successor.id);
  } else {
    faction.state.set('isDestroyed', true);
    faction.alive = false;
    faction.state.set('stability', 0);
  }
}

/**
 * 取候选人的继任分数：优先 ranks.json 的 successionScore（按 rankId），回退到 rank.order。
 * @param {import('./npc-entity.js').NPCEntity} entity 提供 _ranksData 的上下文实体
 * @param {Object} npc 候选人
 * @returns {number}
 */
export function successionScoreOf(entity, npc) {
  const rankId = npc.state.get('rankId');
  const rank = entity._ranksData.find(r => r.id === rankId);
  if (!rank) return 0;
  return rank.successionScore ?? rank.order ?? 0;
}
