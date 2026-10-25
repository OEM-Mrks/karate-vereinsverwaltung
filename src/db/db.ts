// Zentrale SQLite-Datenbank (sql.js / WebAssembly) – läuft vollständig im Browser.
// Änderungen werden automatisch im Browser-Speicher (IndexedDB) gesichert und können jederzeit
// als .sqlite-Datei heruntergeladen und wieder geöffnet werden.

import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { DEFAULT_CATEGORIES, DEFAULT_FEE_GROUPS, DEFAULT_RULES } from './seed';

/** Kennung in der SQLite-Datei, damit wir fremde Datenbanken erkennen. */
const APPLICATION_ID = 0x4b415241; // "KARA"

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let version = 0;
const listeners = new Set<() => void>();
let persistHandler: ((bytes: Uint8Array) => Promise<void>) | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let batchDepth = 0;
let pendingNotify = false;

export type Param = SqlValue | boolean | undefined;

export function setSqlJs(s: SqlJsStatic) {
  SQL = s;
}

export function hasDatabase(): boolean {
  return db !== null;
}

function requireDb(): Database {
  if (!db) throw new Error('Keine Datenbank geöffnet');
  return db;
}

function clean(params: Param[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function all<T = Record<string, unknown>>(sql: string, params: Param[] = []): T[] {
  const stmt = requireDb().prepare(sql);
  try {
    stmt.bind(clean(params));
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function get<T = Record<string, unknown>>(sql: string, params: Param[] = []): T | undefined {
  return all<T>(sql, params)[0];
}

export function scalar<T = number>(sql: string, params: Param[] = []): T | undefined {
  const row = get<Record<string, unknown>>(sql, params);
  return row ? (Object.values(row)[0] as T) : undefined;
}

/** Führt eine schreibende Anweisung aus und gibt die neue Zeilen-ID zurück. */
export function run(sql: string, params: Param[] = []): number {
  const d = requireDb();
  d.run(sql, clean(params));
  const id = Number(d.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0);
  changed();
  return id;
}

/** Mehrere Änderungen atomar (alles oder nichts). */
export function tx<T>(fn: () => T): T {
  const d = requireDb();
  const outer = batchDepth === 0;
  if (outer) d.run('BEGIN');
  batchDepth++;
  try {
    const result = fn();
    batchDepth--;
    if (outer) d.run('COMMIT');
    if (outer && pendingNotify) changed();
    return result;
  } catch (e) {
    batchDepth--;
    if (outer) {
      d.run('ROLLBACK');
      pendingNotify = false;
    }
    throw e;
  }
}

function changed() {
  if (batchDepth > 0) {
    pendingNotify = true;
    return;
  }
  pendingNotify = false;
  version++;
  bumpUnsaved();
  listeners.forEach((l) => l());
  schedulePersist();
}

function bumpUnsaved() {
  const d = requireDb();
  d.run(
    `INSERT INTO meta(key, value) VALUES('changes_since_export', '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`,
  );
}

// ---------- Reaktivität für React (useSyncExternalStore) ----------

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getVersion(): number {
  return version;
}

/** Erzwingt ein Neuzeichnen (z. B. nach dem Öffnen einer anderen Datenbank). */
export function notifyAll() {
  version++;
  listeners.forEach((l) => l());
}

// ---------- Persistenz ----------

export function setPersistHandler(h: (bytes: Uint8Array) => Promise<void>) {
  persistHandler = h;
}

function schedulePersist() {
  if (!persistHandler) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flush();
  }, 400);
}

export async function flush(): Promise<void> {
  if (!db || !persistHandler) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistHandler(exportBytes());
}

export function exportBytes(): Uint8Array {
  const d = requireDb();
  const bytes = d.export();
  // export() schließt offene Statements und setzt Pragmas zurück
  d.run('PRAGMA foreign_keys = ON');
  return bytes;
}

// ---------- Einstellungen ----------

export function getSetting(key: string, fallback = ''): string {
  const v = scalar<string>('SELECT value FROM meta WHERE key = ?', [key]);
  return v ?? fallback;
}

export function setSetting(key: string, value: string | number) {
  run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
}

export function markExported() {
  requireDb().run(
    `INSERT INTO meta(key, value) VALUES('changes_since_export', '0') ON CONFLICT(key) DO UPDATE SET value = '0'`,
  );
  requireDb().run(
    `INSERT INTO meta(key, value) VALUES('last_export_at', datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  notifyAll();
  schedulePersist();
}

// ---------- Anlegen / Öffnen ----------

/** Spalten, die nach dem ersten Release hinzukamen – CREATE TABLE IF NOT EXISTS legt sie in alten Dateien nicht an. */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ['transactions', 'belege_vollstaendig', 'INTEGER NOT NULL DEFAULT 0'],
  ['documents', 'eigenbeleg', 'INTEGER NOT NULL DEFAULT 0'],
];

function migrate(d: Database) {
  d.run('PRAGMA foreign_keys = ON');
  d.exec(SCHEMA_SQL);
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const cols = d.exec(`PRAGMA table_info(${table})`)[0]?.values.map((r) => r[1]) ?? [];
    if (!cols.includes(column)) d.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  d.run(`PRAGMA application_id = ${APPLICATION_ID}`);
  d.run(
    `INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(SCHEMA_VERSION)],
  );
}

export function createNew(options: { vereinName?: string; withDefaults?: boolean } = {}) {
  if (!SQL) throw new Error('SQLite ist noch nicht geladen');
  db?.close();
  const d = new SQL.Database();
  migrate(d);
  db = d;
  batchDepth = 0;
  tx(() => {
    setSetting('verein_name', options.vereinName || 'Mein Karateverein e. V.');
    setSetting('kuendigungsfrist_monate', 3);
    setSetting('beitragskonto_ab', new Date().getFullYear());
    setSetting('created_at', new Date().toISOString());
    if (options.withDefaults !== false) seedDefaults();
  });
  notifyAll();
}

function seedDefaults() {
  for (const c of DEFAULT_CATEGORIES) {
    run(
      'INSERT INTO categories(nummer, name, typ, sphaere, mitgliedskonto, beleg_pflicht) VALUES (?,?,?,?,?,?)',
      [c.nummer, c.name, c.typ, c.sphaere, c.mitgliedskonto ?? 0, c.beleg_pflicht ?? 0],
    );
  }
  const beitrag = scalar<number>("SELECT id FROM categories WHERE nummer = '4010'");
  if (beitrag) setSetting('beitrag_category_id', beitrag);
  const year = new Date().getFullYear();
  DEFAULT_FEE_GROUPS.forEach((g, i) => {
    const id = run('INSERT INTO fee_groups(name, beschreibung, sort) VALUES (?,?,?)', [g.name, g.beschreibung, i]);
    run('INSERT INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) VALUES (?,?,?)', [id, year, g.monat_cent]);
  });
  for (const r of DEFAULT_RULES) {
    const cat = scalar<number>('SELECT id FROM categories WHERE nummer = ?', [r.nummer]);
    run('INSERT INTO rules(name, prioritaet, text_enthaelt, richtung, category_id) VALUES (?,?,?,?,?)', [
      r.name, 900, r.text_enthaelt, r.richtung, cat ?? null,
    ]);
  }
}

/** Öffnet eine vorhandene SQLite-Datei. Wirft einen Fehler, wenn es keine Datei dieser App ist. */
export function openBytes(bytes: Uint8Array) {
  if (!SQL) throw new Error('SQLite ist noch nicht geladen');
  let d: Database;
  try {
    d = new SQL.Database(bytes);
    const appId = Number(d.exec('PRAGMA application_id')[0]?.values[0][0] ?? 0);
    const hasMeta = d.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").length > 0;
    if (appId !== APPLICATION_ID && !hasMeta) {
      d.close();
      throw new Error('Diese Datei ist keine Datenbank der Vereinsverwaltung.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Diese Datei')) throw e;
    throw new Error('Die Datei konnte nicht als SQLite-Datenbank gelesen werden.');
  }
  migrate(d);
  db?.close();
  db = d;
  batchDepth = 0;
  notifyAll();
}

export function closeDatabase() {
  db?.close();
  db = null;
  notifyAll();
}
