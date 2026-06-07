use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::backup::backup_datasets;
use crate::json_store::{
    read_all_datasets, restore_dataset_from_backup, write_dataset_atomic,
};
use crate::project::{
    dataset_file_name, ProjectInfo, ProjectSnapshot, SaveResult,
    resolve_project_directory,
};
use crate::validation::{has_error, validate_all_datasets, validate_dataset_keys, Issue};

static CURRENT_PROJECT: OnceLock<Mutex<Option<ProjectInfo>>> = OnceLock::new();

#[tauri::command]
pub fn load_project_directory(root_path: String) -> Result<ProjectSnapshot, String> {
    let project = resolve_project_directory(&PathBuf::from(root_path))?;
    let datasets = read_all_datasets(&project)?;
    let issues = validate_all_datasets(&datasets)?;
    set_current_project(project.clone())?;

    Ok(ProjectSnapshot {
        project,
        datasets,
        issues,
    })
}

#[tauri::command]
pub fn reload_all_datasets() -> Result<ProjectSnapshot, String> {
    let project = current_project()?;
    let datasets = read_all_datasets(&project)?;
    let issues = validate_all_datasets(&datasets)?;

    Ok(ProjectSnapshot {
        project,
        datasets,
        issues,
    })
}

#[tauri::command]
pub fn save_dataset(key: String, data: Value) -> Result<SaveResult, String> {
    if dataset_file_name(&key).is_none() {
        return Err(format!("unknown dataset key: {key}"));
    }

    let project = current_project()?;
    let mut datasets = read_all_datasets(&project)?;
    datasets.insert(key.clone(), data.clone());
    reject_if_invalid(&datasets)?;

    let backup_paths = backup_datasets(&project, std::slice::from_ref(&key))?;
    write_dataset_atomic(&project, &key, &data)?;

    Ok(SaveResult {
        mode: "tauri".to_string(),
        file_name: dataset_file_name(&key).unwrap_or_default().to_string(),
        backup_path: backup_paths.get(&key).cloned(),
    })
}

#[tauri::command]
pub fn save_all_datasets(
    datasets: BTreeMap<String, Value>,
) -> Result<Vec<SaveResult>, String> {
    validate_dataset_keys(&datasets)?;

    let project = current_project()?;
    let mut merged = read_all_datasets(&project)?;
    for (key, data) in &datasets {
        merged.insert(key.clone(), data.clone());
    }
    reject_if_invalid(&merged)?;

    let keys: Vec<String> = datasets.keys().cloned().collect();
    let backup_paths = backup_datasets(&project, &keys)?;

    let mut results = Vec::with_capacity(datasets.len());
    let mut written_keys = Vec::new();
    for (key, data) in datasets {
        if let Err(error) = write_dataset_atomic(&project, &key, &data) {
            rollback_written_datasets(&project, &written_keys, &backup_paths);
            return Err(error);
        }
        written_keys.push(key.clone());
        results.push(SaveResult {
            mode: "tauri".to_string(),
            file_name: dataset_file_name(&key).unwrap_or_default().to_string(),
            backup_path: backup_paths.get(&key).cloned(),
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn validate_datasets(
    datasets: BTreeMap<String, Value>,
) -> Result<Vec<Issue>, String> {
    validate_all_datasets(&datasets)
}

fn current_project() -> Result<ProjectInfo, String> {
    let state = CURRENT_PROJECT.get_or_init(|| Mutex::new(None));
    let guard = state
        .lock()
        .map_err(|_| "project state lock is poisoned".to_string())?;
    guard
        .clone()
        .ok_or_else(|| "no project directory has been loaded".to_string())
}

fn set_current_project(project: ProjectInfo) -> Result<(), String> {
    let state = CURRENT_PROJECT.get_or_init(|| Mutex::new(None));
    let mut guard = state
        .lock()
        .map_err(|_| "project state lock is poisoned".to_string())?;
    *guard = Some(project);
    Ok(())
}

fn reject_if_invalid(datasets: &BTreeMap<String, Value>) -> Result<(), String> {
    let issues = validate_all_datasets(datasets)?;
    if has_error(&issues) {
        let messages = issues
            .iter()
            .filter(|issue| issue.severity == "error")
            .map(|issue| format!("{}: {}", issue.path, issue.message))
            .collect::<Vec<_>>()
            .join("; ");
        Err(format!("dataset validation failed: {messages}"))
    } else {
        Ok(())
    }
}

fn rollback_written_datasets(
    project: &ProjectInfo,
    written_keys: &[String],
    backup_paths: &BTreeMap<String, String>,
) {
    for key in written_keys {
        if let Some(backup_path) = backup_paths.get(key) {
            let _ = restore_dataset_from_backup(project, key, backup_path);
        }
    }
}
