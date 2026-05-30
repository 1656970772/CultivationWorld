/**
 * Camera - PixiJS 版相机控制
 * 通过操作 worldContainer 的 position 和 scale 实现平移和缩放
 */
export class Camera {
  constructor(canvas, worldContainer) {
    this.canvas = canvas;
    this.worldContainer = worldContainer;
    this.isDragging = false;
    this._dragStart = null;
    this._containerStartPos = null;
    this.tileSize = 24; // 默认格子大小（逻辑值，供外部查询）
    this._minScale = 0.08; // 最小缩放（允许整张大地图缩进视口）
    this._maxScale = 2.5; // 最大缩放（对应 tileSize ≈ 60）
    this._baseScale = 1.0; // tileSize=24 时的基准 scale

    // 当前缩放值（worldContainer.scale.x）
    this.worldContainer.scale.set(this._baseScale);

    this._bindEvents();
  }

  _bindEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) {
        this.isDragging = false;
        this._dragStart = { x: e.clientX, y: e.clientY };
        this._containerStartPos = {
          x: this.worldContainer.x,
          y: this.worldContainer.y
        };
        this._dragMoving = false;
      }
    });

    canvas.addEventListener('mousemove', e => {
      if (this._dragStart) {
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          this._dragMoving = true;
        }
        if (this._dragMoving) {
          this.isDragging = true;
          this.worldContainer.x = this._containerStartPos.x + dx;
          this.worldContainer.y = this._containerStartPos.y + dy;
          this.clampToMap();
        }
      }
    });

    canvas.addEventListener('mouseup', () => {
      if (this._dragStart) {
        this._dragStart = null;
        this._containerStartPos = null;
        setTimeout(() => { this.isDragging = false; }, 50);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (this._dragStart) {
        this._dragStart = null;
        this._containerStartPos = null;
        setTimeout(() => { this.isDragging = false; }, 50);
      }
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const oldScale = this.worldContainer.scale.x;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(this._minScale, Math.min(this._maxScale, oldScale * delta));

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 缩放前鼠标对应的世界坐标
      const worldX = (mouseX - this.worldContainer.x) / oldScale;
      const worldY = (mouseY - this.worldContainer.y) / oldScale;

      this.worldContainer.scale.set(newScale);

      // 调整 position，使鼠标位置指向同一个世界点
      this.worldContainer.x = mouseX - worldX * newScale;
      this.worldContainer.y = mouseY - worldY * newScale;

      this.tileSize = Math.round(24 * newScale / this._baseScale);
      this.clampToMap();
    }, { passive: false });
  }

  /** 以视口中心为锚点按倍率缩放（用于缩放按钮） */
  zoomBy(factor) {
    const oldScale = this.worldContainer.scale.x;
    const newScale = Math.max(this._minScale, Math.min(this._maxScale, oldScale * factor));
    const rect = this.canvas.getBoundingClientRect();
    const canvasW = rect.width || this.canvas.clientWidth || this.canvas.width;
    const canvasH = rect.height || this.canvas.clientHeight || this.canvas.height;
    const cx = canvasW / 2, cy = canvasH / 2;
    const worldX = (cx - this.worldContainer.x) / oldScale;
    const worldY = (cy - this.worldContainer.y) / oldScale;
    this.worldContainer.scale.set(newScale);
    this.worldContainer.x = cx - worldX * newScale;
    this.worldContainer.y = cy - worldY * newScale;
    this.tileSize = Math.round(24 * newScale / this._baseScale);
    this.clampToMap();
  }

  /** 缩放到指定缩放值并居中到某格（用于双击聚焦院落/建筑） */
  zoomTo(tileX, tileY, scale) {
    const clamped = Math.max(this._minScale, Math.min(this._maxScale, scale));
    this.worldContainer.scale.set(clamped);
    this.tileSize = Math.round(24 * clamped / this._baseScale);
    this.centerOn(tileX, tileY);
    this.clampToMap();
  }

  centerOn(tileX, tileY) {
    const tilePixelSize = 24;
    const scale = this.worldContainer.scale.x;
    const canvasW = this.canvas.clientWidth;
    const canvasH = this.canvas.clientHeight;

    this.worldContainer.x = canvasW / 2 - tileX * tilePixelSize * scale;
    this.worldContainer.y = canvasH / 2 - tileY * tilePixelSize * scale;
  }

  /**
   * 设置地图尺寸（格），用于边界锁定，避免平移到地图外露出黑边。
   */
  setMapBounds(widthTiles, heightTiles) {
    this._mapW = widthTiles;
    this._mapH = heightTiles;
  }

  /**
   * 缩放并居中，使整张地图尽量铺满视口（contain：取较大缩放使较短边铺满，地图始终覆盖画布）。
   */
  fitToView() {
    if (!this._mapW || !this._mapH) return;
    const tilePixelSize = 24;
    const canvasW = this.canvas.clientWidth || this.canvas.width;
    const canvasH = this.canvas.clientHeight || this.canvas.height;
    const mapPxW = this._mapW * tilePixelSize;
    const mapPxH = this._mapH * tilePixelSize;
    // cover：取较大者，保证地图完全覆盖画布（不留黑边）
    const scale = Math.max(canvasW / mapPxW, canvasH / mapPxH);
    const clamped = Math.max(this._minScale, Math.min(this._maxScale, scale));
    this.worldContainer.scale.set(clamped);
    this._baseScale = this._baseScale; // 保持基准不变
    this.centerOn(this._mapW / 2, this._mapH / 2);
    this.clampToMap();
  }

  /**
   * 锁定平移范围，使视口不超出地图（地图始终铺满画布）。
   */
  clampToMap() {
    if (!this._mapW || !this._mapH) return;
    const tilePixelSize = 24;
    const scale = this.worldContainer.scale.x;
    const canvasW = this.canvas.clientWidth || this.canvas.width;
    const canvasH = this.canvas.clientHeight || this.canvas.height;
    const mapPxW = this._mapW * tilePixelSize * scale;
    const mapPxH = this._mapH * tilePixelSize * scale;

    if (mapPxW >= canvasW) {
      this.worldContainer.x = Math.min(0, Math.max(canvasW - mapPxW, this.worldContainer.x));
    } else {
      this.worldContainer.x = (canvasW - mapPxW) / 2;
    }
    if (mapPxH >= canvasH) {
      this.worldContainer.y = Math.min(0, Math.max(canvasH - mapPxH, this.worldContainer.y));
    } else {
      this.worldContainer.y = (canvasH - mapPxH) / 2;
    }
  }

  /**
   * 跟随某个实体：传入一个返回 {x, y}（格坐标，可为浮点）的取位函数。
   * 调用 updateFollow() 时相机持续居中到该实体。
   * @param {() => ({x:number,y:number}|null)} getPosFn
   */
  follow(getPosFn) {
    this._followFn = typeof getPosFn === 'function' ? getPosFn : null;
  }

  stopFollow() {
    this._followFn = null;
  }

  isFollowing() {
    return !!this._followFn;
  }

  /** 每帧调用：若处于跟随态且用户未拖拽，则居中到目标 */
  updateFollow() {
    if (!this._followFn || this.isDragging || this._dragStart) return;
    const pos = this._followFn();
    if (pos && typeof pos.x === 'number') {
      this.centerOn(pos.x, pos.y);
      this.clampToMap();
    }
  }

  screenToWorld(screenX, screenY) {
    const scale = this.worldContainer.scale.x;
    const tilePixelSize = 24;
    const wx = (screenX - this.worldContainer.x) / (tilePixelSize * scale);
    const wy = (screenY - this.worldContainer.y) / (tilePixelSize * scale);
    return { x: Math.floor(wx), y: Math.floor(wy) };
  }

  /**
   * 获取当前视口可见的 chunk 范围
   * @param {number} CHUNK_SIZE chunk 的格子大小（默认 16）
   * @returns {{ cx1, cy1, cx2, cy2 }}
   */
  getVisibleChunkRange(CHUNK_SIZE = 16) {
    const scale = this.worldContainer.scale.x;
    const tilePixelSize = 24;
    const chunkPx = CHUNK_SIZE * tilePixelSize;

    const canvasW = this.canvas.clientWidth;
    const canvasH = this.canvas.clientHeight;

    const worldX1 = -this.worldContainer.x / scale;
    const worldY1 = -this.worldContainer.y / scale;
    const worldX2 = (canvasW - this.worldContainer.x) / scale;
    const worldY2 = (canvasH - this.worldContainer.y) / scale;

    return {
      cx1: Math.max(0, Math.floor(worldX1 / chunkPx) - 1),
      cy1: Math.max(0, Math.floor(worldY1 / chunkPx) - 1),
      cx2: Math.ceil(worldX2 / chunkPx) + 1,
      cy2: Math.ceil(worldY2 / chunkPx) + 1,
    };
  }
}
