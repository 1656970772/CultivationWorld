use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::validation::Issue;

pub const DATASET_FILES: [(&str, &str); 7] = [
    ("factions", "factions.json"),
    ("npcs", "npcs.json"),
    ("terrains", "terrains.json"),
    ("modifiers", "modifiers.json"),
    ("rules", "rules.json"),
    ("events", "events.json"),
    ("map", "map.json"),
];

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

pub fn dataset_file_name(key: &str) -> Option<&'static str> {
    DATASET_FILES
        .iter()
        .find_map(|(dataset_key, file_name)| (*dataset_key == key).then_some(*file_name))
}

pub fn dataset_keys() -> impl Iterator<Item = &'static str> {
    DATASET_FILES.iter().map(|(key, _)| *key)
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

    let child_data = input_path.join("data");
    if child_data.is_dir() {
        return project_info(input_path.clone(), child_data, "project-root");
    }

    if looks_like_data_directory(&input_path) {
        return project_info(input_path.clone(), input_path, "data-directory");
    }

    Err(format!(
        "could not find data directory or known dataset files under {}",
        input_path.display()
    ))
}

pub fn dataset_path(project: &ProjectInfo, key: &str) -> Result<PathBuf, String> {
    let file_name =
        dataset_file_name(key).ok_or_else(|| format!("unknown dataset key: {key}"))?;
    let data_dir = PathBuf::from(&project.data_path);
    let target = data_dir.join(file_name);
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

fn looks_like_data_directory(path: &Path) -> bool {
    DATASET_FILES
        .iter()
        .any(|(_, file_name)| path.join(file_name).is_file())
}

fn project_info(
    root_path: PathBuf,
    data_path: PathBuf,
    source_label: &str,
) -> Result<ProjectInfo, String> {
    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().into_owned(),
        data_path: data_path
            .canonicalize()
            .map_err(|error| format!("failed to resolve data directory: {error}"))?
            .to_string_lossy()
            .into_owned(),
        source_label: source_label.to_string(),
    })
}
