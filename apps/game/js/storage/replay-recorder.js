/**
 * ReplayRecorder —— 确定性重放记录器（日志落盘 + 重放 + 确定性种子）。
 *
 * 设计（配合 abstract/rng.js 的确定性种子）：
 *   - 每局 = 一个 seed + 一串「按 tick 顺序的输入事件」。由于模拟已是确定性的
 *     （所有随机走 worldContext.rng），只要重放时用相同 seed 重建引擎、按相同顺序
 *     重新 tick，世界演化必然逐字节一致。重放文件只存 seed + 输入序列，不存任何校验值。
 *   - 日志落盘：把每 tick 的事件流分批 POST 到 serve.py 的 /api/log，
 *     落到本地 runs/<runId>/log.jsonl，供离线分析。
 *   - 重放文件：seed + 输入序列 + 元信息，POST 到 /api/replay → runs/<runId>/replay.json。
 *
 * 浏览器无法直接写磁盘，故依赖 serve.py 的 POST 接口落盘；
 * 若服务器不可用（如 file:// 打开），自动降级为仅内存记录，可手动导出。
 */

/** 生成一个 32 位无符号整数种子。 */
export function makeSeed() {
  return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
}

/** 生成一个 runId（时间戳 + seed），用作落盘目录名。 */
function makeRunId(seed) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}_s${seed >>> 0}`;
}

export class ReplayRecorder {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.seed] 指定种子（重放/复现时传入）；缺省则随机生成。
   * @param {boolean} [opts.persist=true] 是否经 serve.py 落盘。
   * @param {number} [opts.flushEvery=50] 每累计多少条日志自动落盘一次。
   */
  constructor({ seed, persist = true, flushEvery = 50 } = {}) {
    this.seed = (seed != null) ? (seed >>> 0) : makeSeed();
    this.runId = makeRunId(this.seed);
    this.persist = persist;
    this.flushEvery = flushEvery;

    this.startedAt = Date.now();
    this.currentTick = 0;
    /** 按 tick 顺序记录的输入事件：[{ tick, type, payload }]。 */
    this.inputs = [];
    /** 待落盘的日志缓冲。 */
    this._logBuffer = [];
    this._serverOk = persist;
  }

  /**
   * 记录一次输入事件（玩家操作 / 推进指令等）。
   * 模拟当前为自治世界，主要输入是 TICK/MULTI_TICK；后续接入主角操作时同样在此登记。
   * @param {string} type 事件类型（如 'tick' / 'multi_tick' / 'player_action'）。
   * @param {Object} [payload] 事件参数（如 multi_tick 的 count、玩家动作详情）。
   */
  recordInput(type, payload = {}) {
    this.inputs.push({ tick: this.currentTick, type, payload });
  }

  /**
   * 推进到下一 tick 前调用，记录该 tick 产生的事件日志。
   * @param {number} day 当前世界天数。
   * @param {Object} tickLog 引擎返回的本 tick 日志（事件等）。
   */
  recordTick(day, tickLog) {
    this.currentTick += 1;
    const events = tickLog?.events || tickLog?.timelineEntries || [];
    if (Array.isArray(events) && events.length > 0) {
      for (const ev of events) {
        this._logBuffer.push({ tick: this.currentTick, day, event: ev });
      }
    }
    if (this._logBuffer.length >= this.flushEvery) {
      this.flushLog();
    }
  }

  /** 把日志缓冲分批 POST 落盘（失败则降级为内存保留）。 */
  async flushLog() {
    if (!this._serverOk || this._logBuffer.length === 0) return;
    const lines = this._logBuffer;
    this._logBuffer = [];
    try {
      const res = await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: this.runId, lines }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      // 落盘失败：可能是 file:// 打开或服务器无 POST 接口。降级保留在内存，停止后续尝试。
      this._serverOk = false;
      this._logBuffer = lines.concat(this._logBuffer);
      console.warn('[ReplayRecorder] 日志落盘失败，降级为内存记录：', err.message);
    }
  }

  /** 组装重放对象（seed + 输入序列 + 元信息）。 */
  buildReplay() {
    return {
      version: 1,
      runId: this.runId,
      seed: this.seed,
      startedAt: this.startedAt,
      savedAt: Date.now(),
      totalTicks: this.currentTick,
      inputs: this.inputs,
    };
  }

  /** 把重放文件落盘到 runs/<runId>/replay.json。 */
  async saveReplay() {
    await this.flushLog();
    const replay = this.buildReplay();
    if (!this._serverOk) {
      console.warn('[ReplayRecorder] 服务器不可用，重放仅在内存：', replay);
      return replay;
    }
    try {
      const res = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: this.runId, replay }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      console.log(`[ReplayRecorder] 重放已保存：runs/${this.runId}/replay.json`);
    } catch (err) {
      console.warn('[ReplayRecorder] 重放落盘失败：', err.message);
    }
    return replay;
  }

  /** 从一个重放对象加载（用于回放模式）。 */
  static fromReplay(replay) {
    const rec = new ReplayRecorder({ seed: replay.seed, persist: false });
    rec.runId = replay.runId || rec.runId;
    rec.inputs = replay.inputs || [];
    return rec;
  }
}
