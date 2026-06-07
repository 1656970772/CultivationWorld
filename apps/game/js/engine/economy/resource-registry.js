function asList(value) {
  return Array.isArray(value) ? value : [];
}

function positiveNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export class ResourceRegistry {
  constructor({ resources = [], organizationPointKeys = [] } = {}) {
    this._resources = new Map();
    this._factionStateResourceIds = new Set();
    this._organizationPointKeys = new Set(organizationPointKeys);
    for (const resource of resources) this.register(resource);
  }

  static fromConfig(config = {}) {
    const assets = config?.assets || {};
    const resources = asList(assets.factionStateResourceIds).map(id => ({
      id,
      resourceKind: 'faction_state',
    }));
    return new ResourceRegistry({
      resources,
      organizationPointKeys: asList(assets.organizationPointKeys),
    });
  }

  static fromDefinitions({ macroResources = [], itemDefs = {}, organizationPointKeys = [] } = {}) {
    const resources = [];
    for (const resource of asList(macroResources)) {
      resources.push({
        ...resource,
        resourceKind: resource.resourceKind || 'faction_state',
      });
    }
    for (const item of asList(itemDefs.items)) {
      if (item.category !== 'currency') continue;
      resources.push({
        ...item,
        resourceKind: item.resourceKind || 'faction_state',
      });
    }
    return new ResourceRegistry({ resources, organizationPointKeys });
  }

  static fromResourceIds(resourceIds = [], organizationPointKeys = []) {
    return new ResourceRegistry({
      resources: asList(resourceIds).map(id => ({ id, resourceKind: 'faction_state' })),
      organizationPointKeys,
    });
  }

  register(resource = {}) {
    if (!resource.id) return;
    const normalized = { ...resource };
    this._resources.set(normalized.id, normalized);
    if (normalized.resourceKind === 'faction_state' || normalized.factionState === true) {
      this._factionStateResourceIds.add(normalized.id);
    }
  }

  get(id) {
    return this._resources.get(id) || null;
  }

  has(id) {
    return this._resources.has(id);
  }

  isFactionStateResource(id) {
    return this._factionStateResourceIds.has(id);
  }

  isOrganizationPoint(key) {
    return this._organizationPointKeys.has(key);
  }

  factionStateResourceIds() {
    return Array.from(this._factionStateResourceIds);
  }

  organizationPointKeys() {
    return Array.from(this._organizationPointKeys);
  }

  initialStateFrom(resources = {}) {
    const initial = {};
    for (const id of this._factionStateResourceIds) {
      if (Object.prototype.hasOwnProperty.call(resources, id)) {
        initial[id] = positiveNumber(resources[id]);
      }
    }
    return initial;
  }
}
