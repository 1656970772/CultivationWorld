/**
 * ObsessionSystem - 执念系统（GOBT 长期心智，ADR-019）。
 *
 * 执念是凌驾于日常需求之上的人生级长期目标（参考仙逆"逆天改命"、凡人"长生"）。
 * 来源分两类：
 *   - 先天：出生时按人格(野心/正义感)+灵根 roll 一个初始执念（如"长生""成为最强"）。
 *   - 后天：MemorySystem 中的高强度记忆触发新执念（门派被灭→复仇、道侣陨落→复活）。
 *
 * 执念通过 toGoal() 转为高 basePriority 的 Goal，与日常需求目标一起进入 PlannerNode 的
 * Utility 选择。其 goalState 复用现有可达子目标（修为/真气）作为"阶段性手段"——
 * 修仙逻辑下，"变强"是复仇/长生/证道的共同前置；targetRef 供未来"追踪/击杀"行为接入。
 */
import { Goal, GoalSource } from './goal.js';

/**
 * 执念类型枚举。
 * @enum {string}
 */
export const ObsessionType = Object.freeze({
  LONGEVITY: 'longevity',     // 长生：恐惧寿元，痴迷续命/突破
  SUPREMACY: 'supremacy',     // 最强：证道巅峰，痴迷修为
  REVENGE: 'revenge',         // 复仇：针对某人/某势力
  PROTECT_DAO: 'protect_dao', // 护道：除魔卫道（高正义感）
  RESURRECTION: 'resurrection', // 复活：复活陨落的道侣
  // —— 流派分化执念（ADR-022 / ADR-023）——
  PLUNDER: 'plunder',         // 夺宝：铤而走险抢夺天材地宝/闯秘境（参考凡人修仙传 杀人夺宝）
  RETIRE: 'retire',           // 养老：放弃突破，回宗门/洞府安享余生（项目推演设定，无直接原著原型）
  LEGACY: 'legacy',           // 传承：寿元将尽时收徒传法、延续道统（参考大道争锋 传承道统）
  POWER: 'power',             // 夺权：争夺宗门掌门/势力领袖之位（参考凡人修仙传/大道争锋 掌门继任）
});

export class Obsession {
  /**
   * @param {Object} config
   * @param {ObsessionType} config.type
   * @param {string|null} [config.targetId] 复仇/复活目标实体 id
   * @param {string|null} [config.targetFactionId] 复仇目标势力 id
   * @param {number} [config.intensity=80] 执念强度（0-100），映射为 Goal 优先级
   * @param {Object} [config.goalState] GOAP 目标状态（阶段性手段）
   */
  constructor(config) {
    this.type = config.type;
    this.targetId = config.targetId ?? null;
    this.targetFactionId = config.targetFactionId ?? null;
    this.intensity = config.intensity ?? 80;
    this.goalState = config.goalState || {};
    this.name = config.name || config.type;
  }

  /**
   * 转为参与 Utility 选择的 Goal。
   * 优先级 = intensity（0-100，与 Need.priority 同口径），保证执念能与日常需求公平比较，
   * 强执念（intensity 高）自然压过普通需求。
   * @param {?Object} [goalMultCfg] obsession.json goalMult 配置（ADR-020）。
   *   enabled=true 时给执念自身 Goal 注入 self 乘子（如飞升→修为目标 ×1.5）。
   * @returns {Goal}
   */
  toGoal(goalMultCfg = null) {
    const goal = new Goal({
      id: `goal_obsession_${this.type}`,
      name: this.name,
      source: GoalSource.OBSESSION,
      sourceId: `obsession_${this.type}`,
      goalState: this.goalState,
      priority: this.intensity,
      urgency: 0,
      tag: 'obsession',
    });
    if (goalMultCfg && goalMultCfg.enabled === true) {
      const selfMult = goalMultCfg.byType?.[this.type]?.self;
      if (typeof selfMult === 'number' && selfMult !== 1) {
        goal.modulators.push({ label: `obsession_${this.type}_self`, deltaPriority: 0, mult: selfMult });
      }
    }
    return goal;
  }

  toJSON() {
    return {
      type: this.type,
      targetId: this.targetId,
      targetFactionId: this.targetFactionId,
      intensity: this.intensity,
      name: this.name,
    };
  }
}

export class ObsessionSystem {
  /**
   * @param {?Object} [goalMultCfg] obsession.json goalMult 配置（ADR-020），供 toGoals 注入乘子。
   */
  constructor(goalMultCfg = null) {
    /** @type {Obsession[]} */
    this.obsessions = [];
    this.goalMultCfg = goalMultCfg || null;
  }

  add(obsession) {
    if (!obsession) return;
    // 同类型执念只保留强度更高者，避免重复堆叠。
    const existing = this.obsessions.find(o => o.type === obsession.type);
    if (existing) {
      if (obsession.intensity > existing.intensity) {
        Object.assign(existing, obsession);
      }
      return;
    }
    this.obsessions.push(obsession);
  }

  has(type) {
    return this.obsessions.some(o => o.type === type);
  }

  /** 全部执念转为 Goal 列表（供 collectExtraGoals 注入 PlannerNode）。 */
  toGoals() {
    return this.obsessions.map(o => o.toGoal(this.goalMultCfg));
  }

  /**
   * 当前执念对某「需求 Goal」的同方向乘法加成（ADR-020）：
   * 飞升 NPC 的日常修炼也被放大。返回乘子（无加成为 1）。
   * @param {string} needSourceId 如 'need_npc_cultivation'
   * @returns {number}
   */
  needGoalMult(needSourceId) {
    const cfg = this.goalMultCfg;
    if (!cfg || cfg.enabled !== true) return 1;
    let mult = 1;
    for (const o of this.obsessions) {
      const m = cfg.byType?.[o.type]?.needs?.[needSourceId];
      if (typeof m === 'number') mult *= m;
    }
    return mult;
  }

  snapshot() {
    return { obsessions: this.obsessions.map(o => o.toJSON()) };
  }

  loadFrom(snap) {
    if (!snap || !Array.isArray(snap.obsessions)) return;
    this.obsessions = snap.obsessions.map(o => new Obsession(o));
  }

  toJSON() {
    return this.snapshot();
  }
}
