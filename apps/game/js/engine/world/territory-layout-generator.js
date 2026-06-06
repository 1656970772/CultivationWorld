/**
 * TerritoryLayoutGenerator - 势力领地与建筑布局生成器（运行时，纯可视化）
 *
 * 在引擎初始化阶段，为每个势力以总部为中心生成：
 *   1. 外围"有机领地"（inner）：BFS + 半径噪声扰动，使领地成片但形状自然；
 *   2. 中心"规整院落"（core）：轴对齐矩形，最外圈为院墙（wall），内部规则放置功能建筑；
 * 并扫描矿脉连通块生成"矿区"（mine），布置采矿点与守卫位。
 *
 * 直接在 tileIndex 的 tile 上写入 ownerId / district / building 字段，
 * 渲染层共享同一 tileIndex 引用即可读取，无需改 snapshot。
 *
 * 纯数据生成，不依赖渲染层。
 */
import { isPassable, nearestPassable } from './pathfinding.js';
import { DistrictType, BuildingType } from './layout-constants.js';

const NEI4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];

/** 确定性 hash 噪声 [0,1)，用于领地半径扰动（同 seed 同结果） */
function hashNoise(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 0) / 0xffffffff;
}

const VEIN_TYPES = new Set([
  'low_spirit_vein', 'mid_spirit_vein', 'high_spirit_vein', 'top_spirit_vein',
]);

export class TerritoryLayoutGenerator {
  /**
   * @param {Object} opts
   * @param {Map} opts.tileIndex     Map<"x,y", tile>
   * @param {Map} opts.terrainIndex  Map<type, terrainDef>
   * @param {number} opts.mapWidth
   * @param {number} opts.mapHeight
   * @param {Array} opts.factions    势力实体数组
   * @param {number} [opts.seed]
   */
  constructor({ tileIndex, terrainIndex, mapWidth, mapHeight, factions, seed = 42 }) {
    this.tileIndex = tileIndex;
    this.terrainIndex = terrainIndex;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.factions = factions || [];
    this.seed = seed;
    /**
     * 各势力建筑坐标索引：Map<factionId, { hq:{x,y}, byType: Map<buildingType, {x,y}[]> }>
     * 供行为目标解析（如接任务走任务殿、求药走炼丹房）使用。
     */
    this.buildingsByFaction = new Map();
  }

  tileAt(x, y) { return this.tileIndex.get(`${x},${y}`); }
  passable(x, y) { return isPassable(this.tileAt(x, y), this.terrainIndex); }

  /** 执行全部生成 */
  generate() {
    const stats = { factions: [], mines: 0 };
    for (const faction of this.factions) {
      const r = this._layoutFaction(faction);
      if (r) stats.factions.push(r);
    }
    stats.mines = this._layoutMines();
    stats.buildingsByFaction = this.buildingsByFaction;
    return stats;
  }

  /** 势力类型 → 院落尺寸与领地半径（强势力更大） */
  _sizeForFaction(faction) {
    const type = faction.staticData?.factionType;
    const territoryCount = faction.state.get('territoryCount') || 1;
    const isSect = ['righteous', 'evil', 'demon'].includes(type);
    const isOrg = String(faction.id).startsWith('org_');

    if (isOrg) {
      // 中立机构：小院落（坊市/拍卖等）
      return { type, coreW: 5, coreH: 5, innerRadius: 5, isOrg: true, isSect: false };
    }
    if (isSect) {
      // 宗门：院落随 territoryCount 放大（7..11，奇数便于居中）
      const span = Math.min(11, Math.max(7, 5 + territoryCount));
      const coreSpan = span % 2 === 0 ? span + 1 : span;
      return { type, coreW: coreSpan, coreH: coreSpan, innerRadius: coreSpan + 6, isOrg: false, isSect: true };
    }
    // 其余中立小宗门
    return { type, coreW: 7, coreH: 7, innerRadius: 9, isOrg: false, isSect: false };
  }

  /**
   * 为单个势力生成领地 + 院落 + 建筑
   * @returns {{factionId, innerTiles, coreTiles, buildings}|null}
   */
  _layoutFaction(faction) {
    const hq = faction.staticData?.headquarters;
    if (!hq || typeof hq.x !== 'number') return null;
    // 总部若落在不可通行格（如河流），就近迁到可通行格，避免建筑落空
    let cx = hq.x, cy = hq.y;
    if (!this.passable(cx, cy)) {
      const fixed = nearestPassable(cx, cy, this.tileIndex, this.terrainIndex);
      if (fixed) { cx = fixed.x; cy = fixed.y; }
    }
    const size = this._sizeForFaction(faction);
    const seed = this.seed + this._idSeed(faction.id);

    // 1. 外围有机领地：以 cx,cy 为中心、半径受噪声扰动的圆盘
    const innerTiles = this._growOrganicTerritory(faction.id, cx, cy, size.innerRadius, seed);

    // 2. 中心规整院落（在领地内嵌入轴对齐矩形）
    const core = this._carveCourtyard(faction.id, cx, cy, size.coreW, size.coreH);

    // 3. 院落内放置建筑
    const buildings = this._placeBuildings(core, size);

    // 记录建筑坐标索引（供行为目标解析）
    const byType = new Map();
    for (const b of buildings) {
      if (!byType.has(b.type)) byType.set(b.type, []);
      byType.get(b.type).push({ x: b.x, y: b.y });
    }
    this.buildingsByFaction.set(faction.id, { hq: { x: cx, y: cy }, byType });

    return {
      factionId: faction.id,
      innerTiles: innerTiles.length,
      coreTiles: core.tiles.length,
      buildings,
    };
  }

  _idSeed(id) {
    let h = 0;
    for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
    return h % 100000;
  }

  /**
   * BFS 扩张领地：以中心扩散，按"到中心的距离 < 噪声扰动半径"接纳格子，
   * 形成成片但边缘自然的有机形状。占领时设 ownerId + district=inner。
   */
  _growOrganicTerritory(factionId, cx, cy, radius, seed) {
    const claimed = [];
    const visited = new Set();
    const queue = [{ x: cx, y: cy }];
    visited.add(`${cx},${cy}`);
    const maxReach = radius + 3;

    while (queue.length > 0) {
      const { x, y } = queue.shift();
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > maxReach) continue;

      // 噪声扰动的局部半径阈值：让边缘起伏
      const noise = hashNoise(Math.round(x), Math.round(y), seed);
      const localRadius = radius * (0.7 + 0.6 * noise);
      const tile = this.tileAt(x, y);
      if (tile && dist <= localRadius && this.passable(x, y) && tile.ownerId == null) {
        tile.ownerId = factionId;
        tile.district = DistrictType.INNER;
        claimed.push(tile);
      }

      for (const [dx, dy] of NEI4) {
        const nx = x + dx, ny = y + dy;
        const nkey = `${nx},${ny}`;
        if (!visited.has(nkey) && this.tileIndex.has(nkey)) {
          visited.add(nkey);
          if (Math.hypot(nx - cx, ny - cy) <= maxReach) queue.push({ x: nx, y: ny });
        }
      }
    }
    return claimed;
  }

  /**
   * 在中心嵌入轴对齐矩形院落：内部 district=core，最外圈 district=wall。
   * 不可通行格（河流）跳过。返回院落格集合与边界。
   */
  _carveCourtyard(factionId, cx, cy, w, h) {
    const halfW = Math.floor(w / 2), halfH = Math.floor(h / 2);
    const x0 = cx - halfW, x1 = cx + halfW;
    const y0 = cy - halfH, y1 = cy + halfH;
    const tiles = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = this.tileAt(x, y);
        if (!tile || !this.passable(x, y)) continue;
        tile.ownerId = factionId;
        const isEdge = (x === x0 || x === x1 || y === y0 || y === y1);
        tile.district = isEdge ? DistrictType.WALL : DistrictType.CORE;
        tile.building = null;
        tiles.push(tile);
      }
    }
    return { cx, cy, x0, x1, y0, y1, tiles };
  }

  /** 设置某格建筑（仅当格存在、可通行；山门允许落在外圈墙上） */
  _setBuilding(x, y, type) {
    const tile = this.tileAt(x, y);
    if (!tile || !this.passable(x, y)) return false;
    tile.building = type;
    // 山门保留在 wall 圈，其余建筑所在格归为 core，避免被当作墙
    if (type !== BuildingType.GATE && tile.district === DistrictType.WALL) {
      tile.district = DistrictType.CORE;
    }
    return true;
  }

  /**
   * 院落内规则化放置建筑：
   *   中心主殿（机构为坊市）、下方任务殿、四角修炼场、两侧藏经阁/炼丹房、
   *   下边墙中点开山门。
   */
  _placeBuildings(core, size) {
    const { cx, cy, x0, x1, y0, y1, tiles } = core;
    const placed = [];
    const add = (x, y, type) => {
      if (this._setBuilding(x, y, type)) { placed.push({ x, y, type }); return true; }
      return false;
    };
    // 在院落内找最靠中心的可放置格（中心被河流占用时兜底）
    const placeNearCenter = (type) => {
      if (add(cx, cy, type)) return;
      const sorted = [...tiles].sort((a, b) =>
        (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)));
      for (const t of sorted) {
        if (!t.building && add(t.x, t.y, type)) return;
      }
    };

    // 中心：主殿 / 坊市（保证一定落地）
    placeNearCenter(size.isOrg ? BuildingType.MARKET : BuildingType.MAIN_HALL);

    if (size.isOrg) {
      // 中立机构：坊市 + 任务殿（兑奖）+ 守卫
      add(cx, Math.min(y1 - 1, cy + 1), BuildingType.QUEST_HALL);
      add(x0 + 1, y0 + 1, BuildingType.GUARD_POST);
      add(x1 - 1, y0 + 1, BuildingType.GUARD_POST);
    } else {
      // 任务殿：主殿正下方
      add(cx, Math.min(y1 - 1, cy + 2), BuildingType.QUEST_HALL);
      // 四角修炼场
      add(x0 + 1, y0 + 1, BuildingType.TRAINING);
      add(x1 - 1, y0 + 1, BuildingType.TRAINING);
      add(x0 + 1, y1 - 1, BuildingType.TRAINING);
      add(x1 - 1, y1 - 1, BuildingType.TRAINING);
      // 两侧：藏经阁 / 炼丹房
      add(x0 + 1, cy, BuildingType.LIBRARY);
      add(x1 - 1, cy, BuildingType.ALCHEMY);
    }

    // 山门：下边墙中点
    add(cx, y1, BuildingType.GATE);
    return placed;
  }

  // ───────────────────────── 矿区 ─────────────────────────

  /** 扫描矿脉连通块，标记 district=mine 并布置采矿点/守卫位。返回矿区数。 */
  _layoutMines() {
    const visited = new Set();
    let mineCount = 0;

    for (const [key, tile] of this.tileIndex.entries()) {
      if (visited.has(key)) continue;
      if (!VEIN_TYPES.has(tile.terrain)) continue;

      // flood-fill 同属矿脉的连通块（任意矿脉类型相邻即连通）。
      // 已归属势力的矿脉格仍参与连通遍历（避免割裂矿块），但不被矿区改写。
      const block = [];
      const queue = [tile];
      visited.add(key);
      while (queue.length > 0) {
        const t = queue.shift();
        block.push(t);
        for (const [dx, dy] of NEI4) {
          const nkey = `${t.x + dx},${t.y + dy}`;
          if (visited.has(nkey)) continue;
          const nt = this.tileIndex.get(nkey);
          if (nt && VEIN_TYPES.has(nt.terrain)) {
            visited.add(nkey);
            queue.push(nt);
          }
        }
      }

      // 仅装饰未被势力占领的矿脉格，保留势力领地内的建筑与分区
      const freeBlock = block.filter(t => !t.ownerId);
      if (freeBlock.length === 0) continue;
      this._decorateMineBlock(freeBlock);
      mineCount++;
    }
    return mineCount;
  }

  /** 给一个矿脉连通块标记矿区，按间隔放采矿点，边缘放守卫位 */
  _decorateMineBlock(block) {
    for (const t of block) {
      if (t.ownerId) continue;
      t.district = DistrictType.MINE;
    }
    // 采矿点：每隔几格一个（确定性，依坐标）
    let nodeCount = 0;
    for (const t of block) {
      if (((t.x + t.y) % 3 === 0) && nodeCount < Math.max(1, Math.floor(block.length / 4))) {
        t.building = BuildingType.MINE_NODE;
        nodeCount++;
      }
    }
    if (nodeCount === 0 && block.length > 0) {
      block[Math.floor(block.length / 2)].building = BuildingType.MINE_NODE;
    }
    // 守卫位：矿块边缘（邻接非矿脉的可通行格）放一个
    for (const t of block) {
      if (t.building) continue;
      let isEdge = false;
      for (const [dx, dy] of NEI4) {
        const nt = this.tileAt(t.x + dx, t.y + dy);
        if (nt && !VEIN_TYPES.has(nt.terrain)) { isEdge = true; break; }
      }
      if (isEdge) { t.building = BuildingType.GUARD_POST; break; }
    }
  }
}
