// Start der App, automatisches Speichern im Browser, Sicherung als Datei und Wiederherstellung.

import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { closeDatabase, createNew, exportBytes, flush, getSetting, hasDatabase, markExported, openBytes, setPersistHandler, setSqlJs } from './db';
import { clearBrowser, downloadBlob, loadFromBrowser, requestPersistentStorage, saveToBrowser } from './storage';
import { loadDemo } from './demo';

export type SaveState = { saving: boolean; error: string | null; savedAt: Date | null };
let saveState: SaveState = { saving: false, error: null, savedAt: null };
const saveListeners = new Set<() => void>();

export function getSaveState() {
  return saveState;
}
export function subscribeSave(l: () => void) {
  saveListeners.add(l);
  return () => saveListeners.delete(l);
}
function setSave(s: Partial<SaveState>) {
  saveState = { ...saveState, ...s };
  saveListeners.forEach((l) => l());
}

/** Lädt SQLite (WebAssembly) und die zuletzt verwendete Datenbank aus dem Browser-Speicher. */
export async function boot(): Promise<{ restored: boolean }> {
  // Das WebAssembly-Modul ist in die App eingebettet – es wird nichts aus dem Internet geladen.
  const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
  const SQL = await initSqlJs({ wasmBinary });
  setSqlJs(SQL);
  setPersistHandler(async (bytes) => {
    setSave({ saving: true });
    try {
      await saveToBrowser(bytes);
      setSave({ saving: false, error: null, savedAt: new Date() });
    } catch (e) {
      setSave({ saving: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  void requestPersistentStorage();
  const stored = await loadFromBrowser();
  if (stored) {
    try {
      openBytes(stored);
      return { restored: true };
    } catch (e) {
      console.error('Gespeicherte Datenbank konnte nicht geöffnet werden', e);
    }
  }
  return { restored: false };
}

window.addEventListener('beforeunload', () => {
  if (hasDatabase()) void flush();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && hasDatabase()) void flush();
});

export async function startNew(vereinName: string) {
  createNew({ vereinName });
  await flush();
}

export async function startDemo() {
  loadDemo();
  await flush();
}

export async function openFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  openBytes(bytes);
  // Frisch geöffnete Datei gilt als gesichert
  markExported();
  await flush();
}

function backupName(): string {
  const verein = getSetting('verein_name', 'verein')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${verein || 'verein'}_${stamp}.sqlite`;
}

type SaveFilePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable: () => Promise<{ write: (d: BlobPart) => Promise<void>; close: () => Promise<void> }>;
}>;

/** Speichert die komplette Datenbank (inkl. Belege) als .sqlite-Datei. */
export async function downloadBackup(): Promise<boolean> {
  const bytes = exportBytes();
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: backupName(),
        types: [{ description: 'SQLite-Datenbank', accept: { 'application/vnd.sqlite3': ['.sqlite'] } }],
      });
      const w = await handle.createWritable();
      await w.write(bytes as BlobPart);
      await w.close();
      markExported();
      await flush();
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      // Fallback: normaler Download
    }
  }
  downloadBlob(bytes as BlobPart, backupName(), 'application/vnd.sqlite3');
  markExported();
  await flush();
  return true;
}

/** Entfernt alle Daten aus diesem Browser. */
export async function wipeBrowser() {
  closeDatabase();
  await clearBrowser();
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('vv:')).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignorieren */
  }
}
