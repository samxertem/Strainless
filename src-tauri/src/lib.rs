mod files;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Must match the URL the frontend passes to `Database.load` (src/lib/db.ts).
const DB_URL: &str = "sqlite:strainless.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial schema",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            files::import_attachment,
            files::open_attachment,
            files::delete_attachment_file,
            files::delete_item_files,
            files::open_data_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Strainless");
}
