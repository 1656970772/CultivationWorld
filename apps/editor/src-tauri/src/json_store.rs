use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::project::{
    dataset_keys, dataset_path, ensure_safe_dataset_file_target, ProjectInfo,
};

pub fn read_all_datasets(project: &ProjectInfo) -> Result<BTreeMap<String, Value>, String> {
    let mut datasets = BTreeMap::new();
    for key in dataset_keys() {
        datasets.insert(key.to_string(), read_dataset(project, key)?);
    }
    Ok(datasets)
}

pub fn read_dataset(project: &ProjectInfo, key: &str) -> Result<Value, String> {
    let path = dataset_path(project, key)?;
    let data_dir = PathBuf::from(&project.data_path);
    ensure_safe_dataset_file_target(&data_dir, &path)?;
    if !path.is_file() {
        return Err(format!("missing dataset file: {}", path.display()));
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

pub fn write_dataset_atomic(
    project: &ProjectInfo,
    key: &str,
    data: &Value,
) -> Result<(), String> {
    let target = dataset_path(project, key)?;
    let data_dir = PathBuf::from(&project.data_path);
    ensure_safe_dataset_file_target(&data_dir, &target)?;

    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid dataset file name: {}", target.display()))?;
    let tmp_path = target.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        chrono::Local::now().timestamp_nanos_opt().unwrap_or_default()
    ));

    write_pretty_json(&tmp_path, data).and_then(|_| replace_file(&tmp_path, &target))
}

pub fn restore_dataset_from_backup(
    project: &ProjectInfo,
    key: &str,
    backup_path: &str,
) -> Result<(), String> {
    let target = dataset_path(project, key)?;
    let data_dir = PathBuf::from(&project.data_path);
    ensure_safe_dataset_file_target(&data_dir, &target)?;
    fs::copy(backup_path, &target).map_err(|error| {
        format!(
            "failed to restore {} from {}: {error}",
            target.display(),
            backup_path
        )
    })?;
    Ok(())
}

fn write_pretty_json(path: &Path, data: &Value) -> Result<(), String> {
    let mut file = fs::File::create(path)
        .map_err(|error| format!("failed to create temp file {}: {error}", path.display()))?;
    serde_json::to_writer_pretty(&mut file, data)
        .map_err(|error| format!("failed to serialize JSON {}: {error}", path.display()))?;
    file.write_all(b"\n")
        .map_err(|error| format!("failed to write newline {}: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("failed to flush temp file {}: {error}", path.display()))?;
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(tmp_path: &Path, target: &Path) -> Result<(), String> {
    fs::rename(tmp_path, target).map_err(|error| {
        let _ = fs::remove_file(tmp_path);
        format!(
            "failed to replace {} with {}: {error}",
            target.display(),
            tmp_path.display()
        )
    })
}

#[cfg(windows)]
fn replace_file(tmp_path: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let tmp_wide: Vec<u16> = tmp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target_wide: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let replaced = unsafe {
        MoveFileExW(
            tmp_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if replaced != 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        let _ = fs::remove_file(tmp_path);
        Err(format!(
            "failed to replace {} with {}: {error}",
            target.display(),
            tmp_path.display()
        ))
    }
}
