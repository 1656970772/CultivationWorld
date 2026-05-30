/**
 * SpatialComponent - 实体空间组件
 *
 * 组合模式：为实体提供地图坐标、移动速度、寻路目标与路径。
 * 仅 NPC、妖兽等需要在地图上移动的实体持有该组件；势力用 headquarters + territory 表达位置，不使用此组件。
 *
 * 坐标说明：
 * - x, y 为精确坐标（整数格中心，渲染层可在 tick 之间做插值）。
 * - tileX, tileY 为所在格子（整数），由 x, y 取整得到。
 * - speed 为每 tick（每游戏日）可推进的格数，来源于境界/妖兽阶位（见 data/balance/movement.json）。
 */
export class SpatialComponent {
  /**
   * @param {Object} opts
   * @param {number} opts.x   初始 X 坐标
   * @param {number} opts.y   初始 Y 坐标
   * @param {number} [opts.speed=1] 每 tick 移动格数
   */
  constructor({ x = 0, y = 0, speed = 1 } = {}) {
    this.x = x;
    this.y = y;
    this.speed = speed > 0 ? speed : 1;

    /** @type {{x:number,y:number}|null} 目标格子 */
    this.destination = null;
    /** @type {Array<{x:number,y:number}>} 当前路径（不含起点） */
    this.path = [];
    /** @type {number} 路径推进下标 */
    this.pathIndex = 0;
    /** @type {boolean} 是否处于移动中 */
    this.moving = false;
  }

  get tileX() {
    return Math.round(this.x);
  }

  get tileY() {
    return Math.round(this.y);
  }

  /**
   * 设置移动目标（不含寻路，路径由 MovementSystem 计算后回填）
   * @param {number} x
   * @param {number} y
   */
  setDestination(x, y) {
    this.destination = { x, y };
    this.moving = true;
  }

  /** 清除目标与路径，停止移动 */
  clearDestination() {
    this.destination = null;
    this.path = [];
    this.pathIndex = 0;
    this.moving = false;
  }

  /**
   * 回填寻路结果
   * @param {Array<{x:number,y:number}>} pathArray 不含起点的路径
   */
  setPath(pathArray) {
    this.path = Array.isArray(pathArray) ? pathArray : [];
    this.pathIndex = 0;
    this.moving = this.path.length > 0;
  }

  /** 是否已到达目标格子 */
  isAtDestination() {
    if (!this.destination) return true;
    return this.tileX === this.destination.x && this.tileY === this.destination.y;
  }

  isMoving() {
    return this.moving;
  }

  /** 直线距离（格） */
  distanceTo(x, y) {
    return Math.hypot(this.x - x, this.y - y);
  }

  snapshot() {
    return {
      x: this.x,
      y: this.y,
      tileX: this.tileX,
      tileY: this.tileY,
      speed: this.speed,
      moving: this.moving,
      destination: this.destination ? { ...this.destination } : null,
    };
  }
}
