// Unterlagen je Mitglied (Mitgliedsantrag, SEPA-Mandat, Kündigung …) – als BLOB in der Datenbank, Teil jeder Sicherung.

import { all, get, run } from '../db/db';
import type { MemberDocumentArt, MemberDocumentMeta } from '../db/schema';
import { ANTRAG_FELDER, type AntragDaten } from './antrag';
import { MAX_DOC_SIZE } from './docs';
import { normalizeIBAN } from './format';

export const MEMBER_DOC_ARTEN: { id: MemberDocumentArt; name: string }[] = [
  { id: 'antrag', name: 'Mitgliedsantrag' },
  { id: 'sepa', name: 'SEPA-Mandat' },
  { id: 'kuendigung', name: 'Kündigung' },
  { id: 'sonstiges', name: 'Sonstiges' },
];

export const ACCEPT_MEMBER_DOCS = 'application/pdf,image/png,image/jpeg,image/webp';

export async function addMemberDocument(memberId: number, file: Blob & { name: string }, art: MemberDocumentArt = 'antrag', text: string | null = null): Promise<number> {
  if (file.size > MAX_DOC_SIZE) throw new Error(`„${file.name}" ist größer als 20 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  return run(
    'INSERT INTO member_documents(member_id, art, dateiname, mime, groesse, daten, text) VALUES (?,?,?,?,?,?,?)',
    [memberId, art, file.name, mime, file.size, bytes, text],
  );
}

export function listMemberDocuments(memberId: number): MemberDocumentMeta[] {
  return all<MemberDocumentMeta>(
    'SELECT id, member_id, art, dateiname, mime, groesse, text, created_at FROM member_documents WHERE member_id = ? ORDER BY id DESC',
    [memberId],
  );
}

export function memberDocumentFile(id: number): { bytes: Uint8Array; mime: string; name: string } | null {
  const d = get<{ daten: Uint8Array; mime: string; dateiname: string }>('SELECT daten, mime, dateiname FROM member_documents WHERE id = ?', [id]);
  return d ? { bytes: d.daten, mime: d.mime, name: d.dateiname } : null;
}

export function memberDocumentBlobUrl(id: number): { url: string; mime: string; name: string } | null {
  const d = memberDocumentFile(id);
  if (!d) return null;
  return { url: URL.createObjectURL(new Blob([d.bytes as BlobPart], { type: d.mime })), mime: d.mime, name: d.name };
}

/** Bereits erkannter Text (null = noch nicht ausgelesen). */
export function memberDocumentText(id: number): string | null {
  return get<{ text: string | null }>('SELECT text FROM member_documents WHERE id = ?', [id])?.text ?? null;
}

export function setMemberDocumentText(id: number, text: string) {
  run('UPDATE member_documents SET text = ? WHERE id = ?', [text, id]);
}

/** Ausgewählte Angaben aus dem Antrag ins Mitglied übernehmen. */
export function applyAntrag(memberId: number, daten: AntragDaten) {
  const erlaubt = new Set<string>(ANTRAG_FELDER.map((f) => f.id));
  const entries = Object.entries(daten).filter(([k, v]) => erlaubt.has(k) && v?.trim()) as [keyof AntragDaten, string][];
  if (!entries.length) return;
  const value = (k: keyof AntragDaten, v: string) => (k === 'iban' ? normalizeIBAN(v) : k === 'bic' ? v.toUpperCase() : v.trim()) || null;
  run(
    `UPDATE members SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...entries.map(([k, v]) => value(k, v)), memberId],
  );
}
