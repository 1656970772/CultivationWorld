/**
 * Rng —— 确定性种子伪随机数生成器（mulberry32）。
 *
 * 设计目标（日志落盘 / 重放 / 确定性种子）：
 *   - 同一个 seed 产生完全相同的数列，使整个世界模拟可复现。
 *   - 取代散落各处的 Math.random：模拟逻辑统一从 worldContext.rng 取随机，
 *     渲染/UI 等"非模拟"代码不受约束，可继续用 Math.random。
 *   - 状态可序列化（getState/setState），便于重放时从任意 tick 恢复。
 *
 * 算法：mulberry32。32 位整数状态，速度快、分布质量对游戏模拟足够，
 *   与 territory-layout-generator.js 的 Math.imul 位运算风格一致。
 *
 * 用法：
 *   const rng = new Rng(42);
 *   rng.next();              // [0,1) 浮点，等价 Math.random()
 *   rng.float(min, max);     // [min,max) 浮点
 *   rng.int(min, max);       // [min,max] 整数（含两端）
 *   rng.chance(0.3);         // 30% 概率返回 true
 *   rng.bool();              // 等概率 true/false
 *   rng.pick(arr);           // 数组中等概率取一个元素
 *   rng.shuffle(arr);        // 原地 Fisher-Yates 洗牌（确定性）
 *   const fn = rng.fn();     // 返回 () => number，无缝替换接受 randomFn 的旧接口
 */
export class Rng {
  /**
   * @param {number} [seed=Date.now()] 初始种子。整数。
   */
  constructor(seed = Date.now()) {
    // 归一化为 32 位无符号整数；0 也可作为合法种子。
    this._state = (seed >>> 0) || 1;
    this._seed = this._state;
  }

  /** 创建本次模拟的初始种子（未显式提供时）。 */
  static makeSeed() {
    return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
  }

  /** 返回构造时的原始种子，用于记录到重放文件。 */
  get seed() {
    return this._seed;
  }

  /** [0,1) 浮点，等价 Math.random()。mulberry32 核心。 */
  next() {
    let t = (this._state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min,max) 浮点。 */
  float(min, max) {
    return min + this.next() * (max - min);
  }

  /** [min,max] 整数（含两端）。 */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** p 概率返回 true（p<=0 恒 false，p>=1 恒 true）。 */
  chance(p) {
    return this.next() < p;
  }

  /** 等概率 true/false。 */
  bool() {
    return this.next() < 0.5;
  }

  /**
   * 数组中等概率取一个元素；空数组返回 undefined。
   * @template T
   * @param {T[]} arr
   * @returns {T|undefined}
   */
  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * 原地 Fisher-Yates 洗牌（确定性）。
   * @template T
   * @param {T[]} arr
   * @returns {T[]} 同一个数组引用
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * 返回一个绑定到本实例的随机函数 () => number。
   * 用于无缝替换接受 randomFn = Math.random 的旧接口。
   * @returns {() => number}
   */
  fn() {
    return () => this.next();
  }

  /**
   * 派生一个子 RNG：用 label 与当前状态混合出一个新种子。
   * 用于给独立子系统隔离的随机流，避免相互干扰（同 label + 同主状态 → 同子流）。
   * @param {string|number} label
   * @returns {Rng}
   */
  derive(label) {
    let h = this._state >>> 0;
    const s = String(label);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    }
    return new Rng(h);
  }

  /** 导出当前内部状态，用于序列化 / 重放快照。 */
  getState() {
    return this._state >>> 0;
  }

  /** 恢复内部状态。 */
  setState(state) {
    this._state = (state >>> 0) || 1;
  }
}
