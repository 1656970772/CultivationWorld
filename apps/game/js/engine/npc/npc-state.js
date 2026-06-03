/**
 * NPCState - NPC 运行时状态
 *
 * 自然死亡规则（凡人修仙传设定）：
 * - 寿元上限由 ranks.json 的 lifespan.baseYears ± varianceYears 决定
 * - age < startRatio × maxAge → 不触发自然死亡
 * - startRatio ≤ lifeRatio < 1.0 → 二次曲线：deathChance = minChance + (1-minChance) × t²
 *   其中 t = (ageDays - threshold) / (maxAgeDays - threshold)
 * - age ≥ 100% maxAge → deathChance = 1.0（必死）
 *
 * 时间参数、死亡参数来自 data/config/game-config.json（通过构造函数 gameConfig 参数传入）。
 */
import { RuntimeState } from '../abstract/runtime-state.js';

const ROLE_RANKS = {
  'leader': 6,
  'heir': 5,
  'elder': 4,
  'general': 3,
  'officer': 3,
  'core_disciple': 2,
  'disciple': 1,
  // 外门弟子：门派考核/月度贡献考核未达标被贬谪的最低职位
  'outer_disciple': 0,
};

export class NPCState extends RuntimeState {
  /**
   * @param {Object} npcConfig
   * @param {Array|null} ranksData ranks.json 数据
   * @param {Object} [gameConfig] data/config/game-config.json 内容（可选，有默认值）
   * @param {import('../abstract/rng.js').Rng} rng 确定性随机源。
   */
  constructor(npcConfig, ranksData = null, gameConfig = {}, rng) {
    const timeCfg = gameConfig.time || {};
    const npcCfg = gameConfig.npc || {};
    const deathCfg = gameConfig.naturalDeath || {};

    const daysPerYear = timeCfg.daysPerYear ?? 360;
    const initRatioMin = npcCfg.initialAgeRatioMin ?? 0.3;
    const initRatioMax = npcCfg.initialAgeRatioMax ?? 0.7;
    const fallbackBase = npcCfg.fallbackMaxAgeYearsBase ?? 80;
    const fallbackVariance = npcCfg.fallbackMaxAgeYearsVariance ?? 40;

    const rankInfo = ranksData
      ? ranksData.find(r => r.id === npcConfig.rankId)
      : null;

    const maxAgeYears = rankInfo
      ? rankInfo.lifespan.baseYears + (rng.next() - 0.5) * 2 * rankInfo.lifespan.varianceYears
      : fallbackBase + rng.next() * fallbackVariance;

    const maxAgeDays = Math.floor(maxAgeYears * daysPerYear);
    const ageRatio = initRatioMin + rng.next() * (initRatioMax - initRatioMin);
    const ageDays = Math.floor(maxAgeDays * ageRatio);

    super({
      alive: npcConfig.alive !== false,
      ageDays,
      ageYears: Math.floor(ageDays / daysPerYear),
      maxAgeDays,
      maxAgeYears: Math.floor(maxAgeYears),
      factionId: npcConfig.factionId,
      currentRole: npcConfig.role,
      roleRank: ROLE_RANKS[npcConfig.role] || 1,
      rankId: npcConfig.rankId,
      rankName: rankInfo ? rankInfo.name : npcConfig.rankId,
      cultivationProgress: rng.next() * 0.3,
      // 游历感悟：通过外出游历积累，与闭关进度(cultivationProgress)互补。
      // 突破总进度 = cultivationProgress + insight（见 toGOAPState 的 totalProgress 与 ADR-016）。
      // 闭关有 cultivationCap 上限（按境界），撞墙后剩余进度必须靠游历补足。
      insight: 0,
      // 派生缓存：突破总进度 = cultivationProgress + insight。由 set('cultivationProgress'/'insight')
      // 自动重算，供数据驱动需求评估器(ConfigurableEvaluator 读 entityState.get('totalProgress'))使用。
      // 初始值在构造末尾按实际 cultivationProgress 同步。
      totalProgress: 0,
      qi: 0,
      morale: 50 + rng.next() * 50,
      lifeRatio: 0,
      isLeader: npcConfig.role === 'leader',
      isElder: npcConfig.role === 'elder',
      hasFaction: !!npcConfig.factionId,
      // 散修：无任何势力归属的独立修士（参考凡人修仙传/完美世界「散修生存方式」）
      isWanderer: !npcConfig.factionId,
      // 派生：宗门弟子在本门任务堂、散修在悬赏阁/坊市，二者均可接取悬赏任务
      canTakeQuest: true,
      factionAtPeace: true,
      factionInDanger: false,
      dutyFulfilled: false,
      hasActiveQuest: false,
      activeQuestTypeId: null,
      activeQuestTypeName: null,
      activeQuestDifficulty: 0,
      activeQuestDiffName: null,
      questDaysRemaining: 0,
      questTargetX: null,
      questTargetY: null,
      // 斩妖/除害/猎灵兽任务锁定的具体妖兽实例 id，用于把任务目标与地图活体妖兽绑定。
      questTargetMonsterId: null,
      questComplete: false,
      questTurnedIn: false,
      factionHasQiPillMaterial: false,
      factionHasBreakthroughPillMaterial: false,
      factionHasArtifactMaterial: false,
      factionNeedsHuntMaterials: false,
      donatableMaterialCount: 0,
      hasEquippedArtifact: false,
      // 复仇行为链派生状态（ADR-020）：hasRevengeTarget 由 NPCEntity.onPreTick 按执念/恩怨刷新；
      // nearRevengeTarget 由追踪行为标记、击杀后清空；enemyKilled 为执念达成标志。
      hasRevengeTarget: false,
      nearRevengeTarget: false,
      enemyKilled: false,
      contribution: 0,
      // 月度贡献：当月累计，月末考核后清零（与终身累计 contribution 区分）
      monthlyContribution: 0,
      // 月度考核额度未达标的紧迫标记（由 tick-manager 月度结算/临近月末时更新）
      monthlyQuotaMet: true,
      // 受伤程度：0=健康，受伤累加；回血行为逐步降低。区别于 lifeRatio（寿元）
      injuryLevel: 0,
      // 气血（HP）系统（ADR-041 阶段1）：maxHp = combat.npcHp.baseHp[境界] × 体质 hpBonus。
      // 占位 0，真正数值由 NPCEntity 构造末尾 _initHp() 按 combat 配置与体质计算并回满。
      hp: 0,
      maxHp: 0,
      // 先天资质：灵根(5档)与体质(凡体+稀有特殊体)。出生即定、终身不变。
      // 由 NPCEntity._initTalent 按 cultivation.json 权重随机赋值（或 npcConfig 显式指定）。
      spiritRootId: npcConfig.spiritRootId || 'triple',
      physiqueId: npcConfig.physiqueId || 'mortal_body',
      totalQuestsCompleted: 0,
      gender: npcConfig.gender || (rng.next() < 0.5 ? 'male' : 'female'),
      daoCompanionId: npcConfig.daoCompanionId || null,
      childrenCount: 0,
      techniqueId: npcConfig.techniqueId || null,
      breakthroughAidBonus: npcConfig.breakthroughAidBonus || 0,
      actionStatus: 'idle',
      actionRemaining: 0,
      // 价值-风险决策（ADR-017）：上头标记。lastDecisionHeadstrong 表示上次大决策的首个行为
      // 是否因“上头”而被选中；headstrongActionId 记录命中上头的行为 id（无则 null）。
      lastDecisionHeadstrong: false,
      headstrongActionId: null,
      // 游历/闭关顺序随机：每进入新境界 roll 一次，∈ {cultivate_first, explore_first}，
      // 影响本境界内 GOAP 对游历/闭关的相对偏好（见 NPCEntity 与 computeDecisionCost）。
      breakthroughPathOrder: 'cultivate_first',
      // —— 流派分化派生状态（ADR-022/ADR-023）。作为 GOAP 目标键，由对应流派行为 effect 置真。——
      // 夺宝流：抢得天材地宝（act_npc_raid_treasure 成功后置真，结算后由决策周期复位）。
      treasureObtained: false,
      // 养老流：归隐安养达成（act_npc_seclude/return_sect 后置真）。
      atPeace: false,
      // 传承流：已收徒并完成传承（act_npc_take_disciple/teach 后置真）。
      discipleRaised: false,
      // 夺权流：成为势力领袖（与 isLeader 同义，作为夺权执念目标键；夺权行为成功后置真）。
      isFactionLeader: npcConfig.role === 'leader',
      // —— 信息传播 / 机会点 / 怀璧其罪派生状态（ADR-024/025）——
      // 机会点目标键：到达并完成机会点行为后由 act_npc_goto_opportunity effect 置真，结算后复位。
      arrivedAtOpportunity: false,
      // 当前锁定的机会点 id（由 collectExtraGoals 选定，nearest_opportunity 解析坐标）。
      targetOpportunityId: null,
      // 已装备法宝 id（ADR-025）：进 assetScore，可被抢夺转移。
      equippedArtifactId: npcConfig.equippedArtifactId || null,
      // —— 关系驱动行为派生状态（ADR-028）——
      // 由 _buildRelationshipGoals 选定的关系对象 id（支援同门/探望恩人/师徒互动），relationship_target 解析坐标。
      targetRelationshipId: null,
      // 关系 Goal 达成键：到达并结算支援/探望行为后由 effect 置真，结算后复位。
      assistedAlly: false,
      visitedBenefactor: false,
      // —— 师徒互动派生状态（ADR-029 第三期）——
      // 师傅传功(护徒·点化)/师傅护徒(驰援)/徒弟尽孝(探望) 三类关系 Goal 的达成键，结算后复位。
      taughtDisciple: false,
      protectedDisciple: false,
      visitedMaster: false,
    });

    this._rng = rng;
    this._daysPerYear = daysPerYear;
    this._naturalDeath = {
      startRatio: deathCfg.startRatio ?? 0.95,
      minChance: deathCfg.minChance ?? 0.0002,
      maxChance: deathCfg.maxChance ?? 1.0,
    };

    this.set('lifeRatio', ageDays / maxAgeDays);
    this._syncTotalProgress();
  }

  /**
   * @override
   * 维护派生字段 totalProgress：当 cultivationProgress 或 insight 变更时自动重算并落库，
   * 使数据驱动需求评估器(读 get('totalProgress'))与 GOAP(toGOAPState 注入)取值一致。
   */
  set(key, value) {
    super.set(key, value);
    if (key === 'cultivationProgress' || key === 'insight') {
      this._syncTotalProgress();
    }
  }

  _syncTotalProgress() {
    const total = (this.get('cultivationProgress') || 0) + (this.get('insight') || 0);
    super.set('totalProgress', total);
  }

  /**
   * @override
   * 注入派生字段 totalProgress = cultivationProgress + insight，供 GOAP 目标判定与突破使用。
   * 这样修炼需求的 goalState 直接对 totalProgress 设阈值，闭关撞 cap 后只剩游历能推进，
   * GOAP 便自然推导出"去游历"，无需独立的游历需求。
   */
  toGOAPState() {
    const flat = super.toGOAPState();
    const progress = this.get('cultivationProgress') || 0;
    const insight = this.get('insight') || 0;
    flat.totalProgress = progress + insight;
    return flat;
  }

  advanceAge() {
    const ageDays = (this.get('ageDays') || 0) + 1;
    const maxAgeDays = this.get('maxAgeDays') || 1;
    this.setMany({
      ageDays,
      ageYears: Math.floor(ageDays / this._daysPerYear),
      lifeRatio: ageDays / maxAgeDays,
    });
  }

  /**
   * 自然死亡判定
   *
   * 公式：二次曲线
   *   threshold = maxAgeDays × startRatio
   *   t = (ageDays - threshold) / (maxAgeDays - threshold)    范围 [0, 1]
   *   deathChance = minChance + (maxChance - minChance) × t²
   *
   * 例：元婴修士寿元上限 1200 年（432000 天）
   *   - 1140 年（95%）开始触发，初始概率 0.0002/天
   *   - 1170 年（97.5%）概率约 0.25/天
   *   - 1200 年（100%）概率 1.0/天，必死
   *
   * @returns {{ died: boolean, deathChance: number, roll: number } | false}
   */
  checkNaturalDeath() {
    const ageDays = this.get('ageDays') || 0;
    const maxAgeDays = this.get('maxAgeDays') || 1;
    const { startRatio, minChance, maxChance } = this._naturalDeath;

    const threshold = Math.floor(maxAgeDays * startRatio);

    if (ageDays < threshold) return false;

    if (ageDays >= maxAgeDays) {
      return { died: true, deathChance: 1.0, roll: 0 };
    }

    const t = (ageDays - threshold) / (maxAgeDays - threshold);
    const deathChance = minChance + (maxChance - minChance) * t * t;

    const roll = this._rng.next();
    return {
      died: roll < deathChance,
      deathChance,
      roll,
    };
  }
}
