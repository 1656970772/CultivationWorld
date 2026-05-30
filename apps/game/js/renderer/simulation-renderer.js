/**
 * SimulationRenderer - 自动模拟的实时渲染器
 *
 * 复用 Camera（平移/缩放/跟随），用 PixiJS 绘制视口内的地形与移动中的实体
 * （NPC / 妖兽 / 势力领地）。轻量视口渲染：只画可见范围的格子与实体，
 * 不依赖主角玩法的 chunk 烘焙与迷雾系统。
 *
 * 与模拟解耦：只读 engine.getWorldSnapshot() 与 tileIndex，不修改任何引擎状态。
 * 移动平滑：用 requestAnimationFrame 在两次 tick 的实体坐标之间插值。
 */
import { Camera } from './camera.js';
import { DistrictType, BuildingType, themeColorOf, hexToInt } from '../engine/world/layout-constants.js';

const TILE_PX = 24;

/** 建筑图标颜色（与 HTML 图例一致） */
const BUILDING_COLOR = {
  [BuildingType.MAIN_HALL]: 0xffe082,   // 主殿：金
  [BuildingType.QUEST_HALL]: 0x4dd0e1,  // 任务殿：青
  [BuildingType.TRAINING]: 0xaed581,    // 修炼场：绿
  [BuildingType.LIBRARY]: 0x9575cd,     // 藏经阁：紫
  [BuildingType.ALCHEMY]: 0xff8a65,     // 炼丹房：橙
  [BuildingType.GATE]: 0xbcaaa4,        // 山门：褐
  [BuildingType.MARKET]: 0xffd54f,      // 坊市：亮金
  [BuildingType.MINE_NODE]: 0xf06292,   // 采矿点：粉
  [BuildingType.GUARD_POST]: 0x90a4ae,  // 守卫位：灰
};

export class SimulationRenderer {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.container   画布容器
   * @param {Map} opts.tileIndex          Map<"x,y", tile>
   * @param {Map} opts.terrainIndex       Map<type, terrainDef>
   * @param {number} opts.mapWidth
   * @param {number} opts.mapHeight
   */
  constructor({ container, tileIndex, terrainIndex, mapWidth, mapHeight, factionTypes }) {
    this.container = container;
    this.tileIndex = tileIndex;
    this.terrainIndex = terrainIndex;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    /** Map<factionId, factionType> 用于领地主题色 */
    this.factionTypes = factionTypes || new Map();

    this.app = null;
    this.camera = null;
    this.worldContainer = null;
    this.terrainGfx = null;
    this.territoryGfx = null;
    this.entityGfx = null;

    // 实体插值：id → { fromX, fromY, toX, toY, t }
    this._entityPos = new Map();
    this._lastSnapshot = null;
    this._followId = null;
    this._onFollowChange = null;
    this._destroyed = false;
  }

  async init() {
    const PIXI = globalThis.PIXI;
    if (!PIXI) throw new Error('PixiJS 未加载');

    this.app = new PIXI.Application();
    await this.app.init({
      background: '#0a0f14',
      resizeTo: this.container,
      antialias: false,
    });
    this.container.appendChild(this.app.canvas);

    this.worldContainer = new PIXI.Container();
    this.app.stage.addChild(this.worldContainer);

    this.terrainGfx = new PIXI.Graphics();
    this.territoryGfx = new PIXI.Graphics();
    this.entityGfx = new PIXI.Graphics();
    this.worldContainer.addChild(this.terrainGfx);
    this.worldContainer.addChild(this.territoryGfx);
    this.worldContainer.addChild(this.entityGfx);

    this.camera = new Camera(this.app.canvas, this.worldContainer);
    this.camera.setMapBounds(this.mapWidth, this.mapHeight);
    // 初始缩放到能铺满画布（不留黑边），起步给一个偏俯瞰的视野
    this.camera.fitToView();

    // 点击地图：选中点击位置最近的实体并跟随
    this.app.canvas.addEventListener('click', (e) => {
      if (this.camera.isDragging) return;
      const rect = this.app.canvas.getBoundingClientRect();
      const world = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      this._selectNearestEntity(world.x, world.y);
    });

    // 双击地图：放大到该位置（便于查看院落/建筑细节）
    this.app.canvas.addEventListener('dblclick', (e) => {
      const rect = this.app.canvas.getBoundingClientRect();
      const world = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.camera.zoomTo(world.x, world.y, 1.4);
    });

    this.app.ticker.add(() => this._renderFrame());
  }

  /** 设置每帧插值进度推进速度（根据每秒 tick 数自适应） */
  setTicksPerSecond(tps) {
    this._tps = Math.max(1, tps);
  }

  /**
   * 接收一次新的世界快照（每 tick 调用），更新实体目标位置用于插值。
   */
  updateSnapshot(snapshot) {
    this._lastSnapshot = snapshot;
    const seen = new Set();

    const ingest = (entities) => {
      for (const [id, e] of Object.entries(entities || {})) {
        if (!e.spatial) continue;
        seen.add(id);
        const tx = e.spatial.x, ty = e.spatial.y;
        const prev = this._entityPos.get(id);
        if (prev) {
          this._entityPos.set(id, { fromX: prev.toX, fromY: prev.toY, toX: tx, toY: ty, t: 0, type: e._etype });
        } else {
          this._entityPos.set(id, { fromX: tx, fromY: ty, toX: tx, toY: ty, t: 1, type: e._etype });
        }
      }
    };
    // 标注实体类型供渲染上色
    for (const e of Object.values(snapshot.npcs || {})) e._etype = 'npc';
    for (const e of Object.values(snapshot.monsters || {})) e._etype = 'monster';
    ingest(snapshot.npcs);
    ingest(snapshot.monsters);

    // 清理已消失（死亡）的实体
    for (const id of [...this._entityPos.keys()]) {
      if (!seen.has(id)) this._entityPos.delete(id);
    }
  }

  /** 跟随指定实体 */
  followEntity(id, onClear) {
    this._followId = id;
    this._onFollowChange = onClear || null;
    this.camera.follow(() => {
      const p = this._entityPos.get(id);
      if (!p) return null;
      return { x: p.fromX + (p.toX - p.fromX) * p.t, y: p.fromY + (p.toY - p.fromY) * p.t };
    });
  }

  stopFollow() {
    this._followId = null;
    this.camera.stopFollow();
    if (this._onFollowChange) this._onFollowChange(null);
  }

  /** 缩放控制（供 UI 按钮调用） */
  zoomIn() { this.camera.zoomBy(1.5); }
  zoomOut() { this.camera.zoomBy(1 / 1.5); }
  resetView() { this.camera.fitToView(); }

  /**
   * 把视角定位到某格（用于点选势力总部）。会先取消实体跟随，
   * 并放大到足以看清院落（若当前更近则保持）。
   * @param {number} tileX
   * @param {number} tileY
   * @param {number} [minScale=0.7] 目标最小缩放
   */
  focusOnTile(tileX, tileY, minScale = 0.7) {
    this.stopFollow();
    const cur = this.camera.worldContainer.scale.x;
    this.camera.zoomTo(tileX, tileY, Math.max(cur, minScale));
  }

  getFollowId() {
    return this._followId;
  }

  _selectNearestEntity(wx, wy) {
    let best = null, bestD = 4; // 4 格内才选中
    for (const [id, p] of this._entityPos.entries()) {
      const x = p.fromX + (p.toX - p.fromX) * p.t;
      const y = p.fromY + (p.toY - p.fromY) * p.t;
      const d = Math.hypot(x - wx, y - wy);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best) {
      this.followEntity(best, this._onFollowChange);
      if (this._onSelect) this._onSelect(best);
    }
  }

  /** 注册点选实体回调（供 UI 同步） */
  onSelect(cb) { this._onSelect = cb; }

  _renderFrame() {
    if (this._destroyed || !this._lastSnapshot) return;

    // 插值推进
    const step = (this._tps || 5) / 60; // 每帧推进
    for (const p of this._entityPos.values()) {
      if (p.t < 1) p.t = Math.min(1, p.t + step);
    }

    this.camera.updateFollow();

    // 地形 + 领地是静态图层，仅在相机视口（平移/缩放）变化时重绘，
    // 否则每帧重建数万格几何会严重卡顿（尤其全图缩放）。
    const wc = this.worldContainer;
    const view = `${Math.round(wc.x)},${Math.round(wc.y)},${wc.scale.x.toFixed(3)}`;
    if (view !== this._lastView) {
      this._lastView = view;
      this._drawTerrain();
      this._drawTerritory();
    }

    // 实体层每帧重绘（移动插值动画）
    this._drawEntities();
  }

  /** 强制下一帧重绘静态图层（例如地图布局变化时） */
  invalidateStatic() { this._lastView = null; }

  /** 当前视口可见格范围（与 _drawTerrain 一致） */
  _visibleTileRange() {
    const scale = this.worldContainer.scale.x;
    const canvasW = this.app.screen.width;
    const canvasH = this.app.screen.height;
    const x1 = Math.max(0, Math.floor(-this.worldContainer.x / scale / TILE_PX) - 1);
    const y1 = Math.max(0, Math.floor(-this.worldContainer.y / scale / TILE_PX) - 1);
    const x2 = Math.min(this.mapWidth - 1, Math.ceil((canvasW - this.worldContainer.x) / scale / TILE_PX) + 1);
    const y2 = Math.min(this.mapHeight - 1, Math.ceil((canvasH - this.worldContainer.y) / scale / TILE_PX) + 1);
    return { x1, y1, x2, y2, scale };
  }

  _factionColorInt(ownerId) {
    const type = this.factionTypes.get(ownerId);
    return hexToInt(themeColorOf(type));
  }

  /**
   * 绘制势力领地（阵营色块）、院墙轮廓、矿区与功能建筑图标。
   * 缩放自适应：scale 小只画色块/墙；放大到阈值再画建筑图标。
   */
  _drawTerritory() {
    const g = this.territoryGfx;
    g.clear();
    const { x1, y1, x2, y2, scale } = this._visibleTileRange();
    const drawBuildings = scale >= 0.6;
    const drawWalls = scale >= 0.35;

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const tile = this.tileIndex.get(`${x},${y}`);
        if (!tile) continue;
        const px = x * TILE_PX, py = y * TILE_PX;
        const district = tile.district;

        // 矿区：统一暖紫罩色，区分自然矿脉与已开发矿区
        if (district === DistrictType.MINE) {
          g.rect(px, py, TILE_PX, TILE_PX).fill({ color: 0xab47bc, alpha: 0.18 });
        } else if (tile.ownerId) {
          // 势力领地：阵营色半透明叠加，core 更明显，inner 更淡
          const color = this._factionColorInt(tile.ownerId);
          const alpha = district === DistrictType.CORE ? 0.34
                      : district === DistrictType.WALL ? 0.30 : 0.16;
          g.rect(px, py, TILE_PX, TILE_PX).fill({ color, alpha });
        }

        // 院墙轮廓
        if (drawWalls && district === DistrictType.WALL) {
          const color = this._factionColorInt(tile.ownerId);
          g.rect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1)
            .stroke({ width: 2, color, alpha: 0.9 });
        }

        // 建筑图标
        if (drawBuildings && tile.building) {
          this._drawBuildingIcon(g, px, py, tile.building);
        }
      }
    }
  }

  /** 在格内画建筑图标（按类型用不同形状/颜色，便于辨认） */
  _drawBuildingIcon(g, px, py, building) {
    const color = BUILDING_COLOR[building] || 0xffffff;
    const cx = px + TILE_PX / 2, cy = py + TILE_PX / 2;
    const r = TILE_PX * 0.32;

    switch (building) {
      case BuildingType.MAIN_HALL:
      case BuildingType.MARKET:
        // 大方块 + 白边（核心建筑最醒目）
        g.rect(cx - r, cy - r, r * 2, r * 2).fill(color);
        g.rect(cx - r, cy - r, r * 2, r * 2).stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
        break;
      case BuildingType.QUEST_HALL:
        // 菱形
        g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy]).fill(color);
        break;
      case BuildingType.TRAINING:
        // 圆形
        g.circle(cx, cy, r * 0.85).fill(color);
        break;
      case BuildingType.LIBRARY:
      case BuildingType.ALCHEMY:
        // 小方块
        g.rect(cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4).fill(color);
        break;
      case BuildingType.GATE:
        // 门形（上横 + 两竖）
        g.rect(cx - r, cy - r, r * 2, r * 0.5).fill(color);
        g.rect(cx - r, cy - r, r * 0.5, r * 2).fill(color);
        g.rect(cx + r * 0.5, cy - r, r * 0.5, r * 2).fill(color);
        break;
      case BuildingType.MINE_NODE:
        // 星点（菱形小点）
        g.poly([cx, cy - r * 0.7, cx + r * 0.7, cy, cx, cy + r * 0.7, cx - r * 0.7, cy]).fill(color);
        break;
      case BuildingType.GUARD_POST:
        // 三角
        g.poly([cx, cy - r, cx + r, cy + r, cx - r, cy + r]).fill(color);
        break;
      default:
        g.circle(cx, cy, r * 0.5).fill(color);
    }
  }

  _terrainColor(terrain) {
    const def = this.terrainIndex.get(terrain);
    if (def && def.color) return parseInt(def.color.replace('#', '0x'));
    return 0x223344;
  }

  _drawTerrain() {
    const g = this.terrainGfx;
    g.clear();

    const scale = this.worldContainer.scale.x;
    // 使用渲染器逻辑尺寸（CSS 像素），不要再除以 DPR，否则视口会被低估导致右/下出现黑边
    const canvasW = this.app.screen.width;
    const canvasH = this.app.screen.height;

    const x1 = Math.max(0, Math.floor(-this.worldContainer.x / scale / TILE_PX) - 1);
    const y1 = Math.max(0, Math.floor(-this.worldContainer.y / scale / TILE_PX) - 1);
    const x2 = Math.min(this.mapWidth - 1, Math.ceil((canvasW - this.worldContainer.x) / scale / TILE_PX) + 1);
    const y2 = Math.min(this.mapHeight - 1, Math.ceil((canvasH - this.worldContainer.y) / scale / TILE_PX) + 1);

    // 是否画格子轮廓：缩放过小时格线会糊成一片，故按 scale 阈值开关
    const drawGrid = scale >= 0.45;

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const tile = this.tileIndex.get(`${x},${y}`);
        if (!tile) continue;
        const color = this._terrainColor(tile.terrain);
        g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill(color);
      }
    }

    // 格子轮廓（统一一遍描边，半透明深色网格线让格子有形状）
    if (drawGrid) {
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          const tile = this.tileIndex.get(`${x},${y}`);
          if (!tile) continue;
          g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX)
            .stroke({ width: 1, color: 0x000000, alpha: 0.18 });
        }
      }
    }
  }

  /** 妖兽按阶位 1→9 由橙红渐变到紫 */
  _monsterColor(grade) {
    const g = grade || 1;
    const palette = [0xff8a65, 0xff7043, 0xf4511e, 0xd84315, 0xbf360c,
                     0xad1457, 0x8e24aa, 0x6a1b9a, 0x4a148c];
    return palette[Math.min(g - 1, palette.length - 1)];
  }

  /**
   * NPC 按所属势力上色：以阵营主题色为基调，按 factionId 哈希微扰色相/明度，
   * 使同阵营的不同势力可区分；散修（无 factionId）用白色。带缓存。
   */
  _npcColor(factionId) {
    if (!factionId) return 0xffffff; // 散修：白
    if (!this._npcColorCache) this._npcColorCache = new Map();
    if (this._npcColorCache.has(factionId)) return this._npcColorCache.get(factionId);

    const type = this.factionTypes.get(factionId);
    const base = hexToInt(themeColorOf(type));
    // 哈希出 [-1,1] 的扰动，调整 HSL 明度与色相
    let h = 0;
    for (let i = 0; i < factionId.length; i++) h = (h * 31 + factionId.charCodeAt(i)) >>> 0;
    const jitterL = ((h % 100) / 100 - 0.5) * 0.28;      // 明度扰动
    const jitterH = (((h >> 7) % 100) / 100 - 0.5) * 0.10; // 色相扰动
    const color = this._adjustColor(base, jitterH, jitterL);
    this._npcColorCache.set(factionId, color);
    return color;
  }

  /** 对 0xRRGGBB 在 HSL 空间做色相(dh)/明度(dl)微调，返回 0xRRGGBB */
  _adjustColor(int, dh, dl) {
    let r = (int >> 16) & 0xff, g = (int >> 8) & 0xff, b = int & 0xff;
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hsl_h = 0, s = 0; const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hsl_h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) hsl_h = ((b - r) / d + 2) / 6;
      else hsl_h = ((r - g) / d + 4) / 6;
    }
    hsl_h = (hsl_h + dh + 1) % 1;
    const nl = Math.max(0.12, Math.min(0.92, l + dl));
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s;
    const p = 2 * nl - q;
    const nr = Math.round(hue2rgb(p, q, hsl_h + 1 / 3) * 255);
    const ng = Math.round(hue2rgb(p, q, hsl_h) * 255);
    const nb = Math.round(hue2rgb(p, q, hsl_h - 1 / 3) * 255);
    return (nr << 16) | (ng << 8) | nb;
  }

  /** 画小人图标（头 + 身体），用于 NPC */
  _drawPerson(g, cx, cy, r, color, outline) {
    const headR = r * 0.42;
    const headY = cy - r * 0.5;
    // 身体（梯形/钟形：用三角近似）
    g.poly([
      cx, headY,
      cx + r * 0.7, cy + r * 0.8,
      cx - r * 0.7, cy + r * 0.8,
    ]).fill(color);
    // 头
    g.circle(cx, headY, headR).fill(color);
    if (outline) {
      g.circle(cx, headY, headR).stroke({ width: 1, color: outline, alpha: 0.9 });
    }
  }

  /** 画牛头图标（脸 + 两只角），用于妖兽 */
  _drawBullHead(g, cx, cy, r, color, outline) {
    // 牛脸（略宽的椭圆，用圆近似 + 下巴）
    g.circle(cx, cy + r * 0.15, r * 0.62).fill(color);
    g.poly([
      cx - r * 0.4, cy + r * 0.2,
      cx + r * 0.4, cy + r * 0.2,
      cx, cy + r * 0.85,
    ]).fill(color);
    // 左角
    g.poly([
      cx - r * 0.5, cy - r * 0.15,
      cx - r * 1.05, cy - r * 0.75,
      cx - r * 0.78, cy - r * 0.78,
      cx - r * 0.3, cy - r * 0.35,
    ]).fill(color);
    // 右角
    g.poly([
      cx + r * 0.5, cy - r * 0.15,
      cx + r * 1.05, cy - r * 0.75,
      cx + r * 0.78, cy - r * 0.78,
      cx + r * 0.3, cy - r * 0.35,
    ]).fill(color);
    if (outline) {
      g.circle(cx, cy + r * 0.15, r * 0.62).stroke({ width: 1, color: outline, alpha: 0.85 });
    }
  }

  _drawEntities() {
    const g = this.entityGfx;
    g.clear();
    const snap = this._lastSnapshot;
    const scale = this.worldContainer.scale.x;
    const r = Math.max(2.5, 6 / scale * 0.6 + 2.5);
    // 缩放很小时图标退化为圆点（细节看不清也更省）
    const detailed = scale >= 0.22;

    // 视口裁剪范围（格），超出范围的实体不绘制，避免全图时画满数百实体
    const { x1, y1, x2, y2 } = this._visibleTileRange();
    const inView = (tx, ty) => tx >= x1 - 1 && tx <= x2 + 1 && ty >= y1 - 1 && ty <= y2 + 1;

    for (const [id, e] of Object.entries(snap.npcs || {})) {
      const p = this._entityPos.get(id);
      if (!p) continue;
      const tx = p.fromX + (p.toX - p.fromX) * p.t;
      const ty = p.fromY + (p.toY - p.fromY) * p.t;
      if (!inView(tx, ty)) continue;
      const x = tx * TILE_PX + TILE_PX / 2;
      const y = ty * TILE_PX + TILE_PX / 2;
      const color = this._npcColor(e.factionId);
      if (detailed) this._drawPerson(g, x, y, r, color, e.factionId ? 0x1a1a1a : 0x555555);
      else g.circle(x, y, r * 0.7).fill(color);
      if (id === this._followId) g.circle(x, y, r + 5).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    }

    for (const [id, e] of Object.entries(snap.monsters || {})) {
      const p = this._entityPos.get(id);
      if (!p) continue;
      const tx = p.fromX + (p.toX - p.fromX) * p.t;
      const ty = p.fromY + (p.toY - p.fromY) * p.t;
      if (!inView(tx, ty)) continue;
      const x = tx * TILE_PX + TILE_PX / 2;
      const y = ty * TILE_PX + TILE_PX / 2;
      const color = this._monsterColor(e.grade);
      if (detailed) this._drawBullHead(g, x, y, r * 1.05, color, 0x1a1a1a);
      else g.circle(x, y, r * 0.7).fill(color);
      if (id === this._followId) g.circle(x, y, r + 5).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    }

    // 机会点（ADR-024）：江湖热点，以金色菱形标注，便于观察"群体涌向热点"现象。
    // 默认禁用态 opportunities 为空，不绘制。
    for (const opp of (snap.opportunities || [])) {
      const tx = opp.pos?.x, ty = opp.pos?.y;
      if (typeof tx !== 'number' || !inView(tx, ty)) continue;
      const x = tx * TILE_PX + TILE_PX / 2;
      const y = ty * TILE_PX + TILE_PX / 2;
      const rr = r + 3;
      const color = this._opportunityColor(opp.type);
      g.poly([x, y - rr, x + rr, y, x, y + rr, x - rr, y]).fill({ color, alpha: 0.85 });
      g.poly([x, y - rr, x + rr, y, x, y + rr, x - rr, y]).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
    }
  }

  /** 机会点类型 → 标注颜色。 */
  _opportunityColor(type) {
    switch (type) {
      case 'secret_realm': return 0x9b59ff;   // 秘境：紫
      case 'monster_corpse': return 0xff7043;  // 妖兽尸骸：橙红
      case 'auction': return 0xffd54f;         // 拍卖会：金
      case 'treasure': return 0x66ddaa;        // 天材地宝：青绿
      case 'wealth_target': return 0xff4081;   // 怀璧之人：洋红
      default: return 0xffd700;
    }
  }

  destroy() {
    this._destroyed = true;
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this._entityPos.clear();
  }
}
