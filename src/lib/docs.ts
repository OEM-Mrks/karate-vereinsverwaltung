// Belege (PDF, Bilder) werden als BLOB in der SQLite-Datenbank gespeichert und mit ihr gesichert.

import { all, get, run, scalar } from '../db/db';
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
  file: Blob & { name: string },
  meta: {
    transaction_id?: number | null; partner_id?: number | null; belegdatum?: string | null; beschreibung?: string | null;
    belegnr?: string; eigenbeleg?: boolean;
  },
): Promise<number> {
  if (file.size > MAX_DOC_SIZE) throw new Error(`„${file.name}" ist größer als 20 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const datum = meta.belegdatum ?? todayISO();
  return run(
    `INSERT INTO documents(belegnr, belegdatum, beschreibung, transaction_id, partner_id, dateiname, mime, groesse, daten, eigenbeleg)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [meta.belegnr ?? nextBelegNr(datum), datum, meta.beschreibung ?? null, meta.transaction_id ?? null, meta.partner_id ?? null,
      file.name, file.type || guessMime(file.name), file.size, bytes, meta.eigenbeleg ? 1 : 0],
  );
}

// ---------- Belegpflicht ----------
// Eine Buchung braucht so viele Belege, wie sie belegpflichtige Splitzeilen hat (z. B. zwei Rechnungen in einer Überweisung).
// Gehören mehrere Splitzeilen zu einer Rechnung, setzt man den Haken „Belege vollständig“.

/** Fehlen bei dieser Buchung noch Belege? */
export function belegFehlt(soll: number, ist: number, vollstaendig: number | boolean): boolean {
  return soll > 0 && !vollstaendig && ist < soll;
}

export type FehlenderBeleg = {
  id: number; buchungsdatum: string; betrag_cent: number; gegen_name: string | null; verwendungszweck: string | null;
  kat: string; soll: number; ist: number;
};

/** Belegpflichtige Buchungen im Zeitraum, bei denen noch (mindestens ein) Beleg fehlt. */
export function fehlendeBelege(von: string, bis: string): FehlenderBeleg[] {
  return all<FehlenderBeleg>(
    `SELECT t.id, t.buchungsdatum, t.betrag_cent, t.gegen_name, t.verwendungszweck,
            GROUP_CONCAT(DISTINCT c.nummer || ' ' || c.name) AS kat, COUNT(a.id) AS soll,
            (SELECT COUNT(*) FROM documents d WHERE d.transaction_id = t.id) AS ist
     FROM transactions t JOIN allocations a ON a.transaction_id = t.id JOIN categories c ON c.id = a.category_id
     WHERE c.beleg_pflicht = 1 AND t.buchungsdatum BETWEEN ? AND ? AND t.belege_vollstaendig = 0
     GROUP BY t.id HAVING ist < soll
     ORDER BY t.buchungsdatum DESC`,
    [von, bis],
  );
}

export function setBelegeVollstaendig(transactionId: number, v: boolean) {
  run('UPDATE transactions SET belege_vollstaendig = ? WHERE id = ?', [v ? 1 : 0, transactionId]);
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
