export class MapCanvasView {
  constructor({ model, datasets = {}, onSelect = () => {}, onPreviewSelection = () => {} }) {
    this.model = model;
    this.datasets = datasets;
    this.onSelect = onSelect;
    this.onPreviewSelection = onPreviewSelection;
    this.selectedTile = null;
    this.selection = null;
    this.dragStart = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-editor-canvas';
    this.canvas.width = 720;
    this.canvas.height = 720;
    this.context = this.canvas.getContext('2d');

    this.bindEvents();
  }

  static isSupported() {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return Boolean(canvas?.getContext?.('2d'));
  }

  getElement() {
    return this.canvas;
  }

  setDatasets(datasets) {
    this.datasets = datasets || {};
    this.draw();
  }

  setSelectedTile(tile) {
    this.selectedTile = tile;
    this.draw();
  }

  clearSelection() {
    this.selection = null;
    this.dragStart = null;
    this.draw();
  }

  draw() {
    const ctx = this.context;
    if (!ctx) return;

    this.resizeForDisplay();
    const { cellWidth, cellHeight } = this.getCellMetrics();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const terrainColors = createTerrainColorMap(this.datasets.terrains);
    const ownerColors = createOwnerColorMap(this.datasets.factions);

    for (const tile of this.model.getTiles()) {
      const x = Number(tile.x) * cellWidth;
      const y = Number(tile.y) * cellHeight;
      ctx.fillStyle = terrainColors.get(tile.terrain) || '#9b927d';
      ctx.fillRect(x, y, Math.ceil(cellWidth) + 0.5, Math.ceil(cellHeight) + 0.5);

      if (tile.ownerId) {
        ctx.fillStyle = ownerColors.get(tile.ownerId) || 'rgba(47, 95, 143, 0.28)';
        ctx.fillRect(x, y, Math.ceil(cellWidth) + 0.5, Math.ceil(cellHeight) + 0.5);
      }
    }

    this.drawSelection(ctx, cellWidth, cellHeight);
    this.drawGrid(ctx, cellWidth, cellHeight);
  }

  resizeForDisplay() {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.floor(rect.width || this.canvas.clientWidth || 720));
    const cssHeight = Math.max(280, Math.floor(rect.height || this.canvas.clientHeight || cssWidth * 0.72));
    const scale = window.devicePixelRatio || 1;
    const nextWidth = Math.floor(cssWidth * scale);
    const nextHeight = Math.floor(cssHeight * scale);

    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth;
      this.canvas.height = nextHeight;
    }
  }

  getCellMetrics() {
    return {
      cellWidth: this.canvas.width / Math.max(1, this.model.width),
      cellHeight: this.canvas.height / Math.max(1, this.model.height)
    };
  }

  getTilePoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const offsetX = (event.clientX - rect.left) / Math.max(1, rect.width);
    const offsetY = (event.clientY - rect.top) / Math.max(1, rect.height);

    return {
      x: clamp(Math.floor(offsetX * this.model.width), 0, this.model.width - 1),
      y: clamp(Math.floor(offsetY * this.model.height), 0, this.model.height - 1)
    };
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragStart = this.getTilePoint(event);
      this.selection = { ...this.dragStart, width: 1, height: 1 };
      this.onPreviewSelection(this.selection);
      this.draw();
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragStart) return;
      this.selection = createRectFromPoints(this.dragStart, this.getTilePoint(event));
      this.onPreviewSelection(this.selection);
      this.draw();
    });

    this.canvas.addEventListener('pointerup', (event) => {
      if (!this.dragStart) return;
      this.selection = createRectFromPoints(this.dragStart, this.getTilePoint(event));
      this.dragStart = null;
      this.onSelect(this.selection);
      this.draw();
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.cancelDrag();
    });

    this.canvas.addEventListener('pointercancel', () => {
      this.cancelDrag();
    });

    this.canvas.addEventListener('lostpointercapture', () => {
      this.cancelDrag();
    });
  }

  cancelDrag() {
      if (!this.dragStart) return;
      this.dragStart = null;
      this.selection = null;
      this.onPreviewSelection(null);
      this.draw();
  }

  drawGrid(ctx, cellWidth, cellHeight) {
    if (cellWidth < 6 || cellHeight < 6) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(21, 24, 20, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= this.model.width; x++) {
      const px = Math.round(x * cellWidth) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, this.canvas.height);
    }
    for (let y = 0; y <= this.model.height; y++) {
      const py = Math.round(y * cellHeight) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(this.canvas.width, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawSelection(ctx, cellWidth, cellHeight) {
    const rect = this.selection || (this.selectedTile ? {
      x: this.selectedTile.x,
      y: this.selectedTile.y,
      width: 1,
      height: 1
    } : null);
    if (!rect) return;

    ctx.save();
    ctx.lineWidth = Math.max(2, Math.min(cellWidth, cellHeight) * 0.16);
    ctx.strokeStyle = '#f7ecd2';
    ctx.fillStyle = 'rgba(247, 236, 210, 0.16)';
    ctx.fillRect(rect.x * cellWidth, rect.y * cellHeight, rect.width * cellWidth, rect.height * cellHeight);
    ctx.strokeRect(rect.x * cellWidth, rect.y * cellHeight, rect.width * cellWidth, rect.height * cellHeight);
    ctx.restore();
  }
}

function createTerrainColorMap(terrains = []) {
  return new Map((terrains || []).map((terrain) => [terrain.type, terrain.color]));
}

function createOwnerColorMap(factions = []) {
  const colors = new Map();
  (factions || []).forEach((faction, index) => {
    colors.set(faction.id, getOwnerColor(index));
  });
  return colors;
}

function getOwnerColor(index) {
  const hue = (index * 53 + 202) % 360;
  return `hsla(${hue}, 58%, 42%, 0.32)`;
}

function createRectFromPoints(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(start.x - end.x) + 1,
    height: Math.abs(start.y - end.y) + 1
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
