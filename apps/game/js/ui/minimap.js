const FACTION_COLORS = {
  'sect_001': '#5DADE2',  // 青云宗 - 天蓝
  'sect_002': '#BDC3C7',  // 天剑宗 - 银白
  'sect_003': '#F4D03F',  // 玄真观 - 金黄
  'sect_004': '#E74C3C',  // 血煞门 - 深红
  'sect_005': '#8E44AD',  // 幽冥教 - 暗紫
  'sect_006': '#27AE60',  // 毒蝎帮 - 毒绿
  'sect_007': '#2ECC71',  // 药王谷 - 翠绿
  'sect_008': '#3498DB',  // 天机阁 - 靛蓝
  'sect_009': '#E67E22',  // 万妖山 - 橙红
  'sect_010': '#795548',  // 蛮蛟族 - 深棕
  'sect_011': '#FFD700',  // 大晋王朝 - 明黄
  'sect_012': '#1ABC9C',  // 南越国 - 青色
};

export class Minimap {
  constructor(containerId) {
    this.container = document.getElementById(containerId);

    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.mapData = null;
    this.playerState = null;
    this.factionColors = {};
    this.terrainColors = {};
    this.onNavigate = null;

    this.canvas.addEventListener('click', (e) => {
      if (!this.mapData || !this.onNavigate) return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.mapData.width / this.canvas.width;
      const scaleY = this.mapData.height / this.canvas.height;
      const worldX = Math.floor((e.clientX - rect.left) * scaleX);
      const worldY = Math.floor((e.clientY - rect.top) * scaleY);
      this.onNavigate(worldX, worldY);
    });
  }

  init(mapData, terrains, factions) {
    this.mapData = mapData;
    this.canvas.width = this.container.clientWidth;
    this.canvas.height = this.container.clientHeight;

    for (const t of terrains) {
      this.terrainColors[t.type] = t.color;
    }

    for (const f of factions) {
      this.factionColors[f.id] = FACTION_COLORS[f.id] || '#888';
    }
  }

  render(playerState) {
    if (!this.mapData) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    const scaleX = w / this.mapData.width;
    const scaleY = h / this.mapData.height;

    for (const tile of this.mapData.tiles) {
      const px = Math.floor(tile.x * scaleX);
      const py = Math.floor(tile.y * scaleY);
      const pw = Math.max(1, Math.ceil(scaleX));
      const ph = Math.max(1, Math.ceil(scaleY));

      ctx.fillStyle = this.terrainColors[tile.terrain] || '#333';
      ctx.fillRect(px, py, pw, ph);

      if (tile.ownerId && this.factionColors[tile.ownerId]) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = this.factionColors[tile.ownerId];
        ctx.fillRect(px, py, pw, ph);
        ctx.globalAlpha = 1.0;
      }
    }

    if (playerState) {
      const px = Math.floor(playerState.x * scaleX);
      const py = Math.floor(playerState.y * scaleY);
      ctx.fillStyle = '#00ff88';
      ctx.fillRect(px - 2, py - 2, 5, 5);
    }
  }
}
