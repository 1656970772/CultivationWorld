/**
 * InfoPropagationSystem - 信息传播系统（ADR-024）
 *
 * 核心思想（参考很多动态世界游戏的"事件 ≠ 信息"问题）：
 *   世界发生的事件不会被所有人瞬间知晓，而是以「消息」为载体，
 *   通过传播半径（天地异象）、口耳相传、城镇广播、宗门/商会情报网逐步扩散。
 *   NPC 只能基于"自己已知的消息"做决策，产生信息不对称与江湖热点的涌现现象。
 *
 * 数据模型见 docs/data-models/info-propagation.md，参数见 data/world/news.json。
 * 默认 enabled=false 时整套系统不产生任何新闻，行为与现状完全一致（零漂移）。
 *
 * 渠道职责分离（单一职责）：
 *   - radius : 每天扩散 spreadRadius，覆盖到 NPC 即写入其 knownNews（本系统 tick 内完成）。
 *   - oral / town / sect / guild : 由 TickManager 在相应时机调用对应 helper（见阶段6）。
 */
import { RELIABILITY_LEVELS } from '../../core/constants.js';

let _newsSeq = 1;

/**
 * 一条世界新闻。事件发生时由 publishNews 创建。
 */
export class WorldNews {
  /**
   * @param {Object} cfg
   * @param {string} cfg.type NewsType
   * @param {{x:number,y:number}} cfg.origin 事件发生坐标
   * @param {number} cfg.day 发生日
   * @param {number} cfg.importance 重要性 0-100
   * @param {number} cfg.value 预估价值（供机会决策）
   * @param {string} [cfg.subjectId] 关联实体（如怀璧其罪的当事 NPC、机会点 id）
   * @param {string} [cfg.opportunityId] 关联机会点 id
   * @param {string} [cfg.text] 描述文本
   * @param {Object} cfg.params news.json 该类型传播参数
   */
  constructor(cfg) {
    this.id = `news_${_newsSeq++}`;
    this.type = cfg.type;
    this.origin = { x: cfg.origin?.x ?? 0, y: cfg.origin?.y ?? 0 };
    this.day = cfg.day ?? 0;
    this.importance = cfg.importance ?? cfg.params?.importance ?? 50;
    this.value = cfg.value ?? 0;
    this.subjectId = cfg.subjectId ?? null;
    this.opportunityId = cfg.opportunityId ?? null;
    this.text = cfg.text ?? '';

    const p = cfg.params || {};
    this.spreadSpeed = p.spreadSpeed ?? 15;
    this.maxRadius = p.maxRadius ?? 150;
    this.baseReliability = p.baseReliability ?? 0.7;
    this.decayRate = p.decayRate ?? 0.02;
    this.ttlDays = p.ttlDays ?? 15;

    /** 当前传播半径（每天增长，达到 maxRadius 后停止扩张） */
    this.spreadRadius = 0;
    /** 直接传播渠道已覆盖到的 NPC id 集合（避免重复写入） */
    this.reachedByRadius = new Set();
  }

  /** 是否已超过存活天数（应被移除）。 */
  isExpired(currentDay) {
    return currentDay - this.day >= this.ttlDays;
  }

  /**
   * 在某距离处的显示可信度（随距离与时间衰减）。
   * 公式：base × max(0, 1 - dist/maxRadius) × (1 - decayRate × 经过天数)。
   */
  reliabilityAt(dist, currentDay) {
    const distFactor = this.maxRadius > 0 ? Math.max(0, 1 - dist / this.maxRadius) : 1;
    const ageFactor = Math.max(0, 1 - this.decayRate * (currentDay - this.day));
    return Math.max(0, this.baseReliability * distFactor * ageFactor);
  }

  toJSON() {
    return {
      id: this.id, type: this.type, origin: this.origin, day: this.day,
      importance: this.importance, value: this.value, subjectId: this.subjectId,
      opportunityId: this.opportunityId, text: this.text,
      spreadRadius: Math.round(this.spreadRadius),
    };
  }
}

export class InfoPropagationSystem {
  /**
   * @param {Object} [config] data/world/news.json 内容
   */
  constructor(config = {}) {
    this.config = config || {};
    /** @type {WorldNews[]} 活跃新闻 */
    this.activeNews = [];
    /** @type {Map<string, WorldNews>} id → news（快速查关联机会等） */
    this._byId = new Map();
  }

  get enabled() {
    return this.config?.enabled === true;
  }

  /** 某新闻类型的传播参数。 */
  paramsFor(type) {
    return this.config?.newsTypes?.[type] || {};
  }

  /** 渠道是否启用。 */
  channelEnabled(channel) {
    return this.config?.channels?.[channel]?.enabled === true;
  }

  channelConfig(channel) {
    return this.config?.channels?.[channel] || {};
  }

  get defaultBeliefThreshold() {
    return this.config?.defaultBeliefThreshold ?? 0.25;
  }

  /**
   * 发布一条新闻（事件源调用）。enabled=false 时静默忽略。
   * @returns {WorldNews|null}
   */
  publishNews({ type, origin, day, value = 0, subjectId = null, opportunityId = null, text = '' }) {
    if (!this.enabled || !type) return null;
    const params = this.paramsFor(type);
    const news = new WorldNews({
      type, origin, day, value, subjectId, opportunityId, text,
      importance: params.importance, params,
    });
    this.activeNews.push(news);
    this._byId.set(news.id, news);
    return news;
  }

  getById(id) {
    return this._byId.get(id) || null;
  }

  /**
   * 每日推进：扩散半径 + 覆盖到的 NPC 写入 knownNews；移除过期新闻。
   * @param {Object} ctx
   * @param {number} ctx.currentDay
   * @param {Array} ctx.npcs 在世 NPC 列表
   * @returns {Array} 本 tick 的传播事件日志（供 tickLog.infoEvents）
   */
  tick({ currentDay, npcs }) {
    const log = [];
    if (!this.enabled) return log;

    // 1) 移除过期新闻
    if (this.activeNews.length > 0) {
      const kept = [];
      for (const news of this.activeNews) {
        if (news.isExpired(currentDay)) {
          this._byId.delete(news.id);
        } else {
          kept.push(news);
        }
      }
      this.activeNews = kept;
    }

    if (!this.channelEnabled('radius')) return log;

    // 2) 半径扩散 + 覆盖判定
    for (const news of this.activeNews) {
      if (news.spreadRadius < news.maxRadius) {
        news.spreadRadius = Math.min(news.maxRadius, news.spreadRadius + news.spreadSpeed);
      }
      const r = news.spreadRadius;
      const r2 = r * r;
      for (const npc of npcs) {
        if (news.reachedByRadius.has(npc.id)) continue;
        const sp = npc.spatial;
        if (!sp) continue;
        const dx = sp.tileX - news.origin.x;
        const dy = sp.tileY - news.origin.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue;
        const dist = Math.sqrt(dist2);
        const reliability = news.reliabilityAt(dist, currentDay);
        const added = receiveNews(npc, news, reliability, currentDay, this.defaultBeliefThreshold);
        news.reachedByRadius.add(npc.id);
        if (added) {
          log.push({
            type: 'news_spread', newsType: news.type, newsId: news.id,
            npcId: npc.id, npcName: npc.name, reliability: Number(reliability.toFixed(2)),
            x: news.origin.x, y: news.origin.y, day: currentDay,
            description: `${npc.name} ${reliabilityLabel(reliability)}${news.text || newsTypeName(this, news.type)}`,
          });
        }
      }
    }
    return log;
  }

  snapshot() {
    return { activeNews: this.activeNews.map(n => n.toJSON()) };
  }
}

/**
 * 把一条新闻写入 NPC 的 knownNews（若可信度达门槛且为更可信的版本）。
 * NPC state 上以 knownNews（普通对象 Map 形式存于专用字段，避免污染 GOAP 状态键）维护。
 * @returns {boolean} 是否实际写入（新知或更新为更高可信度）
 */
export function receiveNews(npc, news, reliability, currentDay, defaultBeliefThreshold) {
  if (!npc || !news) return false;
  const threshold = npc.state?.personality?.beliefThreshold ?? defaultBeliefThreshold;
  if (reliability < threshold) return false;

  if (!npc._knownNews) npc._knownNews = new Map();
  const prev = npc._knownNews.get(news.id);
  if (prev && prev.reliability >= reliability) return false;
  npc._knownNews.set(news.id, {
    newsId: news.id,
    type: news.type,
    reliability,
    value: news.value,
    origin: news.origin,
    opportunityId: news.opportunityId,
    subjectId: news.subjectId,
    tickKnown: currentDay,
  });
  return true;
}

function reliabilityLabel(reliability) {
  if (reliability >= RELIABILITY_LEVELS.CONFIRMED) return '确认了';
  if (reliability >= RELIABILITY_LEVELS.MESSAGE) return '听闻';
  return '隐约听说';
}

function newsTypeName(system, type) {
  return system.config?.newsTypes?.[type]?.name || type;
}
