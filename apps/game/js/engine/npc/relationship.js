/**
 * RelationshipGraph - NPC 个人恩怨/恩义图（GOBT 长期心智，ADR-019）。
 *
 * ADR-027 起，本类成为世界级 RelationshipSystem 的「兼容查询视图」：
 *   - 绑定模式（NPC 持有，构造时传入 { system, ownerId }）：grudge/gratitude 读写
 *     委托给世界级 RelationshipSystem，表达为 type='grudge'/'gratitude' 的有向边，
 *     使个人恩怨成为统一关系网的一部分（单一真相源）。
 *   - 独立模式（无 system，如单元测试 `new RelationshipGraph()`）：回退到内部 Map，
 *     行为与 ADR-019 原实现完全一致（保证既有测试零改动通过）。
 *
 * 对外接口（addGrudge/getGrudge/topGrudge 等）保持不变，故复仇链
 * （tick-manager._resolveRevengeTarget → npc.relationships.topGrudge()）无需改动。
 *
 * 与势力间 relations（faction.state.relations）分层：这里记录"个人对个人"的仇恨/恩义。
 * grudge/gratitude 取值约定为非负累积量，越大表示恩怨越深。
 */
export class RelationshipGraph {
  /**
   * @param {Object} [opts]
   * @param {import('../world/relationship-system.js').RelationshipSystem|null} [opts.system] 世界级关系网（绑定模式）
   * @param {string|null} [opts.ownerId] 本图所属实体 id（绑定模式必填）
   */
  constructor(opts = {}) {
    this._system = opts.system || null;
    this._ownerId = opts.ownerId || null;
    // 独立模式回退存储（无 system 时使用）。
    /** @type {Map<string, number>} */
    this.grudge = new Map();
    /** @type {Map<string, number>} */
    this.gratitude = new Map();
  }

  /** 是否绑定到世界级关系网。 */
  get _bound() { return !!(this._system && this._ownerId); }

  /** 增加对某人的仇恨。 */
  addGrudge(actorId, amount) {
    if (!actorId || !(amount > 0)) return;
    if (this._bound) {
      this._system.addEdge(this._ownerId, actorId, 'grudge', { strengthDelta: amount });
      return;
    }
    this.grudge.set(actorId, (this.grudge.get(actorId) || 0) + amount);
  }

  /** 增加对某人的恩义。 */
  addGratitude(actorId, amount) {
    if (!actorId || !(amount > 0)) return;
    if (this._bound) {
      this._system.addEdge(this._ownerId, actorId, 'gratitude', { strengthDelta: amount });
      return;
    }
    this.gratitude.set(actorId, (this.gratitude.get(actorId) || 0) + amount);
  }

  getGrudge(actorId) {
    if (this._bound) {
      const e = this._system.getEdge(this._ownerId, actorId, 'grudge');
      return e ? e.strength : 0;
    }
    return this.grudge.get(actorId) || 0;
  }

  getGratitude(actorId) {
    if (this._bound) {
      const e = this._system.getEdge(this._ownerId, actorId, 'gratitude');
      return e ? e.strength : 0;
    }
    return this.gratitude.get(actorId) || 0;
  }

  /** 仇恨最深的对象 { actorId, value }，无则 null。 */
  topGrudge() {
    if (this._bound) {
      const e = this._system.topEdgeOfType(this._ownerId, 'grudge');
      return e ? { actorId: e.toId, value: e.strength } : null;
    }
    let bestId = null, bestVal = 0;
    for (const [id, v] of this.grudge) {
      if (v > bestVal) { bestVal = v; bestId = id; }
    }
    return bestId ? { actorId: bestId, value: bestVal } : null;
  }

  /** 恩义最重的对象 { actorId, value }，无则 null。 */
  topGratitude() {
    if (this._bound) {
      const e = this._system.topEdgeOfType(this._ownerId, 'gratitude');
      return e ? { actorId: e.toId, value: e.strength } : null;
    }
    let bestId = null, bestVal = 0;
    for (const [id, v] of this.gratitude) {
      if (v > bestVal) { bestVal = v; bestId = id; }
    }
    return bestId ? { actorId: bestId, value: bestVal } : null;
  }

  /**
   * 序列化为存储格式。
   * - 绑定模式：恩怨边由世界级 RelationshipSystem 统一序列化，这里输出空视图避免重复存储。
   * - 独立模式：序列化内部 Map（与 ADR-019 一致）。
   */
  snapshot() {
    if (this._bound) {
      return {
        grudge: Object.fromEntries(this._system.edgesOfType(this._ownerId, 'grudge').map(e => [e.toId, e.strength])),
        gratitude: Object.fromEntries(this._system.edgesOfType(this._ownerId, 'gratitude').map(e => [e.toId, e.strength])),
        _backedBySystem: true,
      };
    }
    return {
      grudge: Object.fromEntries(this.grudge),
      gratitude: Object.fromEntries(this.gratitude),
    };
  }

  loadFrom(snap) {
    if (!snap) return;
    if (this._bound) {
      // 绑定模式下边由 RelationshipSystem.loadFrom 统一恢复，这里跳过避免双写。
      if (snap._backedBySystem) return;
      // 兼容旧存档（独立模式快照）：回灌到世界级系统。
      for (const [actorId, v] of Object.entries(snap.grudge || {})) {
        this._system.addEdge(this._ownerId, actorId, 'grudge', { strengthDelta: v });
      }
      for (const [actorId, v] of Object.entries(snap.gratitude || {})) {
        this._system.addEdge(this._ownerId, actorId, 'gratitude', { strengthDelta: v });
      }
      return;
    }
    this.grudge = new Map(Object.entries(snap.grudge || {}));
    this.gratitude = new Map(Object.entries(snap.gratitude || {}));
  }

  toJSON() {
    return this.snapshot();
  }
}
