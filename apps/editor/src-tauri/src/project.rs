use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::validation::Issue;

const SKIP_DIRS: &[&str] = &[
    ".backups",
    ".git",
    ".snapshots",
    "__pycache__",
    "desktop-dist",
    "node_modules",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DatasetEntry {
    pub key: &'static str,
    pub relative_path: PathBuf,
    pub backup_file_name: &'static str,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DatasetRegistry {
    entries: Vec<DatasetEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root_path: String,
    pub data_path: String,
    pub source_label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub project: ProjectInfo,
    pub datasets: BTreeMap<String, Value>,
    pub issues: Vec<Issue>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub mode: String,
    pub file_name: String,
    pub backup_path: Option<String>,
}

static CURRENT_REGISTRY: OnceLock<Mutex<DatasetRegistry>> = OnceLock::new();

impl DatasetRegistry {
    pub fn scan(data_dir: &Path) -> Result<Self, String> {
        let mut entries = Vec::new();
        scan_json_files(data_dir, data_dir, &mut entries)?;
        entries.sort_by(|a, b| a.key.cmp(b.key));
        Ok(Self { entries })
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn keys(&self) -> Vec<&'static str> {
        self.entries.iter().map(|entry| entry.key).collect()
    }

    pub fn entry(&self, key: &str) -> Option<&DatasetEntry> {
        self.entries.iter().find(|entry| entry.key == key)
    }
}

pub fn dataset_file_name(key: &str) -> Option<&'static str> {
    with_registry(|registry| registry.entry(key).map(|entry| entry.backup_file_name))
        .flatten()
}

pub fn dataset_keys() -> std::vec::IntoIter<&'static str> {
    with_registry(|registry| registry.keys())
        .unwrap_or_default()
        .into_iter()
}

pub fn resolve_project_directory(input_path: &Path) -> Result<ProjectInfo, String> {
    let input_path = input_path
        .canonicalize()
        .map_err(|error| format!("failed to resolve project path: {error}"))?;

    if !input_path.is_dir() {
        return Err(format!(
            "project path is not a directory: {}",
            input_path.display()
        ));
    }

    let repo_game_data = input_path.join("apps").join("game").join("data");
    if has_data_directory_sentinel(&repo_game_data) {
        return project_info(input_path.clone(), repo_game_data, "project-root");
    }

    let child_data = input_path.join("data");
    if has_data_directory_sentinel(&child_data) {
        return project_info(input_path.clone(), child_data, "project-root");
    }

    if looks_like_data_directory(&input_path) {
        return project_info(input_path.clone(), input_path, "data-directory");
    }

    Err(format!(
        "could not find apps/game/data, data directory, or valid game data sentinel under {}",
        input_path.display()
    ))
}

pub fn dataset_path(project: &ProjectInfo, key: &str) -> Result<PathBuf, String> {
    let data_dir = PathBuf::from(&project.data_path);
    let relative_path = with_registry(|registry| {
        registry
            .entry(key)
            .map(|entry| entry.relative_path.clone())
    })
    .flatten()
    .ok_or_else(|| format!("unknown dataset key: {key}"))?;

    validate_relative_dataset_path(&relative_path)?;
    let target = data_dir.join(relative_path);
    ensure_inside_data_dir(&data_dir, &target)?;
    Ok(target)
}

pub fn ensure_inside_data_dir(data_dir: &Path, target: &Path) -> Result<(), String> {
    let data_dir = data_dir
        .canonicalize()
        .map_err(|error| format!("failed to resolve data directory: {error}"))?;
    let parent = target.parent().ok_or_else(|| {
        format!(
            "dataset target has no parent directory: {}",
            target.display()
        )
    })?;
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("failed to resolve dataset parent: {error}"))?;

    if parent.starts_with(&data_dir) {
        Ok(())
    } else {
        Err(format!(
            "refusing to access path outside data directory: {}",
            target.display()
        ))
    }
}

pub fn ensure_safe_dataset_file_target(data_dir: &Path, target: &Path) -> Result<(), String> {
    ensure_inside_data_dir(data_dir, target)?;
    if let Ok(metadata) = fs::symlink_metadata(target) {
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "refusing to access symlinked dataset file: {}",
                target.display()
            ));
        }
    }
    Ok(())
}

fn project_info(
    root_path: PathBuf,
    data_path: PathBuf,
    source_label: &str,
) -> Result<ProjectInfo, String> {
    let data_path = data_path
        .canonicalize()
        .map_err(|error| format!("failed to resolve data directory: {error}"))?;
    if !has_data_directory_sentinel(&data_path) {
        return Err(format!(
            "directory is not a game data directory: {}",
            data_path.display()
        ));
    }
    let registry = DatasetRegistry::scan(&data_path)?;
    if registry.is_empty() {
        return Err(format!("no JSON datasets found under {}", data_path.display()));
    }
    replace_registry(registry)?;

    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().into_owned(),
        data_path: data_path.to_string_lossy().into_owned(),
        source_label: source_label.to_string(),
    })
}

fn looks_like_data_directory(path: &Path) -> bool {
    if !has_data_directory_sentinel(path) {
        return false;
    }
    DatasetRegistry::scan(path)
        .map(|registry| !registry.is_empty())
        .unwrap_or(false)
}

fn has_data_directory_sentinel(path: &Path) -> bool {
    path.join("config").join("data-manifest.json").is_file()
        || path.join("entities").join("factions.json").is_file()
}

fn scan_json_files(
    root: &Path,
    dir: &Path,
    entries: &mut Vec<DatasetEntry>,
) -> Result<(), String> {
    let read_dir = fs::read_dir(dir)
        .map_err(|error| format!("failed to read directory {}: {error}", dir.display()))?;
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
        if file_type.is_dir() {
            if should_skip_dir(entry.file_name().as_os_str()) {
                continue;
            }
            scan_json_files(root, &path, entries)?;
            continue;
        }
        if !file_type.is_file() || path.extension() != Some(OsStr::new("json")) {
            continue;
        }
        let relative_path = path
            .strip_prefix(root)
            .map_err(|error| format!("failed to derive dataset path {}: {error}", path.display()))?
            .to_path_buf();
        let key = leak_string(relative_path_to_key(&relative_path)?);
        let backup_file_name = leak_string(backup_file_name_for_key(key));
        entries.push(DatasetEntry {
            key,
            relative_path,
            backup_file_name,
        });
    }
    Ok(())
}

fn should_skip_dir(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    SKIP_DIRS.contains(&name) || name.starts_with('.')
}

fn relative_path_to_key(path: &Path) -> Result<String, String> {
    let without_ext = path.with_extension("");
    let mut parts = Vec::new();
    for component in without_ext.components() {
        match component {
            Component::Normal(value) => parts.push(value.to_string_lossy().into_owned()),
            _ => {
                return Err(format!(
                    "invalid dataset relative path: {}",
                    path.display()
                ));
            }
        }
    }
    Ok(parts.join("/"))
}

fn validate_relative_dataset_path(path: &Path) -> Result<(), String> {
    if path.is_absolute() {
        return Err(format!("dataset path must be relative: {}", path.display()));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(format!(
                    "dataset path contains unsafe component: {}",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

fn backup_file_name_for_key(key: &str) -> String {
    if !key.contains('/') {
        return format!("{key}.json");
    }
    let mut name = String::new();
    for ch in key.chars() {
        match ch {
            '/' | '\\' | ':' => name.push_str("__"),
            _ => name.push(ch),
        }
    }
    format!("{name}.json")
}

fn replace_registry(registry: DatasetRegistry) -> Result<(), String> {
    let state = CURRENT_REGISTRY.get_or_init(|| Mutex::new(DatasetRegistry::default()));
    let mut guard = state
        .lock()
        .map_err(|_| "dataset registry lock is poisoned".to_string())?;
    *guard = registry;
    Ok(())
}

fn with_registry<T>(f: impl FnOnce(&DatasetRegistry) -> T) -> Option<T> {
    let state = CURRENT_REGISTRY.get()?;
    let guard = state.lock().ok()?;
    Some(f(&guard))
}

fn leak_string(value: String) -> &'static str {
    Box::leak(value.into_boxed_str())
}
