/**
 * MonsterState - 妖兽运行时状态
 *
 * 寿元/自然死亡规则与 NPC 一致（到寿而终的二次曲线），但寿元按妖兽阶位决定，
 * 且整体比同等修为的人类更长（妖兽天生寿元长）。
 * - 寿元上限由 lifespanConfig.byGrade[grade].baseYears ± varianceYears 决定
 * - age < startRatio × maxAge → 不触发自然死亡
 * - startRatio ≤ lifeRatio < 1.0 → deathChance = minChance + (maxChance-minChance) × t²
 * - age ≥ 100% maxAge → 必死
 */
import { RuntimeState } from '../abstract/runtime-state.js';

export class MonsterState extends RuntimeState {
  /**
   * @param {Object} def      monsters.json 妖兽定义
   * @param {Object} [opts]
   * @param {Object} [opts.lifespanConfig] 寿元配置（来自 monster-spawn.json lifespan 段）
   */
  constructor(def, opts = {}) {
    const attrs = def.attributes || {};
    const maxHp = (attrs.vitality || 30) * 10;

    const life = opts.lifespanConfig || {};
    const daysPerYear = life.daysPerYear ?? 360;
    const gradeKey = String(def.grade);
    const gradeLife = (life.byGrade && life.byGrade[gradeKey]) || null;
    const baseYears = gradeLife ? gradeLife.baseYears : (def.grade * 120 + 80);
    const varianceYears = gradeLife ? gradeLife.varianceYears : baseYears * 0.2;

    const maxAgeYears = baseYears + (Math.random() - 0.5) * 2 * varianceYears;
    const maxAgeDays = Math.max(1, Math.floor(maxAgeYears * daysPerYear));

    const initMin = life.initialAgeRatioMin ?? 0.2;
    const initMax = life.initialAgeRatioMax ?? 0.7;
    const ageRatio = initMin + Math.random() * (initMax - initMin);
    const ageDays = Math.floor(maxAgeDays * ageRatio);

    super({
      alive: true,
      grade: def.grade,
      hp: maxHp,
      maxHp,
      // 战斗力粗略估算：力量 + 速度*0.5 + 防御 + 阶位加成
      power: (attrs.strength || 0) + (attrs.speed || 0) * 0.5 + (attrs.defense || 0) + def.grade * 30,
      behaviorState: 'wander', // wander | hunt | rest
      targetNpcId: null,
      restDays: 0,
      huntCooldown: 0,
      ageDays,
      ageYears: Math.floor(ageDays / daysPerYear),
      maxAgeDays,
      maxAgeYears: Math.floor(maxAgeYears),
      lifeRatio: ageDays / maxAgeDays,
      // BT 条件字段（由钩子方法每 tick 刷新）
      hpRatio: 1,
      hasTarget: false,
      nearTarget: false,
      packNearby: 0,
      // tier3+ 情绪与仇恨（grade < 5 时保持初始值 0/null，不参与决策）
      emotionFear: 0,
      emotionRage: 0,
      grudgeTargetId: null,
    });

    this._daysPerYear = daysPerYear;
    const death = life.death || {};
    this._naturalDeath = {
      startRatio: death.startRatio ?? 0.95,
      minChance: death.minChance ?? 0.0002,
      maxChance: death.maxChance ?? 1.0,
    };
  }

  /** 推进一天年龄 */
  advanceAge() {
    const ageDays = (this.get('ageDays') || 0) + 1;
    const maxAgeDays = this.get('maxAgeDays') || 1;
    this.setMany({
      ageDays,
      ageYears: Math.floor(ageDays / this._daysPerYear),
      lifeRatio: ageDays / maxAgeDays,
    });
  }

  /**
   * 自然死亡判定（到寿曲线，与 NPC 同一公式）
   * @returns {{ died: boolean, deathChance: number, roll: number } | false}
   */
  checkNaturalDeath() {
    const ageDays = this.get('ageDays') || 0;
    const maxAgeDays = this.get('maxAgeDays') || 1;
    const { startRatio, minChance, maxChance } = this._naturalDeath;

    const threshold = Math.floor(maxAgeDays * startRatio);
    if (ageDays < threshold) return false;
    if (ageDays >= maxAgeDays) return { died: true, deathChance: 1.0, roll: 0 };

    const t = (ageDays - threshold) / (maxAgeDays - threshold);
    const deathChance = minChance + (maxChance - minChance) * t * t;
    const roll = Math.random();
    return { died: roll < deathChance, deathChance, roll };
  }
}
