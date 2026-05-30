/**
 * 即时反应节点（GOBT 缝合层，ADR-018/ADR-019）。
 *
 * 反应节点放在 BT 高优先 Selector 前部，命中时抢占（打断）正在进行的深思熟虑规划，
 * 体现"情绪/恩怨驱动的本能反应"。为不破坏既有世界平衡，默认阈值可配且偏保守；
 * 调参入口在 data/behavior-trees/*.json 与 emotion.json。
 */
import { BTNode, BTStatus } from './bt-node.js';

/**
 * EmotionReactionNode：当某情绪超过阈值时，强制 NPC 执行一个指定的单行为（抢占当前计划）。
 *
 * 典型用法：心魔(inner_demon)过高 → 强制静心闭关(act_npc_cultivate) 压制心魔；
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
