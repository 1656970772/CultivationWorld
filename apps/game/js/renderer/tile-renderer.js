/**
 * TileRenderer - PixiJS Chunk 烘焙器
 * 将 16×16 的 tile chunk 烘焙为 PIXI.RenderTexture，提供给 Renderer 使用
 */

const TILE_PX = 24; // 基准格子像素大小
export const CHUNK_SIZE = 16; // 每个 chunk 的格子数

const DEFAULT_TERRAIN_COLOR = 0x888888;
const DEFAULT_FACTION_COLOR = 0xcccccc;

function _parsePresentationColor(definition) {
  const color = definition?.presentation?.color;
  if (typeof color !== 'string') return null;

  const normalized = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;

  return parseInt(normalized, 16);
}

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
    this._terrainColorMap.clear();
    this._factionColorMap.clear();

    if (Array.isArray(terrains)) {
      for (const t of terrains) {
        const type = t.type || t.id;
        const color = _parsePresentationColor(t);
        if (type && color !== null) {
          this._terrainColorMap.set(type, color);
        }
      }
    }

    if (Array.isArray(factions)) {
      for (const f of factions) {
        const color = _parsePresentationColor(f);
        if (f.id && color !== null) {
          this._factionColorMap.set(f.id, color);
        }
      }
    }
  }

  _getTerrainColor(terrain) {
    return this._terrainColorMap.get(terrain) ?? DEFAULT_TERRAIN_COLOR;
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
          const fColor = this._factionColorMap.get(tile.ownerId) ?? DEFAULT_FACTION_COLOR;
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
