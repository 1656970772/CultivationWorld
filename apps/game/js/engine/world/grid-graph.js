/**
 * GridGraph - 寻路用的整型网格位图（一次性构建，供 JPS / HPA* 复用）
 *
 * 原 A* 以 `Map<"x,y", tile>` + 字符串 key 运行，每次扩展都创建字符串、查 Map、
 * 拆分坐标，开销巨大。GridGraph 把地图压成两个 TypedArray：
 *   - passable: Uint8Array，1=可通行 0=障碍（按 y*width+x 索引）
 *   - cost:     Uint8Array，整数移动代价（不可通行处为 0）
 *
 * 坐标 → 线性索引 `idx = y * width + x`，全程整型运算，无字符串。
 * 地图地形静态，故 GridGraph 在引擎初始化时构建一次，所有实体共享只读。
 *
 * 注意：领地归属（ownerId）不影响通行性，故领地变化无需重建本位图。
 */
export class GridGraph {
  /**
   * @param {Object} deps
   * @param {Map<string, Object>} deps.tileIndex     Map<"x,y", tile>
   * @param {Map<string, Object>} [deps.terrainIndex] 地形定义索引（passable/moveCost）
   * @param {number} deps.width
   * @param {number} deps.height
   */
  constructor({ tileIndex, terrainIndex, width, height }) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.passable = new Uint8Array(n);
    this.cost = new Uint8Array(n);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tileIndex.get(`${x},${y}`);
        const idx = y * width + x;
        if (!tile) { this.passable[idx] = 0; this.cost[idx] = 0; continue; }
        const def = terrainIndex?.get(tile.terrain);
        const passable = def ? def.passable !== false : tile.terrain !== 'river';
        this.passable[idx] = passable ? 1 : 0;
        if (passable) {
          let c = (def && typeof def.moveCost === 'number' && def.moveCost > 0)
            ? def.moveCost
            : (tile.terrain === 'swamp' ? 2 : 1);
          if (c < 1) c = 1;
          if (c > 255) c = 255;
          this.cost[idx] = c;
        } else {
          this.cost[idx] = 0;
        }
      }
    }
  }

  /** 越界或障碍均返回 false */
  isWalkable(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.passable[y * this.width + x] === 1;
  }

  /** 整数移动代价（障碍/越界返回 0） */
  costAt(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.cost[y * this.width + x];
  }

  idx(x, y) { return y * this.width + x; }
}
