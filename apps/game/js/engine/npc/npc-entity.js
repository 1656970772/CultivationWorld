/**
 * NPCEntity - NPC 实体
 */
import { BaseEntity } from '../abstract/base-entity.js';
import { GoalSource } from '../abstract/goal.js';
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
import { EventAwareness } from './event-awareness.js';
import { DynamicGoalProvider } from './dynamic-goals.js';
import { InterruptPolicy, InterruptDecision } from './interrupt-policy.js';
import {
  tryBreakthrough as tryBreakthroughImpl,
  handleDeath as handleDeathImpl,
} from './npc-lifecycle.js';
import { createBTLoader, NPC_DEFAULT_BT } from '../abstract/bt/index.js';
import { StimulusQueue, StimulusType } from '../abstract/stimulus.js';
import { IntentService } from './intent-service.js';
import { MemorySystem, MemoryType } from '../abstract/memory-system.js';
import { RelationshipGraph } from './relationship.js';
import { ObsessionSystem, Obsession } from '../abstract/obsession-system.js';
import { EmotionSystem } from '../abstract/emotion-system.js';
import { AbilityComponent } from '../abstract/ability-component.js';
import { ItemRegistry } from '../items/item-registry.js';
import { EffectEngine } from '../abstract/gameplay-effect.js';
import { EffectPool } from '../pools/effect-pool.js';
import { Rng } from '../abstract/rng.js';
import {
  applyTraitEffects,
  readTraitSpeedMult,
  readTraitHpMult,
} from './npc-traits.js';
import {
  canFactionProvideExchangeMaterials,
  countDonatableMaterials,
  factionNeedsMonsterExchangeMaterials,
} from './npc-economy.js';

function seedFromId(id) {
  let h = 2166136261;
  for (const ch of String(id || 'npc')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

/** NPC 共享 BTLoader（已注册 planner 节点）。PlannerNode 无内部状态，可被各 NPC 安全复用。 */
const NPC_BT_LOADER = createBTLoader();
const DYNAMIC_INTERRUPT_DECISION_RANK = Object.freeze({
  [InterruptDecision.IGNORE]: 0,
  [InterruptDecision.KEEP_CURRENT_QUEUE]: 1,
  [InterruptDecision.AFTER_STEP]: 2,
  [InterruptDecision.INTERRUPT_NOW]: 3,
});

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
    // 确定性随机源（由 WorldEngine 经 entityConfig 注入）。实体内部所有随机统一走 this._rng。
    this._rng = entityConfig.rng || new Rng(seedFromId(npcConfig.id));
    this._cultivationConfig = entityConfig.cultivationConfig || {};
    this._combatConfig = entityConfig.combatConfig || {};
    this._personalityConfig = entityConfig.personalityConfig || {};
    this._aiConfig = entityConfig.aiConfig || {};
    this._memoryConfig = entityConfig.memoryConfig || {};
    this._obsessionConfig = entityConfig.obsessionConfig || {};
    this._emotionConfig = entityConfig.emotionConfig || {};
    this._utilityConfig = entityConfig.utilityConfig || {};
    this._economyConfig = entityConfig.economyConfig || {};
    this._actionSets = entityConfig.actionSets || {};
    this.initStaticData(npcConfig);
    this.state = new NPCState(npcConfig, ranksData, entityConfig.gameConfig || {}, this._rng);
    // 把性格暴露到 state 上（仅作只读引用，存于专用字段，不进 _values，故不污染 GOAP 状态键）
    this.state.personality = this.staticData.personality || {};
    this._initTalent(npcConfig);
    // 能力组件 + 先天特质修正层须在 _initHp 之前建好：_computeMaxHp 经 AttributeSet 读 traitHpMult。
    this._initAbilityComponent();
    this._initHp();
    this._initInventory(npcConfig);
    this._initAbilities(npcConfig);
    this._initNeeds(npcConfig);
    this._initActions(npcConfig);
    this._rollBreakthroughPathOrder();

    // 决策相位：无决策冷却——空闲时每天都可重新规划。仅用 decisionPhaseMax 做【开局错相】，
    // 让各 NPC 首次决策错开 0~phaseMax 天，避免开局全员同 tick 齐步规划造成性能峰值。
    // 错相用完后 canStartNewDecision 恒返回 true（每天可决策）。
    this._decisionPhaseMax = this._aiConfig.decisionPhaseMax ?? 12;
    this._decisionPhase = Math.floor(this._rng.next() * (this._decisionPhaseMax + 1));

    // 长期记忆与个人恩怨图（GOBT 长期心智，ADR-019）。
    // 个人恩怨图绑定到世界级关系网（ADR-027）：grudge/gratitude 成为统一关系网的边，
    // 接口不变，复仇链零改动。无 relationshipSystem 时（独立单测）回退内部 Map。
    this.memory = new MemorySystem({ capacity: this._memoryConfig.capacity ?? 32 });
    this._relationshipSystem = entityConfig.relationshipSystem || null;
    // 关系网配置（ADR-028 二期）：含 goalsEnabled 与 npcGoals 阈值，供关系驱动 Goal 读取。
    this._relationshipConfig = entityConfig.relationshipConfig || {};
    this._dynamicGoalConfig = entityConfig.dynamicGoalConfig || {};
    this.eventAwareness = new EventAwareness();
    this.relationships = new RelationshipGraph(
      this._relationshipSystem
        ? { system: this._relationshipSystem, ownerId: this.id }
        : {}
    );

    // 执念系统（ADR-019）：先天按人格/灵根 roll 一个初始执念。
    // goalMult（ADR-020）：执念对自身/同方向需求 Goal 的乘法加成（默认 enabled=false，不改变现有行为）。
    this.obsessions = new ObsessionSystem(this._obsessionConfig.goalMult || null);
    this._rollInnateObsession();

    // 情绪系统（ADR-019）：由记忆事件激发、每日回归基线，作为 Utility 乘子调制目标。
    this.emotions = new EmotionSystem(this._emotionConfig);

    // 反应层刺激队列（四层 AI 架构 Reaction 层，ADR-048）：外部系统（攻击方/世界事件）
    // 在事件发生瞬间 pushStimulus，本 NPC 在自身 tick 的反应层（ReactiveNode）最先消费，
    // 获得「即时反应」语义而无需子 tick，全程同步、确定性可复现。
    const reactionCfg = entityConfig.reactionConfig || {};
    this._reactionConfig = reactionCfg;
    this.stimulusQueue = new StimulusQueue({
      ttl: reactionCfg.stimulusTtl ?? 2,
      capacity: reactionCfg.stimulusCapacity ?? 16,
    });
    // 立即重决策请求标记（ADR-048）：大事件（秘境/拍卖/大比/遇仇人）置真，
    // PlannerNode 门控见到后即便当前正执行计划也立即重选目标+重规划（打断长链）。
    this._replanRequested = false;
    this._deferredReplanRequested = null;
    this._lastDynamicInterrupt = null;

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
   * 反应层入口：外部系统向本 NPC 压入一条刺激（ADR-048）。
   * 攻击方在 applyDamage 命中后、世界系统在大事件发生时调用。纯同步，确定性。
   * @param {string} type StimulusType 之一
   * @param {Object} [opts] { priority, sourceId, payload, day }
   */
  pushStimulus(type, opts = {}) {
    if (!this.stimulusQueue) return;
    this.stimulusQueue.push(type, opts);
  }

  /**
   * 请求立即重决策（ADR-048）：大事件触发后置标记，使 PlannerNode 即便在执行计划中途
   * 也立即重选目标+重规划（打断长链）。仅置标记，不直接改计划（单一职责）。
   * @param {string} [_reason] 调试用原因
   */
  requestReplan(_reason = null) {
    this._replanRequested = true;
  }

  /**
   * 消费立即重决策标记（ADR-048）：供 PlannerNode 门控查询并清除（一次性）。
   * @returns {boolean} 是否有待处理的重决策请求
   */
  consumeReplanRequest() {
    if (!this._replanRequested) return false;
    this._replanRequested = false;
    return true;
  }

  /**
   * 意图层入口（四层 AI 架构 Utility 层，ADR-048）：委托 IntentService 选目标 + GOAP 规划。
   * 供 PlannerNode._doPlan 调用，使「选目标」逻辑集中于意图层服务（单一真相源）。
   * @param {Object} worldContext
   */
  selectIntent(worldContext) {
    return IntentService.selectGoal(this, worldContext);
  }

  /**
   * 大事件 → 动态决策（四层 AI 架构 Utility 层，ADR-048）：
   * 检测本 tick 新出现的高优先事件（遇仇人 / 知晓可达机缘：秘境/拍卖/天材地宝），
   * 向自身压入对应刺激并请求立即重决策（requestReplan），使 PlannerNode 即便正执行长链
   * 也立即打断、重选目标。仅在 reaction.eventReplan.enabled=true 时生效（默认 false，不改变现有行为）。
   *
   * 注意：本方法只「检测变化 + 置请求」，具体目标（复仇执念 / 机会 Goal）仍由既有
   * collectExtraGoals/buildOpportunityGoal 经 Utility 选出（单一真相源，不在此处造目标）。
   * @param {Object} worldContext
   */
  _checkEventReplan(worldContext) {
    const reactionCfg = this._reactionConfig || {};
    const evCfg = reactionCfg.eventReplan || {};
    if (evCfg.enabled !== true) return;
    const day = worldContext.currentDay ?? worldContext.day ?? 0;

    // 遇仇人：hasRevengeTarget 由 false 跃迁为 true（本 tick 新锁定可定位的在世仇人）。
    const hasRevenge = this.state.get('hasRevengeTarget') === true;
    if (hasRevenge && this._prevHasRevengeTarget !== true) {
      const target = (typeof worldContext.resolveRevengeTarget === 'function')
        ? worldContext.resolveRevengeTarget(this)
        : null;
      this.pushStimulus(StimulusType.ENEMY_SPOTTED, {
        sourceId: target?.id ?? null,
        day,
        payload: { enemyId: target?.id ?? null },
      });
      this.requestReplan('enemy_spotted');
    }
    this._prevHasRevengeTarget = hasRevenge;

    // 知晓可达机缘：本 tick 新获得一个最值得前往的机会点（秘境/拍卖/天材地宝/妖兽尸骸）。
    if (evCfg.opportunityReplan !== false && typeof worldContext.bestOpportunityFor === 'function') {
      const pick = worldContext.bestOpportunityFor(this);
      const oppId = pick?.opp?.id ?? null;
      if (oppId && oppId !== this._prevOpportunityId) {
        this.pushStimulus(this._opportunityStimulusType(pick.opp), {
          sourceId: oppId,
          day,
          payload: { opportunityId: oppId, opportunityType: pick.opp?.type ?? null },
        });
        this.requestReplan('opportunity');
      }
      this._prevOpportunityId = oppId;
    }
  }

  /** 机会点类型 → 刺激类型（秘境/拍卖映射到对应枚举，其余归为发现宝物，ADR-048）。 */
  _opportunityStimulusType(opp) {
    const t = opp?.type || '';
    if (typeof t === 'string') {
      if (t.includes('secret') || t.includes('realm')) return StimulusType.SECRET_REALM;
      if (t.includes('auction')) return StimulusType.AUCTION;
    }
    return StimulusType.TREASURE_SPOTTED;
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
   * utility.json `enabled=false`(默认) 时为空操作 → 不改变现有行为。
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
      knownDynamicEvents: this.eventAwareness ? this.eventAwareness.snapshot().known.slice(0, 5) : [],
      dynamicInterrupt: this._lastDynamicInterrupt || null,
    };
  }

  /**
   * 先天执念抽取（ADR-019）：委托 npc-obsession-trigger（出生即定型）。
   */
  _rollInnateObsession() {
    rollInnateObsessionImpl(this, this._rng);
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
    checkConditionalObsessionImpl(this, this._rng);
  }

  /**
   * @override
   * 收集执念目标（ADR-019）：委托 npc-goals（执念 + 机会 + 关系/师徒 Goal）。
   */
  collectExtraGoals(worldContext) {
    return collectExtraGoalsImpl(this, worldContext);
  }

  _syncDynamicEventAwareness(worldContext) {
    if (!this.eventAwareness || typeof worldContext?.knownDynamicEventsFor !== 'function') return;
    const day = worldContext.currentDay ?? worldContext.day ?? 0;
    const known = worldContext.knownDynamicEventsFor(this) || [];
    for (const entry of known) {
      if (!entry?.event) continue;
      this.eventAwareness.learn(entry.event, {
        confidence: entry.confidence ?? 0,
        source: entry.source ?? 'unknown',
        scope: entry.scope ?? null,
        visibilityScope: entry.visibilityScope ?? null,
        day: entry.day ?? day,
      });
    }
  }

  collectDynamicGoals(worldContext) {
    return DynamicGoalProvider.collect(this, worldContext);
  }

  _checkDynamicGoalInterrupts(worldContext) {
    const config = worldContext?.dynamicGoalConfig ?? this._dynamicGoalConfig ?? {};
    if (config.enabled !== true) {
      this._deferredReplanRequested = null;
      return;
    }

    const goals = this.collectDynamicGoals(worldContext)
      .filter(goal => goal?.source === GoalSource.DYNAMIC);
    if (goals.length === 0) {
      this._deferredReplanRequested = null;
      return;
    }

    const chosen = this._selectDynamicInterrupt(goals, worldContext);
    if (!chosen) {
      this._deferredReplanRequested = null;
      return;
    }
    const { goal: best, interrupt } = chosen;
    this._lastDynamicInterrupt = interrupt;

    if (interrupt.decision === InterruptDecision.INTERRUPT_NOW) {
      this._deferredReplanRequested = null;
      this.requestReplan(`dynamic:${interrupt.goalId}`);
      return;
    }
    if (interrupt.decision === InterruptDecision.AFTER_STEP) {
      this._deferredReplanRequested = {
        eventId: interrupt.eventId,
        goalId: interrupt.goalId,
        day: interrupt.day,
      };
      return;
    }
    this._deferredReplanRequested = null;
    if (interrupt.decision === InterruptDecision.IGNORE && interrupt.eventId && this.eventAwareness) {
      const day = worldContext.currentDay ?? worldContext.day ?? 0;
      const ignoreDays = best.dynamic?.interrupt?.ignoreDays ?? config.interrupt?.ignoreDays ?? 10;
      this.eventAwareness.ignore(interrupt.eventId, day + ignoreDays);
    }
  }

  _selectDynamicInterrupt(goals, worldContext) {
    let best = null;
    for (const goal of goals) {
      const interrupt = InterruptPolicy.decide(this, goal, worldContext);
      const rank = DYNAMIC_INTERRUPT_DECISION_RANK[interrupt.decision] ?? 0;
      const candidate = { goal, interrupt, rank };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.rank !== best.rank) {
        if (candidate.rank > best.rank) best = candidate;
        continue;
      }
      if (interrupt.score !== best.interrupt.score) {
        if (interrupt.score > best.interrupt.score) best = candidate;
        continue;
      }
      if (goal.urgencyScore() > best.goal.urgencyScore()) best = candidate;
    }
    return best;
  }

  onPlanChosen() {
    const result = this.behaviorSystem?.getLastPlanResult?.();
    if (result?.goalSource === GoalSource.DYNAMIC && result.dynamicEventId) {
      this.state.set('targetDynamicEventId', result.dynamicEventId);
      this.state.set('targetDynamicEventType', result.dynamicEventType || null);
    } else {
      this.state.set('targetDynamicEventId', null);
      this.state.set('targetDynamicEventType', null);
    }
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
   * 使关系行为链前置失效，GOAP 下一轮重规划自然放弃，回归日常。
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

    // 复仇追击提速（行为精准化 2026-06-02）：破解『同速追逐困局』。NPC 与仇人皆 1 格/天，
    // 追击者去追仇人旧坐标、仇人又移走，几乎永远差一步（实测 330 次追踪仅 1 次同格）。
    // 复仇/夺舍执念在身时给追击者速度加成，体现『穷追不舍、千里追杀』，使其能真正逼近仇人。
    if (this.hasSpatial && this.hasSpatial()) {
      const sp = this.spatial;
      if (this._baseSpeed == null) this._baseSpeed = sp.speed;
      const boost = this._aiConfig.revengePursuitSpeed ?? 2;
      sp.speed = hasTarget ? Math.max(this._baseSpeed, boost) : this._baseSpeed;
    }
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
    let roll = this._rng.next() * total;
    for (const [key, v] of entries) {
      roll -= (v.weight || 0);
      if (roll < 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  _initInventory(config) {
    // 起始物品：低阶灵石 + 可选 items 映射（如天才自带遁地符 { item_escape_talisman: 2 }）。
    const initial = { low_spirit_stone: config.spiritStone || 0 };
    if (config.items && typeof config.items === 'object') {
      for (const [itemId, amount] of Object.entries(config.items)) {
        if (amount > 0) initial[itemId] = (initial[itemId] || 0) + amount;
      }
    }
    this.inventory.loadFrom(initial);
  }

  /**
   * 初始化能力系统组件（ADR-042）：创建 AbilityComponent，授予能力。
   * 能力来源：① 背包中带 grantsAbilities 的物品（如遁地符）；② npcConfig.abilities 显式授予。
   * 持遁地符即获 ga_lock_hp（锁血）+ ga_escape_talisman（遁地），二者可组合。
   */
  /**
   * 创建能力系统组件 + 注入先天特质（ADR-042 阶段2）。须在 _initHp 之前调用。
   * - 先天特质 Tag（可组合查询层）：灵根/体质表达为层级 Tag（Trait.SpiritRoot.{id} / Trait.Physique.{id}）。
   * - 先天特质修正层（Infinite Effect）：灵根/体质的 speed/breakthrough/lifespan/hp 加成经 AttributeSet 生效
   *   （cultivation.json traitEffects.enabled 开关，默认 true；数值仍以 cultivation.json 为单一真相源）。
   */
  _initAbilityComponent() {
    this.abilityComponent = new AbilityComponent(this);
    this.attributes = this.abilityComponent.attributes;

    const spiritRootId = this.state.get('spiritRootId');
    if (spiritRootId) this.abilityComponent.tags.add(`Trait.SpiritRoot.${spiritRootId}`);
    const physiqueId = this.state.get('physiqueId');
    if (physiqueId) this.abilityComponent.tags.add(`Trait.Physique.${physiqueId}`);

    applyTraitEffects(this);
  }

  _initAbilities(config) {
    // 显式授予（npcs.json 可写 abilities:["ga_xxx"]）。
    if (Array.isArray(config.abilities)) {
      for (const id of config.abilities) this.abilityComponent.grantAbility(id);
    }
    // 由背包物品授予（遁地符等）。
    this.refreshItemGrantedAbilities();
  }

  /**
   * 根据当前背包中带 grantsAbilities 的物品，授予对应能力（幂等）。
   * 持有遁地符 → 授予锁血 + 遁地能力。后续兑换得到符时也应调用本方法刷新。
   */
  refreshItemGrantedAbilities() {
    if (!this.abilityComponent) return;
    for (const [itemId, amount] of Object.entries(this.inventory.getAll())) {
      if (amount <= 0) continue;
      const def = ItemRegistry.get(itemId);
      const grants = def?.properties?.grantsAbilities;
      if (Array.isArray(grants)) {
        for (const abilityId of grants) this.abilityComponent.grantAbility(abilityId);
      }
    }
  }

  /** @override */
  initStaticData(config) {
    this.staticData = new NPCStaticData(config);
  }

  _initNeeds(config) {
    const needIds = config.needIds || [
      'need_npc_survival', 'need_npc_heal',
      'need_npc_active_quest', 'need_npc_donate_materials',
      'need_npc_combat_recovery', 'need_npc_combat_supply', 'need_npc_hunt_companion',
      'need_npc_cultivation', 'need_npc_breakthrough_aid',
      'need_npc_combat_gear', 'need_npc_hunt_resources', 'need_npc_loyalty_duty',
      'need_npc_ambition',
      // 散修生计（2026-06-02 行为精准化）：散修无门派俸禄，须接坊市悬赏自食其力，仅 isWanderer 触发。
      'need_npc_wanderer_subsistence',
    ];

    for (const needId of needIds) {
      if (NeedPool.has(needId)) {
        this.needSystem.addNeed(NeedPool.create(needId));
      }
    }
  }

  _initActions(config) {
    const defaultActionIds = this._actionSets.defaultNpcActionIds || [
      'act_npc_serve_faction',
      'act_npc_seek_elixir', 'act_npc_challenge',
      'act_npc_assist_faction',
      'act_npc_donate_materials',
      'act_npc_redeem_breakthrough_pill', 'act_npc_use_breakthrough_pill',
      'act_npc_redeem_artifact',
      // 流派分化行为（ADR-022/ADR-023）：夺宝/养老/传承/夺权。
      // 这些行为的执念目标（treasureObtained/atPeace/discipleRaised/isFactionLeader）默认无人持有，
      // 仅当 NPC 经 obsession.json 规则 roll/触发到对应执念时，其 Goal 才进入 Utility 选择，
      // 故加入可用行为池不改变未持执念 NPC 的既有规划。
      'act_npc_raid_treasure', 'act_npc_seclude',
      'act_npc_take_disciple', 'act_npc_seize_power',
      // 机会点前往行为（ADR-024）：仅当机会系统 enabled 且 NPC 知晓可行机会时，
      // collectExtraGoals 才产出 opportunity Goal 触发本行为。
      'act_npc_goto_opportunity',
      // 关系驱动行为（ADR-028）：驰援同门 / 探望恩人。仅当 goalsEnabled 且存在 qualifying 关系边时，
      // collectExtraGoals 才产出对应关系 Goal 触发本行为。
      'act_npc_assist_ally', 'act_npc_visit_benefactor',
      // 师徒互动行为（ADR-029）：师傅护徒(驰援)。传功/探望已迁移到 JobAction。
      // 存在 qualifying master/disciple 边时，collectExtraGoals 才产出对应 Goal 触发本行为。
      'act_npc_protect_disciple',
      // 反应层行为（四层 AI 架构 Reaction 层，ADR-048）：逃命/暂避/回血/反击。
      // 仅由 ReactiveNode 在被攻击刺激命中时 setSingleActionPlan 强制选取（不进 GOAP/Utility 规划），
      // 且仅当 reaction.enabled=true 时反应层才会消费刺激，故加入可用池不改变既有规划。
      'act_npc_react_flee', 'act_npc_react_retreat',
      'act_npc_react_heal', 'act_npc_react_counter',
    ];
    const defaultJobActionIds = this._actionSets.defaultNpcJobActionIds || [
      'act_npc_prepare_dynamic_event',
      'act_npc_join_dynamic_event',
      'act_npc_prepare_secret_realm',
      'act_npc_prepare_sect_tournament',
      'act_npc_acquire_heal_item',
      'act_npc_acquire_artifact',
      'act_npc_job_cultivate',
      'act_npc_job_train_chamber',
      'act_npc_job_heal',
      'act_npc_job_explore',
      'act_npc_accept_monster_hunt_job',
      'act_npc_accept_quest_job',
      'act_npc_execute_quest_job',
      'act_npc_turn_in_quest_job',
      'act_npc_job_redeem_qi_pill',
      'act_npc_job_use_qi_pill',
      'act_npc_job_hunt_enemy',
      'act_npc_job_kill_enemy',
      'act_npc_job_teach_disciple',
      'act_npc_job_visit_master',
    ];
    const actionIds = config.actionIds
      ? config.actionIds
      : [
          ...defaultActionIds,
          ...(this._aiConfig.jobs?.enabled === true ? defaultJobActionIds : []),
        ];
    this.state.set('jobsEnabled', this._aiConfig.jobs?.enabled === true);

    const actions = [];
    for (const actionId of actionIds) {
      if (ActionPool.has(actionId)) {
        actions.push(ActionPool.create(actionId));
      }
    }
    this._applyCultivationCapPreconditions(actions);
    const maxDepth = this._aiConfig.maxDepth ?? 10;
    const maxIterations = this._aiConfig.maxIterations ?? 300;
    this.initBehaviorSystem(actions, { maxDepth, maxIterations }, { jobsEnabled: this._aiConfig.jobs?.enabled === true });
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
    const cappedActionIds = ['act_npc_job_cultivate', 'act_npc_job_train_chamber'];
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
    const order = this._rng.next() < 0.5 ? 'explore_first' : 'cultivate_first';
    this.state.set('breakthroughPathOrder', order);
  }

  /**
   * @override
   * 决策门控（GOBT：供 PlannerNode 在"空闲且无计划"时询问是否可重新规划，ADR-018）。
   * 无决策冷却：空闲时每天都可重新评估需求并规划，避免修炼被战斗打断后长期空闲卡进度。
   * 仅保留【开局错相】：首次决策前递减初始相位，错开各 NPC 的首次规划 tick；相位用完后恒放行。
   * 注意：仅在 PlannerNode 判定空闲且无计划时调用，故执行多 tick 行为（闭关等）期间不会被打断。
   * @returns {boolean}
   */
  canStartNewDecision(worldContext) {
    if (this._decisionPhase > 0) {
      this._decisionPhase--;
      return false;
    }
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

  /**
   * 每日被动真气吸纳（ADR-039）：参考凡人修仙传"修士时刻吸纳天地灵气炼化为真气"。
   * 即便不主动闭关、在做任务/游历/管理，真气仍缓慢增长（远慢于专心修炼），
   * 乘灵根/体质/功法速度倍率（与修炼同源）。破解"闭关进度撞顶停修后真气停滞"死锁。
   * @param {Object} worldContext
   */
  _passiveQiAbsorb(worldContext) {
    const cult = this._cultivationConfig;
    if (!cult) return;
    const baseMap = cult.passiveQiGain?.base;
    if (!baseMap) return;
    const rankId = this.state.get('rankId') || 'mortal';
    const base = baseMap[rankId];
    if (!base) return;

    // 灵根+体质修炼速度连乘（ADR-042 阶段2）：经 AttributeSet traitSpeedMult 生效（开关关则回退直接读 config）。
    let mult = readTraitSpeedMult(this);
    const techniqueId = this.state.get('techniqueId');
    if (techniqueId && worldContext.techniqueRegistry) {
      const technique = worldContext.techniqueRegistry.get(techniqueId);
      if (technique?.effects) mult *= technique.effects.cultivationSpeedMultiplier ?? 1.0;
    }

    const gain = base * mult;
    if (gain > 0) this.state.set('qi', (this.state.get('qi') || 0) + gain);
  }

  /**
   * 真气是否尚未达到下一境界突破门槛（qi < nextRank.qiRequired）。
   * 用于 gate 聚气丹兑换/服用：只要真气不够突破，就应允许补真气——
   * 替代旧的错误前置 totalProgress<1.0（进度满≠真气够，会锁死天才，见 ADR-039）。
   * 已是最高境界（无下一境界）时返回 false（无需再补真气突破）。
   * @returns {boolean}
   */
  /**
   * 计算当前境界与体质下的 maxHp（ADR-041 阶段1）。
   * maxHp = combat.npcHp.baseHp[境界] × 体质 hpBonusMultiplier。
   * @returns {number}
   */
  _computeMaxHp() {
    const baseHpMap = this._combatConfig.npcHp?.baseHp || {};
    const rankId = this.state.get('rankId') || 'mortal';
    const baseHp = baseHpMap[rankId] ?? 30;
    // 体质血量上限倍率（ADR-042 阶段2）：经 AttributeSet traitHpMult 生效（开关关则回退直接读 config）。
    const hpBonus = readTraitHpMult(this);
    return Math.max(1, Math.round(baseHp * hpBonus));
  }

  /** 初始化 hp/maxHp 并回满（构造时调用，ADR-041 阶段1）。 */
  _initHp() {
    const maxHp = this._computeMaxHp();
    this.state.set('maxHp', maxHp);
    this.state.set('hp', maxHp);
  }

  /**
   * 突破成功后重算 maxHp（境界提升血量上限大增），但【不回满当前 hp】。
   * 突破就是突破：只抬高上限，当前 hp 保持不变（夹新上限）。突破回满血是某些
   * 功法/秘法/体质才有的特殊效果，后续按 docs/TODO-combat-survival.md 实现。
   * 上限提升后的空缺血量靠自然回血/回血丹/天材地宝慢慢补。
   */
  refreshMaxHpOnBreakthrough() {
    const maxHp = this._computeMaxHp();
    this.state.set('maxHp', maxHp);
    const hp = this.state.get('hp') || 0;
    this.state.set('hp', Math.min(hp, maxHp));
  }

  /**
   * 破境回元（ADR-042 阶段2）：仅当实体持 Trait.BreakthroughFullHeal Tag（特殊功法/体质授予）时，
   * 突破成功后经通用 ge_full_heal（Instant，hp override 至 maxHp）回满血。
   * 默认无 NPC 持该 Tag，故默认不触发。
   */
  tryBreakthroughFullHeal() {
    const comp = this.abilityComponent;
    if (!comp?.tags?.hasTag('Trait.BreakthroughFullHeal')) return;
    const effDef = EffectPool.get('ge_full_heal');
    if (effDef) EffectEngine.applyEffect(this, effDef);
  }

  /** 每日自然回血（ADR-041 阶段1）：按 dailyRegenRatio × maxHp 缓慢恢复，夹 maxHp。 */
  _dailyHpRegen() {
    const maxHp = this.state.get('maxHp') || 0;
    if (maxHp <= 0) return;
    const hp = this.state.get('hp') || 0;
    if (hp >= maxHp) return;
    const ratio = this._combatConfig.npcHp?.dailyRegenRatio ?? 0.02;
    this.state.set('hp', Math.min(maxHp, hp + maxHp * ratio));
  }

  _isQiBelowNextRankRequirement() {
    const ranks = this._ranksData;
    if (!ranks || ranks.length === 0) return false;
    const currentRankId = this.state.get('rankId') || 'mortal';
    const currentRank = ranks.find(r => r.id === currentRankId);
    if (!currentRank) return false;
    const cultivationRanks = ranks
      .filter(r => r.category === 'cultivation')
      .sort((a, b) => a.order - b.order);
    const nextRank = cultivationRanks.find(r => r.order > currentRank.order);
    if (!nextRank) return false;
    const qi = this.state.get('qi') || 0;
    return qi < (nextRank.qiRequired || 0);
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
    flat.qiBelowNextRank = this._isQiBelowNextRankRequirement();
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

    // 反应层刺激队列每日清理过期刺激（ADR-048）：避免未消费刺激堆积。
    if (this.stimulusQueue) {
      this.stimulusQueue.pruneExpired(worldContext.currentDay ?? worldContext.day ?? 0);
    }

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

    // 大事件 → 动态决策（ADR-048）：遇仇人/知晓机缘等新事件即时压刺激 + 请求立即重决策。
    // 在复仇/关系派生状态刷新之后调用，使其能读到本 tick 最新的 hasRevengeTarget 等。
    this._checkEventReplan(worldContext);
    this._syncDynamicEventAwareness(worldContext);
    this._checkDynamicGoalInterrupts(worldContext);

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
    this._passiveQiAbsorb(worldContext);
    this._dailyHpRegen();
    // 能力系统（ADR-042）：推进活跃 Effect 倒计时（duration buff/debuff 到期对称撤销）。
    // 阶段1 锁血为 instant 无活跃实例，此调用为后续阶段2 buff 类 Effect 预备，零开销。
    if (this.abilityComponent) this.abilityComponent.tick();
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

  /** @override */
  onPostTick(worldContext) {
    const pending = this._deferredReplanRequested;
    if (!pending) return;
    if (this.behaviorSystem?.isBusy?.() === true) return;
    const stillValid = this.collectDynamicGoals(worldContext).some(goal =>
      goal?.source === GoalSource.DYNAMIC
      && goal.dynamic?.eventId === pending.eventId
      && goal.sourceId === pending.goalId
    );
    this._deferredReplanRequested = null;
    if (!stillValid) return;
    this.requestReplan('dynamic_after_step');
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
