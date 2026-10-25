// Vollständigkeitsprüfung der Mitgliederdaten – welche Angaben Pflicht sind, ist einstellbar.

import { getSetting } from '../db/db';
import type { Member } from '../db/schema';
import { ageAt } from './format';

export const CHECK_FIELDS: { id: string; label: string; ok: (m: Member) => boolean }[] = [
  { id: 'vorname', label: 'Vorname', ok: (m) => !!m.vorname?.trim() },
  { id: 'geburtsdatum', label: 'Geburtsdatum', ok: (m) => !!m.geburtsdatum },
  { id: 'anschrift', label: 'Anschrift', ok: (m) => !!(m.strasse?.trim() && m.plz?.trim() && m.ort?.trim()) },
  { id: 'email', label: 'E-Mail', ok: (m) => !!m.email?.trim() },
  { id: 'telefon', label: 'Telefon/Handy', ok: (m) => !!(m.telefon?.trim() || m.mobil?.trim()) },
  { id: 'iban', label: 'IBAN', ok: (m) => !!m.iban },
  { id: 'sepa', label: 'SEPA-Mandat', ok: (m) => !!m.sepa_mandat_ref?.trim() },
  { id: 'beitrag', label: 'Beitragsgruppe', ok: (m) => m.fee_group_id != null || m.beitrag_individuell_cent != null },
  { id: 'mitgliedsnr', label: 'Mitgliedsnummer', ok: (m) => !!m.mitgliedsnr?.trim() },
  {
    id: 'erziehungsberechtigte',
    label: 'Erziehungsberechtigte',
    // Nur bei Minderjährigen gefordert
    ok: (m) => (ageAt(m.geburtsdatum) ?? 99) >= 18 || !!m.erziehungsberechtigte?.trim(),
  },
];

export const DEFAULT_REQUIRED = ['vorname', 'geburtsdatum', 'anschrift', 'telefon', 'beitrag', 'erziehungsberechtigte'];

export function requiredFields(): string[] {
  try {
    const v = getSetting('pflichtfelder');
    return v ? (JSON.parse(v) as string[]) : DEFAULT_REQUIRED;
  } catch {
    return DEFAULT_REQUIRED;
  }
}

/** Fehlende Pflichtangaben eines Mitglieds (Bezeichnungen). */
export function missingFields(m: Member, required: string[] = requiredFields()): string[] {
  return CHECK_FIELDS.filter((f) => required.includes(f.id) && !f.ok(m)).map((f) => f.label);
}
