/**
 * Pathfinding - 通用网格寻路工具
 *
 * 寻路分层（详见 docs/decisions/adr-013-jps-hierarchical-pathfinding.md）：
 *   1) 若提供 GridGraph（整型位图），优先走 JPS（跳点搜索），障碍稀疏大地图下最快；
 *   2) 否则回退到基于 tileIndex 的标准 A*（字符串 key，兼容旧调用）。
 * computePath 的对外签名保持不变：computePath(from, to, tileIndex, options)，
 * options.graph 传入 GridGraph 时启用 JPS。
 *
 * 纯函数，不依赖渲染层；不读取 DOM/Pixi。
 */
import { jpsPath } from './jps.js';

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

/**
 * 判断地块是否可通行
 * @param {Object} tile
 * @param {Map<string, Object>} terrainIndex  地形 type → 地形定义（含 passable / moveCost）
 */
function isPassable(tile, terrainIndex) {
  if (!tile) return false;
  const def = terrainIndex?.get(tile.terrain);
  if (def) return def.passable !== false;
  // 无地形定义时的兜底：河流不可通行
  return tile.terrain !== 'river';
}

/**
 * 获取地块移动代价
 */
function moveCostOf(tile, terrainIndex) {
  const def = terrainIndex?.get(tile?.terrain);
  if (def && typeof def.moveCost === 'number' && def.moveCost > 0) return def.moveCost;
  // 兜底：沼泽 2，其余 1
  return tile?.terrain === 'swamp' ? 2 : 1;
}

/**
 * 计算从 from 到 to 的路径（A*）
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {Map<string, Object>} tileIndex   Map<"x,y", tile>
 * @param {Object} [options]
 * @param {Map<string, Object>} [options.terrainIndex] 地形定义索引（用于 passable/moveCost）
 * @param {import('./grid-graph.js').GridGraph} [options.graph] 整型网格位图，提供则启用 JPS
 * @param {import('./hierarchical-graph.js').HierarchicalGraph} [options.hier] 分层抽象图（HPA*）
 * @param {number} [options.maxExpansions=20000] 最大扩展节点数（性能护栏）
 * @returns {Array<{x:number,y:number}>|null} 不含起点的路径；不可达返回 null
 */
export function computePath(from, to, tileIndex, options = {}) {
  if (!from || !to) return null;
  if (from.x === to.x && from.y === to.y) return [];

  // 优先级：分层 HPA*（超远距离）→ JPS（有位图）→ 标准 A*（兜底）
  const graph = options.graph || null;
  if (graph) {
    const hier = options.hier || null;
    if (hier) {
      const hp = hier.findPath(from, to, options.maxExpansions);
      if (hp) return hp;
      // 分层失败（同簇/不可达）回退 JPS
    }
    return jpsPath(from, to, graph, options);
  }

  if (!tileIndex) return null;
  const terrainIndex = options.terrainIndex || null;
  const maxExpansions = options.maxExpansions ?? 20000;

  const key = (x, y) => `${x},${y}`;
  const startKey = key(from.x, from.y);
  const goalKey = key(to.x, to.y);

  const goalTile = tileIndex.get(goalKey);
  if (!isPassable(goalTile, terrainIndex)) return null;

  const heuristic = (x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);

  // 优先队列：二叉堆按 f 取最小（替代原数组线性扫描，大地图下显著降低寻路开销）
  const open = new PathHeap();
  open.push({ x: from.x, y: from.y, g: 0, f: heuristic(from.x, from.y) });
  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  let expansions = 0;

  while (open.size > 0) {
    const current = open.pop();
    const curKey = key(current.x, current.y);

    if (curKey === goalKey) {
      const path = [];
      let node = goalKey;
      while (node !== startKey) {
        const [nx, ny] = node.split(',').map(Number);
        path.unshift({ x: nx, y: ny });
        node = cameFrom.get(node);
        if (node == null) break;
      }
      return path;
    }

    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (++expansions > maxExpansions) return null;

    for (const { dx, dy } of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nKey = key(nx, ny);
      if (closed.has(nKey)) continue;

      const tile = tileIndex.get(nKey);
      if (!isPassable(tile, terrainIndex)) continue;

      const tentativeG = current.g + moveCostOf(tile, terrainIndex);
      if (gScore.has(nKey) && tentativeG >= gScore.get(nKey)) continue;

      gScore.set(nKey, tentativeG);
      cameFrom.set(nKey, curKey);
      open.push({ x: nx, y: ny, g: tentativeG, f: tentativeG + heuristic(nx, ny) });
    }
  }

  return null;
}

/**
 * 寻路专用最小堆（按 f 排序）。
 * 替代原数组 + 线性扫描取最小，扩展规模较大时显著降低取最小的开销。
 */
class PathHeap {
  constructor() { this._data = []; }
  get size() { return this._data.length; }

  push(node) {
    const d = this._data;
    d.push(node);
    let i = d.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (d[parent].f <= d[i].f) break;
      const tmp = d[parent]; d[parent] = d[i]; d[i] = tmp;
      i = parent;
    }
  }

  pop() {
    const d = this._data;
    const top = d[0];
    const last = d.pop();
    if (d.length > 0) {
      d[0] = last;
      let i = 0;
      const n = d.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && d[l].f < d[smallest].f) smallest = l;
        if (r < n && d[r].f < d[smallest].f) smallest = r;
        if (smallest === i) break;
        const tmp = d[smallest]; d[smallest] = d[i]; d[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * 在 tileIndex 中寻找距 (x,y) 最近的可通行格子（用于修正非法初始位置，如总部落在河上）
 * @returns {{x:number,y:number}|null}
 */
export function nearestPassable(x, y, tileIndex, terrainIndex = null, maxRadius = 10) {
  const origin = tileIndex.get(`${x},${y}`);
  if (isPassable(origin, terrainIndex)) return { x, y };

  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tile = tileIndex.get(`${x + dx},${y + dy}`);
        if (isPassable(tile, terrainIndex)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

export { isPassable, moveCostOf };
