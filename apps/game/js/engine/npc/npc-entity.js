/**
 * NPCEntity - NPC 实体
 */
import { BaseEntity } from '../abstract/base-entity.js';
import { NPCStaticData } from './npc-static-data.js';
import { NPCState } from './npc-state.js';
import { NeedPool } from '../pools/need-pool.js';
import { ActionPool } from '../pools/action-pool.js';
import { decorateGoalConsiderations as decorateGoalConsiderationsImpl } from './npc-utility.js';
import {
  rollInnateObsession as rollInnateObsessionImpl,
  checkAcquiredObsession as checkAcquiredObsessionImpl,
  checkConditionalObsession as checkConditionalObsessionImpl,
} from './npc-obsession-trigger.js';
import {
  collectExtraGoals as collectExtraGoalsImpl,
  buildRelationshipGoals as buildRelationshipGoalsImpl,
  checkSeizeDiscipleObsession as checkSeizeDiscipleObsessionImpl,
  buildOpportunityGoal as buildOpportunityGoalImpl,
} from './npc-goals.js';
import {
  tryBreakthrough as tryBreakthroughImpl,
  handleDeath as handleDeathImpl,
} from './npc-lifecycle.js';
import { createBTLoader, NPC_DEFAULT_BT } from '../abstract/bt/index.js';
import { MemorySystem, MemoryType } from '../abstract/memory-system.js';
import { RelationshipGraph } from './relationship.js';
import { ObsessionSystem, Obsession } from '../abstract/obsession-system.js';
import { EmotionSystem } from '../abstract/emotion-system.js';
import {
  canFactionProvideExchangeMaterials,
  countDonatableMaterials,
  factionNeedsMonsterExchangeMaterials,
} from './npc-economy.js';

/** NPC 共享 BTLoader（已注册 planner 节点）。PlannerNode 无内部状态，可被各 NPC 安全复用。 */
const NPC_BT_LOADER = createBTLoader();

export class NPCEntity extends BaseEntity {
  /**
   * @param {Object} npcConfig
   * @param {Array|null} [ranksData] ranks.json 数据
   * @param {Object} [entityConfig] 额外配置（来自 data/config/ 与 data/balance/）
   * @param {Object} [entityConfig.gameConfig] game-config.json 内容
   * @param {Object} [entityConfig.cultivationConfig] cultivation.json 内容
   * @param {Object} [entityConfig.aiConfig] ai-config.json 中 npc 段落
   */
  constructor(npcConfig, ranksData = null, entityConfig = {}) {
    super(npcConfig.id, 'npc');

    this._ranksData = ranksData || [];
    this._cultivationConfig = entityConfig.cultivationConfig || {};
    this._personalityConfig = entityConfig.personalityConfig || {};
    this._aiConfig = entityConfig.aiConfig || {};
    this._memoryConfig = entityConfig.memoryConfig || {};
    this._obsessionConfig = entityConfig.obsessionConfig || {};
    this._emotionConfig = entityConfig.emotionConfig || {};
    this._utilityConfig = entityConfig.utilityConfig || {};
    this._economyConfig = entityConfig.economyConfig || {};
    this.initStaticData(npcConfig);
    this.state = new NPCState(npcConfig, ranksData, entityConfig.gameConfig || {});
    // 把性格暴露到 state 上（仅作只读引用，存于专用字段，不进 _values，故不污染 GOAP 状态键）
    this.state.personality = this.staticData.personality || {};
    this._initTalent(npcConfig);
    this._initInventory(npcConfig);
    this._initNeeds(npcConfig);
    this._initActions(npcConfig);
    this._rollBreakthroughPathOrder();

    // 决策周期：每个 NPC 随机错开决策时机，周期内静候，到期才通过 GOAP 重新规划大行为。
    this._decisionMin = this._aiConfig.decisionIntervalMin ?? 3;
    this._decisionMax = this._aiConfig.decisionIntervalMax ?? 12;
    this._decisionCooldown = this._rollDecisionInterval();

    // 长期记忆与个人恩怨图（GOBT 长期心智，ADR-019）。
    // 个人恩怨图绑定到世界级关系网（ADR-027）：grudge/gratitude 成为统一关系网的边，
    // 接口不变，复仇链零改动。无 relationshipSystem 时（独立单测）回退内部 Map。
    this.memory = new MemorySystem({ capacity: this._memoryConfig.capacity ?? 32 });
    this._relationshipSystem = entityConfig.relationshipSystem || null;
    // 关系网配置（ADR-028 二期）：含 goalsEnabled 与 npcGoals 阈值，供关系驱动 Goal 读取。
    this._relationshipConfig = entityConfig.relationshipConfig || {};
    this.relationships = new RelationshipGraph(
      this._relationshipSystem
        ? { system: this._relationshipSystem, ownerId: this.id }
        : {}
    );

    // 执念系统（ADR-019）：先天按人格/灵根 roll 一个初始执念。
    // goalMult（ADR-020）：执念对自身/同方向需求 Goal 的乘法加成（默认 enabled=false 零漂移）。
    this.obsessions = new ObsessionSystem(this._obsessionConfig.goalMult || null);
    this._rollInnateObsession();

    // 情绪系统（ADR-019）：由记忆事件激发、每日回归基线，作为 Utility 乘子调制目标。
    this.emotions = new EmotionSystem(this._emotionConfig);

    // 安装 GOBT 行为树（ADR-018）：tick() 由 BTRunner 编排"反应→评估→规划→执行"。
    // 默认用内置 NPC 树；entityConfig.npcBehaviorTree 提供时覆盖（数据驱动）。
    const btJson = entityConfig.npcBehaviorTree || NPC_DEFAULT_BT;
    this.initBT(NPC_BT_LOADER.build(btJson));
  }

  /**
   * 记入一条重大事件记忆，并按 memory.json 更新个人恩怨/恩义（ADR-019）。
   * @param {MemoryType} type
   * @param {Object} [opts]
   * @param {string|null} [opts.actorId] 相关方实体 id（仇人/恩人）
   * @param {string|null} [opts.factionId] 相关势力 id
   * @param {number} [opts.tick] 世界日
   * @param {{x:number,y:number}|null} [opts.location]
   */
  recordMemory(type, opts = {}) {
    const cfg = (this._memoryConfig.events || {})[type];
    if (!cfg) return;
    this.memory.add({
      type,
      actorId: opts.actorId ?? null,
      factionId: opts.factionId ?? null,
      tick: opts.tick ?? 0,
      location: opts.location ?? null,
      intensity: cfg.intensity ?? 0,
      decay: cfg.decay ?? 0,
    });
    if (cfg.grudgeGain && opts.actorId) {
      this.relationships.addGrudge(opts.actorId, cfg.grudgeGain);
    }
    if (cfg.gratitudeGain && opts.actorId) {
      this.relationships.addGratitude(opts.actorId, cfg.gratitudeGain);
    }
    // 记忆写入后，激发对应情绪（ADR-019）。
    if (this.emotions) this.emotions.onMemoryEvent(type);
    // 检查是否触发后天执念（ADR-019）。
    this._checkAcquiredObsession(type);
  }

  /**
   * @override
   * 情绪对目标的 Utility 调制（ADR-019）：愤怒放大复仇执念、恐惧放大生存紧迫度等。
   * @param {import('../abstract/goal.js').Goal} goal
   */
  modulateGoal(goal) {
    if (this.emotions) this.emotions.modulateGoal(goal);
  }

  /**
   * @override
   * 装配目标考量因素（ADR-020）：把 TimeValue（时间价值=f(lifeRatio)）、目标风险、
   * utility.json 自定义考量因素挂到 Goal 上，使「选目标」阶段就乘法式权衡。
   * utility.json `enabled=false`(默认) 时为空操作 → 行为零漂移。
   * @param {import('../abstract/goal.js').Goal} goal
   * @param {Object} worldContext
   */
  decorateGoalConsiderations(goal, worldContext) {
    decorateGoalConsiderationsImpl(this, goal, worldContext, this._utilityConfig);
  }

  /**
   * 心智摘要（ADR-019）：供决策时间线/调试看板可视化 NPC 的执念、情绪、记忆与恩怨。
   * @returns {Object}
   */
  getMindSummary() {
    const topGrudge = this.relationships ? this.relationships.topGrudge() : null;
    return {
      obsessions: this.obsessions ? this.obsessions.obsessions.map(o => ({ type: o.type, name: o.name, intensity: o.intensity, targetId: o.targetId, targetFactionId: o.targetFactionId })) : [],
      emotions: this.emotions ? this.emotions.snapshot().values : {},
      memoryCount: this.memory ? this.memory.size() : 0,
      topGrudge: topGrudge || null,
    };
  }

  /**
   * 先天执念抽取（ADR-019）：委托 npc-obsession-trigger（出生即定型）。
   */
  _rollInnateObsession() {
    rollInnateObsessionImpl(this);
  }

  /**
   * 后天执念触发（ADR-019）：委托 npc-obsession-trigger（某类记忆达阈值时生成执念）。
   * @param {MemoryType} memoryType 刚写入的记忆类型
   */
  _checkAcquiredObsession(memoryType) {
    checkAcquiredObsessionImpl(this, memoryType);
  }

  /**
   * 条件执念检查（ADR-023）：委托 npc-obsession-trigger（随寿元/境界/野心演化触发养老/传承）。
   */
  _checkConditionalObsession() {
    checkConditionalObsessionImpl(this);
  }

  /**
   * @override
   * 收集执念目标（ADR-019）：委托 npc-goals（执念 + 机会 + 关系/师徒 Goal）。
   */
  collectExtraGoals(worldContext) {
    return collectExtraGoalsImpl(this, worldContext);
  }

  /**
   * 关系驱动 Goal（ADR-028）：委托 npc-goals（护短同门 / 报恩 / 师徒互动）。
   * @param {Object} worldContext
   * @returns {import('../abstract/goal.js').Goal|null}
   */
  _buildRelationshipGoals(worldContext) {
    return buildRelationshipGoalsImpl(this, worldContext);
  }

  /**
   * 夺舍图谋执念检查（ADR-029 第三期）：委托 npc-goals（邪修师傅对高资质徒弟起夺舍执念）。
   * @param {Object} worldContext
   */
  _checkSeizeDiscipleObsession(worldContext) {
    checkSeizeDiscipleObsessionImpl(this, worldContext);
  }

  /**
   * 继承遗志（ADR-029 第三期）：本 NPC 的师傅陨落时调用。两层（参考凡人修仙传『传承不仅是功法，更是意志的延续』）：
   *   ① 复仇：写 master_lost 记忆 → 触发 revenge 执念（仿 companion_lost，对凶手）。
   *   ② 执念延续：把师傅未竟的非复仇执念（inheritableObsessionTypes）按折扣 intensity 复制给本 NPC。
   * 由 TickManager._collectDeaths 在师傅死亡时驱动（仅 goalsEnabled）。
   * @param {Object} master 陨落的师傅实体
   * @param {{killerId?:string|null, killerFactionId?:string|null, tick?:number, location?:Object|null}} info 师傅死亡信息
   */
  inheritMasterLegacy(master, info = {}) {
    const cfg = this._relationshipConfig.masterDiscipleGoals?.inheritWill || {};
    // ① 复仇：恩师陨落记忆（grudgeGain 经记忆配置对凶手建仇 + 触发 master_lost→revenge 执念）。
    const memType = cfg.revengeMemoryType || 'master_lost';
    if (typeof this.recordMemory === 'function') {
      this.recordMemory(memType, {
        actorId: info.killerId || null,
        factionId: info.killerFactionId || null,
        tick: info.tick ?? 0,
        location: info.location ?? null,
      });
    }
    // ② 执念延续：复制师傅未竟的可继承执念（折扣强度，去重保强者）。
    if (!master || !master.obsessions || !this.obsessions) return;
    const mult = cfg.inheritObsessionIntensityMult ?? 0.7;
    const inheritable = new Set(cfg.inheritableObsessionTypes || ['plunder', 'supremacy', 'longevity', 'power', 'protect_dao']);
    for (const o of master.obsessions.obsessions) {
      if (!inheritable.has(o.type)) continue; // revenge/resurrection/seizure 等不继承（各有专属触发）。
      this.obsessions.add(new Obsession({
        type: o.type,
        name: o.name,
        intensity: Math.round((o.intensity ?? 70) * mult),
        targetId: o.targetId,
        targetFactionId: o.targetFactionId,
        goalState: o.goalState || {},
      }));
    }
  }

  /**
   * 刷新关系驱动派生状态（ADR-028）：关系对象失效（死亡/失联）即清空 targetRelationshipId，
   * 使关系行为链前置失效，GOAP 下一轮重规划自然放弃，回归日常（零漂移）。
   * @param {Object} worldContext
   */
  _refreshRelationshipState(worldContext) {
    const relId = this.state.get('targetRelationshipId');
    if (!relId) return;
    const registry = worldContext?.entityRegistry;
    const target = registry?.getById?.(relId);
    if (!target || !target.alive || !(target.hasSpatial && target.hasSpatial())) {
      this.state.set('targetRelationshipId', null);
    }
  }

  /**
   * 依世界上下文为本 NPC 构造"前往机会点" Goal（ADR-024）：委托 npc-goals。
   * @returns {import('../abstract/goal.js').Goal|null}
   */
  _buildOpportunityGoal(worldContext) {
    return buildOpportunityGoalImpl(this, worldContext);
  }

  /**
   * 刷新复仇派生状态（ADR-020）：依世界上下文判断是否存在可定位的在世仇人。
   * 仇人已死/失联时清空 hasRevengeTarget 与 nearRevengeTarget，使复仇行为链前置失效，
   * GOAP 下一轮重规划时自然不再选追踪/击杀，转回日常目标。
   * @param {Object} worldContext
   */
  _refreshRevengeState(worldContext) {
    // 复仇/夺舍已达成（仇人/徒弟已被本 NPC 手刃）：清除该执念，重置派生状态，回归日常。
    // seizure（ADR-029 夺舍）与 revenge 同走击杀链，达成后一并清除。
    if (this.state.get('enemyKilled') === true && this.obsessions) {
      this.obsessions.obsessions = this.obsessions.obsessions.filter(o => o.type !== 'revenge' && o.type !== 'seizure');
      this.state.set('enemyKilled', false);
    }
    const hasTarget = (worldContext && typeof worldContext.resolveRevengeTarget === 'function')
      ? !!worldContext.resolveRevengeTarget(this)
      : false;
    this.state.set('hasRevengeTarget', hasTarget);
    if (!hasTarget) this.state.set('nearRevengeTarget', false);
  }

  /** 抽取一个随机决策周期（天） */
  _rollDecisionInterval() {
    const min = this._decisionMin, max = this._decisionMax;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  /**
   * 初始化先天资质：灵根(spiritRootId) 与 体质(physiqueId)。
   * npcConfig 已显式指定则保留，否则按 cultivation.json 的 weight 权重随机抽取。
   */
  _initTalent(npcConfig) {
    const cfg = this._cultivationConfig;
    if (!npcConfig.spiritRootId) {
      const grades = cfg.spiritRoot?.grades;
      const picked = this._weightedPick(grades);
      if (picked) this.state.set('spiritRootId', picked);
    }
    if (!npcConfig.physiqueId) {
      const types = cfg.physique?.types;
      const picked = this._weightedPick(types);
      if (picked) this.state.set('physiqueId', picked);
    }
  }

  /** 按 { key: { weight } } 映射的 weight 字段做加权随机，返回选中的 key（无有效权重返回 null） */
  _weightedPick(map) {
    if (!map) return null;
    const entries = Object.entries(map);
    const total = entries.reduce((s, [, v]) => s + (v.weight || 0), 0);
    if (total <= 0) return null;
    let roll = Math.random() * total;
    for (const [key, v] of entries) {
      roll -= (v.weight || 0);
      if (roll < 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  _initInventory(config) {
    this.inventory.loadFrom({
      low_spirit_stone: config.spiritStone || 0,
    });
  }

  /** @override */
  initStaticData(config) {
    this.staticData = new NPCStaticData(config);
  }

  _initNeeds(config) {
    const needIds = config.needIds || [
      'need_npc_survival', 'need_npc_heal',
      'need_npc_active_quest', 'need_npc_donate_materials',
      'need_npc_cultivation', 'need_npc_breakthrough_aid',
      'need_npc_combat_gear', 'need_npc_hunt_resources', 'need_npc_loyalty_duty',
      'need_npc_ambition',
    ];

    for (const needId of needIds) {
      if (NeedPool.has(needId)) {
        this.needSystem.addNeed(NeedPool.create(needId));
      }
    }
  }

  _initActions(config) {
    const actionIds = config.actionIds || [
      'act_npc_cultivate', 'act_npc_train_chamber',
      'act_npc_serve_faction', 'act_npc_heal',
      'act_npc_seek_elixir', 'act_npc_challenge',
      'act_npc_assist_faction', 'act_npc_explore',
      'act_npc_accept_hunt_quest',
      'act_npc_accept_quest', 'act_npc_do_quest', 'act_npc_turn_in_quest',
      'act_npc_donate_materials',
      'act_npc_redeem_qi_pill', 'act_npc_use_qi_pill',
      'act_npc_redeem_breakthrough_pill', 'act_npc_use_breakthrough_pill',
      'act_npc_redeem_artifact',
      // 流派分化行为（ADR-022/ADR-023）：夺宝/养老/传承/夺权。
      // 这些行为的执念目标（treasureObtained/atPeace/discipleRaised/isFactionLeader）默认无人持有，
      // 仅当 NPC 经 obsession.json 规则 roll/触发到对应执念时，其 Goal 才进入 Utility 选择，
      // 故加入可用行为池不改变未持执念 NPC 的既有规划（零漂移）。
      'act_npc_raid_treasure', 'act_npc_seclude',
      'act_npc_take_disciple', 'act_npc_seize_power',
      // 机会点前往行为（ADR-024）：仅当机会系统 enabled 且 NPC 知晓可行机会时，
      // collectExtraGoals 才产出 opportunity Goal 触发本行为，故零漂移。
      'act_npc_goto_opportunity',
      // 复仇行为链（ADR-020/028）：追踪→击杀仇人。仅当 hasRevengeTarget（执念/恩怨/高强度 enemy 边）
      // 为真时其 Goal(enemyKilled) 才进入规划，故加入可用池不改变无仇 NPC 既有规划（零漂移）。
      'act_npc_hunt_enemy', 'act_npc_kill_enemy',
      // 关系驱动行为（ADR-028）：驰援同门 / 探望恩人。仅当 goalsEnabled 且存在 qualifying 关系边时，
      // collectExtraGoals 才产出对应关系 Goal 触发本行为，故零漂移。
      'act_npc_assist_ally', 'act_npc_visit_benefactor',
      // 师徒互动行为（ADR-029）：师傅传功(点化)/师傅护徒(驰援)/徒弟尽孝(探望)。仅当 goalsEnabled 且
      // 存在 qualifying master/disciple 边时，collectExtraGoals 才产出对应 Goal 触发本行为，故零漂移。
      'act_npc_teach_disciple', 'act_npc_protect_disciple', 'act_npc_visit_master',
    ];

    const actions = [];
    for (const actionId of actionIds) {
      if (ActionPool.has(actionId)) {
        actions.push(ActionPool.create(actionId));
      }
    }
    this._applyCultivationCapPreconditions(actions);
    const maxDepth = this._aiConfig.maxDepth ?? 10;
    const maxIterations = this._aiConfig.maxIterations ?? 300;
    this.initBehaviorSystem(actions, { maxDepth, maxIterations });
  }

  /**
   * 按当前境界把闭关类行为的 cap 前置(cultivationProgress < cap)注入为真实上限。
   * 这样 GOAP 在搜索中把 cultivationProgress 推到 cap 后，闭关前置不再满足，
   * A* 只能转而选择游历(产出 insight)继续推进 totalProgress，从而"被迫游历"。
   * 境界变化（突破）后需重新注入，见 refreshCultivationCapPreconditions。
   */
  _applyCultivationCapPreconditions(actions) {
    const capMap = this._cultivationConfig.cultivationCap || {};
    const rankId = this.state.get('rankId') || 'mortal';
    const cap = capMap[rankId] ?? 1.0;
    const cappedActionIds = ['act_npc_cultivate', 'act_npc_train_chamber'];
    // 闭关进度边际递减后实际很难精确到 cap（指数衰减永远逼近不等于），
    // 故前置阈值取 cap×0.999 即视为“到顶”，避免规划层永久允许闭关却几乎不前进。
    const capThreshold = cap * 0.999;
    for (const action of actions) {
      if (!cappedActionIds.includes(action.id)) continue;
      action.preconditions = {
        ...action.preconditions,
        cultivationProgress: { op: 'lt', value: capThreshold },
      };
      // Action 在构造时预存了 _preconditionEntries（GOAP 热路径用），需同步刷新。
      action._preconditionEntries = Object.entries(action.preconditions);
    }
  }

  /** 突破成功境界变化后，按新境界刷新闭关 cap 前置。 */
  refreshCultivationCapPreconditions() {
    if (this.behaviorSystem) {
      this._applyCultivationCapPreconditions(this.behaviorSystem.availableActions);
    }
  }

  /**
   * 随机本境界的游历/闭关先后偏好（ADR-017）。
   * 因“相加制”下先游历或先闭关最终都能到 totalProgress>=1.0，顺序只影响路径不影响可达性。
   * explore_first 会通过 Utility 给探索类目标加分，让 NPC 优先选择探索目标（ADR-021）。
   */
  _rollBreakthroughPathOrder() {
    const order = Math.random() < 0.5 ? 'explore_first' : 'cultivate_first';
    this.state.set('breakthroughPathOrder', order);
  }

  /**
   * @override
   * 决策门控（GOBT：供 PlannerNode 在"空闲且无计划"时询问是否可重新规划，ADR-018）。
   * 等价迁移旧 _decisionCooldown 时序：
   * - 决策周期未到：递减冷却并返回 false（PlannerNode 静候，不规划）。
   * - 决策周期已到：返回 true 并重置一个新的随机周期（随后 PlannerNode 执行 GOAP 规划）。
   * 注意：仅在 PlannerNode 判定空闲且无计划时调用，因此 busy/hasPlan 时不会递减，与旧逻辑一致。
   * @returns {boolean}
   */
  canStartNewDecision(worldContext) {
    if (this._decisionCooldown > 0) {
      this._decisionCooldown--;
      return false;
    }
    this._decisionCooldown = this._rollDecisionInterval();
    return true;
  }

  /**
   * @override
   * 暴露给 PlannerNode：返回 null 让 GOAP 使用纯路径代价（ADR-021）。
   * 风险/价值/上头/路径偏好等决策因素已迁移至 Utility 选目标层（decorateGoalConsiderations）。
   */
  buildDecisionCostFn(_worldContext) {
    return null;
  }

  /** @override */
  buildGOAPState(worldContext) {
    const flat = super.buildGOAPState(worldContext);
    flat.lowSpiritStone = this.inventory?.getAmount('low_spirit_stone') || 0;
    flat.qiPillCount = this.inventory?.getAmount('item_qi_pill') || 0;
    flat.breakthroughPillCount = this.inventory?.getAmount('item_breakthrough_pill') || 0;
    flat.donatableMaterialCount = countDonatableMaterials(this, this._economyConfig);
    flat.hasEquippedArtifact = !!this.state.get('equippedArtifactId');
    flat.factionHasQiPillMaterial = canFactionProvideExchangeMaterials(this, worldContext, 'qi_pill');
    flat.factionHasBreakthroughPillMaterial = canFactionProvideExchangeMaterials(this, worldContext, 'breakthrough_pill');
    flat.factionHasArtifactMaterial = canFactionProvideExchangeMaterials(this, worldContext, 'artifact_low');
    flat.factionNeedsHuntMaterials = factionNeedsMonsterExchangeMaterials(this, worldContext);
    return flat;
  }

  _refreshEconomyMaterialState(worldContext) {
    this.state.set('donatableMaterialCount', countDonatableMaterials(this, this._economyConfig));
    this.state.set('hasEquippedArtifact', !!this.state.get('equippedArtifactId'));
    this.state.set('factionHasQiPillMaterial', canFactionProvideExchangeMaterials(this, worldContext, 'qi_pill'));
    this.state.set('factionHasBreakthroughPillMaterial', canFactionProvideExchangeMaterials(this, worldContext, 'breakthrough_pill'));
    this.state.set('factionHasArtifactMaterial', canFactionProvideExchangeMaterials(this, worldContext, 'artifact_low'));
    this.state.set('factionNeedsHuntMaterials', factionNeedsMonsterExchangeMaterials(this, worldContext));
  }

  /** @override */
  onPreTick(worldContext) {
    this.state.advanceAge();

    // 记忆每日衰减（ADR-019）：强度随时间淡去，强度归零的记忆被清理。
    if (this.memory) this.memory.decayTick(1);
    // 情绪每日回归基线（ADR-019）：愤怒/恐惧随时间平复。
    if (this.emotions) this.emotions.decayTick(1);

    // 条件执念（ADR-023）：随寿元/境界/野心演化触发养老/传承等人生取向执念。
    if (this.obsessions) this._checkConditionalObsession();

    // 夺舍图谋执念（ADR-029 第三期，轻度）：邪修师傅对高资质徒弟起夺舍执念（关系感知，goalsEnabled gate）。
    if (this.obsessions) this._checkSeizeDiscipleObsession(worldContext);

    // 复仇行为链派生状态（ADR-020）：刷新 hasRevengeTarget（仇人仍在世且可定位）。
    // 仇人已死/失联时置 false，使 act_npc_hunt/kill_enemy 前置失效，GOAP 自然放弃复仇目标。
    this._refreshRevengeState(worldContext);

    // 关系驱动派生状态（ADR-028）：关系对象（支援同门/恩人）失效即清空锁定目标。
    this._refreshRelationshipState(worldContext);

    const deathResult = this.state.checkNaturalDeath();
    if (deathResult && deathResult.died) {
      this.state.set('alive', false);
      this.alive = false;
      this._deathInfo = {
        cause: 'natural',
        npcId: this.id,
        npcName: this.name,
        factionId: this.state.get('factionId'),
        ageYears: this.state.get('ageYears'),
        maxAgeYears: this.state.get('maxAgeYears'),
        rankName: this.state.get('rankName'),
        lifeRatio: this.state.get('lifeRatio'),
        deathChance: deathResult.deathChance,
        roll: deathResult.roll,
      };
      this._handleDeath(worldContext);
      return;
    }

    this._refreshEconomyMaterialState(worldContext);
    this._tryBreakthrough();

    this.state.set('dutyFulfilled', false);
    this.state.set('questTurnedIn', false);

    if (this.state.get('hasActiveQuest') && this.state.get('questDaysRemaining') > 0) {
      this.state.set('questComplete', false);
    }

    const factionId = this.state.get('factionId');
    if (factionId && worldContext.entityRegistry) {
      const faction = worldContext.entityRegistry.getById(factionId);
      if (faction && faction.alive) {
        const stability = faction.state?.get('stability') || 50;
        this.state.set('factionAtPeace', stability >= 60);
        this.state.set('factionInDanger', stability < 30);
      } else {
        // 势力已覆灭：原弟子沦为散修，可转向悬赏阁/坊市谋生
        const wasInFaction = this.state.get('hasFaction') !== false;
        this.state.set('hasFaction', false);
        this.state.set('isWanderer', true);
        this.state.set('factionAtPeace', true);
        this.state.set('factionInDanger', false);
        // 记忆：门派被灭（ADR-019）。仅在"首次"察觉覆灭时记一次，避免每 tick 重复写入。
        if (wasInFaction && this.memory && this.memory.getByType('sect_destroyed').length === 0) {
          this.recordMemory('sect_destroyed', {
            factionId,
            tick: worldContext.currentDay ?? worldContext.day ?? 0,
          });
        }
      }
    }
  }

  /**
   * 境界突破判定（ADR-012/017）：委托 npc-lifecycle。
   * 成功/失败结果写入 this._breakthroughInfo，并按需刷新闭关 cap 前置与路径偏好。
   */
  _tryBreakthrough() {
    tryBreakthroughImpl(this);
  }

  /**
   * 死亡处理：委托 npc-lifecycle（掌门陨落触发继任）。
   * @param {Object} worldContext
   */
  _handleDeath(worldContext) {
    handleDeathImpl(this, worldContext);
  }

  get name() { return this.staticData.name; }

  /** @override */
  toJSON() {
    return {
      ...super.toJSON(),
      name: this.name,
      role: this.state.get('currentRole'),
      factionId: this.state.get('factionId'),
      ageYears: this.state.get('ageYears'),
      maxAgeYears: this.state.get('maxAgeYears'),
      qi: this.state.get('qi') || 0,
      gender: this.state.get('gender') || 'male',
      daoCompanionId: this.state.get('daoCompanionId') || null,
    };
  }
}
