//! File storage. User files are copied into `<data dir>/<area>/<owner id>/`, so the
//! app owns its copy and nothing breaks when the original is moved:
//!   attachments/<item id>/…   files attached to an item
//!   courses/<course id>/…     a course's library (slides, PDFs, pasted images)
//!   journal/<YYYY-MM-DD>/…    the day's mood photo

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// The same directory tauri-plugin-sql resolves `sqlite:strainless.db` against,
/// so the database and the files live side by side.
pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Storage areas the frontend may address. Anything else is rejected.
const AREAS: [&str; 2] = ["attachments", "courses"];

fn owner_dir(app: &AppHandle, area: &str, owner_id: i64) -> Result<PathBuf, String> {
    if !AREAS.contains(&area) {
        return Err(format!("unknown storage area: {area}"));
    }
    Ok(data_dir(app)?.join(area).join(owner_id.to_string()))
}

/// Rejects anything that isn't a bare file name, so a stored name from the
/// database can never point outside its folder (e.g. `..\..\x`).
pub(crate) fn bare_name(name: &str) -> Result<&str, String> {
    let path = Path::new(name);
    match path.file_name() {
        Some(file) if file == path.as_os_str() => Ok(name),
        _ => Err(format!("invalid file name: {name}")),
    }
}

fn stored_path(app: &AppHandle, area: &str, owner_id: i64, stored_name: &str) -> Result<PathBuf, String> {
    Ok(owner_dir(app, area, owner_id)?.join(bare_name(stored_name)?))
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

/// Copies a file from disk (picked in a dialog or dropped) into an area.
#[tauri::command]
pub fn import_file(app: AppHandle, area: String, owner_id: i64, source_path: String) -> Result<StoredFile, String> {
    let source = PathBuf::from(&source_path);
    if source.is_dir() {
        return Err(format!("{source_path} is a folder; add the files inside it, or zip it first"));
    }
    let original_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("source path has no file name")?
        .to_string();

    let dir = owner_dir(&app, &area, owner_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = unique_path(&dir, &original_name);
    let size = std::fs::copy(&source, &dest).map_err(|e| format!("could not copy {original_name}: {e}"))?;

    let stored_name = dest.file_name().unwrap().to_string_lossy().into_owned();
    Ok(StoredFile { stored_name, original_name, size })
}

/// Saves bytes sent from the frontend (e.g. a screenshot pasted into notes).
/// The body is raw bytes, not JSON; area, owner and file name travel in headers.
#[tauri::command]
pub fn import_bytes(app: AppHandle, request: Request<'_>) -> Result<StoredFile, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let header = |key: &str| {
        request.headers().get(key).and_then(|v| v.to_str().ok()).ok_or(format!("missing header {key}"))
    };
    let area = header("x-area")?;
    let owner_id: i64 = header("x-owner")?.parse().map_err(|_| "x-owner must be a number")?;
    let name = bare_name(header("x-name")?)?.to_string();

    let dir = owner_dir(&app, area, owner_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = unique_path(&dir, &name);
    std::fs::write(&dest, bytes).map_err(|e| format!("could not save {name}: {e}"))?;
    let stored_name = dest.file_name().unwrap().to_string_lossy().into_owned();
    Ok(StoredFile { stored_name, original_name: name, size: bytes.len() as u64 })
}

/// Absolute path of a stored file, for display via the asset protocol (images).
#[tauri::command]
pub fn file_path(app: AppHandle, area: String, owner_id: i64, stored_name: String) -> Result<String, String> {
    Ok(stored_path(&app, &area, owner_id, &stored_name)?.to_string_lossy().into_owned())
}

/// Raw bytes of a stored file (PDF, DOCX, PPTX, XLSX…). `Response` skips JSON
/// encoding, so the frontend receives an ArrayBuffer directly.
#[tauri::command]
pub fn read_file(app: AppHandle, area: String, owner_id: i64, stored_name: String) -> Result<Response, String> {
    let path = stored_path(&app, &area, owner_id, &stored_name)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("could not read {stored_name}: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn open_file(app: AppHandle, area: String, owner_id: i64, stored_name: String) -> Result<(), String> {
    let path = stored_path(&app, &area, owner_id, &stored_name)?;
    if !path.exists() {
        return Err(format!("{stored_name} is missing from the data folder"));
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(app: AppHandle, area: String, owner_id: i64, stored_name: String) -> Result<(), String> {
    match std::fs::remove_file(stored_path(&app, &area, owner_id, &stored_name)?) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Removes an owner's whole folder (an item's attachments, or a course's library).
#[tauri::command]
pub fn delete_owner_files(app: AppHandle, area: String, owner_id: i64) -> Result<(), String> {
    match std::fs::remove_dir_all(owner_dir(&app, &area, owner_id)?) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

// ---------- journal mood photos: <data dir>/journal/<YYYY-MM-DD>/<file> ----------

fn journal_dir(app: &AppHandle, day: &str) -> Result<PathBuf, String> {
    let valid = day.len() == 10 && day.chars().all(|c| c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(format!("invalid journal day: {day}"));
    }
    Ok(data_dir(app)?.join("journal").join(day))
}

/// Copies a photo into the day's journal folder and returns its stored file name.
#[tauri::command]
pub fn import_journal_photo(app: AppHandle, day: String, source_path: String) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    let name = source.file_name().and_then(|n| n.to_str()).ok_or("source path has no file name")?;
    let dir = journal_dir(&app, &day)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = unique_path(&dir, name);
    std::fs::copy(&source, &dest).map_err(|e| format!("could not copy {name}: {e}"))?;
    Ok(dest.file_name().unwrap().to_string_lossy().into_owned())
}

#[tauri::command]
pub fn journal_photo_path(app: AppHandle, day: String, stored_name: String) -> Result<String, String> {
    Ok(journal_dir(&app, &day)?.join(bare_name(&stored_name)?).to_string_lossy().into_owned())
}

#[tauri::command]
pub fn delete_journal_photo(app: AppHandle, day: String, stored_name: String) -> Result<(), String> {
    match std::fs::remove_file(journal_dir(&app, &day)?.join(bare_name(&stored_name)?)) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Writes an exported calendar to a path the user picked in a save dialog.
/// Only `.ics` targets are accepted, so this can't be used to overwrite arbitrary files.
#[tauri::command]
pub fn write_calendar_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("ics")) {
        return Err("calendar exports must end in .ics".into());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
