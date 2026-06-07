const PRESENTATION_DATA_EVENT = 'cultivation-world:presentation-data';

function _getPresentationColor(definition) {
  return definition?.presentation?.color;
}

function _publishPresentationData(terrains, factions) {
  const detail = {
    terrains: Array.isArray(terrains) ? terrains : [],
    factions: Array.isArray(factions) ? factions : [],
  };
  globalThis.__cultivationWorldPresentationData = detail;

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    const EventCtor = window.CustomEvent || globalThis.CustomEvent;
    if (EventCtor) {
      window.dispatchEvent(new EventCtor(PRESENTATION_DATA_EVENT, { detail }));
    }
  }
}

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
    this.factionColors = {};
    this.terrainColors = {};
    _publishPresentationData(terrains, factions);

    for (const t of terrains || []) {
      const terrainType = t.type || t.id;
      const color = _getPresentationColor(t);
      if (terrainType && color) {
        this.terrainColors[terrainType] = color;
      }
    }

    for (const f of factions || []) {
      const color = _getPresentationColor(f);
      if (f.id && color) {
        this.factionColors[f.id] = color;
      }
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
