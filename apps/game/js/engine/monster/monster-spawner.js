/**
 * MonsterSpawner - 妖兽分布生成器
 *
 * 按"地形 habitat 过滤 + 距势力总部的危险梯度 + 北部深山加成 + 灵脉稀有加权"
 * 在地图上生成妖兽实例。河流不可通行，妖兽不会站在河流格上（但 habitat 含 river
 * 的妖兽可生成在邻河的可通行格）。
 *
 * 确定性随机（seed），保证同 seed 下分布一致（与纯数据/渲染模式结果一致）。
 */
import { MonsterEntity } from './monster-entity.js';
import { isPassable } from '../world/pathfinding.js';

export class MonsterSpawner {
  /**
   * @param {Object} deps
   * @param {Map} deps.tileIndex
   * @param {Map} deps.terrainIndex
   * @param {Array} deps.monsterDefs       monsters.json
   * @param {Array} deps.factions          势力实体（取 headquarters 作危险锚点）
   * @param {Object} deps.spawnConfig      data/balance/monster-spawn.json
   * @param {Object} deps.movementConfig   data/balance/movement.json
   * @param {Object} deps.rankOrderMap     rankId → order（NPC 境界比较）
   * @param {number} deps.mapWidth
   * @param {number} deps.mapHeight
   */
  constructor({ tileIndex, terrainIndex, monsterDefs, factions, spawnConfig,
                movementConfig, rankOrderMap, mapWidth, mapHeight }) {
    this.tileIndex = tileIndex;
    this.terrainIndex = terrainIndex;
    this.monsterDefs = monsterDefs || [];
    this.factions = factions || [];
    this.cfg = spawnConfig || {};
    this.movementConfig = movementConfig || {};
    this.rankOrderMap = rankOrderMap || {};
    this.mapWidth = mapWidth || 300;
    this.mapHeight = mapHeight || 300;

    this._seed = this.cfg.spawnSeed ?? 1337;
    // 势力总部锚点
    this._hqs = this.factions
      .map(f => f.staticData?.headquarters)
      .filter(hq => hq && typeof hq.x === 'number');

    // 战斗参数（猎杀率/反击）。自然死亡改由寿元曲线决定，不再走固定概率。
    this._combatConfig = { ...(this.cfg.combat || {}) };
    // 寿元配置（按阶位决定上限 + 到寿曲线），传给 MonsterState
    this._lifespanConfig = {
      ...(this.cfg.lifespan || {}),
      daysPerYear: this.cfg.population?.daysPerYear ?? 360,
    };
    this._familyCount = {};
  }

  /** 确定性随机 [0,1) */
  _rand() {
    this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff;
    return this._seed / 0x7fffffff;
  }

  /** 距最近势力总部的曼哈顿距离 */
  _distToNearestHq(x, y) {
    let best = Infinity;
    for (const hq of this._hqs) {
      const d = Math.abs(hq.x - x) + Math.abs(hq.y - y);
      if (d < best) best = d;
    }
    return best === Infinity ? 9999 : best;
  }

  /** 给定坐标，返回允许的 [minGrade, maxGrade] 危险区间 */
  _gradeRangeAt(x, y) {
    const dist = this._distToNearestHq(x, y);
    let range = { minGrade: 1, maxGrade: 3 };
    for (const band of (this.cfg.dangerByDistance || [])) {
      if (dist <= band.maxDist) { range = { minGrade: band.minGrade, maxGrade: band.maxGrade }; break; }
    }
    // 北部深山加成
    if (y < (this.cfg.northDepthY ?? 0)) {
      range.maxGrade = Math.max(range.maxGrade, this.cfg.northMinMaxGrade ?? range.maxGrade);
    }
    return range;
  }

  /** 该格是否邻接河流（用于 habitat 含 river 的妖兽） */
  _isNearRiver(x, y) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const t = this.tileIndex.get(`${x + dx},${y + dy}`);
      if (t && t.terrain === 'river') return true;
    }
    return false;
  }

  /** 该格是否邻接灵脉（含自身） */
  _isNearVein(x, y) {
    const veinTypes = new Set(['low_spirit_vein', 'mid_spirit_vein', 'high_spirit_vein', 'top_spirit_vein']);
    for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const t = this.tileIndex.get(`${x + dx},${y + dy}`);
      if (t && veinTypes.has(t.terrain)) return true;
    }
    return false;
  }

  /**
   * 在 (x,y) 选一个匹配地形与危险区间的妖兽定义
   * @returns {Object|null} monsters.json 定义
   */
  _pickMonsterAt(x, y, tileTerrain) {
    const range = this._gradeRangeAt(x, y);
    const nearRiver = this._isNearRiver(x, y);
    const nearVein = this._isNearVein(x, y);
    const rarityWeight = this.cfg.rarityWeight || {};
    const veinRareBonus = this.cfg.veinRareBonus ?? 0;

    const candidates = this.monsterDefs.filter(def => {
      if (def.grade < range.minGrade || def.grade > range.maxGrade) return false;
      const habitat = def.habitat || [];
      // 地形匹配：直接匹配地形，或 habitat 含 river 且该格邻河
      const terrainMatch = habitat.includes(tileTerrain)
        || (habitat.includes('river') && nearRiver);
      return terrainMatch;
    });
    if (candidates.length === 0) return null;

    // 加权抽样：稀有度权重 +（邻灵脉时对稀有妖兽加成）
    let total = 0;
    const weights = candidates.map(def => {
      let w = rarityWeight[def.rarity] ?? 10;
      if (nearVein && (def.rarity === 'rare' || def.rarity === 'epic'
          || def.rarity === 'legendary' || def.rarity === 'mythic')) {
        w *= (1 + veinRareBonus * 5);
      }
      total += w;
      return w;
    });

    let roll = this._rand() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  /** 妖兽移动速度（按阶位 + 属性 speed 加成） */
  _monsterSpeed(def) {
    const byGrade = this.movementConfig.monsterSpeedByGrade || {};
    const base = byGrade[String(def.grade)] ?? byGrade.default ?? 3;
    const attrWeight = this.movementConfig.monsterSpeedAttributeWeight ?? 0;
    return Math.max(1, Math.round(base + (def.attributes?.speed || 0) * attrWeight));
  }

  /**
   * 生成所有妖兽实例
   * @returns {MonsterEntity[]}
   */
  spawn() {
    const total = this.cfg.totalMonsters ?? 300;
    const monsters = [];
    const familyCount = {};
    let attempts = 0;
    const maxAttempts = total * 30;

    while (monsters.length < total && attempts < maxAttempts) {
      attempts++;
      const x = Math.floor(this._rand() * this.mapWidth);
      const y = Math.floor(this._rand() * this.mapHeight);
      const tile = this.tileIndex.get(`${x},${y}`);
      if (!isPassable(tile, this.terrainIndex)) continue;

      const def = this._pickMonsterAt(x, y, tile.terrain);
      if (!def) continue;

      monsters.push(this._makeMonster(def, x, y));
    }

    return monsters;
  }

  /** 妖兽 BT 档位（与 monster-bt-presets.js 的 getBTTier 逻辑一致） */
  _getBTTier(grade) {
    if (grade >= 5) return 'tier3';
    if (grade >= 3) return 'tier2';
    return 'tier1';
  }

  /** 用 def 在 (x,y) 实例化一只妖兽（spawn 与 respawn 共用）*/
  _makeMonster(def, x, y) {
    const tier = this._getBTTier(def.grade);
    const tierCfg = (this.cfg.behaviorByTier || {})[tier] || {};
    // 档位配置覆盖全局 combat 默认值
    const combatConfig = { ...this._combatConfig, ...tierCfg };

    const idx = (this._familyCount[def.id] = (this._familyCount[def.id] || 0) + 1);
    return new MonsterEntity(def, {
      id: `monster_${def.id}_${idx}`,
      name: def.name,
      x, y,
      speed: this._monsterSpeed(def),
      wanderRadius: tierCfg.wanderRadius ?? (this.cfg.wanderRadius ?? 12),
      senseRange: tierCfg.senseRange ?? (this.cfg.senseRange ?? 5),
      rankOrderMap: this.rankOrderMap,
      combatConfig,
      lifespanConfig: this._lifespanConfig,
    });
  }

  /**
   * 在地图上随机选一个合法可生成点并实例化一只妖兽（用于种群补充）。
   * @returns {MonsterEntity|null}
   */
  spawnOne() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(this._rand() * this.mapWidth);
      const y = Math.floor(this._rand() * this.mapHeight);
      const tile = this.tileIndex.get(`${x},${y}`);
      if (!isPassable(tile, this.terrainIndex)) continue;
      const def = this._pickMonsterAt(x, y, tile.terrain);
      if (!def) continue;
      return this._makeMonster(def, x, y);
    }
    return null;
  }
}
