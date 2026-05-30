export class TileMapModel {
  constructor(map) {
    this.map = map || { width: 0, height: 0, tiles: [] };
    if (!Array.isArray(this.map.tiles)) this.map.tiles = [];
    this.width = Number(this.map.width || 0);
    this.height = Number(this.map.height || 0);
    this.tileIndex = new Map();
    this.rebuildIndex();
  }

  rebuildIndex() {
    this.tileIndex.clear();
    for (const tile of this.map.tiles) {
      if (tile == null) continue;
      this.tileIndex.set(createTileKey(tile.x, tile.y), tile);
    }
  }

  getTile(x, y) {
    return this.tileIndex.get(createTileKey(x, y)) || null;
  }

  paintTile(x, y, patch) {
    const tile = this.getTile(x, y);
    const change = this.createPatch(tile, patch);
    if (!change) return [];
    return this.applyChanges([change]);
  }

  paintRect(rect, patch) {
    const range = normalizeRect(rect, this.width, this.height);
    const changes = [];

    for (let y = range.y1; y <= range.y2; y++) {
      for (let x = range.x1; x <= range.x2; x++) {
        const change = this.createPatch(this.getTile(x, y), patch);
        if (change) changes.push(change);
      }
    }

    return this.applyChanges(changes);
  }

  createPatch(tile, patch) {
    if (!tile || !patch || typeof patch !== 'object') return null;
    const before = {};
    const after = {};

    for (const [key, value] of Object.entries(patch)) {
      if (valuesEqual(tile[key], value)) continue;
      before[key] = cloneValue(tile[key]);
      after[key] = cloneValue(value);
    }

    if (Object.keys(after).length === 0) return null;
    return {
      x: tile.x,
      y: tile.y,
      tile,
      before,
      after
    };
  }

  applyChanges(changes, direction = 'after') {
    if (!Array.isArray(changes) || changes.length === 0) return [];

    for (const change of changes) {
      const tile = change.tile || this.getTile(change.x, change.y);
      if (!tile) continue;
      const patch = direction === 'before' ? change.before : change.after;
      applyPatchToTile(tile, patch);
    }

    return changes;
  }

  getTiles() {
    return this.map.tiles;
  }
}

export function createTileKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function normalizeRect(rect, width, height) {
  const hasBounds = rect.x1 != null || rect.x2 != null || rect.y1 != null || rect.y2 != null;
  const rawX1 = hasBounds ? Number(rect.x1 ?? rect.x ?? 0) : Number(rect.x ?? 0);
  const rawY1 = hasBounds ? Number(rect.y1 ?? rect.y ?? 0) : Number(rect.y ?? 0);
  const rawX2 = hasBounds ? Number(rect.x2 ?? rect.x ?? 0) : rawX1 + Math.max(1, Number(rect.width ?? 1)) - 1;
  const rawY2 = hasBounds ? Number(rect.y2 ?? rect.y ?? 0) : rawY1 + Math.max(1, Number(rect.height ?? 1)) - 1;

  return {
    x1: clamp(Math.min(rawX1, rawX2), 0, Math.max(0, width - 1)),
    y1: clamp(Math.min(rawY1, rawY2), 0, Math.max(0, height - 1)),
    x2: clamp(Math.max(rawX1, rawX2), 0, Math.max(0, width - 1)),
    y2: clamp(Math.max(rawY1, rawY2), 0, Math.max(0, height - 1))
  };
}

function applyPatchToTile(tile, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) delete tile[key];
    else tile[key] = cloneValue(value);
  }
}

function cloneValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (left == null || right == null) return left === right;
  if (typeof left !== 'object' || typeof right !== 'object') return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
