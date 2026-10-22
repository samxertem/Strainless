// Weekly automatic backup into a folder the user picked (OneDrive, Google Drive,
// a USB stick…). Uses the same zip as "Back up now", and keeps only the newest few.

import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import type { BackupManifest, Settings } from './types';
import { exportBackup } from './db';
import { dayDiff, toDateInput } from './dates';

export const AUTO_BACKUP_EVERY_DAYS = 7;
export const AUTO_BACKUPS_KEPT = 4;

/** True when automatic backup is on and the last backup (made any way) is a week old. */
export function autoBackupDue(settings: Settings, now: Date): boolean {
  if (!settings.autoBackupDir) return false;
  return !settings.lastBackupAt || dayDiff(new Date(settings.lastBackupAt), now) >= AUTO_BACKUP_EVERY_DAYS;
}

/** Writes Strainless-auto-<date>.zip into the folder, then removes all but the newest few. */
export async function runAutoBackup(dir: string): Promise<BackupManifest> {
  const manifest = await exportBackup(await join(dir, `Strainless-auto-${toDateInput(new Date())}.zip`));
  await invoke('prune_auto_backups', { dir, keep: AUTO_BACKUPS_KEPT });
  return manifest;
}
