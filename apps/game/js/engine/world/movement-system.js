/**
 * MovementSystem - 实体移动系统
 *
 * 每 tick 推进持有 SpatialComponent 且有移动目标的实体，按其 speed 沿路径前进。
 * 路径缺失时按需调用寻路；到达后回报，供行为耗时层进入执行阶段。
 *
 * 单一职责：只负责"把实体往目标挪"，不关心实体为什么要移动（那是行为层的事）。
 */
import { computePath, isPassable } from './pathfinding.js';

export class MovementSystem {
  /**
   * @param {Object} deps
   * @param {Map<string, Object>} deps.tileIndex    Map<"x,y", tile>
   * @param {Map<string, Object>} [deps.terrainIndex] 地形定义索引（passable/moveCost）
   */
  constructor({ tileIndex, terrainIndex, graph, hierGraph } = {}) {
    this.tileIndex = tileIndex || new Map();
    this.terrainIndex = terrainIndex || null;
    this.graph = graph || null;        // GridGraph：启用 JPS
    this.hierGraph = hierGraph || null; // HierarchicalGraph：远距离启用 HPA*
    // 远距离阈值：超过则走分层抽象图（曼哈顿距离，格）。
    // 本地图障碍稀疏、JPS 已极快，故仅超远距离才用分层；阈值偏大留作大地图扩展。
    this._hierThreshold = 96;
    /**
     * 路径缓存：地图地形静态（领地归属不影响通行），相同 from→to 的 A* 结果可复用。
     * NPC 频繁在固定地点间往返（总部/坊市/任务点），缓存命中可大幅削减 A* 调用。
     * @type {Map<string, Array<{x:number,y:number}>>}
     */
    this._pathCache = new Map();
    this._pathCacheMax = 4000;
  }

  /** 从缓存取路径副本（命中返回不含起点的路径拷贝，未命中返回 undefined） */
  _getCachedPath(fx, fy, tx, ty) {
    const cached = this._pathCache.get(`${fx},${fy}>${tx},${ty}`);
    if (!cached) return undefined;
    // 返回拷贝，避免调用方推进 pathIndex 时污染缓存数组
    return cached.map(p => ({ x: p.x, y: p.y }));
  }

  _setCachedPath(fx, fy, tx, ty, path) {
    if (this._pathCache.size >= this._pathCacheMax) {
      // 简单淘汰：清空一半（避免维护 LRU 的额外开销）
      const keep = Math.floor(this._pathCacheMax / 2);
      let i = 0;
      for (const k of this._pathCache.keys()) {
        if (i++ >= keep) this._pathCache.delete(k);
      }
    }
    this._pathCache.set(`${fx},${fy}>${tx},${ty}`, path.map(p => ({ x: p.x, y: p.y })));
  }

  /**
   * 推进单个实体一 tick 的移动
   * @param {import('../abstract/base-entity.js').BaseEntity} entity
   * @returns {{ moved:boolean, arrived:boolean, blocked:boolean }}
   */
  tickMove(entity) {
    const sp = entity?.spatial;
    if (!sp || !sp.destination) {
      return { moved: false, arrived: false, blocked: false };
    }

    // 已到达
    if (sp.isAtDestination()) {
      sp.clearDestination();
      return { moved: false, arrived: true, blocked: false };
    }

    // 需要寻路（首次或路径已走完但未到达）
    if (sp.path.length === 0 || sp.pathIndex >= sp.path.length) {
      const fx = sp.tileX, fy = sp.tileY;
      const tx = sp.destination.x, ty = sp.destination.y;

      // 短距离：直线贪心步进（开阔地无需任何搜索，妖兽近距离游荡/追猎走此路）
      const manhattan = Math.abs(tx - fx) + Math.abs(ty - fy);
      let path;
      if (manhattan <= 16) {
        path = this._straightLinePath(sp);
      }

      if (path === undefined || path === null) {
        // 中长距离：JPS / HPA*（含路径缓存）。远距离走分层，近距离走 JPS。
        path = this._getCachedPath(fx, fy, tx, ty);
        if (path === undefined) {
          const useHier = this.hierGraph && manhattan > this._hierThreshold;
          path = computePath(
            { x: fx, y: fy },
            { x: tx, y: ty },
            this.tileIndex,
            {
              terrainIndex: this.terrainIndex,
              graph: this.graph,
              hier: useHier ? this.hierGraph : null,
            },
          );
          if (path && path.length > 0) {
            this._setCachedPath(fx, fy, tx, ty, path);
          }
        }
      }

      if (!path || path.length === 0) {
        // 不可达：放弃移动，视为到达（让行为层就地处理或重新规划）
        sp.clearDestination();
        return { moved: false, arrived: false, blocked: true };
      }
      sp.setPath(path);
    }

    // 按 speed 推进若干格
    let steps = Math.max(1, Math.floor(sp.speed));
    let moved = false;
    while (steps > 0 && sp.pathIndex < sp.path.length) {
      const next = sp.path[sp.pathIndex];
      sp.x = next.x;
      sp.y = next.y;
      sp.pathIndex++;
      steps--;
      moved = true;
    }

    if (sp.isAtDestination()) {
      sp.clearDestination();
      return { moved, arrived: true, blocked: false };
    }

    return { moved, arrived: false, blocked: false };
  }

  /**
   * 直线贪心路径：从当前格逐格朝目标走（每步优先缩小 dx/dy 较大的轴）。
   * 全程经过的格子均可通行时返回完整路径（不含起点）；
   * 一旦遇到不可通行格立即返回 null，由调用方回退到 A* 绕障。
   *
   * @param {import('../abstract/spatial-component.js').SpatialComponent} sp
   * @returns {Array<{x:number,y:number}>|null}
   */
  _straightLinePath(sp) {
    let cx = sp.tileX, cy = sp.tileY;
    const gx = sp.destination.x, gy = sp.destination.y;
    const path = [];
    // 护栏：曼哈顿距离 + 余量。地图近乎开阔（仅 ~1% 河流不可通行），
    // 直线贪心几乎总能成功；遇河流挡路才回退 A* 绕障，故护栏可放宽到全图距离。
    const maxLen = Math.abs(gx - cx) + Math.abs(gy - cy) + 8;
    let guard = 0;
    while (cx !== gx || cy !== gy) {
      if (++guard > maxLen) return null;
      const dx = gx - cx, dy = gy - cy;
      let nx = cx, ny = cy;
      if (Math.abs(dx) >= Math.abs(dy)) {
        nx += dx > 0 ? 1 : -1;
      } else {
        ny += dy > 0 ? 1 : -1;
      }
      const tile = this.tileIndex.get(`${nx},${ny}`);
      if (!isPassable(tile, this.terrainIndex)) return null;
      cx = nx; cy = ny;
      path.push({ x: cx, y: cy });
    }
    return path;
  }

  /**
   * 便捷寻路（供 worldContext 暴露）
   */
  computePath(from, to) {
    return computePath(from, to, this.tileIndex, { terrainIndex: this.terrainIndex });
  }
}
