/**
 * JpsPlusData - JPS+ 预处理（参考知乎/CSDN「最快速的寻路算法 JPS」之"位运算与预处理"一节）
 *
 * 思路：地图静态时，对每格、每个方向预存"沿该方向最远可走步数 step"：
 *   - step > 0：沿该方向第 step 格是一个**跳点**（含强迫邻居），应入开放表；
 *   - step <= 0：沿该方向走 -step 格后即抵达障碍/边界前最后一格（途中无跳点），
 *               该段是"墙跳距离"，仅用于判断目标是否落在这段直线内。
 *
 * 运行时 jump 直接查表跳到目标步数，免去逐格 isWalkable 循环（JPS 的主要热点）。
 *
 * 本实现与 jps.js 的 4 连通非对称跳点定义严格一致：
 *   - 水平方向跳点：该格存在上/下强迫邻居；
 *   - 垂直方向跳点：该格存在左/右强迫邻居，或该格沿水平任一侧存在水平跳点
 *     （等价于 jps.js 中"垂直行进递归探测水平子分支"）。
 *
 * 方向编码：0=上(0,-1) 1=下(0,1) 2=左(-1,0) 3=右(1,0)
 */

export const DIR_UP = 0, DIR_DOWN = 1, DIR_LEFT = 2, DIR_RIGHT = 3;
export const DIR_VEC = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export class JpsPlusData {
  /**
   * @param {import('./grid-graph.js').GridGraph} graph
   */
  constructor(graph) {
    this.graph = graph;
    const W = graph.width, H = graph.height;
    this.width = W; this.height = H;
    const n = W * H;

    // hJumpPoint[idx]=1：该格存在上/下强迫邻居（水平到达时是跳点）
    this._hJumpPoint = new Uint8Array(n);
    // vJumpPoint[idx]=1：该格是垂直跳点（左右强迫邻居，或可向左/右 jump 到水平跳点）
    this._vJumpPoint = new Uint8Array(n);

    // 4 方向 step 表（Int16 足够覆盖 ≤32767 的地图边长）
    this.step = [new Int16Array(n), new Int16Array(n), new Int16Array(n), new Int16Array(n)];

    // 顺序很关键：
    // 1) 先标记水平跳点（仅依赖局部强迫邻居）
    // 2) 算左右 step 表（依赖水平跳点）
    // 3) 用左右 step 表标记垂直跳点（"能否向侧向 jump 到水平跳点" = 侧向 step>0）
    // 4) 算上下 step 表（依赖垂直跳点）
    this._computeHorizontalJumpFlags();
    this._computeHorizontalSteps();
    this._computeVerticalJumpFlags();
    this._computeVerticalSteps();
  }

  _idx(x, y) { return y * this.width + x; }

  /**
   * 阶段 1：标记水平跳点。
   * 沿水平行进经过该格时，上或下出现"身后障碍、身前可走"的强迫邻居即为水平跳点。
   * 强迫邻居与水平方向 dx 有关，这里对左、右两方向合并判定（任一成立即标记），
   * 与 jps.js 水平分支保持一致。
   */
  _computeHorizontalJumpFlags() {
    const g = this.graph;
    const W = this.width, H = this.height;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!g.isWalkable(x, y)) continue;
        for (const dx of [1, -1]) {
          if ((!g.isWalkable(x - dx, y + 1) && g.isWalkable(x, y + 1)) ||
              (!g.isWalkable(x - dx, y - 1) && g.isWalkable(x, y - 1))) {
            this._hJumpPoint[this._idx(x, y)] = 1;
            break;
          }
        }
      }
    }
  }

  /**
   * 阶段 3：标记垂直跳点。
   * 垂直行进经过 (x,y) 时它是跳点，当且仅当：
   *   - 存在左/右强迫邻居（!walk(x±1,y∓dy) && walk(x±1,y)，对上下方向合并判定）；或
   *   - 该格能向左或向右 jump 到一个水平跳点（即左/右 step 表为正）。
   * 第二条用已算好的左右 step 表 O(1) 判定，等价 jps.js 中"垂直行进递归探测水平子分支"。
   */
  _computeVerticalJumpFlags() {
    const g = this.graph;
    const W = this.width, H = this.height;
    const left = this.step[DIR_LEFT], right = this.step[DIR_RIGHT];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!g.isWalkable(x, y)) continue;
        const idx = this._idx(x, y);
        let vjp = false;
        for (const dy of [1, -1]) {
          if ((!g.isWalkable(x + 1, y - dy) && g.isWalkable(x + 1, y)) ||
              (!g.isWalkable(x - 1, y - dy) && g.isWalkable(x - 1, y))) {
            vjp = true; break;
          }
        }
        // 可向侧向 jump 到水平跳点：自身是水平跳点，或左/右 step 指向某个水平跳点
        if (!vjp) {
          if (this._hJumpPoint[idx] === 1 || left[idx] > 0 || right[idx] > 0) vjp = true;
        }
        if (vjp) this._vJumpPoint[idx] = 1;
      }
    }
  }

  _isVerticalJumpPoint(x, y) { return this._vJumpPoint[this._idx(x, y)] === 1; }
  _isHorizontalJumpPoint(x, y) { return this._hJumpPoint[this._idx(x, y)] === 1; }

  /**
   * 单方向 step 递推。从行进反方向扫描：
   *   - 下一格越界/障碍 → step=0（紧贴墙/边界）
   *   - 下一格是该方向跳点 → step=1
   *   - 下一格不是跳点：前方有跳点(nextStep>0) → step=nextStep+1；否则 step=nextStep-1（负数累计墙距）
   */
  _stepRecur(dir, dx, dy, isJumpPoint, xOrder, yOrder) {
    const g = this.graph;
    const dirStep = this.step[dir];
    for (const y of yOrder) {
      for (const x of xOrder) {
        const idx = this._idx(x, y);
        if (!g.isWalkable(x, y)) { dirStep[idx] = 0; continue; }
        const nx = x + dx, ny = y + dy;
        if (!g.isWalkable(nx, ny)) { dirStep[idx] = 0; continue; }
        if (isJumpPoint(nx, ny)) { dirStep[idx] = 1; continue; }
        const nextStep = dirStep[this._idx(nx, ny)];
        dirStep[idx] = nextStep > 0 ? nextStep + 1 : nextStep - 1;
      }
    }
  }

  /** 阶段 2：左右 step 表（依赖水平跳点标记） */
  _computeHorizontalSteps() {
    const W = this.width, H = this.height;
    const asc = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
    const desc = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = n - 1 - i; return a; };
    const xAsc = asc(W), xDesc = desc(W), yAll = asc(H);
    const isHJP = (x, y) => this._isHorizontalJumpPoint(x, y);
    // 左(-1,0)：next 在 x-1，按 x 升序
    this._stepRecur(DIR_LEFT, -1, 0, isHJP, xAsc, yAll);
    // 右(1,0)：next 在 x+1，按 x 降序
    this._stepRecur(DIR_RIGHT, 1, 0, isHJP, xDesc, yAll);
  }

  /** 阶段 4：上下 step 表（依赖垂直跳点标记） */
  _computeVerticalSteps() {
    const W = this.width, H = this.height;
    const asc = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
    const desc = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = n - 1 - i; return a; };
    const xAll = asc(W), yAsc = asc(H), yDesc = desc(H);
    const isVJP = (x, y) => this._isVerticalJumpPoint(x, y);
    // 上(0,-1)：next 在 y-1，按 y 升序
    this._stepRecur(DIR_UP, 0, -1, isVJP, xAll, yAsc);
    // 下(0,1)：next 在 y+1，按 y 降序
    this._stepRecur(DIR_DOWN, 0, 1, isVJP, xAll, yDesc);
  }

  /** 查 (x,y) 沿方向 dir 的 step 值 */
  stepAt(x, y, dir) {
    return this.step[dir][this._idx(x, y)];
  }
}

/**
 * JPS+ 寻路：用预处理 step 表跳跃，框架与 jps.js 的 A* 相同，但 jump 不再逐格扫描。
 *
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {import('./grid-graph.js').GridGraph} graph
 * @param {JpsPlusData} jpp 预处理数据
 * @param {Object} [options]
 * @param {number} [options.maxExpansions=20000]
 * @returns {Array<{x:number,y:number}>|null}
 */
export function jpsPlusPath(from, to, graph, jpp, options = {}) {
  if (!from || !to) return null;
  if (from.x === to.x && from.y === to.y) return [];
  if (!graph.isWalkable(to.x, to.y) || !graph.isWalkable(from.x, from.y)) return null;

  const W = graph.width;
  const maxExpansions = options.maxExpansions ?? 20000;
  const goalX = to.x, goalY = to.y;
  const h = (x, y) => Math.abs(x - goalX) + Math.abs(y - goalY);

  const open = new PlusHeap();
  const gScore = new Map();
  const cameFrom = new Map();
  const closed = new Set();

  const startIdx = from.y * W + from.x;
  gScore.set(startIdx, 0);
  open.push({ x: from.x, y: from.y, g: 0, f: h(from.x, from.y) });

  let expansions = 0;

  while (open.size > 0) {
    const cur = open.pop();
    const curIdx = cur.y * W + cur.x;
    if (closed.has(curIdx)) continue;
    closed.add(curIdx);

    if (cur.x === goalX && cur.y === goalY) {
      return reconstructPlus(cameFrom, startIdx, curIdx, W);
    }
    if (++expansions > maxExpansions) return null;

    const dirs = prunedDirsPlus(cur, cameFrom, curIdx, W, graph);

    for (const dir of dirs) {
      const jp = jumpPlus(cur.x, cur.y, dir, goalX, goalY, graph, jpp);
      if (!jp) continue;
      const jIdx = jp.y * W + jp.x;
      if (closed.has(jIdx)) continue;
      const ng = cur.g + jp.cost;
      const prev = gScore.get(jIdx);
      if (prev !== undefined && ng >= prev) continue;
      gScore.set(jIdx, ng);
      cameFrom.set(jIdx, curIdx);
      open.push({ x: jp.x, y: jp.y, g: ng, f: ng + h(jp.x, jp.y) });
    }
  }
  return null;
}

/**
 * JPS+ 跳跃：沿 dir 用 step 表一次跳到跳点（或拦截到落在直线上的目标）。
 * 返回 { x, y, cost } 或 null。cost 为从起格到跳点累计的真实 moveCost。
 *
 * 同时复刻 jps.js 的非对称语义：垂直方向跳到"垂直跳点"，水平方向跳到"水平跳点"；
 * step 表在预处理时已据此判定，故此处直接用 step 即可保持结果一致。
 */
function jumpPlus(x, y, dir, goalX, goalY, graph, jpp) {
  const [dx, dy] = DIR_VEC[dir];
  const step = jpp.stepAt(x, y, dir);

  // 目标在本方向直线上时，优先在可达范围内拦截目标
  if (dx !== 0 && y === goalY) {
    const dist = (goalX - x) * dx;
    if (dist > 0) {
      const reach = step > 0 ? step : -step;
      if (dist <= reach) return accumulate(x, y, dx, dy, dist, graph);
    }
  } else if (dy !== 0 && x === goalX) {
    const dist = (goalY - y) * dy;
    if (dist > 0) {
      const reach = step > 0 ? step : -step;
      if (dist <= reach) return accumulate(x, y, dx, dy, dist, graph);
    }
  }

  // step>0：第 step 格是跳点，跳过去
  if (step > 0) return accumulate(x, y, dx, dy, step, graph);
  // step<=0：该方向无跳点（撞墙/边界），且目标不在直线段内 → 此方向无解
  return null;
}

/** 从 (x,y) 沿 (dx,dy) 走 n 步，累加经过格的真实代价，返回终点与 cost */
function accumulate(x, y, dx, dy, n, graph) {
  let cx = x, cy = y, cost = 0;
  for (let i = 0; i < n; i++) {
    cx += dx; cy += dy;
    cost += graph.costAt(cx, cy);
  }
  return { x: cx, y: cy, cost };
}

/** 方向剪枝（与 jps.js 的 prunedDirections 完全一致，返回方向编码数组） */
function prunedDirsPlus(node, cameFrom, curIdx, W, graph) {
  const parentIdx = cameFrom.get(curIdx);
  if (parentIdx === undefined) return [DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT];
  const px = parentIdx % W;
  const py = (parentIdx - px) / W;
  const ndx = Math.sign(node.x - px);
  const ndy = Math.sign(node.y - py);
  const cx = node.x, cy = node.y;

  if (ndy !== 0) {
    // 垂直到达：继续垂直 + 左右
    return [ndy > 0 ? DIR_DOWN : DIR_UP, DIR_RIGHT, DIR_LEFT];
  }
  // 水平到达：继续水平 + 强迫邻居引出的垂直转向
  const dirs = [ndx > 0 ? DIR_RIGHT : DIR_LEFT];
  if (!graph.isWalkable(cx - ndx, cy + 1) && graph.isWalkable(cx, cy + 1)) dirs.push(DIR_DOWN);
  if (!graph.isWalkable(cx - ndx, cy - 1) && graph.isWalkable(cx, cy - 1)) dirs.push(DIR_UP);
  return dirs;
}

/** 回溯跳点链并补成逐格路径（与 jps.js reconstruct 相同） */
function reconstructPlus(cameFrom, startIdx, goalIdx, W) {
  const jumpPoints = [];
  let idx = goalIdx;
  while (idx !== startIdx) {
    jumpPoints.unshift(idx);
    const parent = cameFrom.get(idx);
    if (parent === undefined) break;
    idx = parent;
  }
  let px = startIdx % W;
  let py = (startIdx - px) / W;
  const path = [];
  for (const jIdx of jumpPoints) {
    const jx = jIdx % W;
    const jy = (jIdx - jx) / W;
    const sdx = Math.sign(jx - px);
    const sdy = Math.sign(jy - py);
    let cx = px, cy = py;
    while (cx !== jx || cy !== jy) {
      cx += sdx; cy += sdy;
      path.push({ x: cx, y: cy });
    }
    px = jx; py = jy;
  }
  return path;
}

/** JPS+ 专用最小堆 */
class PlusHeap {
  constructor() { this._data = []; }
  get size() { return this._data.length; }
  push(node) {
    const d = this._data;
    d.push(node);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p].f <= d[i].f) break;
      const t = d[p]; d[p] = d[i]; d[i] = t;
      i = p;
    }
  }
  pop() {
    const d = this._data;
    const top = d[0];
    const last = d.pop();
    if (d.length > 0) {
      d[0] = last;
      let i = 0; const n = d.length;
      while (true) {
        let s = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && d[l].f < d[s].f) s = l;
        if (r < n && d[r].f < d[s].f) s = r;
        if (s === i) break;
        const t = d[s]; d[s] = d[i]; d[i] = t;
        i = s;
      }
    }
    return top;
  }
}
