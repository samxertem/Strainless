//! Backup = one zip holding `manifest.json`, a consistent snapshot of the
//! database (`strainless.db`, made by `VACUUM INTO` on the frontend side) and
//! the whole `attachments/` tree.
//!
//! Restore never deletes anything: the current data is first moved aside into
//! `pre-restore-<label>/` in the data folder, and moved back if anything fails.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::files::{bare_name, data_dir};
use crate::LATEST_SCHEMA;

const DB_FILE: &str = "strainless.db";
/// SQLite runs in WAL mode; these sidecar files belong to the live database.
const DB_SIDECARS: [&str; 2] = ["strainless.db-wal", "strainless.db-shm"];
const ATTACHMENTS: &str = "attachments";
const JOURNAL: &str = "journal";
const COURSES: &str = "courses";
/// Folders of user files that travel with the database.
const FILE_DIRS: [&str; 3] = [ATTACHMENTS, JOURNAL, COURSES];
const SNAPSHOT: &str = "backup-snapshot.db";
const MANIFEST: &str = "manifest.json";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Manifest {
    app: String,
    format: u32,
    schema_version: i64,
    created_at: String,
    item_count: i64,
    attachment_count: i64,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------- commands (thin wrappers over the path-based functions below) ----------

/// Where the frontend should `VACUUM INTO`. Any stale snapshot is removed first,
/// because VACUUM INTO refuses to overwrite an existing file.
#[tauri::command]
pub fn backup_snapshot_path(app: AppHandle) -> Result<String, String> {
    let path = data_dir(&app)?.join(SNAPSHOT);
    match fs::remove_file(&path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(err(e)),
        _ => {}
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn write_backup(app: AppHandle, dest: String, manifest: Manifest) -> Result<(), String> {
    write_backup_from(&data_dir(&app)?, Path::new(&dest), &manifest)
}

/// Validates a backup and returns its manifest, so the UI can show what's in it before restoring.
#[tauri::command]
pub fn inspect_backup(path: String) -> Result<Manifest, String> {
    open_backup(Path::new(&path)).map(|(_, manifest)| manifest)
}

/// Replaces the current data with the backup. The frontend must close its
/// database connection first (Windows can't move an open file).
#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String, label: String) -> Result<(), String> {
    restore_backup_into(&data_dir(&app)?, Path::new(&path), bare_name(&label)?)
}

// ---------- implementation ----------

fn write_backup_from(dir: &Path, dest: &Path, manifest: &Manifest) -> Result<(), String> {
    let snapshot = dir.join(SNAPSHOT);
    if !snapshot.exists() {
        return Err("database snapshot is missing; nothing was backed up".into());
    }

    // Write next to the destination, then rename: a crash never leaves a half-written zip under the real name.
    let partial = dest.with_extension("zip.partial");
    let result = (|| -> Result<(), String> {
        let mut zip = ZipWriter::new(BufWriter::new(File::create(&partial).map_err(err)?));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        zip.start_file(MANIFEST, options).map_err(err)?;
        zip.write_all(serde_json::to_string_pretty(manifest).map_err(err)?.as_bytes()).map_err(err)?;

        zip.start_file(DB_FILE, options).map_err(err)?;
        io::copy(&mut File::open(&snapshot).map_err(err)?, &mut zip).map_err(err)?;

        for folder in FILE_DIRS {
            if dir.join(folder).is_dir() {
                add_dir(&mut zip, &dir.join(folder), folder, options)?;
            }
        }
        zip.finish().map_err(err)?.flush().map_err(err)?;
        fs::rename(&partial, dest).map_err(err)
    })();

    let _ = fs::remove_file(&snapshot);
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn add_dir<W: Write + io::Seek>(
    zip: &mut ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = format!("{prefix}/{}", entry.file_name().to_string_lossy()); // zip paths always use '/'
        if entry.file_type().map_err(err)?.is_dir() {
            add_dir(zip, &entry.path(), &name, options)?;
        } else {
            zip.start_file(name, options).map_err(err)?;
            io::copy(&mut File::open(entry.path()).map_err(err)?, zip).map_err(err)?;
        }
    }
    Ok(())
}

fn open_backup(path: &Path) -> Result<(ZipArchive<BufReader<File>>, Manifest), String> {
    let file = File::open(path).map_err(|e| format!("could not open backup: {e}"))?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(|_| "this file is not a valid zip archive")?;
    let manifest: Manifest = {
        let entry = archive.by_name(MANIFEST).map_err(|_| "this zip is not a Strainless backup (no manifest)")?;
        serde_json::from_reader(entry).map_err(|e| format!("backup manifest is unreadable: {e}"))?
    };
    if manifest.app != "strainless" {
        return Err("this zip is not a Strainless backup".into());
    }
    if manifest.schema_version > LATEST_SCHEMA {
        return Err("this backup was made by a newer version of Strainless; update the app first".into());
    }
    if archive.by_name(DB_FILE).is_err() {
        return Err("backup is incomplete: the database is missing".into());
    }
    Ok((archive, manifest))
}

fn restore_backup_into(dir: &Path, backup: &Path, label: &str) -> Result<(), String> {
    let (mut archive, _) = open_backup(backup)?;
    let staging = dir.join("restore-staging");
    let aside = dir.join(format!("pre-restore-{label}"));

    // 1. Extract to a staging folder first; a corrupt zip fails here, before live data is touched.
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(err)?;
    let extracted = extract_allowed(&mut archive, &staging);
    if let Err(e) = extracted {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("backup could not be read, nothing was changed: {e}"));
    }

    // 2. Move the current data aside, 3. move the restored data in. Roll back on failure.
    let restored: Vec<&str> = [DB_FILE].into_iter().chain(FILE_DIRS).collect();
    let live: Vec<&str> = restored.iter().copied().chain(DB_SIDECARS).collect();
    fs::create_dir_all(&aside).map_err(err)?;
    let mut moved_aside: Vec<&str> = Vec::new();
    let mut moved_in: Vec<&str> = Vec::new();
    let mut swap = || -> Result<(), String> {
        for name in &live {
            if dir.join(name).exists() {
                fs::rename(dir.join(name), aside.join(name)).map_err(|e| format!("could not move {name} aside: {e}"))?;
                moved_aside.push(name);
            }
        }
        for name in &restored {
            if staging.join(name).exists() {
                fs::rename(staging.join(name), dir.join(name)).map_err(err)?;
                moved_in.push(name);
            }
        }
        Ok(())
    };

    if let Err(e) = swap() {
        for name in &moved_in {
            let _ = fs::rename(dir.join(name), staging.join(name));
        }
        for name in &moved_aside {
            let _ = fs::rename(aside.join(name), dir.join(name));
        }
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir(&aside); // only succeeds if empty, i.e. everything went back
        return Err(format!("restore failed, your data was left as it was: {e}"));
    }

    let _ = fs::remove_dir_all(&staging);
    Ok(())
}

/// Extracts only `strainless.db`, `attachments/**` and `journal/**`. `enclosed_name()`
/// rejects absolute paths and `..` components, so a malicious zip can't write outside `dest`.
fn extract_allowed(archive: &mut ZipArchive<BufReader<File>>, dest: &Path) -> Result<(), String> {
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(err)?;
        let Some(relative) = entry.enclosed_name() else { continue };
        if relative != Path::new(DB_FILE) && !FILE_DIRS.iter().any(|d| relative.starts_with(d)) {
            continue;
        }
        let target: PathBuf = dest.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(err)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(err)?;
            }
            io::copy(&mut entry, &mut File::create(&target).map_err(err)?).map_err(err)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A fresh, empty directory under the system temp dir.
    fn temp_dir(name: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("strainless-test-{}-{name}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifest(schema_version: i64) -> Manifest {
        Manifest {
            app: "strainless".into(),
            format: 1,
            schema_version,
            created_at: "2026-10-22T10:00:00.000Z".into(),
            item_count: 2,
            attachment_count: 2,
        }
    }

    fn write(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    /// Data folder with a "database" snapshot and nested attachments, backed up to a zip.
    fn make_backup(data: &Path, zip_path: &Path) {
        write(&data.join(SNAPSHOT), "DB v1");
        write(&data.join("attachments/1/syllabus.pdf"), "pdf bytes");
        write(&data.join("attachments/2/ÇAP form (2).docx"), "docx bytes");
        write(&data.join("journal/2026-10-22/mood.jpg"), "mood photo");
        write(&data.join("courses/1/Week 3 - Fourier.pptx"), "slides");
        write_backup_from(data, zip_path, &manifest(LATEST_SCHEMA)).unwrap();
    }

    #[test]
    fn backup_then_restore_round_trips_and_keeps_old_data_aside() {
        let data = temp_dir("roundtrip");
        let zip_path = data.join("backup.zip");
        make_backup(&data, &zip_path);
        assert!(!data.join(SNAPSHOT).exists(), "snapshot is cleaned up after backup");
        assert!(!data.join("backup.zip.partial").exists());

        // Life goes on: the live data changes after the backup.
        write(&data.join(DB_FILE), "DB v2");
        write(&data.join("strainless.db-wal"), "wal");
        write(&data.join("attachments/3/new.png"), "png");
        write(&data.join("journal/2026-10-23/later.jpg"), "later photo");

        restore_backup_into(&data, &zip_path, "test").unwrap();
        assert_eq!(read(&data.join("journal/2026-10-22/mood.jpg")), "mood photo");
        assert_eq!(read(&data.join("courses/1/Week 3 - Fourier.pptx")), "slides");
        assert!(!data.join("journal/2026-10-23").exists());
        assert_eq!(read(&data.join("pre-restore-test/journal/2026-10-23/later.jpg")), "later photo");

        assert_eq!(read(&data.join(DB_FILE)), "DB v1");
        assert_eq!(read(&data.join("attachments/1/syllabus.pdf")), "pdf bytes");
        assert_eq!(read(&data.join("attachments/2/ÇAP form (2).docx")), "docx bytes");
        assert!(!data.join("attachments/3").exists(), "attachments are replaced, not merged");
        assert!(!data.join("strainless.db-wal").exists(), "stale WAL must not sit next to the restored db");

        let aside = data.join("pre-restore-test");
        assert_eq!(read(&aside.join(DB_FILE)), "DB v2", "previous data is kept, not deleted");
        assert_eq!(read(&aside.join("strainless.db-wal")), "wal");
        assert_eq!(read(&aside.join("attachments/3/new.png")), "png");
        assert!(!data.join("restore-staging").exists());
    }

    #[test]
    fn inspect_reads_the_manifest() {
        let data = temp_dir("inspect");
        let zip_path = data.join("backup.zip");
        make_backup(&data, &zip_path);
        let m = open_backup(&zip_path).unwrap().1;
        assert_eq!((m.schema_version, m.item_count), (LATEST_SCHEMA, 2));
    }

    #[test]
    fn rejects_backups_from_newer_versions() {
        let data = temp_dir("newer");
        write(&data.join(SNAPSHOT), "db");
        let zip_path = data.join("future.zip");
        write_backup_from(&data, &zip_path, &manifest(LATEST_SCHEMA + 1)).unwrap();
        let e = open_backup(&zip_path).unwrap_err();
        assert!(e.contains("newer version"), "{e}");
    }

    #[test]
    fn rejects_files_that_are_not_backups() {
        let data = temp_dir("notzip");
        write(&data.join("notes.zip"), "definitely not a zip");
        assert!(open_backup(&data.join("notes.zip")).unwrap_err().contains("not a valid zip"));

        let other = data.join("other.zip");
        let mut zip = ZipWriter::new(File::create(&other).unwrap());
        zip.start_file("readme.txt", SimpleFileOptions::default()).unwrap();
        zip.finish().unwrap();
        assert!(open_backup(&other).unwrap_err().contains("no manifest"));
    }

    #[test]
    fn zip_slip_entries_are_ignored() {
        let data = temp_dir("zipslip");
        let live = data.join("live");
        write(&live.join(DB_FILE), "current");

        let evil = data.join("evil.zip");
        let mut zip = ZipWriter::new(File::create(&evil).unwrap());
        let o = SimpleFileOptions::default();
        zip.start_file(MANIFEST, o).unwrap();
        zip.write_all(serde_json::to_string(&manifest(1)).unwrap().as_bytes()).unwrap();
        zip.start_file(DB_FILE, o).unwrap();
        zip.write_all(b"restored").unwrap();
        zip.start_file("../escaped.txt", o).unwrap();
        zip.write_all(b"pwned").unwrap();
        zip.start_file("attachments/../../escaped2.txt", o).unwrap();
        zip.write_all(b"pwned").unwrap();
        zip.start_file("unexpected/top-level.txt", o).unwrap();
        zip.write_all(b"ignored").unwrap();
        zip.finish().unwrap();

        restore_backup_into(&live, &evil, "x").unwrap();
        assert_eq!(read(&live.join(DB_FILE)), "restored");
        assert!(!data.join("escaped.txt").exists());
        assert!(!data.join("escaped2.txt").exists());
        assert!(!live.join("unexpected").exists());
    }

    #[test]
    fn backup_without_snapshot_fails_cleanly() {
        let data = temp_dir("nosnap");
        let e = write_backup_from(&data, &data.join("b.zip"), &manifest(1)).unwrap_err();
        assert!(e.contains("snapshot is missing"));
        assert!(!data.join("b.zip").exists());
    }
}
