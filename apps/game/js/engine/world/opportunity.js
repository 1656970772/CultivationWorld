/**
 * WorldOpportunity / OpportunitySystem - 世界机会点系统（ADR-024）
 *
 * 机会点是世界中"有坐标、有价值、会过期"的持久热点，统一表示所有值得 NPC 前往的目标：
 * 妖兽尸骸、秘境入口、拍卖会、天材地宝、怀璧之人等。
 *
 * 关键设计：NPC 不直接响应「事件」，而是响应由事件派生出的「机会点」。这样：
 *   - 多个 NPC 知晓同一消息 → 关联同一机会点 → 涌向同一坐标（江湖热点涌现）。
 *   - 机会点有 maxClaims 与 expireTick，满员/过期后不再吸引新 NPC，避免无限聚集。
 *
 * 参数见 data/world/opportunities.json。默认 enabled=false 时不生成任何机会点。
 */

let _oppSeq = 1;

export class WorldOpportunity {
  /**
   * @param {Object} cfg
   * @param {string} cfg.type OpportunityType
   * @param {{x:number,y:number}} cfg.pos 坐标
   * @param {number} cfg.value 价值
   * @param {number} cfg.createdDay 创建日
   * @param {number} cfg.expireDay 过期日
   * @param {number} cfg.maxClaims 可参与上限
   * @param {string|null} [cfg.rewardSource] reward.json 收益分布键
   * @param {string|null} [cfg.riskKey] risk.json 风险键
   * @param {string|null} [cfg.subjectId] 关联实体（如怀璧之人 NPC id）
   * @param {string} [cfg.name]
   */
  constructor(cfg) {
    this.id = `opp_${_oppSeq++}`;
    this.type = cfg.type;
    this.pos = { x: cfg.pos?.x ?? 0, y: cfg.pos?.y ?? 0 };
    this.value = cfg.value ?? 0;
    this.createdDay = cfg.createdDay ?? 0;
    this.expireDay = cfg.expireDay ?? (this.createdDay + 15);
    this.maxClaims = cfg.maxClaims ?? 99;
    this.rewardSource = cfg.rewardSource ?? null;
    this.riskKey = cfg.riskKey ?? null;
    this.subjectId = cfg.subjectId ?? null;
    this.name = cfg.name || cfg.type;
    /** @type {Set<string>} 已参与/领取的 NPC id */
    this.claimedBy = new Set();
  }

  isExpired(currentDay) {
    return currentDay >= this.expireDay;
  }

  isFull() {
    return this.claimedBy.size >= this.maxClaims;
  }

  /** 是否仍可被新 NPC 追逐（未过期、未满、还有价值）。 */
  isOpen(currentDay) {
    return !this.isExpired(currentDay) && !this.isFull();
  }

  claim(npcId) {
    this.claimedBy.add(npcId);
  }

  toJSON() {
    return {
      id: this.id, type: this.type, pos: this.pos, value: this.value,
      createdDay: this.createdDay, expireDay: this.expireDay,
      claims: this.claimedBy.size, maxClaims: this.maxClaims,
      subjectId: this.subjectId, name: this.name,
    };
  }
}

export class OpportunitySystem {
  /**
   * @param {Object} [config] data/world/opportunities.json
   */
  constructor(config = {}) {
    this.config = config || {};
    /** @type {WorldOpportunity[]} */
    this.opportunities = [];
    this._byId = new Map();
  }

  get enabled() {
    return this.config?.enabled === true;
  }

  typeConfig(type) {
    return this.config?.types?.[type] || {};
  }

  get decision() {
    return this.config?.decision || {};
  }

  /**
   * 生成一个机会点（事件源调用）。enabled=false 时返回 null。
   * @param {Object} args
   * @param {string} args.type
   * @param {{x:number,y:number}} args.pos
   * @param {number} args.currentDay
   * @param {number} [args.value] 覆盖默认价值
   * @param {string|null} [args.subjectId]
   * @returns {WorldOpportunity|null}
   */
  spawn({ type, pos, currentDay, value = null, subjectId = null, rewardSource = undefined, riskKey = undefined, maxClaims = undefined, name = undefined }) {
    if (!this.enabled || !type || !pos) return null;
    const tc = this.typeConfig(type);
    const opp = new WorldOpportunity({
      type, pos, createdDay: currentDay,
      value: value != null ? value : (tc.value ?? 0),
      expireDay: currentDay + (tc.lifespanDays ?? 15),
      maxClaims: maxClaims ?? tc.maxClaims ?? 99,
      rewardSource: rewardSource !== undefined ? rewardSource : (tc.rewardSource ?? null),
      riskKey: riskKey !== undefined ? riskKey : (tc.riskKey ?? null),
      subjectId,
      name: name || tc.name,
    });
    this.opportunities.push(opp);
    this._byId.set(opp.id, opp);
    return opp;
  }

  getById(id) {
    return this._byId.get(id) || null;
  }

  /** 移除过期机会点，返回过期日志。 */
  tick(currentDay) {
    const log = [];
    if (this.opportunities.length === 0) return log;
    const kept = [];
    for (const opp of this.opportunities) {
      if (opp.isExpired(currentDay)) {
        this._byId.delete(opp.id);
        log.push({
          type: 'opportunity_expired', oppType: opp.type, oppId: opp.id,
          x: opp.pos.x, y: opp.pos.y, day: currentDay, claims: opp.claimedBy.size,
          description: `${opp.name}（${opp.pos.x},${opp.pos.y}）机缘已逝`,
        });
      } else {
        kept.push(opp);
      }
    }
    this.opportunities = kept;
    return log;
  }

  snapshot() {
    return { opportunities: this.opportunities.map(o => o.toJSON()) };
  }
}
