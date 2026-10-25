// Häufig benötigte Auswahllisten.

import { all } from '../db/db';
import type { Category, FeeGroup, Member, Partner } from '../db/schema';
import { SPHAEREN } from '../db/schema';

export function categories(): Category[] {
  return all<Category>('SELECT * FROM categories ORDER BY nummer');
}

export function categoryLabel(c: Pick<Category, 'nummer' | 'name'> | undefined | null): string {
  return c ? `${c.nummer} ${c.name}` : '–';
}

const TYP_GROUP = { einnahme: 'Einnahmen', ausgabe: 'Ausgaben', neutral: 'Neutral' } as const;

export function categoryOptions(filter?: (c: Category) => boolean) {
  return categories()
    .filter((c) => c.aktiv && (!filter || filter(c)))
    .map((c) => ({
      value: c.id,
      label: `${c.nummer} ${c.name}`,
      group: `${TYP_GROUP[c.typ]} · ${SPHAEREN.find((s) => s.id === c.sphaere)?.kurz ?? ''}`,
    }));
}

export function memberName(m: Pick<Member, 'vorname' | 'nachname'> | undefined | null): string {
  return m ? `${m.nachname}, ${m.vorname}` : '–';
}

export function memberOptions() {
  return all<Member>('SELECT * FROM members ORDER BY nachname, vorname').map((m) => ({
    value: m.id,
    label: `${memberName(m)}${m.mitgliedsnr ? ` (${m.mitgliedsnr})` : ''}${m.austritt ? ' – ausgetreten' : ''}`,
  }));
}

export function partnerOptions() {
  return all<Partner>('SELECT * FROM partners ORDER BY name').map((p) => ({ value: p.id, label: p.name }));
}

export function feeGroups(): FeeGroup[] {
  return all<FeeGroup>('SELECT * FROM fee_groups ORDER BY sort, name');
}

export const PARTNER_TYPEN = [
  { value: 'lieferant', label: 'Lieferant / Einkaufsquelle' },
  { value: 'verband', label: 'Verband' },
  { value: 'zuschussgeber', label: 'Zuschussgeber' },
  { value: 'vermieter', label: 'Vermieter / Halle' },
  { value: 'sonstige', label: 'Sonstige' },
];
