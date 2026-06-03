/**
 * MonsterEntity - 妖兽实体
 *
 * 继承 BaseEntity，持有空间组件，可在地图上移动。
 * 行为按妖兽阶位分三档行为树：
 *   tier1（grade 1-2）：纯本能 BT — 休整/逃跑/追杀/游荡
 *   tier2（grade 3-4）：领地本能 BT — 增加呼群、巡逻、受伤撤退
 *   tier3（grade 5-6）：初级智慧 BT — 增加情绪（恐惧/狂暴）、仇恨记忆
 *
 * grade 6+（元婴等价）：当前使用 tier3，后续扩展为完整 GOBT（妖兽 Need/Action/Goal）。
 */
import { BaseEntity } from '../abstract/base-entity.js';
import { BTLoader } from '../abstract/bt/bt-loader.js';
import { BTStatus } from '../abstract/bt/bt-node.js';
import { MonsterStaticData } from './monster-static-data.js';
import { MonsterState } from './monster-state.js';
import { MONSTER_TIER1_BT, MONSTER_TIER2_BT, MONSTER_TIER3_BT } from './monster-bt-presets.js';
import { applyDamage } from '../combat/combat-pipeline.js';

/** 妖兽阶位 → 近似修炼境界 order（用于与 NPC 境界比较强弱） */
const GRADE_TO_ORDER = {
  1: 20, 2: 35, 3: 45, 4: 60, 5: 65, 6: 70, 7: 75, 8: 80, 9: 85,
};

/** grade → BT 档位（1/2/3） */
function getBTTier(grade) {
  if (grade >= 5) return 3;
  if (grade >= 3) return 2;
  return 1;
}

/** 档位 → BT 定义 */
const TIER_BT = {
  1: MONSTER_TIER1_BT,
  2: MONSTER_TIER2_BT,
  3: MONSTER_TIER3_BT,
};

export class MonsterEntity extends BaseEntity {
  /**
   * @param {Object} def      monsters.json 妖兽定义
   * @param {Object} opts      { id, name, x, y, speed, wanderRadius, senseRange, rankOrderMap }
   */
  constructor(def, opts = {}) {
    super(opts.id, 'monster');
    this._def = def;
    // 确定性随机源（由 MonsterSpawner 经 opts 注入）。妖兽内部随机统一走 this._rng。
    this._rng = opts.rng || null;
    this.staticData = new MonsterStaticData(def, {
      name: opts.name,
      homeX: opts.x,
      homeY: opts.y,
      wanderRadius: opts.wanderRadius ?? 12,
    });
    this.state = new MonsterState(def, { lifespanConfig: opts.lifespanConfig, rng: this._rng });
    this.initSpatial({ x: opts.x, y: opts.y, speed: opts.speed ?? 3 });

    this._senseRange = opts.senseRange ?? 8;
    this._rankOrderMap = opts.rankOrderMap || {};
    this._orderEquivalent = GRADE_TO_ORDER[def.grade] || (def.grade * 10);
    this._combat = opts.combatConfig || {};

    // 按阶位装配对应档位的行为树
    this._btTier = getBTTier(def.grade);
    const loader = new BTLoader();
    this.initBT(loader.build(TIER_BT[this._btTier]));

    // tier3 专用：领地巡逻角度（持久化，避免每次相同路线）
    this._patrolAngle = this._rng.next() * Math.PI * 2;
    // 当前 tick 感知到的猎物引用（monsterSense 写入，同 tick 内复用）
    this._preyRef = null;
  }

  get name() { return this.staticData.name; }
  get grade() { return this.staticData.grade; }

  // ---------------------------------------------------------------------------
  // BT 钩子：公共基础（所有档位）
  // ---------------------------------------------------------------------------

  /**
   * 预处理：年龄推进、自然死亡判定、更新 hpRatio、猎食冷却倒计时。
   * 返回 FAILURE 表示妖兽本 tick 已死，停止行为树。
   */
  monsterPreTick(worldContext) {
    this.state.advanceAge();
    const deathResult = this.state.checkNaturalDeath();
    if (deathResult && deathResult.died) {
      this._die('natural');
      return BTStatus.FAILURE;
    }

    const hp = this.state.get('hp');
    const maxHp = this.state.get('maxHp');
    this.state.set('hpRatio', maxHp > 0 ? hp / maxHp : 1);

    const huntCd = this.state.get('huntCooldown') || 0;
    if (huntCd > 0) this.state.set('huntCooldown', huntCd - 1);

    return BTStatus.SUCCESS;
  }

  /**
   * 感知：扫描感知范围内的可猎杀 NPC，更新 hasTarget / nearTarget / targetNpcId。
   */
  monsterSense(worldContext) {
    const prey = this._findPrey(worldContext);
    this._preyRef = prey;
    if (prey && prey.spatial) {
      this.state.set('targetNpcId', prey.id);
      this.state.set('hasTarget', true);
      const dist = this.spatial.distanceTo(prey.spatial.tileX, prey.spatial.tileY);
      this.state.set('nearTarget', dist <= 1.5);
    } else {
      this.state.set('targetNpcId', null);
      this.state.set('hasTarget', false);
      this.state.set('nearTarget', false);
      this._preyRef = null;
    }
    // 领地感知（ADR-028）：察觉闯入老巢半径的 NPC，建 territory_threat 边。
    // 仅 goalsEnabled 时执行；不改变 hasTarget/猎食逻辑。
    this._senseTerritory(worldContext);
    return BTStatus.SUCCESS;
  }

  /**
   * 领地威胁感知（ADR-028）：对进入 home±wanderRadius 的 NPC，经 worldContext.recordTerritoryThreat
   * 建领地威胁边，并把最近的入侵者缓存到 _intruderRef + state.intruderNpcId 供领地防御读取。
   * 仅在关系驱动启用时生效；否则不写任何状态。
   */
  _senseTerritory(worldContext) {
    if (typeof worldContext?.relationGoalsEnabled !== 'function' || !worldContext.relationGoalsEnabled()) {
      return;
    }
    const registry = worldContext.entityRegistry;
    if (!registry) return;
    const home = { x: this.staticData.get('homeX'), y: this.staticData.get('homeY') };
    const radius = this.staticData.get('wanderRadius') || 12;
    const npcs = registry.getAliveByType('npc');
    let nearest = null, nearestDist = radius + 0.01;
    for (const npc of npcs) {
      if (!npc.spatial) continue;
      const d = Math.abs(npc.spatial.tileX - home.x) + Math.abs(npc.spatial.tileY - home.y);
      if (d > radius) continue;
      if (typeof worldContext.recordTerritoryThreat === 'function') {
        worldContext.recordTerritoryThreat(this.id, npc.id);
      }
      if (d < nearestDist) { nearestDist = d; nearest = npc; }
    }
    this._intruderRef = nearest;
    this.state.set('intruderNpcId', nearest ? nearest.id : null);
  }

  /**
   * 休整：恢复 HP，倒计时；倒计时归零时切换回游荡。
   */
  monsterRest() {
    const maxHp = this.state.get('maxHp');
    const hp = this.state.get('hp');
    this.state.set('hp', Math.min(maxHp, hp + maxHp * 0.1));
    const rest = (this.state.get('restDays') || 0) - 1;
    if (rest <= 0) {
      this.state.set('behaviorState', 'wander');
      this.state.set('restDays', 0);
      return BTStatus.SUCCESS;
    }
    this.state.set('restDays', rest);
    return BTStatus.RUNNING;
  }

  /**
   * 逃跑：向老巢方向移动并进入短暂休整。
   */
  monsterFlee() {
    const home = { x: this.staticData.get('homeX'), y: this.staticData.get('homeY') };
    this.spatial.setDestination(home.x, home.y);
    this.state.set('behaviorState', 'rest');
    this.state.set('restDays', 3);
    this.state.set('hasTarget', false);
    this.state.set('targetNpcId', null);
    this._preyRef = null;
    return BTStatus.RUNNING;
  }

  /**
   * 追杀：追踪猎物，贴近时发动攻击。
   */
  monsterChaseOrAttack(worldContext) {
    const prey = this._preyRef || this._getTargetPrey(worldContext);
    if (!prey || !prey.spatial) {
      this.state.set('hasTarget', false);
      this.state.set('targetNpcId', null);
      return BTStatus.FAILURE;
    }

    this.state.set('behaviorState', 'hunt');
    this.state.set('targetNpcId', prey.id);
    this.spatial.setDestination(prey.spatial.tileX, prey.spatial.tileY);

    const dist = this.spatial.distanceTo(prey.spatial.tileX, prey.spatial.tileY);
    if (dist <= 1.5) {
      const atk = this._attack(prey, worldContext);
      if (this._tickLog) this._tickLog.action = 'attack';
      if (atk.monsterKilled) return BTStatus.FAILURE;
    } else {
      if (this._tickLog) this._tickLog.action = 'chase';
    }
    return BTStatus.RUNNING;
  }

  /**
   * 无猎物时的本能行为（2026-06-02 行为精准化）：不再 96% 纯游荡，而是按本能在
   * 归巢栖息(lair) / 觅食游猎(forage) / 群居聚拢 / 游荡(wander) 间分化，体现领地与巢穴意识。
   *
   * 世界观依据（docs/世界观参考/.../妖兽与修士关系分析.md）：妖兽有强领地意识、栖息于巢穴、
   * 群居物种成群活动、低阶勤于觅食。仅在 destination 为空（上一目标到达）时重选本能，
   * 避免每 tick 抖动；不触碰 hunt/flee 主链，零外部依赖。
   */
  monsterWander(worldContext) {
    this.state.set('targetNpcId', null);

    // 归巢栖息倒计时：在巢穴停留若干天恢复体力（区别于战后 rest，画像标记为 lair）。
    if (this.state.get('behaviorState') === 'lair' && !this.spatial.destination) {
      const lairDays = (this.state.get('lairDays') || 0) - 1;
      if (lairDays > 0) {
        this.state.set('lairDays', lairDays);
        const maxHp = this.state.get('maxHp'); const hp = this.state.get('hp');
        this.state.set('hp', Math.min(maxHp, hp + maxHp * 0.05));
        return BTStatus.RUNNING;
      }
      this.state.set('lairDays', 0);
      this.state.set('behaviorState', 'wander');
    }

    // 上一段移动未结束：保持当前本能状态继续走（已在 behaviorState 中）。
    if (this.spatial.destination) {
      const bs = this.state.get('behaviorState');
      if (!bs || bs === 'hunt') this.state.set('behaviorState', 'wander');
      return BTStatus.RUNNING;
    }

    const home = { x: this.staticData.get('homeX'), y: this.staticData.get('homeY') };
    const radius = this.staticData.get('wanderRadius') || 8;
    const lairChance = this._combat.lairChance ?? 0;
    const forageChance = this._combat.forageChance ?? 0;
    const packCohesion = this._combat.packCohesion ?? 0;
    const roll = this._rng.next();

    // 1) 归巢栖息：恋巢本能，越高阶越恋巢。回到老巢后栖息若干天（恢复体力，体现"巢穴"）。
    if (roll < lairChance) {
      const dist = this.spatial.distanceTo(home.x, home.y);
      this.state.set('behaviorState', 'lair');
      if (dist <= 1.5) {
        this.state.set('lairDays', this._combat.lairRestDays ?? 2);
      } else {
        this.spatial.setDestination(home.x, home.y);
      }
      return BTStatus.RUNNING;
    }

    // 2) 群居聚拢：swarmBehavior 物种向附近同族（同 defId）靠拢，形成兽群而非各自漫游。
    if (this.staticData.get('swarmBehavior') && roll < lairChance + packCohesion) {
      const mate = this._findNearbySameSpecies(worldContext);
      if (mate && mate.spatial) {
        this.state.set('behaviorState', 'wander');
        this.spatial.setDestination(
          mate.spatial.tileX + Math.round((this._rng.next() - 0.5) * 3),
          mate.spatial.tileY + Math.round((this._rng.next() - 0.5) * 3),
        );
        return BTStatus.RUNNING;
      }
    }

    // 3) 觅食游猎：向较远处搜寻食物，覆盖范围比普通游荡更大（低阶更勤觅食）。
    const isForage = roll < lairChance + packCohesion + forageChance;
    const r = isForage ? radius * (0.8 + this._rng.next() * 0.7) : this._rng.next() * radius;
    this.state.set('behaviorState', isForage ? 'forage' : 'wander');
    const angle = this._rng.next() * Math.PI * 2;
    this.spatial.setDestination(
      Math.round(home.x + Math.cos(angle) * r),
      Math.round(home.y + Math.sin(angle) * r),
    );
    return BTStatus.RUNNING;
  }

  /** 在感知范围内寻找同种妖兽（同 defId），供群居物种聚拢成群。 */
  _findNearbySameSpecies(worldContext) {
    const registry = worldContext?.entityRegistry;
    if (!registry) return null;
    const defId = this.staticData.get('defId');
    const sp = this.spatial;
    let best = null, bestDist = this._senseRange * 2 + 0.01;
    for (const m of registry.getAliveByType('monster')) {
      if (m.id === this.id || !m.spatial) continue;
      if (m.staticData.get('defId') !== defId) continue;
      const d = sp.distanceTo(m.spatial.tileX, m.spatial.tileY);
      if (d > 1 && d <= bestDist) { bestDist = d; best = m; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // BT 钩子：tier2+ 领地行为
  // ---------------------------------------------------------------------------

  /**
   * 呼唤同族（ADR-028 升级为协防）：统计附近同阶妖兽数量；
   * 当关系驱动启用且本兽有目标时，读 pack_member 边，令附近空闲同群妖兽锁定同一目标（群起而攻）。
   * 关系驱动关闭时仅计数（回退一期 stub 行为）。
   */
  monsterCallPack(worldContext) {
    if (!worldContext?.entityRegistry) return BTStatus.SUCCESS;
    const monsters = worldContext.entityRegistry.getAliveByType('monster');
    const sp = this.spatial;
    let count = 0;
    for (const m of monsters) {
      if (m.id === this.id || !m.spatial) continue;
      if (m.grade === this.grade) {
        const d = sp.distanceTo(m.spatial.tileX, m.spatial.tileY);
        if (d <= this._senseRange * 1.5) count++;
      }
    }
    this.state.set('packNearby', count);

    // 协防（ADR-028）：仅 goalsEnabled 时，把本兽当前目标同步给附近空闲同群妖兽。
    const gateOn = typeof worldContext.relationGoalsEnabled === 'function' && worldContext.relationGoalsEnabled();
    const rs = worldContext.relationshipSystem;
    const targetId = this.state.get('targetNpcId');
    if (gateOn && rs && targetId && typeof rs.edgesOfType === 'function') {
      const target = worldContext.entityRegistry.getById(targetId);
      if (target && target.alive && target.spatial) {
        for (const edge of rs.edgesOfType(this.id, 'pack_member')) {
          const mate = worldContext.entityRegistry.getById(edge.toId);
          if (!mate || !mate.alive || !mate.spatial || mate.id === this.id) continue;
          // 仅指挥附近且当前空闲（无目标/非休整）的同群妖兽，避免打断其自身猎食/逃跑。
          if (mate.state.get('hasTarget') === true) continue;
          if (mate.state.get('behaviorState') === 'rest') continue;
          const d = sp.distanceTo(mate.spatial.tileX, mate.spatial.tileY);
          if (d > this._senseRange * 1.5) continue;
          mate.state.set('targetNpcId', targetId);
          mate.state.set('hasTarget', true);
          mate._preyRef = target;
        }
      }
    }
    return BTStatus.SUCCESS;
  }

  /**
   * 领地防御（ADR-028，tier2+）：察觉到闯入老巢半径的 NPC（intruderNpcId 由 _senseTerritory 设置）时，
   * 即便对方境界高于本兽（强者入侵），也锁定为攻击目标，群起护territory（区别于只猎弱者的 _findPrey）。
   * 仅 goalsEnabled 且配置 defendEnabled 时生效；本兽 tier 须 ≥ minTierForDefense。返回 SUCCESS 表示已接管目标。
   */
  monsterDefendTerritory(worldContext) {
    if (typeof worldContext?.relationGoalsEnabled !== 'function' || !worldContext.relationGoalsEnabled()) {
      return BTStatus.FAILURE;
    }
    const territoryCfg = worldContext.relationshipConfig?.territory || {};
    if (territoryCfg.defendEnabled === false) return BTStatus.FAILURE;
    const minTier = territoryCfg.minTierForDefense ?? 2;
    if (this._btTier < minTier) return BTStatus.FAILURE;

    const intruderId = this.state.get('intruderNpcId');
    if (!intruderId) return BTStatus.FAILURE;
    const intruder = this._intruderRef && this._intruderRef.id === intruderId
      ? this._intruderRef
      : worldContext.entityRegistry?.getById(intruderId);
    if (!intruder || !intruder.alive || !intruder.spatial) {
      this.state.set('intruderNpcId', null);
      return BTStatus.FAILURE;
    }
    // 锁定入侵者为目标（覆盖弱猎物逻辑），交由 chase/attack 与 call-pack 处理。
    this._preyRef = intruder;
    this.state.set('targetNpcId', intruder.id);
    this.state.set('hasTarget', true);
    const dist = this.spatial.distanceTo(intruder.spatial.tileX, intruder.spatial.tileY);
    this.state.set('nearTarget', dist <= 1.5);
    return BTStatus.SUCCESS;
  }

  /**
   * 领地巡逻（tier2+，2026-06-02 行为精准化）：高阶妖兽领地意识强，本能分化为
   * 归巢守穴(lair) / 系统巡逻(patrol) / 巡逻间游荡(wander)，比单一随机游荡更像"领地霸主"。
   * 归巢概率(lairChance)随阶位提高（数据驱动），体现"越高阶越镇守老巢"。
   */
  monsterPatrolTerritory() {
    const home = { x: this.staticData.get('homeX'), y: this.staticData.get('homeY') };
    const radius = this.staticData.get('wanderRadius') || 12;

    // 归巢守穴倒计时（与 monsterWander 同机制，画像标记为 lair）。
    if (this.state.get('behaviorState') === 'lair' && !this.spatial.destination) {
      const lairDays = (this.state.get('lairDays') || 0) - 1;
      if (lairDays > 0) {
        this.state.set('lairDays', lairDays);
        const maxHp = this.state.get('maxHp'); const hp = this.state.get('hp');
        this.state.set('hp', Math.min(maxHp, hp + maxHp * 0.05));
        return BTStatus.RUNNING;
      }
      this.state.set('lairDays', 0);
      this.state.set('behaviorState', 'patrol');
    }

    if (this.spatial.destination) {
      const bs = this.state.get('behaviorState');
      if (!bs || bs === 'hunt') this.state.set('behaviorState', 'patrol');
      return BTStatus.RUNNING;
    }

    const lairChance = this._combat.lairChance ?? 0;
    if (this._rng.next() < lairChance) {
      const dist = this.spatial.distanceTo(home.x, home.y);
      this.state.set('behaviorState', 'lair');
      if (dist <= 1.5) this.state.set('lairDays', this._combat.lairRestDays ?? 3);
      else this.spatial.setDestination(home.x, home.y);
      return BTStatus.RUNNING;
    }

    // 系统巡逻：按固定角步长绕 home 巡逻，覆盖领地更均匀（patrol 状态便于画像识别）。
    this.state.set('behaviorState', 'patrol');
    this._patrolAngle = (this._patrolAngle + Math.PI / 4) % (Math.PI * 2);
    const tx = Math.round(home.x + Math.cos(this._patrolAngle) * radius * 0.8);
    const ty = Math.round(home.y + Math.sin(this._patrolAngle) * radius * 0.8);
    this.spatial.setDestination(tx, ty);
    return BTStatus.RUNNING;
  }

  /**
   * 撤回老巢：向 home 移动，到达后切入休整。
   */
  monsterReturnToLair() {
    const home = { x: this.staticData.get('homeX'), y: this.staticData.get('homeY') };
    this.spatial.setDestination(home.x, home.y);
    const dist = this.spatial.distanceTo(home.x, home.y);
    if (dist <= 2) {
      this.state.set('behaviorState', 'rest');
      this.state.set('restDays', 5);
      return BTStatus.SUCCESS;
    }
    return BTStatus.RUNNING;
  }

  // ---------------------------------------------------------------------------
  // BT 钩子：tier3 情绪/仇恨
  // ---------------------------------------------------------------------------

  /**
   * 刷新本能情绪（恐惧/愤怒）：低血量积累恐惧，有猎物积累愤怒，自然衰减。
   */
  monsterUpdateInstincts() {
    const hpRatio = this.state.get('hpRatio') ?? 1;
    const hasTarget = this.state.get('hasTarget');

    let fear = this.state.get('emotionFear') || 0;
    if (hpRatio < 0.5) {
      fear = Math.min(100, fear + (0.5 - hpRatio) * 20);
    } else {
      fear = Math.max(0, fear - 2);
    }

    let rage = this.state.get('emotionRage') || 0;
    rage = hasTarget
      ? Math.min(100, rage + 5)
      : Math.max(0, rage - 3);

    this.state.set('emotionFear', Math.round(fear));
    this.state.set('emotionRage', Math.round(rage));
    return BTStatus.SUCCESS;
  }

  /**
   * 狂暴冲击：忽略血量警戒，强制追杀当前目标。
   */
  monsterBerserkAttack(worldContext) {
    if (!this.state.get('hasTarget')) return BTStatus.FAILURE;
    return this.monsterChaseOrAttack(worldContext);
  }

  /**
   * 仇恨追猎：追杀记录在 grudgeTargetId 中的仇人。
   */
  monsterHuntGrudge(worldContext) {
    const grudgeId = this.state.get('grudgeTargetId');
    if (!grudgeId || !worldContext?.entityRegistry) return BTStatus.FAILURE;
    const target = worldContext.entityRegistry.getById(grudgeId);
    if (!target || !target.alive || !target.spatial) {
      this.state.set('grudgeTargetId', null);
      return BTStatus.FAILURE;
    }
    this._preyRef = target;
    this.state.set('hasTarget', true);
    this.state.set('targetNpcId', grudgeId);
    return this.monsterChaseOrAttack(worldContext);
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /**
   * 在感知范围内寻找可猎杀的 NPC（境界 order 低于妖兽等效 order）。
   */
  _findPrey(worldContext) {
    const registry = worldContext?.entityRegistry;
    if (!registry) return null;

    const huntChance = this._combat.huntChancePerTick ?? 1;
    if (this._rng.next() > huntChance) return null;

    const huntCd = this.state.get('huntCooldown') || 0;
    if (huntCd > 0) return null;

    const npcs = registry.getAliveByType('npc');
    const sp = this.spatial;
    const gap = this._combat.minOrderGapToHunt ?? 0;

    let best = null, bestDist = this._senseRange + 0.01;
    for (const npc of npcs) {
      if (!npc.spatial) continue;
      const npcOrder = this._rankOrderMap[npc.state.get('rankId')] ?? 0;
      if (npcOrder > this._orderEquivalent - gap) continue;
      const d = sp.distanceTo(npc.spatial.tileX, npc.spatial.tileY);
      if (d <= bestDist) { bestDist = d; best = npc; }
    }
    return best;
  }

  /**
   * 通过 targetNpcId 取猎物实体引用（monsterSense 缓存失效时的回退）。
   */
  _getTargetPrey(worldContext) {
    const id = this.state.get('targetNpcId');
    if (!id || !worldContext?.entityRegistry) return null;
    const e = worldContext.entityRegistry.getById(id);
    return (e && e.alive) ? e : null;
  }

  /**
   * 攻击猎物：按战力对比造成伤害/击杀，攻击后进入猎食冷却与休整。
   */
  _attack(npc, worldContext) {
    const monsterPower = this.state.get('power') || 0;
    const npcOrder = this._rankOrderMap[npc.state.get('rankId')] ?? 0;
    const npcPower = npcOrder * 5 + 20;

    const cooldownDays = this._combat.huntCooldownDays ?? 6;

    const winChance = monsterPower / (monsterPower + npcPower);
    let killed = false;
    const role = npc.state.get('currentRole');
    const protectedRole = role === 'leader' || role === 'elder';

    // ADR-042：真实攻防扣血走【统一伤害管线】applyDamage（取代妖兽自有的锁血/碾压实现）。
    //   伤害 = 妖兽攻击力(power) × (1 - NPC防御减免) × random(0.8,1.2)，最低 1。
    //   致死时由 applyDamage 统一判定：非碾压且持锁血能力则锁血到 lockRatio×maxHp（+可能遁地脱险）；
    //   碾压（orderGap≥crushOrderGap 或单击≥maxHp×crushHpMultiple）或无锁血能力则直接死。
    //   leader/elder 仍受保护：不允许致死，hp<=0 托底锁血到 lockRatio×maxHp（沿用旧语义）。
    const combatCfg = worldContext?.balanceConfig?.combat || {};
    const defMap = combatCfg.npcCombat?.baseDef || {};
    const lockCfg = combatCfg.lockHp || {};
    const def = defMap[npc.state.get('rankId')] ?? 0;
    const dmgRoll = 0.8 + this._rng.next() * 0.4;
    const damage = Math.max(1, monsterPower * (1 - def) * dmgRoll);

    const maxHp = npc.state.get('maxHp') || 0;
    const orderGap = (this._orderEquivalent ?? 0) - npcOrder;

    if (protectedRole) {
      const lockRatio = lockCfg.lockRatio ?? 0.05;
      const curHp = npc.state.get('hp') ?? maxHp;
      const newHp = curHp - damage;
      npc.state.set('hp', newHp > 0 ? newHp : (maxHp > 0 ? maxHp * lockRatio : 1));
      npc.state.set('injuryLevel', (npc.state.get('injuryLevel') || 0) + 1);
    } else {
      const result = applyDamage(npc, {
        amount: damage,
        cause: 'monster',
        killer: null,
        orderGap,
        extraDeathInfo: {
          monsterName: this.name,
          monsterGrade: this.grade,
          crushDamage: Math.round(damage),
          victimMaxHp: Math.round(maxHp),
          orderGap,
        },
      }, worldContext);
      killed = result.died;
      // tier3：被自己猎杀/重创的修士对其他同门造成仇恨种子（外部可监听并设置 grudge）
    }

    // NPC 反击妖兽（只要 NPC 未死）：扣妖兽 hp，妖兽可能被反杀（ADR-041：保留双向伤害交换）。
    if (npc.alive) {
      const counterBase = this._combat.npcCounterDamageBase ?? 18;
      const counterWeight = this._combat.npcCounterOrderWeight ?? 1.2;
      const counterDmg = counterBase + npcOrder * counterWeight + this._rng.next() * 10;
      const monHp = (this.state.get('hp') || 0) - counterDmg;
      this.state.set('hp', monHp);
      // tier3：被修士反击，记住仇人
      if (this._btTier >= 3 && !this.state.get('grudgeTargetId')) {
        this.state.set('grudgeTargetId', npc.id);
        // 关系网（ADR-027）：在统一关系网建『妖兽仇敌』边（mon→npc）。
        if (worldContext && typeof worldContext.recordMonsterGrudge === 'function') {
          worldContext.recordMonsterGrudge(this.id, npc.id);
        }
      }
      if (monHp <= 0) {
        this._die('npc_counter', npc.name);
        if (worldContext?.infoEvents) {
          worldContext.infoEvents.push({
            type: 'monster_attack', day: worldContext.currentDay,
            monsterId: this.id, monsterName: this.name,
            npcId: npc.id, npcName: npc.name, killed: false, monsterKilled: true,
            description: `${npc.name} 反杀了 ${this.name}`,
          });
        }
        return { killed: false, monsterKilled: true, winChance };
      }
    }

    this.state.set('huntCooldown', cooldownDays);
    this.state.set('behaviorState', 'rest');
    this.state.set('restDays', killed ? 4 : 2);
    this.state.set('targetNpcId', null);
    this.spatial.clearDestination();

    if (worldContext?.infoEvents) {
      worldContext.infoEvents.push({
        type: 'monster_attack',
        day: worldContext.currentDay,
        monsterId: this.id, monsterName: this.name,
        npcId: npc.id, npcName: npc.name,
        killed,
        description: killed ? `${this.name} 猎杀了 ${npc.name}` : `${this.name} 袭击了 ${npc.name}`,
      });
    }
    return { killed, winChance };
  }

  /** 妖兽死亡：标记 alive=false 并记录死因，供 TickManager 收集到日志 */
  _die(cause, killerName = null) {
    this.state.set('alive', false);
    this.alive = false;
    this.spatial.clearDestination();
    this._deathInfo = {
      cause,
      monsterId: this.id,
      monsterName: this.name,
      grade: this.grade,
      killerName,
      ageYears: this.state.get('ageYears'),
      maxAgeYears: this.state.get('maxAgeYears'),
    };
  }

  snapshot() {
    return {
      ...super.snapshot(),
      name: this.name,
      grade: this.grade,
      btTier: this._btTier,
      defId: this.staticData.get('defId'),
      behaviorState: this.state.get('behaviorState'),
      ageYears: this.state.get('ageYears'),
      maxAgeYears: this.state.get('maxAgeYears'),
    };
  }

  toJSON() { return this.snapshot(); }
}
