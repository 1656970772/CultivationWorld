/**
 * TileRenderer - PixiJS Chunk 烘焙器
 * 将 16×16 的 tile chunk 烘焙为 PIXI.RenderTexture，提供给 Renderer 使用
 */

const TILE_PX = 24; // 基准格子像素大小
export const CHUNK_SIZE = 16; // 每个 chunk 的格子数

// 地形颜色表（十六进制数字格式）
const TERRAIN_COLORS = {
  plain:            0xa0c468,
  mountain:         0x9a8462,
  forest:           0x367030,
  river:            0x5a9de5,
  swamp:            0x6b7a48,
  desert:           0xd4b85a,
  low_spirit_vein:  0xb89fd4,
  mid_spirit_vein:  0xa45ec0,
  high_spirit_vein: 0x7b2fa0,
  top_spirit_vein:  0x5a107a,
};

// 势力颜色池（与 minimap.js 保持一致）
const FACTION_COLOR_MAP = {
  sect_001: 0x5dade2,
  sect_002: 0xbdc3c7,
  sect_003: 0xf4d03f,
  sect_004: 0xe74c3c,
  sect_005: 0x8e44ad,
  sect_006: 0x27ae60,
  sect_007: 0x2ecc71,
  sect_008: 0x3498db,
  sect_009: 0xe67e22,
  sect_010: 0x795548,
  sect_011: 0xffd700,
  sect_012: 0x1abc9c,
};

// 未知势力的备用颜色池
const FALLBACK_PALETTE = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12,
  0x9b59b6, 0x1abc9c, 0xe67e22, 0x34495e,
  0xec407a, 0x26c6da, 0x66bb6a, 0xffa726,
];

export class TileRenderer {
  constructor() {
    this._pixiApp = null;
    this._factionColorMap = new Map(); // factionId → 0xRRGGBB
    this._terrainColorMap = new Map(); // terrain → 0xRRGGBB（含 json 覆盖）
  }

  /**
   * 初始化：传入 PixiJS app 实例和数据
   * @param {PIXI.Application} pixiApp
   * @param {Array} terrains  terrains.json 中的地形数组
   * @param {Array} factions  factions 数组
   */
  init(pixiApp, terrains, factions) {
    this._pixiApp = pixiApp;

    // 载入内置颜色，再用 json 中的 color 字段覆盖（如果有）
    for (const [type, color] of Object.entries(TERRAIN_COLORS)) {
      this._terrainColorMap.set(type, color);
    }
    if (Array.isArray(terrains)) {
      for (const t of terrains) {
        if (t.type && t.color) {
          const hex = parseInt(t.color.replace('#', ''), 16);
          this._terrainColorMap.set(t.type, hex);
        }
      }
    }

    // 分配势力颜色：优先使用预定义表，其次按顺序分配备用色
    if (Array.isArray(factions)) {
      let fallbackIdx = 0;
      for (const f of factions) {
        if (FACTION_COLOR_MAP[f.id] !== undefined) {
          this._factionColorMap.set(f.id, FACTION_COLOR_MAP[f.id]);
        } else {
          this._factionColorMap.set(f.id, FALLBACK_PALETTE[fallbackIdx % FALLBACK_PALETTE.length]);
          fallbackIdx++;
        }
      }
    }
  }

  _getTerrainColor(terrain) {
    return this._terrainColorMap.get(terrain) ?? 0x888888;
  }

  /**
   * 烘焙一个 chunk 为 RenderTexture
   * @param {number} cx chunk X 索引
   * @param {number} cy chunk Y 索引
   * @param {Array<Array>} tileGrid  tileGrid[y][x] 格子数据（世界坐标索引）
   * @param {PIXI.RenderTexture|null} existingTexture 复用已有纹理（避免创建新对象）
   * @returns {PIXI.RenderTexture}
   */
  bakeChunk(cx, cy, tileGrid, existingTexture = null) {
    const { Graphics, RenderTexture } = window.PIXI;
    const g = new Graphics();

    const worldX = cx * CHUNK_SIZE;
    const worldY = cy * CHUNK_SIZE;
    const chunkPx = CHUNK_SIZE * TILE_PX;

    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const gx = worldX + tx;
        const gy = worldY + ty;
        const tile = tileGrid[gy]?.[gx];
        if (!tile) continue;

        const color = this._getTerrainColor(tile.terrain);
        const px = tx * TILE_PX;
        const py = ty * TILE_PX;

        // 地形底色
        g.rect(px, py, TILE_PX, TILE_PX).fill(color);

        // 势力颜色条（底部 4px）
        if (tile.ownerId) {
          const fColor = this._factionColorMap.get(tile.ownerId) ?? 0xcccccc;
          g.rect(px, py + TILE_PX - 4, TILE_PX, 4).fill({ color: fColor, alpha: 0.85 });

          // 边框描边
          g.rect(px, py, TILE_PX, TILE_PX).stroke({ color: fColor, width: 1, alpha: 0.5 });
        }

        // 网格线（右边和下边 1px 暗线）
        g.rect(px + TILE_PX - 1, py, 1, TILE_PX).fill({ color: 0x000000, alpha: 0.12 });
        g.rect(px, py + TILE_PX - 1, TILE_PX, 1).fill({ color: 0x000000, alpha: 0.12 });
      }
    }

    if (existingTexture) {
      this._pixiApp.renderer.render({
        container: g,
        target: existingTexture,
        clear: true,
      });
      g.destroy();
      return existingTexture;
    } else {
      const texture = RenderTexture.create({ width: chunkPx, height: chunkPx });
      this._pixiApp.renderer.render({ container: g, target: texture, clear: true });
      g.destroy();
      return texture;
    }
  }
}
