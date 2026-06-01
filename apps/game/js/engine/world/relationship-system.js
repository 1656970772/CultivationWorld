/**
 * RelationshipSystem - 世界级关系网（ADR-027）。
 *
 * 单一真相源：集中管理所有实体之间的「有向带类型边」，覆盖三层：
 *   - 人际（NPC↔NPC）：师徒/道侣/血亲/同门/盟友/竞争/宿敌/恩人/仇怨/恩义
 *   - 人妖（NPC↔妖兽）：灵宠/坐骑/妖兽仇敌/领地入侵
 *   - 妖妖（妖兽↔妖兽）：同群/首领/争斗
 *
 * 与势力外交（faction.state.relations）分层：本系统是个人/族群层关系，势力层仍走 combat.json。
 *
 * 设计要点（低耦合）：
 *   - 边以 (fromId → toId → type) 唯一标识，按 fromId 分桶存储，便于「某人对谁有什么关系」查询。
 *   - 边类型/默认值/衰减/对称性全部数据驱动于 data/balance/relationship.json。
 *   - 旧的个人恩怨图 grudge/gratitude 表达为 type='grudge'/'gratitude' 的边；
 *     NPCEntity.relationships（RelationshipGraph）作为本系统的兼容查询视图（见 npc/relationship.js）。
 */

/**
 * 关系类型枚举（与 relationship.json edgeTypes 的键对齐；代码侧用枚举避免裸字符串散落）。
 * @enum {string}
 */
export const RelationType = Object.freeze({
  // 人际
  MASTER: 'master',
  DISCIPLE: 'disciple',
  DAO_COMPANION: 'dao_companion',
  KIN: 'kin',
  SAME_SECT: 'same_sect',
  ALLY: 'ally',
  RIVAL: 'rival',
  ENEMY: 'enemy',
  BENEFACTOR: 'benefactor',
  GRUDGE: 'grudge',
  GRATITUDE: 'gratitude',
  // 人妖
  SPIRIT_PET: 'spirit_pet',
  MOUNT: 'mount',
  BEAST_GRUDGE: 'beast_grudge',
  TERRITORY_THREAT: 'territory_threat',
  // 妖妖
  PACK_MEMBER: 'pack_member',
  PACK_LEADER: 'pack_leader',
  BEAST_RIVAL: 'beast_rival',
});

/**
 * 一条有向关系边。
 * @typedef {Object} RelationEdge
 * @property {string} fromId      关系发出方实体 id
 * @property {string} toId        关系指向方实体 id
 * @property {string} type        关系类型（RelationType）
 * @property {number} affinity    好感 -100~100（取自 edgeType 默认）
 * @property {number} strength    强度 0~100（事件叠加，随 decay 衰减）
 * @property {number} originTick  建边的世界日
 * @property {string|null} originEventType 建边触发事件类型
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class RelationshipSystem {
  /**
   * @param {Object} [config] relationship.json 内容
   */
  constructor(config = {}) {
    this._config = config || {};
    this.enabled = config?.enabled !== false;
    /** @type {Object<string, Object>} edgeTypes 定义表 */
    this._edgeTypes = config?.edgeTypes || {};
    /** @type {Object<string, Object>} 事件→边映射 */
    this._bindings = config?.eventBindings || {};
    /**
     * 边存储：fromId → Map<edgeKey, RelationEdge>，edgeKey = `${toId}|${type}`。
     * @type {Map<string, Map<string, RelationEdge>>}
     */
    this._edges = new Map();
  }

  /** 边的唯一键。 */
  static _key(toId, type) { return `${toId}|${type}`; }

  /** 读取某关系类型的默认配置（找不到返回空对象）。 */
  _typeDef(type) { return this._edgeTypes[type] || {}; }

  /**
   * 建立 / 强化一条有向关系边。重复建边则累加 strength（受 strengthDelta 影响），不重复建表项。
   * 若该类型配置了 symmetricType，则自动建立反向对称边。
   * @param {string} fromId
   * @param {string} toId
   * @param {string} type RelationType
   * @param {Object} [opts]
   * @param {number} [opts.tick=0] 世界日
   * @param {string|null} [opts.eventType=null] 触发事件
   * @param {number} [opts.strengthDelta] 额外强度增量（默认用 edgeType.strength）
   * @param {boolean} [opts._skipSymmetric=false] 内部用，避免对称递归
   * @returns {RelationEdge|null}
   */
  addEdge(fromId, toId, type, opts = {}) {
    if (!this.enabled) return null;
    if (!fromId || !toId || !type || fromId === toId) return null;
    const def = this._typeDef(type);

    let bucket = this._edges.get(fromId);
    if (!bucket) { bucket = new Map(); this._edges.set(fromId, bucket); }
    const key = RelationshipSystem._key(toId, type);

    // 显式传入 strengthDelta 时按增量累加（grudge/gratitude/enemy 等累积型）；
    // 未传入时用该类型默认 strength（master/dao_companion 等定值型）。
    const hasDelta = typeof opts.strengthDelta === 'number';
    const delta = hasDelta ? opts.strengthDelta : (def.strength ?? 0);
    let edge = bucket.get(key);
    if (edge) {
      edge.strength = clamp(edge.strength + delta, 0, 100);
    } else {
      // 首次建边：传了 delta 则以 delta 为初值（从 0 起累积），否则用类型默认 strength。
      const initStrength = hasDelta ? delta : (def.strength ?? 0);
      edge = {
        fromId, toId, type,
        affinity: clamp(def.affinity ?? 0, -100, 100),
        strength: clamp(initStrength, 0, 100),
        originTick: opts.tick ?? 0,
        originEventType: opts.eventType ?? null,
      };
      bucket.set(key, edge);
    }

    // 对称类型：自动建反向边（道侣/血亲/同门/盟友/同群等）。
    if (!opts._skipSymmetric && def.symmetricType) {
      this.addEdge(toId, fromId, def.symmetricType, { ...opts, _skipSymmetric: true });
    }
    return edge;
  }

  /**
   * 按事件绑定（relationship.json eventBindings）建边。direction 由调用方在 tick-manager 解释，
   * 这里仅提供「取绑定的 edgeType + strengthDelta」并落边的便捷封装。
   * @param {string} eventType eventBindings 的键
   * @param {string} fromId
   * @param {string} toId
   * @param {Object} [opts] { tick }
   * @returns {RelationEdge|null}
   */
  applyEvent(eventType, fromId, toId, opts = {}) {
    if (!this.enabled) return null;
    const binding = this._bindings[eventType];
    if (!binding || !binding.edgeType) return null;
    return this.addEdge(fromId, toId, binding.edgeType, {
      tick: opts.tick ?? 0,
      eventType,
      strengthDelta: typeof binding.strengthDelta === 'number' ? binding.strengthDelta : undefined,
    });
  }

  /** 取某条边（无则 null）。 */
  getEdge(fromId, toId, type) {
    const bucket = this._edges.get(fromId);
    if (!bucket) return null;
    return bucket.get(RelationshipSystem._key(toId, type)) || null;
  }

  /** 取 fromId 发出的全部边（数组，可能为空）。 */
  edgesFrom(fromId) {
    const bucket = this._edges.get(fromId);
    return bucket ? [...bucket.values()] : [];
  }

  /** 取 fromId 发出的指定类型边（按 strength 降序）。 */
  edgesOfType(fromId, type) {
    return this.edgesFrom(fromId).filter(e => e.type === type).sort((a, b) => b.strength - a.strength);
  }

  /** fromId 对该类型 strength 最高的边（无则 null）。 */
  topEdgeOfType(fromId, type) {
    const list = this.edgesOfType(fromId, type);
    return list.length ? list[0] : null;
  }

  /**
   * 移除涉及某实体的所有边（出边 + 入边）。用于实体死亡/清理（如妖兽重生回收）。
   * @param {string} entityId
   */
  removeEntity(entityId) {
    this._edges.delete(entityId);
    for (const bucket of this._edges.values()) {
      for (const [key, edge] of bucket) {
        if (edge.toId === entityId) bucket.delete(key);
      }
    }
  }

  /**
   * 每日衰减：strength 按 edgeType.decay 向 decayFloor 回落（decay<=0 的类型不变）。
   * strength 归零且 decayFloor 为 0 的边将被清理（节省内存，避免无意义边长期堆积）。
   */
  tick() {
    if (!this.enabled) return;
    for (const bucket of this._edges.values()) {
      for (const [key, edge] of bucket) {
        const def = this._typeDef(edge.type);
        const decay = def.decay ?? 0;
        if (decay <= 0) continue;
        const floor = def.decayFloor ?? 0;
        if (edge.strength > floor) {
          edge.strength = Math.max(floor, edge.strength - decay);
        }
        if (edge.strength <= 0 && floor <= 0) bucket.delete(key);
      }
    }
  }

  /** 全部边的扁平数组（供 graph-builder / 调试）。 */
  allEdges() {
    const out = [];
    for (const bucket of this._edges.values()) {
      for (const edge of bucket.values()) out.push(edge);
    }
    return out;
  }

  /** 统计信息（供报告/调试）。 */
  stats() {
    const byType = {};
    let total = 0;
    for (const bucket of this._edges.values()) {
      for (const edge of bucket.values()) {
        byType[edge.type] = (byType[edge.type] || 0) + 1;
        total++;
      }
    }
    return { total, byType };
  }

  snapshot() {
    return { edges: this.allEdges() };
  }

  loadFrom(snap) {
    this._edges = new Map();
    if (!snap || !Array.isArray(snap.edges)) return;
    for (const e of snap.edges) {
      if (!e.fromId || !e.toId || !e.type) continue;
      let bucket = this._edges.get(e.fromId);
      if (!bucket) { bucket = new Map(); this._edges.set(e.fromId, bucket); }
      bucket.set(RelationshipSystem._key(e.toId, e.type), { ...e });
    }
  }

  toJSON() { return this.snapshot(); }
}
