export function createMapSummary(map, datasets = {}) {
  const terrainCounts = {};
  const ownerCounts = { unowned: 0 };
  let resourceTileCount = 0;
  let buildingTileCount = 0;

  for (const tile of map.tiles || []) {
    const terrainKey = tile.terrain || 'unknown';
    terrainCounts[terrainKey] = (terrainCounts[terrainKey] || 0) + 1;

    if (tile.ownerId) {
      ownerCounts[tile.ownerId] = (ownerCounts[tile.ownerId] || 0) + 1;
    } else {
      ownerCounts.unowned++;
    }

    if (tile.resourceType) resourceTileCount++;
    if (Array.isArray(tile.buildings) && tile.buildings.length > 0) buildingTileCount++;
  }

  return {
    width: map.width,
    height: map.height,
    tileCount: Array.isArray(map.tiles) ? map.tiles.length : 0,
    expectedTileCount: Number(map.width || 0) * Number(map.height || 0),
    terrainCounts,
    ownerCounts,
    resourceTileCount,
    buildingTileCount
  };
}

export function createRecordPreviewText(datasetKey, item, datasets = {}) {
  if (datasetKey === 'map') {
    return JSON.stringify(createMapSummary(item || {}, datasets), null, 2);
  }
  return JSON.stringify(item || {}, null, 2);
}
