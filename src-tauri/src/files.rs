//! Attachment storage. Files are copied into `<data dir>/attachments/<item id>/`
//! so the app owns its copy and nothing breaks when the original is moved.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// The same directory tauri-plugin-sql resolves `sqlite:strainless.db` against,
/// so the database and attachments live side by side.
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

fn item_dir(app: &AppHandle, item_id: i64) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("attachments").join(item_id.to_string()))
}

/// Rejects anything that isn't a bare file name, so a stored name from the
/// database can never point outside the item's folder (e.g. `..\..\x`).
fn bare_name(name: &str) -> Result<&str, String> {
    let path = Path::new(name);
    match path.file_name() {
        Some(file) if file == path.as_os_str() => Ok(name),
        _ => Err(format!("invalid file name: {name}")),
    }
}

/// `report.pdf` -> `report (2).pdf` -> `report (3).pdf` ... until one is free.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("infinite iterator always finds a free name")
}

#[derive(Serialize)]
pub struct StoredFile {
    stored_name: String,
    original_name: String,
    size: u64,
}

#[tauri::command]
pub fn import_attachment(app: AppHandle, item_id: i64, source_path: String) -> Result<StoredFile, String> {
    let source = PathBuf::from(&source_path);
    let original_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("source path has no file name")?
        .to_string();

    let dir = item_dir(&app, item_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = unique_path(&dir, &original_name);
    let size = std::fs::copy(&source, &dest).map_err(|e| format!("could not copy {original_name}: {e}"))?;

    let stored_name = dest.file_name().unwrap().to_string_lossy().into_owned();
    Ok(StoredFile { stored_name, original_name, size })
}

#[tauri::command]
pub fn open_attachment(app: AppHandle, item_id: i64, stored_name: String) -> Result<(), String> {
    let path = item_dir(&app, item_id)?.join(bare_name(&stored_name)?);
    if !path.exists() {
        return Err(format!("{stored_name} is missing from the attachments folder"));
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_attachment_file(app: AppHandle, item_id: i64, stored_name: String) -> Result<(), String> {
    let path = item_dir(&app, item_id)?.join(bare_name(&stored_name)?);
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn delete_item_files(app: AppHandle, item_id: i64) -> Result<(), String> {
    match std::fs::remove_dir_all(item_dir(&app, item_id)?) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
