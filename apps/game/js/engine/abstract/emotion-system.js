/**
 * EmotionSystem - 情绪系统（GOBT 长期心智，ADR-019）。
 *
 * 区别于 morale（士气，长期数值），情绪是较短时程、由事件激发并随时间回归基线的状态：
 *   - anger 愤怒：被攻击/被夺/仇人相关事件激发，放大复仇类目标。
 *   - fear 恐惧：濒死/重伤/强敌事件激发，放大生存/逃避类目标。
 *   - inner_demon 心魔：执念受挫/屠戮事件累积，过高会影响突破（由 npc-entity 读取）。
 *
 * 情绪作为 Utility 调制乘子：通过 modulateGoal() 对 Goal 的 priority/urgency 叠加调制，
 * 不改变需求/执念本身的评估口径（可解释、可回归）。
 */

/**
 * 情绪维度枚举。
 * @enum {string}
 */
export const EmotionType = Object.freeze({
  ANGER: 'anger',
  FEAR: 'fear',
  INNER_DEMON: 'inner_demon',
});

export class EmotionSystem {
  /**
   * @param {Object} [config] emotion.json 内容
   */
  constructor(config = {}) {
    this._config = config;
    const dims = config.dimensions || {};
    /** @type {Map<string, number>} 当前情绪值（0-100） */
    this.values = new Map();
    for (const [type, dim] of Object.entries(dims)) {
      this.values.set(type, dim.baseline ?? 0);
    }
  }

  get(type) {
    return this.values.get(type) || 0;
  }

  /** 叠加情绪值（事件激发用），夹在 [0,100]。 */
  add(type, amount) {
    if (!amount) return;
    const cur = this.values.get(type) || 0;
    this.values.set(type, Math.max(0, Math.min(100, cur + amount)));
  }

  /**
   * 每日回归基线（情绪随时间平复）。
   * @param {number} [days=1]
   */
  decayTick(days = 1) {
    const dims = this._config.dimensions || {};
    for (const [type, dim] of Object.entries(dims)) {
      const baseline = dim.baseline ?? 0;
      const regress = (dim.dailyRegress ?? 0) * days;
      const cur = this.values.get(type) || 0;
      if (cur > baseline) this.values.set(type, Math.max(baseline, cur - regress));
      else if (cur < baseline) this.values.set(type, Math.min(baseline, cur + regress));
    }
  }

  /**
   * 由一条记忆事件激发情绪（数据驱动于 emotion.json.eventTriggers）。
   * @param {string} memoryType
   */
  onMemoryEvent(memoryType) {
    const trig = (this._config.eventTriggers || {})[memoryType];
    if (!trig) return;
    for (const [emotionType, amount] of Object.entries(trig)) {
      this.add(emotionType, amount);
    }
  }

  /**
   * 对一个 Goal 应用情绪调制（Utility 乘子/增量）。
   * 规则来自 emotion.json.goalModulation：按 Goal 的 source/tag 匹配，
   * 当某情绪超过 threshold 时，按超出比例叠加 priority/urgency 增量。
   * @param {import('./goal.js').Goal} goal
   */
  modulateGoal(goal) {
    const rules = this._config.goalModulation || [];
    for (const rule of rules) {
      if (rule.goalSource && goal.source !== rule.goalSource) continue;
      if (rule.goalTag && goal.tag !== rule.goalTag) continue;
      const val = this.get(rule.emotion);
      const threshold = rule.threshold ?? 0;
      if (val <= threshold) continue;
      const ratio = (val - threshold) / Math.max(1, 100 - threshold);
      goal.addModulator({
        label: `emotion_${rule.emotion}`,
        deltaPriority: Math.round(ratio * (rule.maxPriorityBoost || 0)),
        deltaUrgency: Math.round(ratio * (rule.maxUrgencyBoost || 0)),
      });
    }
  }

  snapshot() {
    return { values: Object.fromEntries(this.values) };
  }

  loadFrom(snap) {
    if (!snap || !snap.values) return;
    this.values = new Map(Object.entries(snap.values));
  }

  toJSON() {
    return this.snapshot();
  }
}
