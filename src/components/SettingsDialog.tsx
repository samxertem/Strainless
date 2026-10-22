import { useState, type ReactNode } from 'react';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { Archive, BellRing, CalendarDays, FolderOpen, RotateCcw } from 'lucide-react';
import type { Category, Course, CourseSession, Item, Settings } from '../lib/types';
import type { ThemePref } from '../lib/hooks';
import * as db from '../lib/db';
import { buildIcs } from '../lib/ics';
import { AUTO_BACKUPS_KEPT } from '../lib/autoBackup';
import { toDateInput } from '../lib/dates';
import { ensureNotificationPermission } from '../lib/reminders';
import { Button, Modal, Segmented } from './ui';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  themePref: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
  items: Item[];
  categoriesById: Map<number, Category>;
  courses: Course[];
  sessions: CourseSession[];
  onClose: () => void;
}

type Status = { kind: 'ok' | 'error'; text: string; path?: string } | null;

const ZIP_FILTER = [{ name: 'Strainless backup', extensions: ['zip'] }];
const fullDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function SettingsDialog({
  settings, onChange, themePref, onThemeChange, items, categoriesById, courses, sessions, onClose,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const attempt = async (label: string, op: () => Promise<void>) => {
    setBusy(label);
    setStatus(null);
    try {
      await op();
    } catch (e) {
      setStatus({ kind: 'error', text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = () =>
    attempt('backup', async () => {
      const dest = await save({ title: 'Save backup', defaultPath: `Strainless-backup-${toDateInput(new Date())}.zip`, filters: ZIP_FILTER });
      if (!dest) return;
      const manifest = await db.exportBackup(dest);
      onChange({ lastBackupAt: manifest.created_at });
      setStatus({ kind: 'ok', text: `Backed up ${manifest.item_count} items and ${manifest.attachment_count} files.`, path: dest });
    });

  const restoreBackup = () =>
    attempt('restore', async () => {
      const path = await open({ title: 'Choose a Strainless backup', filters: ZIP_FILTER, multiple: false });
      if (!path || Array.isArray(path)) return;
      const manifest = await db.inspectBackup(path);
      const ok = await ask(
        `Restore the backup from ${fullDate.format(new Date(manifest.created_at))}?\n\n` +
          `It has ${manifest.item_count} items and ${manifest.attachment_count} attachments, and replaces everything currently in Strainless.\n\n` +
          `Your current data is not deleted: it is moved to a "pre-restore" folder inside the data folder.`,
        { title: 'Restore backup', kind: 'warning', okLabel: 'Restore', cancelLabel: 'Cancel' },
      );
      if (!ok) return;
      await db.restoreBackup(path);
      window.location.reload();
    });

  const exportCalendar = () =>
    attempt('calendar', async () => {
      const dest = await save({ title: 'Export deadlines', defaultPath: 'Strainless-deadlines.ics', filters: [{ name: 'Calendar', extensions: ['ics'] }] });
      if (!dest) return;
      const open = items.filter((i) => i.status !== 'done' && i.due_at).length;
      await db.writeCalendarFile(dest, buildIcs(items, categoriesById, new Date(), { courses, sessions }));
      const classes = sessions.length ? ` and ${sessions.length} weekly class${sessions.length === 1 ? '' : 'es'}` : '';
      setStatus({ kind: 'ok', text: `Exported ${open} deadlines${classes}. Import the file into Google Calendar, Apple Calendar or Outlook.`, path: dest });
    });

  const testNotification = () =>
    attempt('test', async () => {
      if (!(await ensureNotificationPermission())) throw new Error('Notifications are blocked for Strainless in your system settings.');
      sendNotification({ title: 'Strainless', body: 'Reminders are working. You will be nudged before deadlines.' });
    });

  const lastBackup = settings.lastBackupAt ? fullDate.format(new Date(settings.lastBackupAt)) : 'Never';

  const pickAutoBackupFolder = () =>
    attempt('folder', async () => {
      const dir = await open({ title: 'Choose a folder for weekly backups', directory: true, multiple: false });
      if (dir && !Array.isArray(dir)) onChange({ autoBackupDir: dir });
    });

  return (
    <Modal title="Settings" onClose={onClose} width="w-[600px]">
      <div className="divide-y divide-line">
        <Group title="Appearance">
          <Segmented value={themePref} onChange={onThemeChange}
            options={[{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Group>

        <Group title="Reminders" hint="Desktop notifications while Strainless is open. Missed ones catch up when you open the app.">
          <Toggle checked={settings.remindersEnabled} onChange={(v) => onChange({ remindersEnabled: v })} label="Remind me about deadlines" />
          <div className={`mt-2 ml-7 space-y-1.5 ${settings.remindersEnabled ? '' : 'pointer-events-none opacity-40'}`}>
            <Toggle small checked={settings.remindDayBefore} onChange={(v) => onChange({ remindDayBefore: v })}
              label="A day before" detail="24 h before timed deadlines · 09:00 the day before all-day ones" />
            <Toggle small checked={settings.remindSameDay} onChange={(v) => onChange({ remindSameDay: v })}
              label="Shortly before" detail="1 h before timed deadlines · 09:00 on the day for all-day ones" />
          </div>
          <div className="mt-3">
            <Button onClick={testNotification} disabled={busy !== null}><BellRing size={14} /> Send a test notification</Button>
          </div>
        </Group>

        <Group title="Backup" hint={`Last backup: ${lastBackup}. One zip with every item, note and attachment.`}>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={exportBackup} disabled={busy !== null}>
              <Archive size={14} /> {busy === 'backup' ? 'Backing up…' : 'Back up now…'}
            </Button>
            <Button onClick={restoreBackup} disabled={busy !== null}>
              <RotateCcw size={14} /> {busy === 'restore' ? 'Restoring…' : 'Restore from backup…'}
            </Button>
          </div>
          <div className="mt-4">
            <Toggle checked={settings.autoBackupDir !== null}
              onChange={(on) => (on ? pickAutoBackupFolder() : onChange({ autoBackupDir: null }))}
              label="Back up automatically every week"
              detail={`Keeps the ${AUTO_BACKUPS_KEPT} newest. A folder inside OneDrive or Google Drive keeps a copy off this computer too.`} />
            {settings.autoBackupDir && (
              <div className="mt-2 ml-12 flex items-center gap-2 text-xs">
                <FolderOpen size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 truncate text-ink" title={settings.autoBackupDir}>{settings.autoBackupDir}</span>
                <button type="button" onClick={pickAutoBackupFolder} className="shrink-0 font-medium text-accent hover:underline">Change…</button>
              </div>
            )}
          </div>
        </Group>

        <Group title="Calendar" hint="Puts your open deadlines and your weekly timetable into the calendar on your phone. Re-export any time; re-importing updates events instead of duplicating them.">
          <Button onClick={exportCalendar} disabled={busy !== null}><CalendarDays size={14} /> Export deadlines & classes (.ics)…</Button>
        </Group>

        <Group title="Data" hint="Everything lives on this computer: a SQLite database plus an attachments folder. No account, no cloud.">
          <Button onClick={() => void attempt('folder', db.openDataFolder)}><FolderOpen size={14} /> Open data folder</Button>
        </Group>

        <Group title="Keyboard">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {[
              ['Ctrl/⌘ N', 'Add an item'],
              ['Ctrl/⌘ K', 'Search everything'],
              ['Ctrl/⌘ ,', 'Settings'],
              ['Esc', 'Close the open panel'],
              ['← →', 'Previous / next file in preview'],
            ].map(([key, what]) => (
              <div key={key} className="contents">
                <dt><kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink">{key}</kbd></dt>
                <dd className="text-muted">{what}</dd>
              </div>
            ))}
          </dl>
        </Group>
      </div>

      {status && (
        <div className={`mx-5 mb-5 flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${
          status.kind === 'ok' ? 'bg-accent-soft text-ink' : 'bg-danger-soft text-ink'}`}>
          <span className="flex-1 break-words">{status.text}</span>
          {status.path && (
            <button type="button" onClick={() => void revealItemInDir(status.path!)}
              className="shrink-0 text-xs font-medium text-accent hover:underline">Show file</button>
          )}
        </div>
      )}
    </Modal>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 mb-3 text-xs text-muted">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label, detail, small }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; detail?: string; small?: boolean;
}) {
  return (
    <label className="flex cursor-default items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 shrink-0 rounded-full transition-colors ${small ? 'h-4 w-7' : 'h-5 w-9'} ${checked ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 left-0.5 rounded-full bg-surface shadow transition-transform ${
          small ? 'size-3' : 'size-4'} ${checked ? (small ? 'translate-x-3' : 'translate-x-4') : ''}`} />
      </button>
      <span>
        <span className={`block text-ink ${small ? 'text-[13px]' : 'text-sm'}`}>{label}</span>
        {detail && <span className="block text-xs text-muted">{detail}</span>}
      </span>
    </label>
  );
}
