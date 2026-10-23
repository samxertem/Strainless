mod backup;
mod files;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Must match the URL the frontend passes to `Database.load` (src/lib/db.ts).
const DB_URL: &str = "sqlite:strainless.db";

/// Migrations are append-only: never edit one that has shipped. sqlx stores a
/// checksum of each applied migration and refuses to start if the file changes.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "initial schema", include_str!("../migrations/001_init.sql")),
    (2, "full-text search", include_str!("../migrations/002_search.sql")),
    (3, "settings and reminders", include_str!("../migrations/003_settings_reminders.sql")),
    (4, "journal and soft colours", include_str!("../migrations/004_journal_soft_colors.sql")),
    (5, "courses, library, highlights", include_str!("../migrations/005_courses_highlights.sql")),
    (6, "text inside files", include_str!("../migrations/006_file_text.sql")),
    (7, "exam topics", include_str!("../migrations/007_exam_topics.sql")),
    (8, "pen drawings", include_str!("../migrations/008_ink.sql")),
    (9, "folders and documents", include_str!("../migrations/009_folders.sql")),
];

/// Highest schema version this build understands; backups from newer builds are refused.
pub(crate) const LATEST_SCHEMA: i64 = MIGRATIONS[MIGRATIONS.len() - 1].0;

#[tauri::command]
fn latest_schema_version() -> i64 {
    LATEST_SCHEMA
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = MIGRATIONS
        .iter()
        .map(|&(version, description, sql)| Migration { version, description, sql, kind: MigrationKind::Up })
        .collect();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            latest_schema_version,
            files::import_file,
            files::import_bytes,
            files::file_path,
            files::read_file,
            files::open_file,
            files::delete_file,
            files::delete_owner_files,
            files::open_data_folder,
            files::scan_paths,
            files::export_folder,
            files::write_calendar_file,
            files::import_journal_photo,
            files::journal_photo_path,
            files::delete_journal_photo,
            backup::backup_snapshot_path,
            backup::write_backup,
            backup::inspect_backup,
            backup::restore_backup,
            backup::prune_auto_backups,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Strainless");
}
