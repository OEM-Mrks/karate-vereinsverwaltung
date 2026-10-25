// Mitgliederversammlung: Anwesenheitsliste der zum Versammlungstag aktiven Mitglieder.

import { all } from '../db/db';
import type { Member } from '../db/schema';
import { isActive } from './fees';
import { ageAt } from './format';

export type VersammlungOptionen = {
  titel: string;
  datum: string;
  uhrzeit: string;
  ort: string;
  anschrift: boolean;
  telefon: boolean;
  email: boolean;
  minderjaehrige: boolean;   // Minderjährige kennzeichnen (Stimmrecht laut Satzung prüfen)
  leerzeilen: number;        // für Gäste und Nachträge
  sortierung: 'name' | 'nr';
};

export type Teilnehmer = Member & { minderjaehrig: boolean };

/** Alle am Versammlungstag aktiven Mitglieder. */
export function teilnehmer(datum: string, sortierung: VersammlungOptionen['sortierung'] = 'name'): Teilnehmer[] {
  const nr = (m: Member) => Number(m.mitgliedsnr) || Number.MAX_SAFE_INTEGER;
  return all<Member>('SELECT * FROM members')
    .filter((m) => isActive(m, datum))
    .map((m) => ({ ...m, minderjaehrig: (ageAt(m.geburtsdatum, datum) ?? 99) < 18 }))
    .sort((a, b) => sortierung === 'nr'
      ? nr(a) - nr(b) || (a.mitgliedsnr ?? '').localeCompare(b.mitgliedsnr ?? '')
      : a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'));
}
