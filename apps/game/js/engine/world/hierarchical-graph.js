/**
 * HierarchicalGraph - 分层寻路抽象图（HPA*）
 *
 * 思路（参考 Botea 等 HPA* 论文与知乎/B站分层 A* 笔记）：
 *   1) 把地图按固定尺寸切成簇（cluster）。
 *   2) 在相邻簇的公共边界上找"过渡点"（entrance）：边界上连续可通行段取中点，
 *      在两侧各放一个抽象节点，并用一条 cost=1 的"簇间边"相连。
 *   3) 在同一簇内的所有过渡点之间用 JPS 预计算"簇内边"（距离缓存）。
 *   4) 抽象图 = 节点（过渡点） + 边（簇间 + 簇内）。
 *
 * 查询时：把起点/终点临时接入各自簇的过渡点，在抽象图上跑 A*，
 * 得到途经过渡点序列，再用 JPS 把相邻过渡点之间细化为逐格路径。
 *
 * 结果为 near-optimal（论文实测 1% 内），但远距离寻路只需在小得多的抽象图上搜索，
 * 配合 JPS 细化，速度远超在全图直接搜索。
 *
 * 地形静态，故抽象图在引擎初始化时构建一次，全实体共享只读。
 */
import { jpsPath } from './jps.js';

export class HierarchicalGraph {
  /**
   * @param {Object} deps
   * @param {import('./grid-graph.js').GridGraph} deps.graph
   * @param {number} [deps.clusterSize=16] 簇边长（格）
   */
  constructor({ graph, clusterSize = 16 }) {
    this.graph = graph;
    this.C = clusterSize;
    this.cols = Math.ceil(graph.width / clusterSize);
    this.rows = Math.ceil(graph.height / clusterSize);

    /** 抽象节点：id -> {x,y,cluster} */
    this.nodes = new Map();
    /** 邻接表：nodeId -> Array<{to, cost}> */
    this.edges = new Map();
    this._nextNodeId = 0;
    /** 坐标 -> 已存在的抽象节点 id（避免同点重复建节点） */
    this._posToNode = new Map();

    this._build();
  }

  _clusterIndex(x, y) {
    const cx = Math.floor(x / this.C);
    const cy = Math.floor(y / this.C);
    return cy * this.cols + cx;
  }

  _addNode(x, y) {
    const key = `${x},${y}`;
    const existing = this._posToNode.get(key);
    if (existing !== undefined) return existing;
    const id = this._nextNodeId++;
    this.nodes.set(id, { x, y, cluster: this._clusterIndex(x, y) });
    this.edges.set(id, []);
    this._posToNode.set(key, id);
    return id;
  }

  _addEdge(a, b, cost) {
    this.edges.get(a).push({ to: b, cost });
    this.edges.get(b).push({ to: a, cost });
  }

  _build() {
    const g = this.graph;
    const C = this.C;

    // 1) 相邻簇间的过渡点（先建簇间边）。只处理"右边界"和"下边界"，避免重复。
    const transitionsByCluster = new Map(); // clusterIndex -> Set<nodeId>

    const addTransition = (x1, y1, x2, y2) => {
      const a = this._addNode(x1, y1);
      const b = this._addNode(x2, y2);
      this._addEdge(a, b, 1);
      const ca = this._clusterIndex(x1, y1);
      const cb = this._clusterIndex(x2, y2);
      if (!transitionsByCluster.has(ca)) transitionsByCluster.set(ca, new Set());
      if (!transitionsByCluster.has(cb)) transitionsByCluster.set(cb, new Set());
      transitionsByCluster.get(ca).add(a);
      transitionsByCluster.get(cb).add(b);
    };

    // 垂直边界（簇的右边）：列 x = (cx+1)*C - 1 与 x+1
    for (let cx = 0; cx < this.cols - 1; cx++) {
      const bx = (cx + 1) * C - 1;
      for (let cy = 0; cy < this.rows; cy++) {
        const y0 = cy * C;
        const y1 = Math.min(y0 + C, g.height);
        this._scanBorder(bx, y0, bx + 1, y1, true, addTransition);
      }
    }
    // 水平边界（簇的下边）：行 y = (cy+1)*C - 1 与 y+1
    for (let cy = 0; cy < this.rows - 1; cy++) {
      const by = (cy + 1) * C - 1;
      for (let cx = 0; cx < this.cols; cx++) {
        const x0 = cx * C;
        const x1 = Math.min(x0 + C, g.width);
        this._scanBorder(x0, by, x1, by + 1, false, addTransition);
      }
    }

    // 2) 同簇内过渡点两两之间用 JPS 预算簇内边（限定在簇范围内搜索）
    for (const [cluster, nodeSet] of transitionsByCluster) {
      const ids = [...nodeSet];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const na = this.nodes.get(ids[i]);
          const nb = this.nodes.get(ids[j]);
          const path = jpsPath({ x: na.x, y: na.y }, { x: nb.x, y: nb.y }, g, { maxExpansions: 4000 });
          if (path) {
            let cost = 0;
            for (const p of path) cost += g.costAt(p.x, p.y);
            this._addEdge(ids[i], ids[j], cost);
          }
        }
      }
    }

    this._transitionsByCluster = transitionsByCluster;
  }

  /**
   * 扫描一段边界，找连续可通行段，在每段中点建一对跨界过渡点。
   * @param {boolean} vertical true=垂直边界(沿 y 扫)，false=水平边界(沿 x 扫)
   */
  _scanBorder(ax, ay, bx, by, vertical, addTransition) {
    const g = this.graph;
    if (vertical) {
      // ax 固定列，[ay,by) 扫 y；对照列 bx
      let segStart = -1;
      for (let y = ay; y <= by; y++) {
        const ok = y < by && g.isWalkable(ax, y) && g.isWalkable(bx, y);
        if (ok && segStart < 0) segStart = y;
        if (!ok && segStart >= 0) {
          const mid = (segStart + y - 1) >> 1;
          addTransition(ax, mid, bx, mid);
          segStart = -1;
        }
      }
    } else {
      // ay 固定行，[ax,bx) 扫 x；对照行 by
      let segStart = -1;
      for (let x = ax; x <= bx; x++) {
        const ok = x < bx && g.isWalkable(x, ay) && g.isWalkable(x, by);
        if (ok && segStart < 0) segStart = x;
        if (!ok && segStart >= 0) {
          const mid = (segStart + x - 1) >> 1;
          addTransition(mid, ay, mid, by);
          segStart = -1;
        }
      }
    }
  }

  /**
   * 分层寻路：返回逐格路径（不含起点），失败/同簇直达返回 null（由调用方回退 JPS）。
   * @param {{x:number,y:number}} from
   * @param {{x:number,y:number}} to
   * @returns {Array<{x:number,y:number}>|null}
   */
  findPath(from, to) {
    const g = this.graph;
    const fromCluster = this._clusterIndex(from.x, from.y);
    const toCluster = this._clusterIndex(to.x, to.y);
    // 同簇：分层无收益，交回 JPS 直接算
    if (fromCluster === toCluster) return null;

    // 临时把 from/to 接入抽象图
    const startId = -1, goalId = -2;
    const tempEdges = new Map();
    tempEdges.set(startId, []);
    tempEdges.set(goalId, []);

    const connect = (id, pos, cluster) => {
      const set = this._transitionsByCluster.get(cluster);
      if (!set) return;
      // 只接最近的 K 个过渡点：簇内过渡点可能很多，全连会让接入开销逼近直接 JPS，
      // 抹掉分层的收益。按曼哈顿距离取最近 K 个再用 JPS 算精确簇内代价。
      const K = 5;
      const sorted = [...set].sort((a, b) => {
        const na = this.nodes.get(a), nb = this.nodes.get(b);
        return (Math.abs(na.x - pos.x) + Math.abs(na.y - pos.y)) -
               (Math.abs(nb.x - pos.x) + Math.abs(nb.y - pos.y));
      });
      const pick = sorted.slice(0, K);
      for (const tid of pick) {
        const tn = this.nodes.get(tid);
        const path = jpsPath(pos, { x: tn.x, y: tn.y }, g, { maxExpansions: 4000 });
        if (path) {
          let cost = 0;
          for (const p of path) cost += g.costAt(p.x, p.y);
          tempEdges.get(id).push({ to: tid, cost });
        }
      }
    };
    connect(startId, from, fromCluster);
    connect(goalId, to, toCluster);
    if (tempEdges.get(startId).length === 0 || tempEdges.get(goalId).length === 0) return null;

    // 在抽象图上跑 A*（节点少，开销极小）
    const abstractPath = this._abstractAStar(startId, goalId, from, to, tempEdges);
    if (!abstractPath) return null;

    // 细化：相邻抽象节点之间用 JPS 还原逐格路径
    const full = [];
    let prev = from;
    for (let i = 0; i < abstractPath.length; i++) {
      const id = abstractPath[i];
      const pos = id === goalId ? to : this.nodes.get(id);
      const seg = jpsPath(prev, { x: pos.x, y: pos.y }, g, { maxExpansions: 4000 });
      if (!seg) return null;
      for (const p of seg) full.push(p);
      prev = { x: pos.x, y: pos.y };
    }
    return full;
  }

  /** 抽象图上的 A*（含临时起终点）。返回节点 id 序列（不含 start，含 goal）。 */
  _abstractAStar(startId, goalId, from, to, tempEdges) {
    const h = (pos) => Math.abs(pos.x - to.x) + Math.abs(pos.y - to.y);
    const posOf = (id) => id === startId ? from : (id === goalId ? to : this.nodes.get(id));
    const neighborsOf = (id) => {
      if (id === startId) return tempEdges.get(startId);
      const base = this.edges.get(id) || [];
      // goal 的临时入边记录在 tempEdges[goalId]，需反向可达：把它并进来
      return base;
    };

    // goal 通过 tempEdges[goalId] 的反向边接入：建立 transition->goal 的映射
    const toGoal = new Map();
    for (const e of tempEdges.get(goalId)) toGoal.set(e.to, e.cost);

    const open = [{ id: startId, g: 0, f: h(from) }];
    const gScore = new Map([[startId, 0]]);
    const came = new Map();
    const closed = new Set();

    while (open.length > 0) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.id === goalId) {
        const seq = [];
        let n = goalId;
        while (n !== startId) { seq.unshift(n); n = came.get(n); if (n === undefined) break; }
        return seq;
      }
      if (closed.has(cur.id)) continue;
      closed.add(cur.id);

      const expand = (toId, cost) => {
        const ng = cur.g + cost;
        if (gScore.has(toId) && ng >= gScore.get(toId)) return;
        gScore.set(toId, ng);
        came.set(toId, cur.id);
        open.push({ id: toId, g: ng, f: ng + h(posOf(toId)) });
      };

      for (const e of neighborsOf(cur.id)) expand(e.to, e.cost);
      // 若当前是某个能直达 goal 的过渡点，加入到 goal 的边
      if (toGoal.has(cur.id)) expand(goalId, toGoal.get(cur.id));
    }
    return null;
  }
}
