function tileFields(adapter = null) {
  return {
    terrain: adapter?.tileFields?.terrain || 'terrain',
    owner: adapter?.tileFields?.owner || 'ownerId',
    resource: adapter?.tileFields?.resource || 'resourceType',
    buildings: adapter?.tileFields?.buildings || 'buildings',
  };
}

export function createMapSummary(map, datasets = {}, adapter = null) {
  const fields = tileFields(adapter);
  const terrainCounts = {};
  const ownerCounts = { unowned: 0 };
  let resourceTileCount = 0;
  let buildingTileCount = 0;

  for (const tile of map.tiles || []) {
    const terrainKey = tile[fields.terrain] || 'unknown';
    terrainCounts[terrainKey] = (terrainCounts[terrainKey] || 0) + 1;

    const ownerId = tile[fields.owner];
    if (ownerId) {
      ownerCounts[ownerId] = (ownerCounts[ownerId] || 0) + 1;
    } else {
      ownerCounts.unowned++;
    }

    if (tile[fields.resource]) resourceTileCount++;
    const buildings = tile[fields.buildings];
    if (Array.isArray(buildings) && buildings.length > 0) buildingTileCount++;
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
