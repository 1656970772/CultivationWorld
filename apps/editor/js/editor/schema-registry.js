const DEFAULT_ASSET_BASE = 'data/';
const GAME_DATA_PREFIX = 'apps/game/data/';

let defaultRegistryPromise = null;

export async function loadDeclarativeRegistry(options = {}) {
  const assetBase = options.assetBase || DEFAULT_ASSET_BASE;
  if (!options.forceReload && assetBase === DEFAULT_ASSET_BASE && defaultRegistryPromise) {
    return defaultRegistryPromise;
  }

  const loadPromise = (async () => {
    const [datasetsConfig, referencesConfig, fieldsConfig, categoriesConfig] = await Promise.all([
      readJsonAsset(`${assetBase}schemas/datasets.json`),
      readJsonAsset(`${assetBase}schemas/references.json`),
      readJsonAsset(`${assetBase}schemas/fields.json`),
      readJsonAsset(`${assetBase}ui/dataset-categories.json`),
    ]);
    const datasets = datasetsConfig.datasets || [];
    const [templates, adapters] = await Promise.all([
      loadTemplates(datasets, assetBase),
      loadAdapters(datasets, assetBase),
    ]);
    return buildRegistry({
      datasetsConfig,
      referencesConfig,
      fieldsConfig,
      categoriesConfig,
      templates,
      adapters,
    });
  })();

  if (assetBase === DEFAULT_ASSET_BASE) defaultRegistryPromise = loadPromise;
  return loadPromise;
}

function buildRegistry({
  datasetsConfig,
  referencesConfig,
  fieldsConfig,
  categoriesConfig,
  templates,
  adapters,
}) {
  const optionSets = referencesConfig.optionSets || {};
  const referenceDefs = referencesConfig.references || {};
  const categoryEntries = categoriesConfig.categories || [];
  const categoryMap = Object.fromEntries(categoryEntries.map((category) => [category.key, category]));

  const schemas = {};
  const datasets = (datasetsConfig.datasets || []).map((dataset) => {
    const relativePath = toGameDataRelativePath(dataset.path);
    const adapterConfig = adapters[dataset.key] || null;
    const fields = resolveFieldOptions(
      fieldsConfig.fields?.[dataset.key] || [],
      optionSets,
      adapterConfig,
    );
    const schema = {
      ...dataset,
      file: dataset.path,
      sourcePath: dataset.path,
      relativePath,
      fields,
      adapterConfig,
      emptyItem: cloneJson(templates[dataset.key] || {}),
      reference: referenceDefs[dataset.key] || null,
    };
    schemas[dataset.key] = schema;
    for (const alias of dataset.aliases || []) {
      schemas[alias] = {
        ...schema,
        key: alias,
        canonicalKey: dataset.key,
      };
    }
    return schema;
  });

  const categories = categoryEntries
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  return {
    datasets,
    schemas,
    references: referenceDefs,
    optionSets,
    categories,
    categoryMap,
    order: datasets.map((dataset) => dataset.key),
  };
}

async function loadTemplates(datasets, assetBase) {
  const templates = {};
  await Promise.all(datasets.map(async (dataset) => {
    if (!dataset.template) return;
    templates[dataset.key] = await readJsonAsset(normalizeAssetPath(dataset.template, assetBase));
  }));
  return templates;
}

async function loadAdapters(datasets, assetBase) {
  const adapters = {};
  await Promise.all(datasets.map(async (dataset) => {
    if (!dataset.adapter) return;
    adapters[dataset.key] = await readJsonAsset(normalizeAssetPath(dataset.adapter, assetBase));
  }));
  return adapters;
}

function resolveFieldOptions(fields, optionSets, adapterConfig = null) {
  return fields.map((field) => {
    const next = { ...field };
    if (next.type === 'tileSummary' && adapterConfig) {
      next.adapterConfig = cloneJson(adapterConfig);
    }
    if (next.optionsRef) {
      next.options = cloneJson(optionSets[next.optionsRef] || []);
      delete next.optionsRef;
    }
    if (Array.isArray(next.fields)) next.fields = resolveFieldOptions(next.fields, optionSets, adapterConfig);
    if (Array.isArray(next.itemFields)) next.itemFields = resolveFieldOptions(next.itemFields, optionSets, adapterConfig);
    return next;
  });
}

async function readJsonAsset(assetPath) {
  if (isBrowserRuntime()) {
    const response = await fetch(assetPath, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`failed to load registry asset ${assetPath}: ${response.status}`);
    }
    return response.json();
  }

  const { readFile } = await import('node:fs/promises');
  const url = new URL(`../../${assetPath}`, import.meta.url);
  const text = await readFile(url, 'utf-8');
  return JSON.parse(text);
}

function normalizeAssetPath(path, assetBase) {
  if (path.startsWith(assetBase)) return path;
  if (path.startsWith(DEFAULT_ASSET_BASE)) {
    return `${assetBase}${path.slice(DEFAULT_ASSET_BASE.length)}`;
  }
  return path;
}

function toGameDataRelativePath(path) {
  if (!path?.startsWith(GAME_DATA_PREFIX)) return path || '';
  return path.slice(GAME_DATA_PREFIX.length);
}

function isBrowserRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const DEFAULT_REGISTRY = await loadDeclarativeRegistry();

export const DATASET_SCHEMAS = DEFAULT_REGISTRY.schemas;
export const DATASET_ORDER = DEFAULT_REGISTRY.order;
export const DATASET_CATEGORIES = DEFAULT_REGISTRY.categories;
export const DATASET_REFERENCES = DEFAULT_REGISTRY.references;

export function getDatasetSchema(datasetKey) {
  return DATASET_SCHEMAS[datasetKey] || null;
}

export function getDatasetLabel(datasetKey) {
  return DATASET_SCHEMAS[datasetKey]?.label || datasetKey;
}

export function getCategoryLabel(categoryKey) {
  return DEFAULT_REGISTRY.categoryMap[categoryKey]?.label || categoryKey;
}

export function getCategoryOrder(categoryKey) {
  return DEFAULT_REGISTRY.categoryMap[categoryKey]?.order ?? 999;
}

export function getSchemaKey(schema, item) {
  if (!schema?.keyField) return schema?.key || '';
  return item?.[schema.keyField] ?? '';
}

export function cloneEmptyItem(schema) {
  return cloneJson(schema?.emptyItem || {});
}
