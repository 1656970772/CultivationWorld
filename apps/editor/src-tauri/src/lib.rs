pub mod backup;
pub mod commands;
pub mod json_store;
pub mod project;
pub mod validation;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_project_directory,
            commands::reload_all_datasets,
            commands::save_dataset,
            commands::save_all_datasets,
            commands::validate_datasets
        ])
        .run(tauri::generate_context!())
        .expect("failed to run 玄天大陆编辑器");
}

#[cfg(test)]
mod tests {
    use super::commands::{load_project_directory, save_dataset, validate_datasets};
    use super::json_store::{read_all_datasets, write_dataset_atomic};
    use super::project::{dataset_file_name, resolve_project_directory};
    use serde_json::{json, Value};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, MutexGuard, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_guard() -> MutexGuard<'static, ()> {
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test lock should not be poisoned")
    }

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("xuantian_backend_{name}_{stamp}"));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    fn write_json(path: &Path, value: Value) {
        fs::write(
            path,
            serde_json::to_string_pretty(&value).expect("json should serialize"),
        )
        .expect("json file should be written");
    }

    fn valid_dataset(key: &str) -> Value {
        match key {
            "factions" => json!([
                { "id": "f1", "name": "Faction One", "leader": "n1" }
            ]),
            "npcs" => json!([
                { "id": "n1", "name": "Leader", "factionId": "f1" }
            ]),
            "terrains" => json!([
                { "type": "grass", "name": "Grass" }
            ]),
            "modifiers" => json!([]),
            "rules" => json!([
                { "id": "r1", "event_type": "harvest" }
            ]),
            "events" => json!([
                { "type": "harvest", "name": "Harvest" }
            ]),
            "map" => json!({
                "width": 2,
                "height": 2,
                "tiles": [
                    { "x": 0, "y": 0, "terrain": "grass", "ownerId": "f1" }
                ]
            }),
            other => panic!("unexpected dataset key {other}"),
        }
    }

    fn write_complete_data_dir(data_dir: &Path) {
        fs::create_dir_all(data_dir).expect("data dir should be created");
        for key in [
            "factions",
            "npcs",
            "terrains",
            "modifiers",
            "rules",
            "events",
            "map",
        ] {
            write_json(data_dir.join(dataset_file_name(key).unwrap()).as_path(), valid_dataset(key));
        }
    }

    fn valid_datasets() -> BTreeMap<String, Value> {
        [
            "factions",
            "npcs",
            "terrains",
            "modifiers",
            "rules",
            "events",
            "map",
        ]
        .into_iter()
        .map(|key| (key.to_string(), valid_dataset(key)))
        .collect()
    }

    #[test]
    fn resolves_project_root_or_data_directory() {
        let _guard = test_guard();
        let root = temp_dir("resolve");
        let data_dir = root.join("data");
        write_complete_data_dir(&data_dir);

        let from_root = resolve_project_directory(&root).expect("root should resolve");
        assert_eq!(
            PathBuf::from(&from_root.data_path),
            data_dir.canonicalize().expect("data path should canonicalize")
        );
        assert_eq!(from_root.source_label, "project-root");

        let from_data = resolve_project_directory(&data_dir).expect("data dir should resolve");
        assert_eq!(
            PathBuf::from(&from_data.data_path),
            data_dir.canonicalize().expect("data path should canonicalize")
        );
        assert_eq!(from_data.source_label, "data-directory");
    }

    #[test]
    fn loading_reports_missing_required_dataset_file() {
        let _guard = test_guard();
        let root = temp_dir("missing");
        let data_dir = root.join("data");
        write_complete_data_dir(&data_dir);
        fs::remove_file(data_dir.join("rules.json")).expect("fixture file should be removed");

        let error = load_project_directory(root.to_string_lossy().into_owned())
            .expect_err("missing dataset should fail load");
        assert!(error.contains("rules.json"));
    }

    #[test]
    fn rejects_unknown_dataset_key() {
        let _guard = test_guard();
        let root = temp_dir("unknown_key");
        write_complete_data_dir(&root.join("data"));
        load_project_directory(root.to_string_lossy().into_owned()).expect("project should load");

        let error = save_dataset("unknown".to_string(), json!({}))
            .expect_err("unknown keys must be rejected");
        assert!(error.contains("unknown dataset key"));
    }

    #[test]
    fn save_creates_backup_directory() {
        let _guard = test_guard();
        let root = temp_dir("backup");
        let data_dir = root.join("data");
        write_complete_data_dir(&data_dir);
        load_project_directory(root.to_string_lossy().into_owned()).expect("project should load");

        let result =
            save_dataset("factions".to_string(), valid_dataset("factions")).expect("save should succeed");

        let backup_path = result.backup_path.expect("backup path should be returned");
        assert!(Path::new(&backup_path).exists());
        assert!(backup_path.contains(".backups"));
        assert_eq!(result.file_name, "factions.json");
    }

    #[test]
    fn validation_reports_invalid_references() {
        let _guard = test_guard();
        let mut datasets = valid_datasets();
        datasets.insert(
            "npcs".to_string(),
            json!([{ "id": "n1", "name": "Leader", "factionId": "missing-faction" }]),
        );

        let issues = validate_datasets(datasets).expect("validation should run");

        assert!(issues.iter().any(|issue| {
            issue.code == "invalid_reference"
                && issue.path == "npcs[0].factionId"
                && issue.message.contains("missing-faction")
        }));
    }

    #[test]
    fn validation_reports_map_coordinate_out_of_bounds() {
        let _guard = test_guard();
        let mut datasets = valid_datasets();
        datasets.insert(
            "map".to_string(),
            json!({
                "width": 2,
                "height": 2,
                "tiles": [
                    { "x": 2, "y": 0, "terrain": "grass", "ownerId": "f1" }
                ]
            }),
        );

        let issues = validate_datasets(datasets).expect("validation should run");

        assert!(issues.iter().any(|issue| {
            issue.code == "map_coordinate_out_of_bounds" && issue.path == "map.tiles[0]"
        }));
    }

    #[test]
    fn atomic_save_writes_json_back_to_target_file() {
        let _guard = test_guard();
        let root = temp_dir("atomic");
        let data_dir = root.join("data");
        write_complete_data_dir(&data_dir);
        let context = resolve_project_directory(&root).expect("project should resolve");

        write_dataset_atomic(&context, "modifiers", &json!([{ "id": "m1" }]))
            .expect("atomic write should succeed");

        let datasets = read_all_datasets(&context).expect("datasets should be readable");
        assert_eq!(datasets.get("modifiers"), Some(&json!([{ "id": "m1" }])));
        assert!(!data_dir.join("modifiers.json.tmp").exists());
    }
}
