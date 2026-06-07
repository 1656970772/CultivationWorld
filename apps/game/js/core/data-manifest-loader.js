/**
 * DataManifestLoader - manifest 驱动的运行时 JSON 数据加载器。
 *
 * 文件清单、目录组与合并规则均来自 data/config/data-manifest.json；
 * 代码只解释这些通用规则，不维护业务数据文件列表。
 */

export const DEFAULT_DATA_MANIFEST_PATH = 'data/config/data-manifest.json';

async function loadJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`加载配置失败 [${path}]: HTTP ${resp.status}`);
  return resp.json();
}

function joinDataPath(directory, file) {
  return `${String(directory || '').replace(/\/+$/, '')}/${file}`;
}

function setByPath(target, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  if (parts.length === 0) throw new Error('data manifest key must not be empty');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function jsonLoader(options = {}) {
  return options.loadJson || loadJSON;
}

/**
 * 加载 data-manifest.json。
 * @param {{ manifestPath?: string, loadJson?: (path: string) => Promise<any>|any }} [options]
 */
export async function loadGameDataManifest(options = {}) {
  const loadJson = jsonLoader(options);
  const manifestPath = options.manifestPath || DEFAULT_DATA_MANIFEST_PATH;
  return loadJson(manifestPath);
}

/**
 * 按 manifest 中的目录组定义加载并合并 JSON 文件。
 * @param {Object} groupManifest
 * @param {{ loadJson?: (path: string) => Promise<any>|any }} [options]
 */
export async function loadJsonGroup(groupManifest, options = {}) {
  if (!groupManifest || !groupManifest.directory || !Array.isArray(groupManifest.files)) {
    throw new Error('loadJsonGroup requires { directory, files }');
  }

  const loadJson = jsonLoader(options);
  const files = groupManifest.files;
  const documents = await Promise.all(
    files.map((file) => loadJson(joinDataPath(groupManifest.directory, file))),
  );

  const output = groupManifest.output || {};
  if (output.mode === 'mergeArrayProperty') {
    const property = output.property;
    if (!property) throw new Error('mergeArrayProperty group requires output.property');
    return {
      [property]: documents.flatMap((document, index) => {
        const list = document?.[property];
        if (!Array.isArray(list)) {
          const path = joinDataPath(groupManifest.directory, files[index]);
          throw new Error(`manifest group file ${path} missing array property ${property}`);
        }
        return list;
      }),
    };
  }

  if (output.mode === 'documentArray') {
    return output.property ? { [output.property]: documents } : documents;
  }

  if (output.mode === 'objectMapById') {
    return Object.fromEntries(documents.map((document) => [document.id, document]));
  }

  return documents;
}

/**
 * 按 manifest 加载完整游戏配置，并保持 WorldEngine.init(configs) 既有字段。
 * @param {Object} manifest
 * @param {{ loadJson?: (path: string) => Promise<any>|any }} [options]
 */
export async function loadGameConfigsFromManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('loadGameConfigsFromManifest requires a manifest object');
  }

  const loadJson = jsonLoader(options);
  const configs = {};

  await Promise.all(Object.entries(manifest.singletons || {}).map(async ([key, path]) => {
    setByPath(configs, key, await loadJson(path));
  }));

  await Promise.all(Object.entries(manifest.groups || {}).map(async ([key, groupManifest]) => {
    const value = await loadJsonGroup(groupManifest, { loadJson });
    setByPath(configs, groupManifest.outputPath || key, value);
  }));

  configs.dataManifest = manifest;
  return configs;
}
