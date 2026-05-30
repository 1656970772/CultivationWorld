/**
 * NPCActions - NPC 行为执行器
 *
 * 修炼参数来自 data/balance/cultivation.json（通过 worldContext.balanceConfig.cultivation 传入）。
 */
import { ActionExecutor } from '../abstract/action.js';
import { ActionPool } from '../pools/action-pool.js';
import { ItemRegistry } from '../items/item-registry.js';

function getCultivationConfig(worldContext) {
  return worldContext.balanceConfig?.cultivation || {};
}

function getRiskConfig(worldContext) {
  return worldContext.balanceConfig?.risk || {};
}

/** 按 [{weight}] 列表做加权随机，返回选中项（无有效权重返回首项/null） */
function weightedPickFrom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const total = list.reduce((s, e) => s + (e.weight || 0), 0);
  if (total <= 0) return list[0];
  let roll = Math.random() * total;
  for (const e of list) {
    roll -= (e.weight || 0);
    if (roll < 0) return e;
  }
  return list[list.length - 1];
}

/**
 * 性格对某风险分项触发概率的加成（绝对值叠加）。数据驱动：见 risk.json 的 personalityModifiers。
 * 加成量 = (trait - minThreshold) / (100 - minThreshold) × maxChanceBoost，trait<阈值则为 0。
 * @returns {number} 概率增量（>=0）
 */
function personalityRiskBoost(entity, modifiers) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return 0;
  const personality = entity.staticData?.personality || {};
  let boost = 0;
  for (const mod of modifiers) {
    const traitVal = personality[mod.trait] ?? 50;
    const minT = mod.minThreshold ?? 0;
    if (traitVal < minT) continue;
    const denom = Math.max(1, 100 - minT);
    boost += ((traitVal - minT) / denom) * (mod.maxChanceBoost ?? 0);
  }
  return boost;
}

/**
 * 结算某行为的风险分项（数据驱动，见 risk.json）。逐项独立 roll，命中则施加效果。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {Object} worldContext
 * @param {string} actionKey risk.json 下的行为键（如 'explore'）
 * @returns {{ triggered: Array, died: boolean, totalRiskPct: number }}
 */
function settleRisk(entity, worldContext, actionKey) {
  const riskCfg = getRiskConfig(worldContext);
  const cfg = riskCfg[actionKey];
  const out = { triggered: [], died: false, totalRiskPct: 0 };
  if (!cfg || !Array.isArray(cfg.items)) return out;

  const rankId = entity.state.get('rankId') || 'mortal';
  const rankMitigation = (cfg.rankMitigation && cfg.rankMitigation[rankId]) ?? 1.0;

  for (const item of cfg.items) {
    const baseChance = item.baseChance ?? 0;
    out.totalRiskPct += baseChance;
    if (baseChance <= 0 && (!item.personalityModifiers || item.personalityModifiers.length === 0)) continue;

    let chance = baseChance + personalityRiskBoost(entity, item.personalityModifiers);
    if (item.appliesRankMitigation) chance *= rankMitigation;
    chance = Math.max(0, Math.min(1, chance));
    if (chance <= 0) continue;

    if (Math.random() < chance) {
      const applied = applyRiskEffect(entity, item.effect, item.name);
      out.triggered.push(applied);
      if (applied.died) out.died = true;
    }
  }
  return out;
}

/** 施加单个风险效果。返回结算描述。 */
function applyRiskEffect(entity, effect, riskName) {
  if (!effect) return { risk: riskName, type: 'none' };
  switch (effect.type) {
    case 'injury': {
      const amt = (effect.amountMin ?? 1)
        + Math.floor(Math.random() * ((effect.amountMax ?? 1) - (effect.amountMin ?? 1) + 1));
      entity.state.set('injuryLevel', (entity.state.get('injuryLevel') || 0) + amt);
      return { risk: riskName, type: 'injury', amount: amt };
    }
    case 'resource_loss': {
      const itemId = effect.itemId || 'low_spirit_stone';
      const have = entity.inventory.getAmount(itemId) || 0;
      const ratio = (effect.lossRatioMin ?? 0)
        + Math.random() * ((effect.lossRatioMax ?? 0) - (effect.lossRatioMin ?? 0));
      const lost = Math.floor(have * ratio);
      if (lost > 0) entity.inventory.remove(itemId, lost);
      return { risk: riskName, type: 'resource_loss', itemId, amount: lost };
    }
    case 'morale_loss': {
      const amt = (effect.amountMin ?? 0)
        + Math.floor(Math.random() * ((effect.amountMax ?? 0) - (effect.amountMin ?? 0) + 1));
      entity.state.set('morale', Math.max(0, (entity.state.get('morale') || 0) - amt));
      return { risk: riskName, type: 'morale_loss', amount: amt };
    }
    case 'death': {
      entity.state.set('alive', false);
      entity.alive = false;
      entity._deathInfo = {
        cause: effect.cause || 'explore',
        npcId: entity.id,
        npcName: entity.name,
        factionId: entity.state.get('factionId'),
        ageYears: entity.state.get('ageYears'),
        maxAgeYears: entity.state.get('maxAgeYears'),
        rankName: entity.state.get('rankName'),
      };
      return { risk: riskName, type: 'death', died: true };
    }
    default:
      return { risk: riskName, type: effect.type || 'unknown' };
  }
}

/**
 * 风险效果的“严重度”权重：把不同类型的风险折算成统一损失量纲（0~1 量级），
 * 供 estimateRiskCost 计算期望损失。death 最重，资源/士气损失较轻。可后续按需调参。
 */
const RISK_SEVERITY = {
  death: 1.0,
  injury: 0.25,
  resource_loss: 0.1,
  morale_loss: 0.05,
};

/**
 * 估算某行为的【期望风险损失】（不 roll，用期望值）。复用 risk.json 分项与性格加成，
 * 与 settleRisk 同一套触发概率公式，但取 Σ(chance × severity) 而非掷骰，保证规划期可重复。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {Object} worldContext
 * @param {?string} riskKey risk.json 下的行为键（如 'explore'）；空/缺失视为无风险返回 0
 * @returns {number} 期望损失（>=0，通常 0~1 量级）
 */
export function estimateRiskCost(entity, worldContext, riskKey) {
  if (!riskKey) return 0;
  const riskCfg = getRiskConfig(worldContext);
  const cfg = riskCfg[riskKey];
  if (!cfg || !Array.isArray(cfg.items)) return 0;

  const rankId = entity.state.get('rankId') || 'mortal';
  const rankMitigation = (cfg.rankMitigation && cfg.rankMitigation[rankId]) ?? 1.0;

  let expected = 0;
  for (const item of cfg.items) {
    const baseChance = item.baseChance ?? 0;
    let chance = baseChance + personalityRiskBoost(entity, item.personalityModifiers);
    if (item.appliesRankMitigation) chance *= rankMitigation;
    chance = Math.max(0, Math.min(1, chance));
    if (chance <= 0) continue;
    const severity = RISK_SEVERITY[item.effect?.type] ?? 0.1;
    expected += chance * severity;
  }
  return expected;
}

/**
 * 计算某行为的【价值】。当前 = 行为基础价值 action.valueScore +（命中上头时）headstrongBonus。
 * 道具期望价值预留（待道具产出系统落地后接入，见 ADR-017 / resources.json 的 value 字段）。
 * @param {import('../abstract/base-entity.js').BaseEntity} entity
 * @param {Object} worldContext
 * @param {import('../abstract/action.js').Action} action
 * @param {Object} [opts]
 * @param {boolean} [opts.headstrong=false] 本次决策该行为是否命中“上头”
 * @param {number} [opts.headstrongBonus=0] 上头命中时注入的价值加成
 * @returns {number}
 */
export function computeActionValue(entity, worldContext, action, opts = {}) {
  const base = action?.valueScore ?? 0;
  // TODO(道具产出系统): 累加 action 预期产出道具的 resources.json value 期望值。
  let value = base;
  if (opts.headstrong) value += (opts.headstrongBonus ?? 0);
  return value;
}

/**
 * 返回行为的纯路径代价（GOAP step cost，ADR-021 重构后职责）。
 *
 * 职责收窄：GOAP 只负责「如何实现目标」（HOW），step cost 仅反映路径长度/消耗，
 * 不再包含风险、价值、上头、路径偏好等目标选择因素——这些均已迁移至 Utility 选目标层
 * （见 npc-utility.js decorateGoalConsiderations，ADR-021）。
 *
 * 参数保留向后兼容签名（entity/worldContext/perDecisionCtx），但实际仅读取 costFloor，
 * 供外部工具/测试代码无需修改调用方式。
 *
 * @param {import('../abstract/base-entity.js').BaseEntity} _entity
 * @param {Object} _worldContext
 * @param {import('../abstract/action.js').Action} action
 * @param {Object} [perDecisionCtx] 仅读取 perDecisionCtx.decisionConfig.costFloor
 * @returns {number} 基础路径代价（>= costFloor）
 */
export function computeDecisionCost(_entity, _worldContext, action, perDecisionCtx = {}) {
  const dc = perDecisionCtx.decisionConfig || {};
  const costFloor = dc.costFloor ?? 0.1;

  const base = typeof action.getPlanCost === 'function'
    ? action.getPlanCost()
    : ((action.weight ?? 1) + Math.max(0, (action.duration ?? 1) - 1));

  return Math.max(costFloor, base);
}

export class NPCCultivateExecutor extends ActionExecutor {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.extraSpeedMultiplier=1.0] 额外修炼速度倍率（如修炼场加成）
   * @param {string} [opts.descriptionPrefix='闭关修炼'] 描述前缀
   */
  run(entity, worldContext, action, opts = {}) {
    const extraSpeedMultiplier = opts.extraSpeedMultiplier ?? 1.0;
    const descriptionPrefix = opts.descriptionPrefix ?? '闭关修炼';
    const cult = getCultivationConfig(worldContext);
    const speedMap = cult.cultivationSpeed || {};
    const stoneMap = cult.spiritStoneCost || {};
    const qiMap = cult.qiBaseGain || {};
    const variance = cult.speedVariance || { min: 0.7, max: 1.3 };
    const companionBonus = cult.daoCompanionBonus || {};

    const rankId = entity.state.get('rankId') || 'mortal';
    const baseSpeed = speedMap[rankId] ?? 0.002;
    let speedMultiplier = (variance.min + Math.random() * (variance.max - variance.min)) * extraSpeedMultiplier;

    // 功法加成：读取 techniqueId → 查 techniqueRegistry → 应用 cultivationSpeedMultiplier
    const techniqueId = entity.state.get('techniqueId');
    let techniqueBreakthroughBonus = 0;
    let techniqueLifespanEffect = 0;
    if (techniqueId && worldContext.techniqueRegistry) {
      const technique = worldContext.techniqueRegistry.get(techniqueId);
      if (technique && technique.effects) {
        speedMultiplier *= technique.effects.cultivationSpeedMultiplier ?? 1.0;
        techniqueBreakthroughBonus = technique.effects.breakthroughBonus ?? 0;
        techniqueLifespanEffect = technique.effects.lifespanBonus ?? 0;
      }
    }

    // 先天资质加成：灵根(资质)与体质 speedMultiplier 连乘进修炼速度（详见 ADR-012）
    const rootGrade = cult.spiritRoot?.grades?.[entity.state.get('spiritRootId')];
    if (rootGrade) speedMultiplier *= rootGrade.speedMultiplier ?? 1.0;
    const physiqueType = cult.physique?.types?.[entity.state.get('physiqueId')];
    if (physiqueType) speedMultiplier *= physiqueType.speedMultiplier ?? 1.0;

    // duration 代表本次闭关天数：进度/真气按天累计（speed 为"每天"语义）
    const days = Math.max(1, action?.duration ?? 1);
    const speed = baseSpeed * speedMultiplier;
    const progressGain = speed * days;

    // 闭关进度边际递减但可到顶（ADR-017）：
    //   有效增量 = 基础增量 × e^(-k × current/cap)。越接近 cap 增量越小，但永不为 0，
    //   故能缓慢逼近/到顶；仍夹 cap 防数值溢出。撞顶后剩余进度靠游历感悟(insight)补足。
    const capMap = cult.cultivationCap || {};
    const cap = capMap[rankId] ?? 1.0;
    const decayK = cult.cultivationDecayK ?? 2.5;
    const current = entity.state.get('cultivationProgress') || 0;
    const decayFactor = Math.exp(-decayK * Math.min(1, current / Math.max(cap, 1e-6)));
    const effectiveGain = progressGain * decayFactor;
    entity.state.set('cultivationProgress', Math.min(current + effectiveGain, cap));

    // 功法寿元影响（负值为消耗，正值为延长，每次修炼小幅触发）
    if (techniqueLifespanEffect !== 0) {
      const daysPerYear = 360;
      const lifeDelta = Math.round((techniqueLifespanEffect / 365) * daysPerYear * 0.01);
      if (lifeDelta !== 0) {
        const maxAgeDays = entity.state.get('maxAgeDays') || 1;
        const newMax = Math.max(1, maxAgeDays + lifeDelta);
        entity.state.set('maxAgeDays', newMax);
        const ageDays = entity.state.get('ageDays') || 0;
        entity.state.set('lifeRatio', ageDays / newMax);
      }
    }

    // 灵石消耗按天累计（闭关 N 天消耗 N 天的灵石）
    const stoneCost = (stoneMap[rankId] ?? 1) * days;
    const available = entity.inventory.getAmount('low_spirit_stone') || 0;
    const consumed = Math.min(stoneCost, available);
    if (consumed > 0) {
      entity.inventory.remove('low_spirit_stone', consumed);
    }

    const baseQi = (qiMap[rankId] ?? 0.5) * days;
    const stoneQi = consumed;
    let qiGain = baseQi + stoneQi;

    const companionId = entity.state.get('daoCompanionId');
    let companionBonusApplied = false;
    if (companionId) {
      const companion = worldContext.entityRegistry?.getById(companionId);
      if (companion && companion.alive) {
        const qiMultiplier = companionBonus.qiMultiplier ?? 1.2;
        const progressBonus = companionBonus.progressBonus ?? 0.2;
        qiGain *= qiMultiplier;
        // 道侣双修叠加功法的 dual_cultivation_bonus
        let dualBonus = progressBonus;
        if (techniqueId && worldContext.techniqueRegistry) {
          const technique = worldContext.techniqueRegistry.get(techniqueId);
          const dualEffect = technique?.effects?.specialEffects?.find(
            e => e.type === 'dual_cultivation_bonus'
          );
          if (dualEffect) dualBonus *= dualEffect.value;
        }
        // 道侣双修额外进度同样走边际递减：以当前(已含本次基础增量)进度计算衰减。
        const curWithBase = entity.state.get('cultivationProgress') || 0;
        const dualDecay = Math.exp(-decayK * Math.min(1, curWithBase / Math.max(cap, 1e-6)));
        entity.state.set('cultivationProgress',
          Math.min(curWithBase + speed * days * dualBonus * dualDecay, cap));
        companionBonusApplied = true;
      }
    }

    const currentQi = entity.state.get('qi') || 0;
    entity.state.set('qi', currentQi + qiGain);

    // 将功法突破加成写入 state，供 _tryBreakthrough 使用
    entity.state.set('techniqueBreakthroughBonus', techniqueBreakthroughBonus);

    return {
      success: true,
      progress: entity.state.get('cultivationProgress'),
      speed,
      qiGain,
      qi: currentQi + qiGain,
      stoneConsumed: consumed,
      techniqueId: techniqueId || null,
      techniqueBreakthroughBonus,
      description: `${entity.staticData.name} ${descriptionPrefix}，消耗${consumed}灵石，真气+${qiGain.toFixed(1)}`,
    };
  }
}

/**
 * 赴修炼场修炼：消耗门派贡献点，换取修炼速度加成。
 * 复用 NPCCultivateExecutor 的核心修炼逻辑（单一职责 + 开闭），仅注入速度倍率并扣减贡献。
 * 贡献不足由行为 preconditions 拦截（GOAP 不会规划本行为），此处兜底再校验一次。
 */
export class NPCTrainChamberExecutor extends NPCCultivateExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const chamberCfg = cult.actions?.trainChamber || {};
    const contributionCost = chamberCfg.contributionCost ?? 10;
    const speedBonus = chamberCfg.speedBonusMultiplier ?? 1.25;

    const contribution = entity.state.get('contribution') || 0;
    if (contribution < contributionCost) {
      // 贡献不足：兜底回退为普通闭关（不扣贡献、无加成）
      return super.run(entity, worldContext, action);
    }

    entity.state.set('contribution', contribution - contributionCost);

    const result = super.run(entity, worldContext, action, {
      extraSpeedMultiplier: speedBonus,
      descriptionPrefix: `入修炼场加速修炼（消耗${contributionCost}贡献）`,
    });
    return {
      ...result,
      contributionSpent: contributionCost,
      speedBonusMultiplier: speedBonus,
    };
  }
}

export class NPCServeFactionExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    entity.state.set('dutyFulfilled', true);
    const factionId = entity.state.get('factionId');
    let adminBonus = false;
    if (factionId) {
      const faction = worldContext.entityRegistry?.getById(factionId);
      if (faction && faction.alive) {
        const role = entity.state.get('currentRole');
        if (role === 'leader') {
          const cult = getCultivationConfig(worldContext);
          const serveCfg = cult.actions?.serveFaction || {};
          faction.inventory.add('low_spirit_stone', serveCfg.leaderStoneBonus ?? 10);
          faction.inventory.add('food', serveCfg.leaderFoodBonus ?? 10);

          // 行政中枢加成：掌门在主殿坐镇履职，额外提升宗门稳定度与资源产出
          if (this._atMainHall(entity, worldContext, factionId)) {
            adminBonus = true;
            const stoneAdmin = serveCfg.mainHallStoneBonus ?? 15;
            const foodAdmin = serveCfg.mainHallFoodBonus ?? 10;
            const stabAdmin = serveCfg.mainHallStabilityBonus ?? 2;
            faction.inventory.add('low_spirit_stone', stoneAdmin);
            faction.inventory.add('food', foodAdmin);
            const stability = faction.state.get('stability') || 0;
            faction.state.set('stability', Math.min(stability + stabAdmin, 100));
          }
        }
      }
    }
    const role = entity.state.get('currentRole');
    const desc = adminBonus
      ? `${entity.staticData.name} 在主殿坐镇理政，宗门运转更趋稳固`
      : `${entity.staticData.name} 履行了 ${role} 的职责`;
    return { description: desc, adminBonus };
  }

  /** 判断 NPC 当前是否身处本势力主殿所在格（含相邻） */
  _atMainHall(entity, worldContext, factionId) {
    const sp = entity.spatial;
    if (!sp || !worldContext.getFactionBuilding) return false;
    const hall = worldContext.getFactionBuilding(factionId, 'main_hall');
    if (!hall) return false;
    return Math.abs(sp.tileX - hall.x) <= 1 && Math.abs(sp.tileY - hall.y) <= 1;
  }
}

export class NPCSeekElixirExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const elixirCfg = cult.actions?.seekElixir || {};
    const successRate = elixirCfg.successRate ?? 0.1;
    const extensionRatio = elixirCfg.lifespanExtensionRatio ?? 0.1;

    const success = Math.random() < successRate;
    if (success) {
      const maxAgeDays = entity.state.get('maxAgeDays') || 1;
      const extension = Math.floor(maxAgeDays * extensionRatio);
      entity.state.set('maxAgeDays', maxAgeDays + extension);
      const ageDays = entity.state.get('ageDays') || 0;
      entity.state.set('lifeRatio', ageDays / (maxAgeDays + extension));
      return { success: true, description: `${entity.staticData.name} 找到了续命丹药，寿元延长` };
    }
    return { success: false, description: `${entity.staticData.name} 寻找续命丹药失败` };
  }
}

export class NPCChallengeExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const challengeCfg = cult.actions?.challenge || {};
    const successRate = challengeCfg.successRate ?? 0.2;

    const success = Math.random() < successRate;
    if (success) {
      // 挑战上位 = 弹性晋升通道：沿职位阶梯实际晋升一级。晋入稀缺顶层（elder/heir）时由引擎按
      // "有空缺直接补位 / 满员挑战现任、成功现任降一级"结算（见 TickManager.promoteByLadder）。
      if (typeof worldContext.promoteByLadder === 'function') {
        const r = worldContext.promoteByLadder(entity.id);
        if (r && r.promoted) {
          const via = r.viaChallenge ? '击败现任' : '补位';
          return {
            success: true, fromRole: r.fromRole, toRole: r.promoted, viaChallenge: r.viaChallenge,
            description: `${entity.staticData.name} 挑战上位成功（${via}），晋升为 ${r.promoted}`,
          };
        }
        return { success: false, description: `${entity.staticData.name} 挑战未果（顶端/满员且不敌现任）` };
      }
      return { success: false, description: `${entity.staticData.name} 挑战上位失败（缺少世界上下文）` };
    }
    return { success: false, description: `${entity.staticData.name} 挑战上位失败` };
  }
}

export class NPCAssistFactionExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const factionId = entity.state.get('factionId');
    if (!factionId) return { success: false };

    const faction = worldContext.entityRegistry?.getById(factionId);
    if (!faction || !faction.alive) return { success: false };

    const cult = getCultivationConfig(worldContext);
    const assistCfg = cult.actions?.assistFaction || {};
    const stoneBonusPerContribution = assistCfg.stoneBonusPerContribution ?? 5;
    const stabilityBonusPerContribution = assistCfg.stabilityBonusPerContribution ?? 0.5;

    const rankId = entity.state.get('rankId') || 'mortal';
    const ranks = entity._ranksData || [];
    const rank = ranks.find(r => r.id === rankId);
    const rankOrder = rank ? rank.order : 0;
    const contribution = Math.floor(rankOrder / 10) + 1;

    faction.inventory.add('low_spirit_stone', contribution * stoneBonusPerContribution);
    const stability = faction.state.get('stability') || 0;
    faction.state.set('stability', Math.min(stability + contribution * stabilityBonusPerContribution, 100));

    entity.state.set('dutyFulfilled', true);
    return {
      success: true,
      contribution,
      description: `${entity.staticData.name} 辅助势力发展，贡献 ${contribution * stoneBonusPerContribution} 灵石`,
    };
  }
}

/**
 * 游历历练：外出大世界寻机缘。归来时
 *   ① 按机缘事件表(cultivation.actions.explore.fortuneEvents)加权 roll 一次，产出 insight + 真气；
 *   ② 按 risk.json 的 explore 分项逐项结算风险（受伤/资源掉落/陨落，含性格加成）。
 * insight 并入突破总进度(totalProgress)，是闭关撞 cultivationCap 上限后唯一能继续推进突破的途径。
 * 机缘/夺宝/洞天福地等事件目前仅产出 insight/qi，预留后续扩展（法宝、材料、修炼加速 buff）。详见 ADR-016。
 */
export class NPCExploreExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const exploreCfg = cult.actions?.explore || {};
    const insightMin = exploreCfg.insightMin ?? 0.01;
    const insightMax = exploreCfg.insightMax ?? 0.03;
    const qiMin = exploreCfg.fortuneQiMin ?? 5;
    const qiMax = exploreCfg.fortuneQiMax ?? 20;
    const events = exploreCfg.fortuneEvents || [];

    const event = weightedPickFrom(events) || { id: 'normal', name: '游历归来', insightMultiplier: 1.0, qiMultiplier: 1.0 };

    const baseInsight = insightMin + Math.random() * (insightMax - insightMin);
    const insightGain = baseInsight * (event.insightMultiplier ?? 1.0);
    const currentInsight = entity.state.get('insight') || 0;
    // insight 封顶 (1 - minCultivationRatio)：保证突破总进度中闭关至少占 minCultivationRatio，
    // 游历感悟最多补足其余部分（默认最多 70%）。见 ADR-017。
    const minCultivationRatio = cult.minCultivationRatio ?? 0.3;
    const insightCap = 1 - minCultivationRatio;
    const newInsight = Math.min(currentInsight + insightGain, insightCap);
    const appliedInsightGain = newInsight - currentInsight;
    entity.state.set('insight', newInsight);

    const baseQi = qiMin + Math.floor(Math.random() * (qiMax - qiMin + 1));
    const qiGain = Math.round(baseQi * (event.qiMultiplier ?? 1.0));
    if (qiGain > 0) {
      entity.state.set('qi', (entity.state.get('qi') || 0) + qiGain);
    }

    // 风险结算（数据驱动）。若触发死亡，提前返回（_deathInfo 已由 applyRiskEffect 写入）。
    const risk = settleRisk(entity, worldContext, 'explore');
    if (risk.died) {
      return {
        success: false,
        outcome: 'death',
        fortuneEvent: event.id,
        riskTriggered: risk.triggered,
        description: `${entity.staticData.name} 在游历途中遭遇不测，陨落于大世界`,
      };
    }

    const riskNote = risk.triggered.length > 0
      ? `，但${risk.triggered.map(r => r.risk).join('、')}`
      : '';
    return {
      success: true,
      outcome: 'fortune',
      fortuneEvent: event.id,
      fortuneEventName: event.name,
      insightGain: Number(appliedInsightGain.toFixed(4)),
      qiGain,
      totalRiskPct: Number(risk.totalRiskPct.toFixed(3)),
      riskTriggered: risk.triggered,
      description: `${entity.staticData.name} 游历归来：${event.name}，感悟+${appliedInsightGain.toFixed(3)}、真气+${qiGain}${riskNote}`,
    };
  }
}

export class NPCAcceptQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const questTemplates = worldContext.questTemplates;
    if (!questTemplates) {
      return { success: false, description: '任务系统未初始化' };
    }

    const cult = getCultivationConfig(worldContext);
    const rankMaxDifficulty = cult.rankMaxDifficulty || {};

    const rankId = entity.state.get('rankId') || 'mortal';
    const maxDiff = rankMaxDifficulty[rankId] ?? 2;

    const { difficulties, questTypes, randomQuestSpawnChance } = questTemplates;

    const available = [];
    for (const qt of questTypes) {
      const [minD, maxD] = qt.difficultyRange;
      const effectiveMax = Math.min(maxD, maxDiff);
      if (minD > effectiveMax) continue;

      if (qt.repeatable) {
        for (let d = minD; d <= effectiveMax; d++) {
          available.push({ quest: qt, difficulty: d });
        }
      } else {
        for (let d = minD; d <= effectiveMax; d++) {
          const chance = randomQuestSpawnChance[String(d)] || 0.5;
          if (Math.random() < chance) {
            available.push({ quest: qt, difficulty: d });
          }
        }
      }
    }

    if (available.length === 0) {
      return { success: false, description: `${entity.name} 没有可接取的任务` };
    }

    const picked = available[Math.floor(Math.random() * available.length)];
    const diffInfo = difficulties.find(d => d.level === picked.difficulty);

    entity.state.set('hasActiveQuest', true);
    entity.state.set('activeQuestTypeId', picked.quest.id);
    entity.state.set('activeQuestTypeName', picked.quest.name);
    entity.state.set('activeQuestDifficulty', picked.difficulty);
    entity.state.set('activeQuestDiffName', diffInfo?.name || '');
    entity.state.set('questDaysRemaining', diffInfo?.durationDays || 1);
    entity.state.set('questComplete', false);

    // 锁定任务发生地（固定坐标），弟子做任务时需先走过去
    let questLoc = null;
    if (typeof worldContext.resolveQuestLocation === 'function') {
      questLoc = worldContext.resolveQuestLocation(entity, picked.quest);
    }
    if (questLoc && typeof questLoc.x === 'number') {
      entity.state.set('questTargetX', questLoc.x);
      entity.state.set('questTargetY', questLoc.y);
    } else {
      entity.state.set('questTargetX', null);
      entity.state.set('questTargetY', null);
    }

    const dist = (questLoc && entity.spatial)
      ? Math.abs(questLoc.x - entity.spatial.tileX) + Math.abs(questLoc.y - entity.spatial.tileY)
      : 0;

    return {
      success: true,
      questType: picked.quest.name,
      difficulty: picked.difficulty,
      difficultyName: diffInfo?.name,
      questTarget: questLoc,
      questDistance: dist,
      description: `${entity.name} 接取了${diffInfo?.name}${picked.quest.name}任务${dist > 0 ? `（地点距 ${dist} 格）` : ''}`,
    };
  }
}

export class NPCDoQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const questTemplates = worldContext.questTemplates;
    const difficulty = entity.state.get('activeQuestDifficulty') || 1;
    const questName = entity.state.get('activeQuestTypeName') || '任务';
    const diffName = entity.state.get('activeQuestDiffName') || '';
    const daysLeft = entity.state.get('questDaysRemaining') || 1;

    const diffInfo = questTemplates?.difficulties?.find(d => d.level === difficulty);
    // dangerInjury/dangerDeath 是【整段任务】的总风险；任务按天推进（每天一次 do_quest），
    // 故把总风险摊到每天，使整段累计风险≈配置值，避免长任务因逐日掷骰累计成必死。
    const totalDays = Math.max(1, diffInfo?.durationDays || 1);
    const dangerInjury = (diffInfo?.dangerInjury || 0.05) / totalDays;
    const dangerDeath = (diffInfo?.dangerDeath || 0) / totalDays;

    const roll = Math.random();
    if (roll < dangerDeath) {
      entity.state.set('alive', false);
      entity.alive = false;
      entity.state.set('hasActiveQuest', false);
      entity.state.set('questComplete', false);
      entity._deathInfo = {
        cause: 'quest',
        npcId: entity.id,
        npcName: entity.name,
        factionId: entity.state.get('factionId'),
        ageYears: entity.state.get('ageYears'),
        maxAgeYears: entity.state.get('maxAgeYears'),
        rankName: entity.state.get('rankName'),
        questName: `${diffName}${questName}`,
      };
      return {
        success: false,
        outcome: 'death',
        description: `${entity.name} 在执行${diffName}${questName}任务中殒命`,
      };
    }

    if (roll < dangerDeath + dangerInjury) {
      const maxAgeDays = entity.state.get('maxAgeDays') || 1;
      const ageDays = entity.state.get('ageDays') || 0;
      // 受伤损耗寿元：相对寿命的小比例（按难度递增），避免一次受伤折损过多
      const lifeLoss = Math.floor(maxAgeDays * (0.002 + difficulty * 0.001));
      entity.state.set('ageDays', ageDays + lifeLoss);
      entity.state.set('lifeRatio', (ageDays + lifeLoss) / maxAgeDays);
      entity.state.set('injuryLevel', (entity.state.get('injuryLevel') || 0) + 1);
    }

    if (daysLeft <= 1) {
      entity.state.set('questDaysRemaining', 0);
      entity.state.set('questComplete', true);
      return {
        success: true,
        outcome: 'complete',
        description: `${entity.name} 完成了${diffName}${questName}任务`,
      };
    }

    entity.state.set('questDaysRemaining', daysLeft - 1);
    entity.state.set('questComplete', false);
    return {
      success: true,
      outcome: 'in_progress',
      daysLeft: daysLeft - 1,
      description: `${entity.name} 正在执行${diffName}${questName}任务（剩余${daysLeft - 1}天）`,
    };
  }
}

export class NPCTurnInQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const questTemplates = worldContext.questTemplates;
    const difficulty = entity.state.get('activeQuestDifficulty') || 1;
    const questName = entity.state.get('activeQuestTypeName') || '任务';
    const diffName = entity.state.get('activeQuestDiffName') || '';
    const factionId = entity.state.get('factionId');

    const diffInfo = questTemplates?.difficulties?.find(d => d.level === difficulty);
    const baseReward = diffInfo?.rewardStones || 5;
    const rewardContribution = diffInfo?.rewardContribution || 2;
    const factionStones = diffInfo?.factionStones || 10;
    const isWanderer = !factionId;

    // 散修走悬赏阁/坊市：悬赏佣金抽成后，散修拿到的灵石更多（无宗门抽水），
    // 但没有宗门贡献点。参考凡人修仙传/完美世界「坊市悬赏榜、私人委托」设定。
    const bountyCfg = getCultivationConfig(worldContext).bounty || {};
    const wandererBonus = bountyCfg.wandererRewardMultiplier ?? 1.5;
    const rewardStones = isWanderer ? Math.round(baseReward * wandererBonus) : baseReward;

    let bountyOrgName = null;
    if (isWanderer) {
      // 悬赏由悬赏阁/坊市垫付：从其库存扣除（不足则照常发放，视作公共平台兜底）
      const org = worldContext._resolveBountyOrgFor
        ? worldContext._resolveBountyOrgFor(entity)
        : null;
      if (org && org.alive) {
        bountyOrgName = org.name;
        const orgStone = org.inventory?.getAmount('low_spirit_stone') || 0;
        if (orgStone > 0) org.inventory.remove('low_spirit_stone', Math.min(rewardStones, orgStone));
      }
    } else if (worldContext.entityRegistry) {
      const faction = worldContext.entityRegistry.getById(factionId);
      if (faction && faction.alive) {
        faction.inventory.add('low_spirit_stone', factionStones);
      }
    }

    entity.inventory.add('low_spirit_stone', rewardStones);

    if (!isWanderer) {
      const contribution = entity.state.get('contribution') || 0;
      entity.state.set('contribution', contribution + rewardContribution);
      // 月度贡献：当月累计，供月末考核与排名（月末清零）
      const monthly = entity.state.get('monthlyContribution') || 0;
      entity.state.set('monthlyContribution', monthly + rewardContribution);
    }

    const totalQuests = entity.state.get('totalQuestsCompleted') || 0;
    entity.state.set('totalQuestsCompleted', totalQuests + 1);

    entity.state.set('hasActiveQuest', false);
    entity.state.set('questComplete', false);
    entity.state.set('questTurnedIn', true);
    entity.state.set('activeQuestTypeId', null);
    entity.state.set('activeQuestTypeName', null);
    entity.state.set('activeQuestDifficulty', 0);
    entity.state.set('activeQuestDiffName', null);
    entity.state.set('questDaysRemaining', 0);

    const description = isWanderer
      ? `${entity.name} 向${bountyOrgName || '悬赏阁'}交付了${diffName}${questName}悬赏，领取 ${rewardStones} 灵石`
      : `${entity.name} 交付了${diffName}${questName}任务，获得 ${rewardStones} 灵石、${rewardContribution} 贡献点，宗门获得 ${factionStones} 灵石`;

    return {
      success: true,
      isWanderer,
      rewardStones,
      rewardContribution: isWanderer ? 0 : rewardContribution,
      factionStones: isWanderer ? 0 : factionStones,
      bountyOrgName,
      description,
    };
  }
}

export class NPCHealExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const current = entity.state.get('injuryLevel') || 0;
    const next = Math.max(0, current - 1);
    entity.state.set('injuryLevel', next);
    return {
      success: true,
      injuryLevel: next,
      description: next > 0
        ? `${entity.staticData.name} 静心疗伤，伤势减轻（剩余 ${next}）`
        : `${entity.staticData.name} 伤势痊愈`,
    };
  }
}

/**
 * 复仇行为链——追踪仇人（ADR-020）。
 * 行为生命周期的 requiresTravel 已把 NPC 移动到 revenge_target resolver 解析的仇人坐标。
 * 本执行器在抵达后确认仇人在世并临近，标记 nearRevengeTarget，供后续击杀。
 * 若途中仇人已死/失联，复仇执念目标自然失效（GOAP 下一轮重规划）。
 */
export class NPCHuntEnemyExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const target = typeof worldContext.resolveRevengeTarget === 'function'
      ? worldContext.resolveRevengeTarget(entity)
      : null;
    if (!target) {
      return { success: false, outcome: 'no_target', description: `${entity.staticData.name} 失去了仇人的踪迹` };
    }
    entity.state.set('nearRevengeTarget', true);
    return {
      success: true,
      outcome: 'tracked',
      targetId: target.id,
      description: `${entity.staticData.name} 追踪到仇人 ${target.staticData?.name || target.id} 的下落`,
    };
  }
}

/**
 * 复仇行为链——击杀仇人（ADR-020）。
 * 用 npcCombatPower 比拼战力，胜率 = myPower/(myPower+enemyPower)（妖兽式比率）。
 *   - 胜：给仇人写 _deathInfo{cause:'slain', killerId, killerFactionId}，并置自身 enemyKilled=true（执念达成）。
 *   - 负：自身按战力差受伤，劣势悬殊时可能陨落（killerId 指向对方），形成双向恩怨。
 */
export class NPCKillEnemyExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const target = typeof worldContext.resolveRevengeTarget === 'function'
      ? worldContext.resolveRevengeTarget(entity)
      : null;
    if (!target) {
      entity.state.set('nearRevengeTarget', false);
      return { success: false, outcome: 'no_target', description: `${entity.staticData.name} 扑了个空，仇人已不知所踪` };
    }

    const powerFn = typeof worldContext.npcCombatPower === 'function'
      ? worldContext.npcCombatPower
      : null;
    const myPower = powerFn ? powerFn(entity) : 1;
    const enemyPower = powerFn ? powerFn(target) : 1;
    const winChance = myPower / Math.max(1e-6, myPower + enemyPower);
    const win = Math.random() < winChance;

    if (win) {
      killNPCByPvP(target, entity);
      entity.state.set('enemyKilled', true);
      entity.state.set('nearRevengeTarget', false);
      return {
        success: true,
        outcome: 'enemy_slain',
        targetId: target.id,
        winChance: Number(winChance.toFixed(3)),
        description: `${entity.staticData.name} 手刃仇人 ${target.staticData?.name || target.id}，了却一桩执念`,
      };
    }

    // 败：按劣势程度受伤；悬殊时陨落（被仇人反杀）。
    const disadvantage = 1 - winChance; // 越大越惨败
    const lethal = disadvantage > 0.8 && Math.random() < (disadvantage - 0.8) * 2.5;
    if (lethal) {
      killNPCByPvP(entity, target);
      return {
        success: false,
        outcome: 'slain_by_enemy',
        targetId: target.id,
        winChance: Number(winChance.toFixed(3)),
        description: `${entity.staticData.name} 寻仇反被 ${target.staticData?.name || target.id} 所杀`,
      };
    }
    const injury = 1 + Math.floor(disadvantage * 3);
    entity.state.set('injuryLevel', (entity.state.get('injuryLevel') || 0) + injury);
    entity.state.set('nearRevengeTarget', false);
    return {
      success: false,
      outcome: 'wounded',
      targetId: target.id,
      winChance: Number(winChance.toFixed(3)),
      description: `${entity.staticData.name} 向仇人寻仇不敌，负伤遁走（伤势+${injury}）`,
    };
  }
}

/**
 * PvP 致死统一写入（ADR-020 阶段D/E）：标记死亡并写 _deathInfo，含 killerId/killerFactionId，
 * 打通 _collectDeaths→recordMemory→relationships→后代复仇执念的恩怨闭环。
 * @param {Object} victim 被杀者
 * @param {Object} killer 凶手
 */
export function killNPCByPvP(victim, killer) {
  if (!victim || !victim.state) return;
  victim.state.set('alive', false);
  victim.alive = false;
  victim._deathInfo = {
    cause: 'slain',
    npcId: victim.id,
    npcName: victim.name,
    factionId: victim.state.get('factionId'),
    ageYears: victim.state.get('ageYears'),
    maxAgeYears: victim.state.get('maxAgeYears'),
    rankName: victim.state.get('rankName'),
    killerId: killer ? killer.id : null,
    killerName: killer ? killer.name : null,
    killerFactionId: killer ? killer.state?.get('factionId') ?? null : null,
  };
}

/**
 * 夺宝流执行器（ADR-022/ADR-023，参考凡人修仙传 杀人夺宝/闯秘境）。
 * 高风险高期望收益：按 reward.json obsession_plunder 概率分布产出收益（真气/感悟/灵石），
 * 按 risk.json plunder 键结算受伤/陨落。成功置 treasureObtained=true（执念达成）。
 */
export class NPCRaidTreasureExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    // 风险结算：触发死亡则提前返回（_deathInfo 已由 applyRiskEffect 写入）。
    const risk = settleRisk(entity, worldContext, 'plunder');
    if (risk.died) {
      return {
        success: false,
        outcome: 'death',
        riskTriggered: risk.triggered,
        description: `${entity.staticData.name} 闯荡险地争夺机缘，殒身于乱战之中`,
      };
    }

    // 期望收益落地：按 reward.json 概率分布 roll 一个结果。
    // 若 outcome 带 itemId，则发放真实物品（法宝/材料/丹药）写入背包（ADR-025），否则回退真气收益。
    const rewardCfg = worldContext.balanceConfig?.reward;
    const grant = rollAndGrantReward(entity, rewardCfg, 'obsession_plunder');

    entity.state.set('treasureObtained', true);
    const riskNote = risk.triggered.length > 0
      ? `，途中${risk.triggered.map(r => r.risk).join('、')}`
      : '';
    const gainNote = grant.grantedItems.length > 0
      ? `夺得${grant.grantedItems.map(g => `${ItemRegistry.get(g.itemId)?.name || g.itemId}×${g.qty}`).join('、')}`
      : (grant.qiGain > 0 ? `夺得${grant.outcome?._name || '机缘'}（真气+${grant.qiGain}）` : '险地一行空手而归');
    return {
      success: true,
      outcome: 'treasure',
      rewardId: grant.outcome?.id ?? null,
      grantedItems: grant.grantedItems,
      qiGain: grant.qiGain,
      riskTriggered: risk.triggered,
      description: `${entity.staticData.name} ${gainNote}${riskNote}`,
    };
  }
}

/**
 * 按 reward.json 某 source 的 outcomes 抽取结果，并把真实物品写入背包（ADR-024/025）。
 * 与旧的"仅加 qi"不同：若 outcome 带 itemId，则发放实物（artifact/material/pill），
 * 否则回退为真气收益。返回 { outcome, qiGain, grantedItems }。
 */
export function rollAndGrantReward(entity, rewardCfg, sourceKey) {
  const outcomes = rewardCfg?.rewardsBySource?.[sourceKey]?.outcomes;
  const result = { outcome: null, qiGain: 0, grantedItems: [] };
  if (!Array.isArray(outcomes) || outcomes.length === 0) return result;
  let roll = Math.random();
  let picked = outcomes[outcomes.length - 1];
  for (const o of outcomes) {
    roll -= (o.prob ?? 0);
    if (roll < 0) { picked = o; break; }
  }
  result.outcome = picked;
  if (picked.itemId) {
    const qty = picked.qty ?? 1;
    entity.inventory.add(picked.itemId, qty);
    result.grantedItems.push({ itemId: picked.itemId, qty });
  } else if ((picked.value ?? 0) > 0) {
    const qiGain = Math.round(picked.value * 200);
    if (qiGain > 0) entity.state.set('qi', (entity.state.get('qi') || 0) + qiGain);
    result.qiGain = qiGain;
  }
  return result;
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
    const grant = opp.rewardSource ? rollAndGrantReward(entity, rewardCfg, opp.rewardSource) : { grantedItems: [], qiGain: 0, outcome: null };
    const lootDesc = grant.grantedItems.length > 0
      ? grant.grantedItems.map(g => `${ItemRegistry.get(g.itemId)?.name || g.itemId}×${g.qty}`).join('、')
      : (grant.qiGain > 0 ? `真气+${grant.qiGain}` : '一无所获');
    const riskNote = risk.triggered.length > 0 ? `，途中${risk.triggered.map(r => r.risk).join('、')}` : '';

    return {
      success: true, outcome: 'opportunity_claimed', oppType: opp.type,
      rewardId: grant.outcome?.id ?? null,
      grantedItems: grant.grantedItems,
      qiGain: grant.qiGain,
      riskTriggered: risk.triggered,
      description: `${entity.staticData.name} 赴${opp.name}，斩获${lootDesc}${riskNote}`,
    };
  }
}

/**
 * 养老流执行器（ADR-023，项目推演设定）。
 * 回归洞府/宗门安养余生：低风险，恢复少量伤势与心境（morale），置 atPeace=true。
 */
export class NPCSecludeExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const injury = entity.state.get('injuryLevel') || 0;
    if (injury > 0) entity.state.set('injuryLevel', Math.max(0, injury - 1));
    const morale = entity.state.get('morale') || 0;
    entity.state.set('morale', Math.min(100, morale + 5));
    entity.state.set('atPeace', true);
    return {
      success: true,
      outcome: 'secluded',
      description: `${entity.staticData.name} 看淡争锋，归隐洞府安养余生`,
    };
  }
}

/**
 * 传承流执行器（ADR-023，参考大道争锋 传承道统 / 遮天 大帝晚年收徒）。
 * 高境界修士收徒传授衣钵：提升宗门稳定度（传承使宗门后继有人），置 discipleRaised=true。
 */
export class NPCTakeDiscipleExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const factionId = entity.state.get('factionId');
    let stabilityNote = '';
    if (factionId) {
      const faction = worldContext.entityRegistry?.getById(factionId);
      if (faction && faction.alive) {
        const stability = faction.state.get('stability') || 0;
        faction.state.set('stability', Math.min(stability + 3, 100));
        stabilityNote = '，宗门后继有人，气运更盛';
      }
    }
    entity.state.set('discipleRaised', true);
    return {
      success: true,
      outcome: 'disciple_raised',
      description: `${entity.staticData.name} 择良才收徒，倾囊相授衣钵道统${stabilityNote}`,
    };
  }
}

/**
 * 夺权流执行器（ADR-023，参考凡人修仙传/大道争锋 掌门继任之争）。
 * 临近权力顶端者发动夺位：按 risk.json power 键结算冲突风险；
 * 成功率受当前 roleRank 与野心影响。成功则经 promoteByLadder 接掌门位并置 isFactionLeader=true。
 */
export class NPCSeizePowerExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const risk = settleRisk(entity, worldContext, 'power');
    if (risk.died) {
      return {
        success: false,
        outcome: 'death',
        riskTriggered: risk.triggered,
        description: `${entity.staticData.name} 夺位事败，殒命于权力倾轧`,
      };
    }

    // 成功率：野心越高、已在的职阶越高，越可能上位。
    const ambition = entity.staticData?.personality?.ambition ?? 50;
    const roleRank = entity.state.get('roleRank') || 1;
    const successRate = Math.min(0.85, 0.2 + ambition / 200 + roleRank * 0.08);
    if (Math.random() < successRate && typeof worldContext.promoteByLadder === 'function') {
      const r = worldContext.promoteByLadder(entity.id);
      if (r && r.promoted === 'leader') {
        entity.state.set('isFactionLeader', true);
        return {
          success: true,
          outcome: 'seized_leadership',
          riskTriggered: risk.triggered,
          description: `${entity.staticData.name} 力压群雄，执掌一方势力，登临掌门之位`,
        };
      }
      if (r && r.promoted) {
        return {
          success: false,
          outcome: 'partial_promotion',
          toRole: r.promoted,
          riskTriggered: risk.triggered,
          description: `${entity.staticData.name} 夺位未竟，但已晋升为 ${r.promoted}`,
        };
      }
    }
    return {
      success: false,
      outcome: 'failed',
      riskTriggered: risk.triggered,
      description: `${entity.staticData.name} 夺位失败，暂避锋芒`,
    };
  }
}

export function registerNPCExecutors() {
  ActionPool.registerExecutor('npc_cultivate', new NPCCultivateExecutor());
  ActionPool.registerExecutor('npc_train_chamber', new NPCTrainChamberExecutor());
  ActionPool.registerExecutor('npc_heal', new NPCHealExecutor());
  ActionPool.registerExecutor('npc_serve_faction', new NPCServeFactionExecutor());
  ActionPool.registerExecutor('npc_seek_elixir', new NPCSeekElixirExecutor());
  ActionPool.registerExecutor('npc_challenge', new NPCChallengeExecutor());
  ActionPool.registerExecutor('npc_assist_faction', new NPCAssistFactionExecutor());
  ActionPool.registerExecutor('npc_explore', new NPCExploreExecutor());
  ActionPool.registerExecutor('npc_accept_quest', new NPCAcceptQuestExecutor());
  ActionPool.registerExecutor('npc_do_quest', new NPCDoQuestExecutor());
  ActionPool.registerExecutor('npc_turn_in_quest', new NPCTurnInQuestExecutor());
  ActionPool.registerExecutor('npc_hunt_enemy', new NPCHuntEnemyExecutor());
  ActionPool.registerExecutor('npc_kill_enemy', new NPCKillEnemyExecutor());
  // 流派分化行为（ADR-022/ADR-023）：夺宝/养老/传承/夺权。
  ActionPool.registerExecutor('npc_raid_treasure', new NPCRaidTreasureExecutor());
  ActionPool.registerExecutor('npc_seclude', new NPCSecludeExecutor());
  ActionPool.registerExecutor('npc_take_disciple', new NPCTakeDiscipleExecutor());
  ActionPool.registerExecutor('npc_seize_power', new NPCSeizePowerExecutor());
  // 机会点前往（ADR-024）
  ActionPool.registerExecutor('npc_goto_opportunity', new NPCGotoOpportunityExecutor());
}
