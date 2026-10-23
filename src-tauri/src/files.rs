//! File storage. User files are copied into `<data dir>/<area>/<owner id>/`, so the
//! app owns its copy and nothing breaks when the original is moved:
//!   attachments/<item id>/…   files attached to an item
//!   courses/<course id>/…     a course's library (slides, PDFs, pasted images)
//!   documents/0/…             the Documents page (folders are only rows in the database)
//!   journal/<YYYY-MM-DD>/…    the day's mood photo

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// The same directory tauri-plugin-sql resolves `sqlite:strainless.db` against,
/// so the database and the files live side by side.
pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Storage areas the frontend may address. Anything else is rejected.
const AREAS: [&str; 3] = ["attachments", "courses", "documents"];

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

// ---------- adding whole folders ----------

/// Folders bigger than this are almost certainly a mistake (a whole drive dropped by accident).
const MAX_SCANNED_FILES: usize = 5000;

/// A file found inside a picked or dropped folder. `folders` is the chain of folder
/// names from the picked folder down to the file; empty for a file picked on its own.
#[derive(Serialize)]
pub struct ScannedFile {
    path: String,
    folders: Vec<String>,
    name: String,
    size: u64,
}

#[derive(Serialize, Default)]
pub struct Scan {
    files: Vec<ScannedFile>,
    /// Every folder, as its chain of names, including empty ones.
    folders: Vec<Vec<String>>,
}

/// System clutter that never belongs in a library: desktop.ini, Thumbs.db, .DS_Store,
/// hidden files, and Office's `~$report.docx` lock files.
fn is_junk(name: &str) -> bool {
    let lower = name.to_lowercase();
    name.starts_with('.') || name.starts_with("~$") || lower == "desktop.ini" || lower == "thumbs.db"
}

/// Lists the files under the given paths (files as they are, folders recursively),
/// so the frontend can recreate the folder structure. Copies nothing.
#[tauri::command]
pub fn scan_paths(paths: Vec<String>) -> Result<Scan, String> {
    let mut scan = Scan::default();
    for path in paths {
        scan_into(Path::new(&path), &mut Vec::new(), &mut scan)?;
    }
    Ok(scan)
}

fn scan_into(path: &Path, folders: &mut Vec<String>, scan: &mut Scan) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{} has no name", path.display()))?;
    // symlink_metadata: links and junctions are skipped, never followed (they can loop).
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("could not read {name}: {e}"))?;
    if meta.file_type().is_symlink() || (!folders.is_empty() && is_junk(&name)) {
        return Ok(());
    }
    if meta.is_dir() {
        folders.push(name);
        scan.folders.push(folders.clone());
        let mut entries: Vec<PathBuf> = std::fs::read_dir(path)
            .map_err(|e| format!("could not open {}: {e}", path.display()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .collect();
        entries.sort();
        for entry in entries {
            scan_into(&entry, folders, scan)?;
        }
        folders.pop();
    } else {
        if scan.files.len() >= MAX_SCANNED_FILES {
            return Err(format!("that folder has more than {MAX_SCANNED_FILES} files; pick a smaller one"));
        }
        scan.files.push(ScannedFile {
            path: path.to_string_lossy().into_owned(),
            folders: folders.clone(),
            name,
            size: meta.len(),
        });
    }
    Ok(())
}

// ---------- exporting as a normal folder ----------

/// One file to write into an export: a stored file, or text made by the app (notes as .md).
/// `path` is the folder names plus the file name, relative to the export folder.
#[derive(Deserialize)]
pub struct ExportEntry {
    path: Vec<String>,
    area: Option<String>,
    owner_id: Option<i64>,
    stored_name: Option<String>,
    text: Option<String>,
}

/// Makes a name safe as one Windows/macOS path component: no separators or
/// reserved characters, no trailing dots or spaces, no reserved device names.
fn safe_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    match cleaned.as_str() {
        "" | "." | ".." => "_".into(),
        _ if reserved => format!("_{cleaned}"),
        _ => cleaned,
    }
}

/// Writes the entries into a new folder `<dest>/<name>` (`name (2)` if taken), then
/// opens it. Returns the folder's path. Async: a big library takes a while to copy.
#[tauri::command]
pub async fn export_folder(app: AppHandle, dest: String, name: String, entries: Vec<ExportEntry>) -> Result<String, String> {
    let data = data_dir(&app)?;
    let target = unique_path(Path::new(&dest), &safe_component(&name));
    let folder = target.clone();
    tauri::async_runtime::spawn_blocking(move || export_entries(&data, &folder, &entries))
        .await
        .map_err(|e| e.to_string())??;
    let shown = target.to_string_lossy().into_owned();
    app.opener().open_path(shown.clone(), None::<&str>).map_err(|e| e.to_string())?;
    Ok(shown)
}

fn export_entries(data: &Path, folder: &Path, entries: &[ExportEntry]) -> Result<(), String> {
    std::fs::create_dir_all(folder).map_err(|e| format!("could not create {}: {e}", folder.display()))?;
    for entry in entries {
        let Some((file_name, dirs)) = entry.path.split_last() else { continue };
        let dir = dirs.iter().fold(folder.to_path_buf(), |p, d| p.join(safe_component(d)));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = unique_path(&dir, &safe_component(file_name));
        if let Some(text) = &entry.text {
            std::fs::write(&dest, text).map_err(|e| format!("could not write {file_name}: {e}"))?;
            continue;
        }
        let (Some(area), Some(owner), Some(stored)) = (&entry.area, entry.owner_id, &entry.stored_name) else {
            return Err(format!("nothing to export for {file_name}"));
        };
        if !AREAS.contains(&area.as_str()) {
            return Err(format!("unknown storage area: {area}"));
        }
        let source = data.join(area).join(owner.to_string()).join(bare_name(stored)?);
        std::fs::copy(&source, &dest).map_err(|e| format!("could not copy {file_name}: {e}"))?;
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_names_are_safe_on_every_system() {
        assert_eq!(safe_component("CE 477: Signals / Systems?"), "CE 477_ Signals _ Systems_");
        assert_eq!(safe_component("notes. "), "notes");
        assert_eq!(safe_component("con.txt"), "_con.txt");
        assert_eq!(safe_component(".."), "_");
        assert_eq!(safe_component("Hafta 3 · Türev.pdf"), "Hafta 3 · Türev.pdf");
    }

    #[test]
    fn export_writes_files_and_text_into_folders() {
        let root = std::env::temp_dir().join(format!("strainless-export-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let data = root.join("data");
        std::fs::create_dir_all(data.join("courses/3")).unwrap();
        std::fs::write(data.join("courses/3/intro.pdf"), "pdf").unwrap();
        let out = root.join("out/CE 477");
        let entries = vec![
            ExportEntry { path: vec!["Week 1".into(), "intro.pdf".into()], area: Some("courses".into()), owner_id: Some(3), stored_name: Some("intro.pdf".into()), text: None },
            ExportEntry { path: vec!["Notes".into(), "Lab: day 1.md".into()], area: None, owner_id: None, stored_name: None, text: Some("# Lab".into()) },
            ExportEntry { path: vec!["x".into()], area: Some("courses".into()), owner_id: Some(3), stored_name: Some("../../secret".into()), text: None },
        ];
        let e = export_entries(&data, &out, &entries).unwrap_err();
        assert!(e.contains("invalid file name"), "{e}");
        assert_eq!(std::fs::read_to_string(out.join("Week 1/intro.pdf")).unwrap(), "pdf");
        assert_eq!(std::fs::read_to_string(out.join("Notes/Lab_ day 1.md")).unwrap(), "# Lab");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_keeps_folder_structure_and_skips_clutter() {
        let root = std::env::temp_dir().join(format!("strainless-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let course = root.join("CE 477 - Signals");
        for (rel, body) in [
            ("Week 1/intro.pdf", "pdf"),
            ("Week 2/Slides/fourier.pptx", "slides!"),
            ("syllabus.docx", "doc"),
            ("Week 1/desktop.ini", "x"),
            ("Week 1/~$draft.docx", "x"),
            (".git/config", "x"),
        ] {
            let path = course.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        std::fs::create_dir_all(course.join("Week 3")).unwrap();

        let scan = scan_paths(vec![course.to_string_lossy().into_owned()]).unwrap();
        let files: Vec<(String, Vec<String>, u64)> =
            scan.files.iter().map(|f| (f.name.clone(), f.folders.clone(), f.size)).collect();
        let top = "CE 477 - Signals".to_string();
        assert_eq!(files, vec![
            ("intro.pdf".into(), vec![top.clone(), "Week 1".into()], 3),
            ("fourier.pptx".into(), vec![top.clone(), "Week 2".into(), "Slides".into()], 7),
            ("syllabus.docx".into(), vec![top.clone()], 3),
        ]);
        assert!(scan.folders.contains(&vec![top.clone(), "Week 3".into()]), "empty folders are kept");
        assert!(!scan.folders.iter().any(|f| f.contains(&".git".to_string())));

        let single = scan_paths(vec![course.join("syllabus.docx").to_string_lossy().into_owned()]).unwrap();
        assert_eq!(single.files[0].folders, Vec::<String>::new());
        let _ = std::fs::remove_dir_all(&root);
    }
}
