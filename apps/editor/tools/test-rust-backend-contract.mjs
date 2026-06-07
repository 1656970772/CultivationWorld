import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDITOR_ROOT = resolve(__dirname, '..');
const read = (path) => readFileSync(resolve(EDITOR_ROOT, path), 'utf-8');

const projectSource = read('src-tauri/src/project.rs');
const commandsSource = read('src-tauri/src/commands.rs');
const validationSource = read('src-tauri/src/validation.rs');
const libSource = read('src-tauri/src/lib.rs');

for (const structName of ['ProjectInfo', 'ProjectSnapshot', 'SaveResult']) {
  const structPattern = new RegExp(
    `#\\[serde\\(rename_all = "camelCase"\\)\\]\\s*\\n\\s*pub struct ${structName}`
  );
  assert.match(
    projectSource,
    structPattern,
    `${structName} 应使用 camelCase 序列化，保持前端 ProjectInfo/SaveResult 契约。`
  );
}

assert.match(
  validationSource,
  /"terrains"\s*\|\s*"modifiers"\s*\|\s*"events"\s*=>\s*Some\("type"\)/,
  'terrains.json 的主键应为 type，不应按 id 校验。'
);

assert.match(
  validationSource,
  /"terrains"\s*\|\s*"modifiers"\s*\|\s*"events"\s*=>\s*Some\("type"\)/,
  'events.json 的主键应为 type，不应按 id 校验。'
);

assert.match(
  validationSource,
  /collect_keys\(datasets\.get\("terrains"\),\s*"type"\)/,
  '地图 terrain 引用应收集 terrains.type。'
);

assert.match(
  validationSource,
  /collect_keys\(datasets\.get\("events"\),\s*"type"\)/,
  'rules.event_type 应引用 events.type。'
);

assert.match(
  validationSource,
  /coordinates\.insert\(\(x,\s*y\)\)[\s\S]+map_coordinate_out_of_bounds/,
  '重复坐标检测应独立于越界检测，越界坐标也应参与 duplicate_map_coordinate 校验。'
);

assert.match(
  projectSource,
  /symlink_metadata\(target\)[\s\S]+is_symlink\(\)/,
  '后端应拒绝访问 symlinked dataset file，避免固定文件名指向 data 目录外。'
);

assert.match(
  projectSource,
  /apps["']\)\s*\.join\(["']game["']\)\s*\.join\(["']data["']\)/,
  'resolve_project_directory 应能从仓库根优先解析 apps/game/data，不能把仓库根当作 data 目录。'
);

assert.match(
  projectSource,
  /has_data_directory_sentinel[\s\S]+config["']\)\s*\.join\(["']data-manifest\.json["'][\s\S]+entities["']\)\s*\.join\(["']factions\.json["']/,
  'data 目录识别应要求 config/data-manifest.json 或 entities/factions.json 这类真实 data sentinel。'
);

assert.doesNotMatch(
  projectSource,
  /fallback_dataset_file_name|key_to_relative_path/,
  '未知 dataset key 不应 fallback 为 ${key}.json，必须由当前 DatasetRegistry strict 决定。'
);

assert.match(
  projectSource,
  /entry\(key\)[\s\S]+ok_or_else\(\|\|\s*format!\("unknown dataset key: \{key\}"\)\)\?/,
  'dataset_path 应在 registry 中找不到 key 时直接失败。'
);

assert.match(
  commandsSource,
  /rollback_written_datasets[\s\S]+restore_dataset_from_backup/,
  'save_all_datasets 写入失败时应尝试用备份回滚已经写入的文件。'
);

const backupSource = read('src-tauri/src/backup.rs');
assert.match(
  backupSource,
  /fs::create_dir\(&candidate\)[\s\S]+ErrorKind::AlreadyExists/,
  '备份目录应通过 fs::create_dir 原子抢占唯一目录，避免并发 exists/create 竞态。'
);

const tauriModeCount = (commandsSource.match(/mode:\s*"tauri"\.to_string\(\)/g) || []).length;
assert.equal(tauriModeCount, 2, '单文件保存和全部保存都应返回 mode: "tauri"。');

for (const commandName of [
  'load_project_directory',
  'reload_all_datasets',
  'save_dataset',
  'save_all_datasets',
  'validate_datasets'
]) {
  assert.ok(
    libSource.includes(`commands::${commandName}`),
    `lib.rs 应注册 Tauri command：${commandName}。`
  );
}

console.log('rust backend contract tests passed');
