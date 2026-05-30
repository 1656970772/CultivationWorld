import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf-8');

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
