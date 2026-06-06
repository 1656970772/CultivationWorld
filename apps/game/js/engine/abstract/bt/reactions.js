/**
 * 即时反应节点（GOBT 缝合层，ADR-018/ADR-019）。
 *
 * 反应节点放在 BT 高优先 Selector 前部，命中时抢占（打断）正在进行的深思熟虑规划，
 * 体现"情绪/恩怨驱动的本能反应"。为不破坏既有世界平衡，默认阈值可配且偏保守；
 * 调参入口在 data/behavior-trees/*.json 与 emotion.json。
 */
import { BTNode, BTStatus } from './bt-node.js';
import { StimulusType } from '../stimulus.js';

function readState(entity, key, fallback = null) {
  const value = typeof entity?.state?.get === 'function' ? entity.state.get(key) : entity?.state?.[key];
  return value ?? fallback;
}

function attackedSourceId(stim) {
  return stim?.payload?.killerId || stim?.payload?.attackerId || stim?.sourceId || null;
}

function resolveEnemyPower(stim, worldContext, myPower) {
  const payload = stim?.payload || {};
  const directPower = payload.enemyPower ?? payload.attackerPower ?? payload.monsterPower ?? payload.killerPower;
  if (Number.isFinite(Number(directPower)) && Number(directPower) > 0) {
    return Number(directPower);
  }

  const sourceId = attackedSourceId(stim);
  const source = sourceId && worldContext?.entityRegistry?.getById
    ? worldContext.entityRegistry.getById(sourceId)
    : null;
  if (!source || source.alive === false) return myPower;

  const powerFn = typeof worldContext?.npcCombatPower === 'function' ? worldContext.npcCombatPower : null;
  if (powerFn) {
    const sourcePower = Number(powerFn(source));
    if (Number.isFinite(sourcePower) && sourcePower > 0) return sourcePower;
  }
  const statePower = Number(source.state?.get?.('power') ?? source.power ?? source.staticData?.power);
  return Number.isFinite(statePower) && statePower > 0 ? statePower : myPower;
}

export function decideAttackedReaction(entity, stim, worldContext, cfg = {}) {
  const actions = cfg.actions || {};
  const combat = cfg.combat || {};
  const hp = Number(readState(entity, 'hp', readState(entity, 'maxHp', 0)));
  const maxHp = Math.max(1, Number(readState(entity, 'maxHp', hp || 1)));
  const hpRatio = hp / maxHp;
  const injury = Number(readState(entity, 'injuryLevel', 0));
  const damage = Number(stim?.payload?.damage || 0);

  const criticalHpRatio = combat.criticalHpRatio ?? cfg.fleeHpRatio ?? 0.25;
  const lowHpRatio = combat.lowHpRatio ?? cfg.healHpRatio ?? 0.45;
  const counterAdvantageRatio = combat.counterAdvantageRatio ?? cfg.powerAdvantage ?? 1.3;
  const retreatDisadvantageRatio = combat.retreatDisadvantageRatio ?? 1.2;
  const heavyDamageHpRatio = combat.heavyDamageHpRatio ?? 0.4;

  const powerFn = typeof worldContext?.npcCombatPower === 'function' ? worldContext.npcCombatPower : null;
  const rawMyPower = powerFn ? Number(powerFn(entity)) : 1;
  const myPower = Math.max(1, Number.isFinite(rawMyPower) ? rawMyPower : 1);
  const enemyPower = Math.max(1, resolveEnemyPower(stim, worldContext, myPower));

  if ((hpRatio <= criticalHpRatio || injury >= 4) && actions.flee) {
    return { kind: 'flee', actionId: actions.flee };
  }
  if (hpRatio <= lowHpRatio && actions.heal) {
    return { kind: 'heal', actionId: actions.heal };
  }
  if (myPower / enemyPower >= counterAdvantageRatio && actions.counter) {
    return { kind: 'counter', actionId: actions.counter };
  }
  if ((enemyPower / myPower >= retreatDisadvantageRatio || damage >= maxHp * heavyDamageHpRatio) && actions.retreat) {
    return { kind: 'retreat', actionId: actions.retreat };
  }
  if (actions.retreat) return { kind: 'retreat', actionId: actions.retreat };
  return null;
}

/**
 * EmotionReactionNode：当某情绪超过阈值时，强制 NPC 执行一个指定的单行为（抢占当前计划）。
 *
 * 典型用法：心魔(inner_demon)过高 → 强制静心闭关(act_npc_job_cultivate) 压制心魔；
 * 愤怒过高且有可达仇人 → 未来可接"追击"行为。
 *
 * 命中条件：emotions.get(emotion) >= threshold 且实体存在该可用行为。
 * 命中时：clearPlan + setSingleActionPlan(actionId)，返回 RUNNING（占据本 tick 决策）。
 * 未命中：返回 FAILURE，交回 Selector 落到深思熟虑分支。
 */
export class EmotionReactionNode extends BTNode {
  /**
   * @param {Object} config
   * @param {string} config.emotion 情绪维度（EmotionType 值）
   * @param {number} config.threshold 触发阈值
   * @param {string} config.actionId 抢占执行的行为 id
   */
  constructor(config = {}) {
    super(config);
    this.emotion = config.emotion;
    this.threshold = config.threshold ?? 101; // 默认不可达，保证不影响既有平衡
    this.actionId = config.actionId;
  }

  tick(entity, blackboard, worldContext) {
    if (!entity.emotions || !entity.behaviorSystem) return BTStatus.FAILURE;
    const val = entity.emotions.get(this.emotion);
    if (val < this.threshold) return BTStatus.FAILURE;

    // 已在执行多 tick 行为时不打断（避免反复抢占造成抖动）。
    if (entity.behaviorSystem.isBusy()) return BTStatus.FAILURE;

    entity.behaviorSystem.clearPlan();
    const ok = entity.behaviorSystem.setSingleActionPlan(this.actionId, `reaction_${this.emotion}`);
    if (!ok) return BTStatus.FAILURE;
    entity.onPlanChosen?.();

    if (blackboard) {
      blackboard.reactedPath = { emotion: this.emotion, value: val, actionId: this.actionId };
      if (entity._tickLog) entity._tickLog.plan = entity.behaviorSystem.getLastPlanResult();
    }
    const result = entity.behaviorSystem.executeStep(entity, worldContext);
    if (blackboard) blackboard.execution = result;
    return BTStatus.RUNNING;
  }

  toJSON() {
    return { ...super.toJSON(), emotion: this.emotion, threshold: this.threshold, actionId: this.actionId };
  }
}

/**
 * ReactiveNode：消费「被攻击」刺激，执行遭袭即时反应决策树（四层 AI 架构 Reaction 层，ADR-048）。
 *
 * 放在 NPC BT reactions selector 顶部（先于 EmotionReactionNode）。命中条件：实体刺激队列有
 * attacked 刺激且 reaction.enabled=true。与 EmotionReactionNode 不同，被攻击反应【可打断 isBusy】
 * （正在闭关/游历也立即出关应敌），这正是「大事件打断当前计划」的核心。
 *
 * 反应决策树（阈值/动作映射均来自 balance/reaction.json，数据驱动）：
 *   1. 重伤濒死（hp/maxHp <= combat.criticalHpRatio）       → 逃命（flee）
 *   2. 血量偏低（hp/maxHp <= combat.lowHpRatio）            → 应急回血（heal）
 *   3. 血量安全 且 敌弱（我方战力/来犯战力 >= counterAdvantage） → 奋起反击（counter）
 *   4. 血量安全 但 打不过/遭重击                             → 暂避锋芒（retreat）
 *
 * 命中时：clearPlan + setSingleActionPlan(反应行为) + 本 tick executeStep，返回 RUNNING（占据本 tick）。
 * 未命中（无刺激/未启用/无可用反应行为）：返回 FAILURE，交回 Selector 落到情绪反应/深思熟虑分支。
 */
export class ReactiveNode extends BTNode {
  tick(entity, blackboard, worldContext) {
    if (!entity.behaviorSystem || !entity.stimulusQueue) return BTStatus.FAILURE;
    const cfg = worldContext?.balanceConfig?.reaction || {};
    if (cfg.enabled !== true) return BTStatus.FAILURE;

    // 仅消费最高优先的 attacked 刺激（其余大事件刺激由 Utility 重决策处理，不在反应层抢占）。
    if (!entity.stimulusQueue.has(StimulusType.ATTACKED)) return BTStatus.FAILURE;
    const stim = entity.stimulusQueue.pop(StimulusType.ATTACKED);
    if (!stim) return BTStatus.FAILURE;

    const decision = this._decide(entity, stim, cfg, worldContext);
    if (!decision || !decision.actionId) return BTStatus.FAILURE;

    // 反击需先把来犯者 id 写入 state，供 NPCReactCounterExecutor 读取。
    if (decision.kind === 'counter') {
      entity.state.set('_reactCounterTargetId', attackedSourceId(stim));
    }

    // 抢占前记录"被打断的意图"（供观测：反应确实打断了哪种长链行为，如闭关/游历）。
    const wasBusy = entity.behaviorSystem.isBusy();
    const interruptedGoal = entity.behaviorSystem.currentNeedId || null;

    // 抢占（可打断 isBusy 中的闭关/游历长链）：JobAction 走专用暂停，普通行为仍清计划。
    const suspendedForReaction = entity.behaviorSystem.suspendPlanForReaction?.('reaction_attacked', entity) === true;
    if (!suspendedForReaction) {
      entity.behaviorSystem.clearPlan(entity);
    }
    const ok = entity.behaviorSystem.setSingleActionPlan(decision.actionId, `reaction_attacked_${decision.kind}`);
    if (!ok) {
      if (suspendedForReaction) {
        entity.behaviorSystem.restoreSuspendedPlan?.('reaction_plan_failed', entity);
      }
      return BTStatus.FAILURE;
    }
    entity.onPlanChosen?.();

    if (blackboard) {
      blackboard.reactedPath = {
        stimulus: StimulusType.ATTACKED,
        decision: decision.kind,
        actionId: decision.actionId,
        killerId: attackedSourceId(stim),
        wasBusy,
        interruptedGoal,
        interruptedMode: suspendedForReaction ? 'pause' : 'clear',
      };
      if (entity._tickLog) entity._tickLog.plan = entity.behaviorSystem.getLastPlanResult();
    }

    const result = entity.behaviorSystem.executeStep(entity, worldContext);
    if (blackboard) blackboard.execution = result;
    if (suspendedForReaction) {
      if (result?.status === 'plan_complete') {
        entity.behaviorSystem.restoreSuspendedPlan?.('reaction_done', entity);
      } else if (result?.status === 'replan' || result?.status === 'failed' || result?.status === 'abort') {
        entity.behaviorSystem.restoreSuspendedPlan?.('reaction_failed', entity);
      }
    }
    return BTStatus.RUNNING;
  }

  /**
   * 反应决策树：依血量比例 + 敌我战力对比选反应类型。
   * @returns {{ kind:string, actionId:string }|null}
   */
  _decide(entity, stim, cfg, worldContext) {
    return decideAttackedReaction(entity, stim, worldContext, cfg);
  }

  toJSON() {
    return { ...super.toJSON() };
  }
}
