/**
 * Consideration - Utility 考量因素（ADR-020）。
 *
 * 标准 Utility AI 做法：把一个目标的"想做程度"拆成多个独立的考量因素(consideration)，
 * 每个考量因素把某个输入值经过响应曲线(response curve)映射到 [0,1]，再相乘得到总效用。
 * 例：突破效用 = 修炼需求 × 瓶颈程度 × 资源充足度。
 *
 * 设计要点：
 * - 响应曲线数据驱动（curve 枚举 + 参数），新增曲线只需扩 CURVES 表（开闭原则）。
 * - 输入来源支持 entityState / world / 派生量(derived，如 timeValue)，由调用方提供 derive。
 * - evaluate 恒返回 [0,1]，便于相乘且不会让总分爆炸。
 */

/**
 * 响应曲线类型枚举（遵循项目规则：多分支用枚举）。
 * @enum {string}
 */
export const CurveType = Object.freeze({
  LINEAR: 'linear',       // y = clamp(slope*(x-shift)+base)
  QUADRATIC: 'quadratic', // y = clamp((slope*(x-shift))^2 + base)
  INVERSE: 'inverse',     // y = clamp(1 - (slope*(x-shift)))  输入越大效用越低
  THRESHOLD: 'threshold', // x>=threshold -> high, 否则 low
  LOGISTIC: 'logistic',   // y = 1/(1+e^(-k*(x-mid)))  S 形
});

/** 输入来源枚举。 */
export const InputSource = Object.freeze({
  ENTITY: 'entity',
  WORLD: 'world',
  DERIVED: 'derived',
});

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 响应曲线实现表：curve(x, params) -> [0,1]。 */
const CURVES = {
  [CurveType.LINEAR]: (x, p) => clamp01((p.slope ?? 1) * (x - (p.shift ?? 0)) + (p.base ?? 0)),
  [CurveType.QUADRATIC]: (x, p) => {
    const t = (p.slope ?? 1) * (x - (p.shift ?? 0));
    return clamp01(t * t + (p.base ?? 0));
  },
  [CurveType.INVERSE]: (x, p) => clamp01(1 - (p.slope ?? 1) * (x - (p.shift ?? 0))),
  [CurveType.THRESHOLD]: (x, p) => (x >= (p.threshold ?? 0) ? (p.high ?? 1) : (p.low ?? 0)),
  [CurveType.LOGISTIC]: (x, p) => {
    const k = p.k ?? 1;
    const mid = p.mid ?? 0.5;
    return clamp01(1 / (1 + Math.exp(-k * (x - mid))));
  },
};

export class Consideration {
  /**
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.inputKey       输入键（entity.state.get(key) / world[key] / derived[key]）
   * @param {InputSource} [config.source]   输入来源，默认 entity
   * @param {CurveType} [config.curve]      响应曲线类型，默认 linear
   * @param {Object} [config.params]        曲线参数
   * @param {number} [config.weight]        权重（预留，用于加权几何平均；默认 1 表示直接相乘）
   */
  constructor(config) {
    this.id = config.id;
    this.inputKey = config.inputKey;
    this.source = config.source || InputSource.ENTITY;
    this.curve = config.curve || CurveType.LINEAR;
    this.params = config.params || {};
    const weight = Number(config.weight ?? 1);
    this.weight = Number.isFinite(weight) && weight >= 0 ? weight : 1;
    const floor = config.floor == null ? null : Number(config.floor);
    this.floor = Number.isFinite(floor) ? clamp01(floor) : null;
  }

  /**
   * 计算本考量因素的效用值 [0,1]。
   * @param {Object} entityState  含 get(key)
   * @param {Object} worldContext
   * @param {Object} [derived]    派生输入表（如 { timeValue: 0.8 }）
   * @returns {number}
   */
  evaluate(entityState, worldContext, derived = {}) {
    let x;
    if (this.source === InputSource.WORLD) {
      x = worldContext ? worldContext[this.inputKey] : undefined;
    } else if (this.source === InputSource.DERIVED) {
      x = derived ? derived[this.inputKey] : undefined;
    } else {
      x = entityState && entityState.get ? entityState.get(this.inputKey) : undefined;
    }
    if (typeof x !== 'number') {
      const stageValue = { early: 0.1, middle: 0.4, late: 0.7, perfection: 1 };
      x = Object.prototype.hasOwnProperty.call(stageValue, x) ? stageValue[x] : 0;
    }
    const fn = CURVES[this.curve] || CURVES[CurveType.LINEAR];
    return clamp01(fn(x, this.params));
  }

  toJSON() {
    return { id: this.id, inputKey: this.inputKey, source: this.source, curve: this.curve };
  }
}

/**
 * 从 JSON 配置数组构建 Consideration 列表。
 * @param {Array} configs
 * @returns {Consideration[]}
 */
export function buildConsiderations(configs) {
  if (!Array.isArray(configs)) return [];
  return configs.map(c => new Consideration(c));
}

/**
 * 计算某目标来源的期望收益 ExpectedValue = Σ(prob × value)（ADR-022）。
 *
 * 收益分布数据驱动于 reward.json：按 sourceId 取 outcomes 求概率加权和。
 * 因每个 outcome.value 归一化到 [0,1]、Σprob≈1，期望值天然落在 [0,1]，
 * 可直接作为 derived.expectedValue 喂给 linear consideration 曲线参与乘法效用。
 *
 * @param {?Object} rewardCfg reward.json 内容（含 enabled / rewardsBySource）
 * @param {string} sourceId Goal 的 sourceId（如 obsession_plunder）
 * @returns {number} 期望收益 ∈ [0,1]；rewardCfg 未开启或无匹配时返回 0（不改变现有行为）
 */
export function deriveExpectedValue(rewardCfg, sourceId) {
  if (!rewardCfg || rewardCfg.enabled !== true) return 0;
  const entry = rewardCfg.rewardsBySource?.[sourceId];
  if (!entry || !Array.isArray(entry.outcomes)) return 0;
  let ev = 0;
  for (const o of entry.outcomes) {
    const prob = typeof o.prob === 'number' ? o.prob : 0;
    const value = typeof o.value === 'number' ? o.value : 0;
    ev += prob * value;
  }
  return clamp01(ev);
}
