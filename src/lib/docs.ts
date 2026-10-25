// Belege (PDF, Bilder) werden als BLOB in der SQLite-Datenbank gespeichert und mit ihr gesichert.

import { get, run, scalar } from '../db/db';
import { todayISO, yearOf } from './format';

export const MAX_DOC_SIZE = 20 * 1024 * 1024;
export const ACCEPT_DOCS = 'application/pdf,image/png,image/jpeg,image/webp,image/heic';

/** Fortlaufende Belegnummer je Jahr, z. B. 2026-007 */
export function nextBelegNr(datum: string = todayISO()): string {
  const y = yearOf(datum);
  const max = scalar<number>(
    "SELECT MAX(CAST(substr(belegnr, 6) AS INTEGER)) FROM documents WHERE belegnr LIKE ?",
    [`${y}-%`],
  ) ?? 0;
  return `${y}-${String(max + 1).padStart(3, '0')}`;
}

export async function addDocument(
  file: File,
  meta: { transaction_id?: number | null; partner_id?: number | null; belegdatum?: string | null; beschreibung?: string | null },
): Promise<number> {
  if (file.size > MAX_DOC_SIZE) throw new Error(`„${file.name}" ist größer als 20 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const datum = meta.belegdatum ?? todayISO();
  return run(
    `INSERT INTO documents(belegnr, belegdatum, beschreibung, transaction_id, partner_id, dateiname, mime, groesse, daten)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [nextBelegNr(datum), datum, meta.beschreibung ?? null, meta.transaction_id ?? null, meta.partner_id ?? null,
      file.name, file.type || guessMime(file.name), file.size, bytes],
  );
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
}

export function documentBlobUrl(id: number): { url: string; mime: string; name: string } | null {
  const d = get<{ daten: Uint8Array; mime: string; dateiname: string }>('SELECT daten, mime, dateiname FROM documents WHERE id = ?', [id]);
  if (!d) return null;
  return { url: URL.createObjectURL(new Blob([d.daten as BlobPart], { type: d.mime })), mime: d.mime, name: d.dateiname };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
