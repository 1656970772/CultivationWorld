/**
 * FogRenderer - PixiJS 版迷雾渲染
 * 使用 PIXI.Graphics 绘制半透明覆盖层，替代 Canvas 2D 的逐格 fillRect
 */
const TILE_PX = 24;

export class FogRenderer {
  constructor() {
    this._fogGraphics = null;
    this._playerX = 0;
    this._playerY = 0;
    this._senseRange = 5;
    this._exploredTiles = new Set(); // "x,y" 格式
    this._visibleTiles = new Set();
    this._dirty = true;
    this._mapWidth = 300;
    this._mapHeight = 300;
  }

  /**
   * @param {PIXI.Graphics} fogGraphics  世界容器中的迷雾 Graphics 对象
   * @param {number} mapWidth
   * @param {number} mapHeight
   */
  init(fogGraphics, mapWidth = 300, mapHeight = 300) {
    this._fogGraphics = fogGraphics;
    this._mapWidth = mapWidth;
    this._mapHeight = mapHeight;
  }

  updateVisibility(playerX, playerY, senseRange) {
    this._playerX = playerX;
    this._playerY = playerY;
    this._senseRange = senseRange;

    this._visibleTiles.clear();
    const range = senseRange;

    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx * dx + dy * dy <= range * range) {
          const tx = playerX + dx;
          const ty = playerY + dy;
          if (tx >= 0 && tx < this._mapWidth && ty >= 0 && ty < this._mapHeight) {
            const key = `${tx},${ty}`;
            this._visibleTiles.add(key);
            this._exploredTiles.add(key);
          }
        }
      }
    }
    this._dirty = true;
  }

  /**
   * 更新迷雾 Graphics（只在玩家移动时重绘）
   * @param {Camera} camera  相机对象（用于获取可见范围）
   * @param {number} CHUNK_SIZE chunk 格子大小
   */
  renderFog(camera, CHUNK_SIZE = 16) {
    if (!this._dirty || !this._fogGraphics) return;
    this._dirty = false;

    const g = this._fogGraphics;
    g.clear();

    // 获取视口内格子范围（带 buffer）
    const { cx1, cy1, cx2, cy2 } = camera.getVisibleChunkRange(CHUNK_SIZE);
    const startX = Math.max(0, cx1 * CHUNK_SIZE - CHUNK_SIZE);
    const startY = Math.max(0, cy1 * CHUNK_SIZE - CHUNK_SIZE);
    const endX = Math.min(this._mapWidth, cx2 * CHUNK_SIZE + CHUNK_SIZE);
    const endY = Math.min(this._mapHeight, cy2 * CHUNK_SIZE + CHUNK_SIZE);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const key = `${x},${y}`;
        let alpha = 0;

        if (!this._exploredTiles.has(key)) {
          alpha = 0.85; // 未探索：深黑
        } else if (!this._visibleTiles.has(key)) {
          alpha = 0.45; // 已探索未可见：半暗
        }
        // 可见格子：alpha=0，不绘制

        if (alpha > 0) {
          g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX)
           .fill({ color: 0x000000, alpha });
        }
      }
    }
  }
}
