use chrono::Local;
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use crate::project::{
    dataset_file_name, dataset_path, ensure_safe_dataset_file_target, ProjectInfo,
};

pub fn backup_datasets(
    project: &ProjectInfo,
    keys: &[String],
) -> Result<BTreeMap<String, String>, String> {
    if keys.is_empty() {
        return Ok(BTreeMap::new());
    }

    let backup_root = PathBuf::from(&project.data_path).join(".backups");
    let backup_dir = unique_backup_dir(&backup_root)?;

    let mut backup_paths = BTreeMap::new();
    for key in keys {
        let file_name =
            dataset_file_name(key).ok_or_else(|| format!("unknown dataset key: {key}"))?;
        let source = dataset_path(project, key)?;
        let data_dir = PathBuf::from(&project.data_path);
        ensure_safe_dataset_file_target(&data_dir, &source)?;
        if !source.is_file() {
            return Err(format!(
                "cannot backup missing dataset file: {}",
                source.display()
            ));
        }
        let backup_path = backup_dir.join(file_name);
        fs::copy(&source, &backup_path).map_err(|error| {
            format!(
                "failed to backup {} to {}: {error}",
                source.display(),
                backup_path.display()
            )
        })?;
        backup_paths.insert(key.clone(), backup_path.to_string_lossy().into_owned());
    }

    Ok(backup_paths)
}

fn unique_backup_dir(backup_root: &PathBuf) -> Result<PathBuf, String> {
    fs::create_dir_all(backup_root).map_err(|error| {
        format!(
            "failed to create backup root {}: {error}",
            backup_root.display()
        )
    })?;

    let base_name = Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    for index in 0..1000 {
        let dir_name = if index == 0 {
            base_name.clone()
        } else {
            format!("{base_name}_{index:03}")
        };
        let candidate = backup_root.join(dir_name);
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "failed to create backup directory {}: {error}",
                    candidate.display()
                ));
            }
        }
    }

    Err(format!(
        "failed to allocate unique backup directory under {}",
        backup_root.display()
    ))
}
