/**
 * NPCEntity - NPC 实体
 */
import { BaseEntity } from '../abstract/base-entity.js';
import { NPCStaticData } from './npc-static-data.js';
import { NPCState } from './npc-state.js';
import { NeedPool } from '../pools/need-pool.js';
import { ActionPool } from '../pools/action-pool.js';
import { estimateRiskCost, computeActionValue } from './npc-actions.js';
import { decorateGoalConsiderations as decorateGoalConsiderationsImpl } from './npc-utility.js';
import { createBTLoader, NPC_DEFAULT_BT } from '../abstract/bt/index.js';
import { MemorySystem, MemoryType } from '../abstract/memory-system.js';
import { RelationshipGraph } from './relationship.js';
import { ObsessionSystem, Obsession } from '../abstract/obsession-system.js';
import { EmotionSystem } from '../abstract/emotion-system.js';
import { Goal, GoalSource } from '../abstract/goal.js';
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
    this.memory = new MemorySystem({ capacity: this._memoryConfig.capacity ?? 32 });
    this.relationships = new RelationshipGraph();

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
   * 先天执念抽取（ADR-019）：按 obsession.json innate.rules 顺序匹配人格/灵根条件，
   * 命中且通过 chance 概率检定则赋予该执念。出生即定型，体现"天生的追求"。
   */
  _rollInnateObsession() {
    const rules = this._obsessionConfig.innate?.rules;
    if (!Array.isArray(rules)) return;
    const personality = this.staticData?.personality || {};
    const spiritRootId = this.state.get('spiritRootId');
    for (const rule of rules) {
      if (rule.requireTrait) {
        const v = personality[rule.requireTrait.trait];
        if (typeof v !== 'number' || v < (rule.requireTrait.min ?? 0)) continue;
      }
      if (rule.requireSpiritRoot && !rule.requireSpiritRoot.includes(spiritRootId)) continue;
      if (Math.random() >= (rule.chance ?? 1)) continue;
      this.obsessions.add(new Obsession({
        type: rule.type,
        name: rule.name,
        intensity: rule.intensity ?? 70,
        goalState: rule.goalState || {},
      }));
      break;
    }
  }

  /**
   * 后天执念触发（ADR-019）：某类记忆刚写入且强度达阈值时，生成对应执念。
   * 复仇/复活执念锁定记忆中的仇人/势力，作为未来"追踪/击杀"行为的 targetRef。
   * @param {MemoryType} memoryType 刚写入的记忆类型
   */
  _checkAcquiredObsession(memoryType) {
    const rules = this._obsessionConfig.acquired?.rules;
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
      if (rule.memoryType !== memoryType) continue;
      const strongest = this.memory.getStrongest(memoryType);
      if (!strongest || strongest.intensity < (rule.minMemoryIntensity ?? 0)) continue;
      this.obsessions.add(new Obsession({
        type: rule.type,
        name: rule.name,
        intensity: rule.intensity ?? 90,
        targetId: strongest.actorId,
        targetFactionId: strongest.factionId,
        goalState: rule.goalState || {},
      }));
    }
  }

  /**
   * 条件执念检查（ADR-023）：随 NPC 状态演化（寿元/境界/野心）触发的执念，
   * 区别于先天 roll（_rollInnateObsession）与记忆触发（_checkAcquiredObsession）。
   * 养老(retire)/传承(legacy) 属此类——人到暮年自然萌生的人生取向。
   * 在 onPreTick 每日调用：按 requireState 全部满足 + requireTrait + chance 概率检定生成。
   * 已有同类型执念则 ObsessionSystem.add 自动去重（保留强度更高者）。
   */
  _checkConditionalObsession() {
    const rules = this._obsessionConfig.conditional?.rules;
    if (!Array.isArray(rules)) return;
    const personality = this.staticData?.personality || {};
    for (const rule of rules) {
      if (this.obsessions.has(rule.type)) continue;
      if (Array.isArray(rule.requireState)
          && !rule.requireState.every(c => this._matchStateCondition(c))) continue;
      if (rule.requireTrait) {
        const v = personality[rule.requireTrait.trait];
        if (typeof v !== 'number') continue;
        if (rule.requireTrait.min != null && v < rule.requireTrait.min) continue;
        if (rule.requireTrait.max != null && v > rule.requireTrait.max) continue;
      }
      if (Math.random() >= (rule.chance ?? 1)) continue;
      this.obsessions.add(new Obsession({
        type: rule.type,
        name: rule.name,
        intensity: rule.intensity ?? 70,
        goalState: rule.goalState || {},
      }));
    }
  }

  /**
   * 比较一条 { key, op, value } 状态条件（语义同 Need._evaluateCondition）。
   * @param {{ key: string, op: string, value: * }} cond
   * @returns {boolean}
   */
  _matchStateCondition(cond) {
    if (!cond) return true;
    const actual = this.state.get(cond.key);
    switch (cond.op) {
      case 'lt': return actual < cond.value;
      case 'lte': return actual <= cond.value;
      case 'gt': return actual > cond.value;
      case 'gte': return actual >= cond.value;
      case 'eq': return actual === cond.value;
      case 'neq': return actual !== cond.value;
      case 'exists': return actual != null;
      default: return false;
    }
  }

  /**
   * @override
   * 收集执念目标（ADR-019），与日常需求目标一起进入 PlannerNode 的 Utility 选择。
   * 强执念（intensity 高）会压过普通需求，驱动 NPC 长期围绕执念行动（如拼命变强）。
   */
  collectExtraGoals(worldContext) {
    const goals = this.obsessions ? this.obsessions.toGoals() : [];
    // 机会点目标（ADR-024）：基于已知消息评估出值得前往的机会点时，生成一个前往 Goal。
    // 仅在机会系统 enabled 且存在可行机会时产出，否则不影响既有规划（零漂移）。
    const oppGoal = this._buildOpportunityGoal(worldContext);
    if (oppGoal) goals.push(oppGoal);
    return goals;
  }

  /**
   * 依世界上下文为本 NPC 构造一个"前往机会点"的 Goal（ADR-024）。
   * 把选中的机会点 id 写入 state.targetOpportunityId，供 nearest_opportunity 解析坐标。
   * @returns {import('../abstract/goal.js').Goal|null}
   */
  _buildOpportunityGoal(worldContext) {
    if (typeof worldContext?.bestOpportunityFor !== 'function') return null;
    const pick = worldContext.bestOpportunityFor(this);
    if (!pick) {
      this.state.set('targetOpportunityId', null);
      return null;
    }
    this.state.set('targetOpportunityId', pick.opp.id);
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

  /**
   * 刷新复仇派生状态（ADR-020）：依世界上下文判断是否存在可定位的在世仇人。
   * 仇人已死/失联时清空 hasRevengeTarget 与 nearRevengeTarget，使复仇行为链前置失效，
   * GOAP 下一轮重规划时自然不再选追踪/击杀，转回日常目标。
   * @param {Object} worldContext
   */
  _refreshRevengeState(worldContext) {
    // 复仇已达成（仇人已被本 NPC 手刃）：清除复仇执念，重置派生状态，回归日常。
    if (this.state.get('enemyKilled') === true && this.obsessions) {
      this.obsessions.obsessions = this.obsessions.obsessions.filter(o => o.type !== 'revenge');
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

    // 复仇行为链派生状态（ADR-020）：刷新 hasRevengeTarget（仇人仍在世且可定位）。
    // 仇人已死/失联时置 false，使 act_npc_hunt/kill_enemy 前置失效，GOAP 自然放弃复仇目标。
    this._refreshRevengeState(worldContext);

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
   * 境界突破判定
   *
   * 突破条件：cultivationProgress >= 1.0 且 qi >= 目标境界 qiRequired
   * 成功率基于目标境界递减，寿元接近上限时额外惩罚。
   * 成功后：消耗真气、更新 rankId/rankName、按新境界寿元延长寿命。
   * 失败后：回退修炼进度至 0.3，真气损失 30%。
   */
  _tryBreakthrough() {
    // 突破以总进度为准：闭关进度(受境界 cultivationCap 上限)+ 游历感悟(insight)。
    const cultivationProgress = this.state.get('cultivationProgress') || 0;
    const progress = cultivationProgress + (this.state.get('insight') || 0);
    if (progress < 1.0) return;

    // 闭关进度至少占最低比例(minCultivationRatio，默认 0.3)才允许突破：
    // 防止纯靠游历感悟“速成”，确保根基（闭关）达标。见 ADR-017。
    const minCultivationRatio = this._cultivationConfig.minCultivationRatio ?? 0.3;
    if (cultivationProgress < minCultivationRatio) return;

    const currentRankId = this.state.get('rankId') || 'mortal';
    const ranks = this._ranksData;
    if (!ranks || ranks.length === 0) return;

    const currentRank = ranks.find(r => r.id === currentRankId);
    if (!currentRank) return;

    const currentOrder = currentRank.order;
    const cultivationRanks = ranks
      .filter(r => r.category === 'cultivation')
      .sort((a, b) => a.order - b.order);

    const nextRank = cultivationRanks.find(r => r.order > currentOrder);
    if (!nextRank) return;

    const currentQi = this.state.get('qi') || 0;
    const qiRequired = nextRank.qiRequired || 0;
    if (currentQi < qiRequired) return;

    const successRate = this._getBreakthroughRate(currentRankId, nextRank.id);
    const breakthroughCfg = this._cultivationConfig.breakthrough || {};

    // 先天资质突破加成：灵根 + 体质 breakthroughBonus 累加进基础成功率（详见 ADR-012）
    const rootGrade = this._cultivationConfig.spiritRoot?.grades?.[this.state.get('spiritRootId')];
    const physiqueType = this._cultivationConfig.physique?.types?.[this.state.get('physiqueId')];
    const talentBonus = (rootGrade?.breakthroughBonus ?? 0) + (physiqueType?.breakthroughBonus ?? 0);
    const techniqueBonus = this.state.get('techniqueBreakthroughBonus') || 0;
    const aidBonus = this.state.get('breakthroughAidBonus') || 0;

    const ageDays = this.state.get('ageDays') || 0;
    const maxAgeDays = this.state.get('maxAgeDays') || 1;
    const agePenaltyThreshold = breakthroughCfg.agePenaltyThreshold ?? 0.8;
    const agePenaltyMultiplier = breakthroughCfg.agePenaltyMultiplier ?? 0.7;
    const ageModifier = ageDays > maxAgeDays * agePenaltyThreshold ? agePenaltyMultiplier : 1.0;

    const baseRate = Math.max(0, Math.min(1, successRate + talentBonus + techniqueBonus + aidBonus));
    const finalRate = baseRate * ageModifier;
    const roll = Math.random();
    if (aidBonus !== 0) this.state.set('breakthroughAidBonus', 0);

    if (roll < finalRate) {
      this.state.set('rankId', nextRank.id);
      this.state.set('rankName', nextRank.name);
      this.state.set('cultivationProgress', 0);
      this.state.set('insight', 0);
      this.state.set('qi', currentQi - qiRequired);

      const lifespan = nextRank.lifespan;
      if (lifespan) {
        const variance = (Math.random() - 0.5) * 2 * lifespan.varianceYears;
        // 体质寿元加成：先天道体等特殊体质额外延长寿元（详见 ADR-012）
        const physiqueLifeBonus = physiqueType?.lifespanBonus ?? 0;
        const newMaxAgeYears = (lifespan.baseYears + variance) * (1 + physiqueLifeBonus);
        const newMaxAgeDays = Math.floor(newMaxAgeYears * 360);
        if (newMaxAgeDays > maxAgeDays) {
          this.state.set('maxAgeDays', newMaxAgeDays);
          this.state.set('maxAgeYears', Math.floor(newMaxAgeYears));
          this.state.set('lifeRatio', ageDays / newMaxAgeDays);
        }
      }

      // 境界提升后，闭关 cap 随之变化（通常更低，更依赖游历），刷新行为前置。
      this.refreshCultivationCapPreconditions();
      // 新境界开始：随机本境界的游历/闭关先后偏好（顺序随机，ADR-017）。
      this._rollBreakthroughPathOrder();

      this._breakthroughInfo = {
        npcId: this.id,
        npcName: this.name,
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
      const capMap = this._cultivationConfig.cultivationCap || {};
      const cap = capMap[currentRankId] ?? 1.0;
      this.state.set('cultivationProgress', Math.min(failureProgress, cap));
      this.state.set('insight', 0);
      this.state.set('qi', Math.floor(currentQi * failureQiRetention));
      this._breakthroughInfo = {
        npcId: this.id,
        npcName: this.name,
        fromRank: currentRank.name,
        targetRank: nextRank.name,
        success: false,
        qiLost: Math.floor(currentQi * (1 - failureQiRetention)),
        aidBonus,
      };
    }
  }

  /**
   * @returns {number} 基础突破成功率
   * 优先读取 cultivationConfig.breakthrough.successRates，回退到内置默认值
   */
  _getBreakthroughRate(fromRankId, toRankId) {
    const breakthroughCfg = this._cultivationConfig.breakthrough || {};
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

  _handleDeath(worldContext) {
    const factionId = this.state.get('factionId');
    const role = this.state.get('currentRole');

    if (role === 'leader' && factionId && worldContext.entityRegistry) {
      this._triggerSuccession(factionId, worldContext);
    }
  }

  _triggerSuccession(factionId, worldContext) {
    const registry = worldContext.entityRegistry;
    const npcs = registry.getAliveByType('npc');
    const candidates = npcs.filter(n =>
      n.state.get('factionId') === factionId && n.id !== this.id
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
          const sa = this._successionScoreOf(a);
          const sb = this._successionScoreOf(b);
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

  /** 取候选人的继任分数：优先 ranks.json 的 successionScore（按 rankId），回退到 rank.order */
  _successionScoreOf(npc) {
    const rankId = npc.state.get('rankId');
    const rank = this._ranksData.find(r => r.id === rankId);
    if (!rank) return 0;
    return rank.successionScore ?? rank.order ?? 0;
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
