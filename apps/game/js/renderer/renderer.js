import { Camera } from './camera.js';
import { TileRenderer, CHUNK_SIZE } from './tile-renderer.js';
import { FogRenderer } from './fog-renderer.js';

const TILE_PX = 24; // 基准格子像素
const TOTAL_CHUNKS_X = Math.ceil(300 / CHUNK_SIZE); // 19
const TOTAL_CHUNKS_Y = Math.ceil(300 / CHUNK_SIZE); // 19

export class Renderer {
  constructor(canvasId) {
    this._canvasId = canvasId;
    this._canvas = document.getElementById(canvasId);
    this._app = null; // PIXI.Application

    // chunk 系统
    this._tileGrid = null;
    this._chunkTextures = new Map(); // "cx,cy" → RenderTexture
    this._chunkSprites = new Map();  // "cx,cy" → Sprite（当前在 stage 上的）
    this._dirtyChunks = new Set();   // 需要重烘焙的 chunk 键
    this._chunkLayer = null;

    // 子系统（在 init 中真正初始化）
    this._camera = null;
    this._tileRenderer = new TileRenderer();
    this._fogRenderer = new FogRenderer();
    this._playerGraphics = null;
    this._playerState = null;

    // 地图信息
    this._mapWidth = 300;
    this._mapHeight = 300;

    // 公共属性（game-manager 会访问）
    this.isRunning = false;
    this.onTileClick = null;

    // 延迟暴露 camera（init 后才可用）
    this.camera = null;
  }

  /**
   * 初始化 PixiJS 应用并构建初始场景
   * 注意：这是 async 方法，需要 await
   */
  async init(mapData, terrains, factions, playerState) {
    if (!window.PIXI) {
      throw new Error('[Renderer] window.PIXI 未定义，请确认 PixiJS v8 CDN 已加载');
    }

    const { Application, Container, Graphics } = window.PIXI;

    this._mapWidth = mapData.width || 300;
    this._mapHeight = mapData.height || 300;

    // 初始化 PixiJS Application
    this._app = new Application();
    await this._app.init({
      canvas: this._canvas,
      width: this._canvas.clientWidth || window.innerWidth,
      height: this._canvas.clientHeight || window.innerHeight,
      backgroundColor: 0x0f0f23,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // 构建场景层次
    const worldContainer = new Container();
    worldContainer.label = 'world';
    this._app.stage.addChild(worldContainer);

    const chunkLayer = new Container();
    chunkLayer.label = 'chunks';
    worldContainer.addChild(chunkLayer);
    this._chunkLayer = chunkLayer;

    const fogGraphics = new Graphics();
    fogGraphics.label = 'fog';
    worldContainer.addChild(fogGraphics);

    const playerGraphics = new Graphics();
    playerGraphics.label = 'player';
    worldContainer.addChild(playerGraphics);
    this._playerGraphics = playerGraphics;

    // 初始化相机
    this._camera = new Camera(this._canvas, worldContainer);
    this.camera = this._camera; // 暴露给 game-manager

    // 初始化 TileRenderer
    this._tileRenderer.init(this._app, terrains, factions);

    // 初始化 FogRenderer
    this._fogRenderer.init(fogGraphics, this._mapWidth, this._mapHeight);

    // 构建 tileGrid
    this._tileGrid = new Array(this._mapHeight);
    for (let y = 0; y < this._mapHeight; y++) {
      this._tileGrid[y] = new Array(this._mapWidth).fill(null);
    }
    for (const tile of mapData.tiles) {
      this._tileGrid[tile.y][tile.x] = tile;
    }

    // 标记所有 chunk 为脏（初始化时需要全量烘焙）
    for (let cy = 0; cy < TOTAL_CHUNKS_Y; cy++) {
      for (let cx = 0; cx < TOTAL_CHUNKS_X; cx++) {
        this._dirtyChunks.add(`${cx},${cy}`);
      }
    }

    // 绑定点击事件
    this._canvas.addEventListener('click', (e) => {
      if (this._camera.isDragging) return;
      if (!this.onTileClick) return;
      const rect = this._canvas.getBoundingClientRect();
      const world = this._camera.screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top
      );
      if (world.x >= 0 && world.x < this._mapWidth &&
          world.y >= 0 && world.y < this._mapHeight) {
        this.onTileClick(world.x, world.y);
      }
    });

    // 窗口缩放
    window.addEventListener('resize', () => this.resizeCanvas());

    // 居中玩家
    if (playerState) {
      this._playerState = playerState;
      this._camera.centerOn(playerState.x, playerState.y);
      this._fogRenderer.updateVisibility(playerState.x, playerState.y, playerState.senseRange || 5);
    }
  }

  /**
   * 启动渲染循环（PixiJS Ticker）
   */
  start() {
    if (this.isRunning || !this._app) return;
    this.isRunning = true;

    this._app.ticker.add(() => {
      this._rebakeDirtyChunks();
      this._updateVisibleChunks();
      this._fogRenderer.renderFog(this._camera, CHUNK_SIZE);
      this._renderPlayer();
    });

    this._app.ticker.start();
  }

  stop() {
    this.isRunning = false;
    if (this._app) {
      this._app.ticker.stop();
    }
  }

  /**
   * 重烘焙脏 chunk（每帧检查，优先烘焙可见的 chunk）
   */
  _rebakeDirtyChunks() {
    if (this._dirtyChunks.size === 0) return;

    const { cx1, cy1, cx2, cy2 } = this._camera.getVisibleChunkRange(CHUNK_SIZE);

    let count = 0;
    const MAX_PER_FRAME = 4; // 每帧最多烘焙数量，避免卡帧

    for (const key of this._dirtyChunks) {
      if (count >= MAX_PER_FRAME) break;

      const [cx, cy] = key.split(',').map(Number);
      const isVisible = cx >= cx1 && cx <= cx2 && cy >= cy1 && cy <= cy2;

      // 非可见 chunk 且队列还很长时，延后处理
      if (!isVisible && this._dirtyChunks.size > 10) continue;

      const existing = this._chunkTextures.get(key) ?? null;
      const texture = this._tileRenderer.bakeChunk(cx, cy, this._tileGrid, existing);

      if (!existing) {
        this._chunkTextures.set(key, texture);
      }

      this._dirtyChunks.delete(key);
      count++;
    }
  }

  /**
   * 根据相机视口，添加/移除可见 chunk 的 Sprite
   */
  _updateVisibleChunks() {
    if (!this._camera || !this._chunkLayer) return;

    const { Sprite } = window.PIXI;
    const { cx1, cy1, cx2, cy2 } = this._camera.getVisibleChunkRange(CHUNK_SIZE);
    const chunkPx = CHUNK_SIZE * TILE_PX;

    const visibleKeys = new Set();

    // 添加新进入视口的 chunk
    for (let cy = Math.max(0, cy1); cy <= Math.min(TOTAL_CHUNKS_Y - 1, cy2); cy++) {
      for (let cx = Math.max(0, cx1); cx <= Math.min(TOTAL_CHUNKS_X - 1, cx2); cx++) {
        const key = `${cx},${cy}`;
        visibleKeys.add(key);

        if (!this._chunkSprites.has(key)) {
          const texture = this._chunkTextures.get(key);
          if (!texture) continue; // 纹理还未烘焙，下帧再试

          const sprite = new Sprite(texture);
          sprite.x = cx * chunkPx;
          sprite.y = cy * chunkPx;
          this._chunkLayer.addChild(sprite);
          this._chunkSprites.set(key, sprite);
        }
      }
    }

    // 移除离开视口的 chunk（释放 Sprite，保留纹理缓存）
    for (const [key, sprite] of this._chunkSprites) {
      if (!visibleKeys.has(key)) {
        this._chunkLayer.removeChild(sprite);
        sprite.destroy({ texture: false }); // 纹理保留在 _chunkTextures
        this._chunkSprites.delete(key);
      }
    }
  }

  /**
   * 渲染玩家标记
   */
  _renderPlayer() {
    if (!this._playerState || !this._playerGraphics) return;

    const g = this._playerGraphics;
    g.clear();

    const px = this._playerState.x * TILE_PX + TILE_PX / 2;
    const py = this._playerState.y * TILE_PX + TILE_PX / 2;
    const radius = TILE_PX * 0.35;

    g.circle(px, py, radius).fill({ color: 0x00ff88, alpha: 0.9 });
    g.circle(px, py, radius + 2).stroke({ color: 0xffffff, width: 1.5, alpha: 0.8 });
  }

  /**
   * 更新地图数据（Tick 后调用）
   * 标记有领地变化的 chunk 为脏
   */
  updateMapData(mapData) {
    if (!this._tileGrid) return;

    for (const tile of mapData.tiles) {
      const oldTile = this._tileGrid[tile.y]?.[tile.x];

      if (!oldTile || oldTile.ownerId !== tile.ownerId || oldTile.terrain !== tile.terrain) {
        this._tileGrid[tile.y][tile.x] = tile;

        const cx = Math.floor(tile.x / CHUNK_SIZE);
        const cy = Math.floor(tile.y / CHUNK_SIZE);
        this._dirtyChunks.add(`${cx},${cy}`);
      }
    }
  }

  /**
   * 更新玩家状态（移动后调用）
   */
  updatePlayerState(playerState) {
    this._playerState = playerState;
    this._fogRenderer.updateVisibility(
      playerState.x,
      playerState.y,
      playerState.senseRange || 5
    );
  }

  /**
   * 调整 canvas 大小
   */
  resizeCanvas() {
    if (!this._app) return;
    const width = this._canvas.clientWidth;
    const height = this._canvas.clientHeight;
    if (width > 0 && height > 0) {
      this._app.renderer.resize(width, height);
    }
  }
}
