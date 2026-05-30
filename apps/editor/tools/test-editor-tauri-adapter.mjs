import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

import { DataStore } from '../js/editor/data-store.js';

const schemas = {
  factions: { file: 'data/entities/factions.json' },
  map: { file: 'data/world/map.json' }
};

const resetGlobals = () => {
  delete globalThis.window;
  delete globalThis.fetch;
  delete globalThis.document;
  delete globalThis.Blob;
  delete globalThis.URL;
};

const createBrowserFileHandle = (dataByFile, writes) => ({
  async getFileHandle(fileName) {
    return {
      async getFile() {
        return {
          async text() {
            return JSON.stringify(dataByFile[fileName]);
          }
        };
      },
      async createWritable() {
        return {
          async write(content) {
            writes.push({ fileName, content });
          },
          async close() {}
        };
      }
    };
  }
});

{
  resetGlobals();
  const fetches = [];
  globalThis.window = {};
  globalThis.fetch = async (url, options) => {
    fetches.push({ url, options });
    return {
      ok: true,
      async json() {
        return { from: url };
      }
    };
  };

  const store = new DataStore(schemas);
  assert.equal(store.canUseDirectoryPicker, false);

  const data = await store.loadAll();
  assert.deepEqual(data, {
    factions: { from: 'data/entities/factions.json' },
    map: { from: 'data/world/map.json' }
  });
  assert.deepEqual(fetches.map((entry) => entry.url), ['data/entities/factions.json', 'data/world/map.json']);
  assert.ok(fetches.every((entry) => entry.options.cache === 'no-store'));
}

{
  resetGlobals();
  const writes = [];
  const dataDirHandle = createBrowserFileHandle(
    {
      'factions.json': [{ id: 'sect_001' }],
      'map.json': { width: 1, height: 1, tiles: [] }
    },
    writes
  );
  globalThis.window = {
    async showDirectoryPicker(options) {
      assert.deepEqual(options, { mode: 'readwrite' });
      return {
        name: 'WorldDymnic-Cursor',
        async getDirectoryHandle(name) {
          assert.equal(name, 'data');
          return dataDirHandle;
        }
      };
    }
  };

  const store = new DataStore(schemas);
  assert.equal(store.canUseDirectoryPicker, true);

  const data = await store.pickProjectDirectory();
  assert.deepEqual(data.factions, [{ id: 'sect_001' }]);
  assert.equal(store.sourceLabel, 'WorldDymnic-Cursor/data');

  const result = await store.saveDataset('factions', [{ id: 'sect_002' }]);
  assert.deepEqual(result, { mode: 'file', fileName: 'factions.json' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].fileName, 'factions.json');
  assert.equal(writes[0].content, '[\n  {\n    "id": "sect_002"\n  }\n]\n');
}

{
  resetGlobals();
  const invokes = [];
  const dialogOptions = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        async invoke(command, payload) {
          invokes.push({ command, payload });
          if (command === 'load_project_directory') {
            assert.deepEqual(payload, { rootPath: 'F:\\WorldDymnic-Cursor' });
            return {
              project: {
                rootPath: 'F:\\WorldDymnic-Cursor',
                dataPath: 'F:\\WorldDymnic-Cursor\\data',
                sourceLabel: 'WorldDymnic-Cursor/data'
              },
              datasets: {
                factions: [{ id: 'sect_tauri' }],
                map: { width: 2, height: 2, tiles: [] }
              },
              issues: []
            };
          }
          if (command === 'reload_all_datasets') {
            return {
              project: { name: 'WorldDymnic-Cursor', rootPath: 'F:\\WorldDymnic-Cursor' },
              datasets: {
                factions: [{ id: 'sect_reloaded' }],
                map: { width: 3, height: 3, tiles: [] }
              },
              issues: []
            };
          }
          if (command === 'save_dataset') {
            assert.deepEqual(payload, { key: 'factions', data: [{ id: 'sect_saved' }] });
            return { mode: 'tauri', fileName: 'factions.json', backupPath: 'F:\\WorldDymnic-Cursor\\data\\factions.json.bak' };
          }
          if (command === 'save_all_datasets') {
            assert.deepEqual(payload, {
              datasets: {
                factions: [{ id: 'sect_saved' }],
                map: { width: 3, height: 3, tiles: [] }
              }
            });
            return [
              { mode: 'tauri', fileName: 'factions.json', backupPath: 'F:\\WorldDymnic-Cursor\\data\\factions.json.bak' },
              { mode: 'tauri', fileName: 'map.json', backupPath: 'F:\\WorldDymnic-Cursor\\data\\map.json.bak' }
            ];
          }
          throw new Error(`Unexpected command: ${command}`);
        }
      },
      dialog: {
        async open(options) {
          dialogOptions.push(options);
          return 'F:\\WorldDymnic-Cursor';
        }
      }
    }
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    async json() {
      return { from: url };
    }
  });

  const store = new DataStore(schemas);
  assert.equal(store.canUseDirectoryPicker, true);

  const bundledData = await store.loadAll();
  assert.equal(bundledData.factions.from, 'data/entities/factions.json');
  assert.equal(invokes.length, 0);

  const pickedData = await store.pickProjectDirectory();
  assert.deepEqual(dialogOptions, [{ directory: true }]);
  assert.equal(pickedData.factions[0].id, 'sect_tauri');
  assert.equal(store.sourceLabel, 'WorldDymnic-Cursor/data');

  const reloadedData = await store.loadAll();
  assert.equal(reloadedData.factions[0].id, 'sect_reloaded');

  const saveResult = await store.saveDataset('factions', [{ id: 'sect_saved' }]);
  assert.equal(saveResult.mode, 'tauri');
  assert.ok(saveResult.backupPath.endsWith('factions.json.bak'));

  const saveAllResult = await store.saveAll({
    factions: [{ id: 'sect_saved' }],
    map: { width: 3, height: 3, tiles: [] }
  });
  assert.ok(saveAllResult.every((result) => result.mode === 'tauri'));
}

{
  resetGlobals();
  let didLoadProject = false;
  globalThis.window = {
    __TAURI__: {
      core: {
        async invoke(command) {
          if (command === 'load_project_directory') didLoadProject = true;
          throw new Error(`Unexpected command: ${command}`);
        }
      },
      dialog: {
        async open() {
          return null;
        }
      }
    }
  };

  const store = new DataStore(schemas);
  const result = await store.pickProjectDirectory();
  assert.equal(result, null);
  assert.equal(didLoadProject, false);
  assert.equal(store.hasOpenProject, false);
}

{
  const html = readFileSync(new NodeURL('../data-editor.html', import.meta.url), 'utf-8');
  assert.ok(html.includes('>打开项目</button>'), '目录按钮文案应为“打开项目”');
  assert.ok(!html.includes('>授权目录</button>'), '目录按钮不应继续显示“授权目录”');
}

{
  const appSource = readFileSync(new NodeURL('../js/editor/editor-app.js', import.meta.url), 'utf-8');
  assert.ok(appSource.includes("result.mode === 'tauri'"), '单文件保存应将 tauri 视为写回成功');
  assert.ok(appSource.includes("result.mode === 'file' || result.mode === 'tauri'"), '保存全部应将 file/tauri 都视为写回成功');
  assert.ok(appSource.includes('已备份'), 'Tauri 保存成功提示应包含备份提示');
}

resetGlobals();
console.log('editor tauri adapter tests passed');
