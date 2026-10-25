// Mitgliederversammlung: Anwesenheitsliste der zum Versammlungstag aktiven Mitglieder.

import { all, getSetting, run, setSetting } from '../db/db';
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
  berichtsjahr?: number;     // Geschäftsjahr für Kassenbericht und Kassenprüfung (Standard: Vorjahr der Versammlung)
  eckdaten?: boolean;        // Eckdaten aus der Buchhaltung in die Protokollvorlage übernehmen (Standard: ja)
  pruefungsjahre?: number[]; // Kassenprüfungen, über die berichtet wird (Standard: Berichtsjahr)
};

export const berichtsjahrVon = (o: Pick<VersammlungOptionen, 'datum' | 'berichtsjahr'>) => o.berichtsjahr ?? Number(o.datum.slice(0, 4)) - 1;
export const pruefungsjahreVon = (o: Pick<VersammlungOptionen, 'datum' | 'berichtsjahr' | 'pruefungsjahre'>) => o.pruefungsjahre ?? [berichtsjahrVon(o)];

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

// ---------- Tagesordnung ----------
// Wird in der Vereinsdatenbank gespeichert (meta), damit sie mit der Sicherung erhalten bleibt.

export type TopPunkt = {
  id: string;
  titel: string;
  details: string;
  aktiv: boolean;           // auf der Tagesordnung (angehakt)
  abstimmung: boolean;      // im Protokoll Felder für Ja/Nein/Enthaltung
  standard?: string;        // Schlüssel des Standardpunkts, fehlt bei eigenen Punkten
};

export type Tagesordnung = {
  punkte: TopPunkt[];
  einladung: string;        // Einleitungstext der Einladung
  antragsfrist: string | null;
};

type Standard = { key: string; titel: string; details?: string; aktiv: boolean; abstimmung?: boolean };

export const STANDARD_PUNKTE: Standard[] = [
  { key: 'eroeffnung', titel: 'Begrüßung und Eröffnung', aktiv: true },
  { key: 'beschlussfaehigkeit', titel: 'Feststellung der ordnungsgemäßen Einladung und der Beschlussfähigkeit', aktiv: true },
  { key: 'tagesordnung', titel: 'Genehmigung der Tagesordnung', aktiv: true, abstimmung: true },
  { key: 'protokoll', titel: 'Genehmigung des Protokolls der letzten Mitgliederversammlung', aktiv: true, abstimmung: true },
  { key: 'bericht_vorstand', titel: 'Bericht des Vorstands', aktiv: true },
  { key: 'bericht_kasse', titel: 'Bericht des Kassenwarts', details: 'Einnahmen und Ausgaben, Kontostand zum 31.12.', aktiv: true },
  { key: 'bericht_pruefer', titel: 'Bericht der Kassenprüfer', aktiv: true },
  { key: 'aussprache', titel: 'Aussprache zu den Berichten', aktiv: true },
  { key: 'entlastung', titel: 'Entlastung des Vorstands', aktiv: true, abstimmung: true },
  { key: 'wahlleitung', titel: 'Wahl einer Wahlleitung', aktiv: false, abstimmung: true },
  { key: 'neuwahlen', titel: 'Neuwahlen', aktiv: false, abstimmung: true },
  { key: 'kassenpruefer', titel: 'Wahl der Kassenprüfer', aktiv: false, abstimmung: true },
  { key: 'beitraege', titel: 'Mitgliedsbeiträge', details: 'Beratung und Beschluss über die Höhe der Mitgliedsbeiträge', aktiv: false, abstimmung: true },
  { key: 'haushalt', titel: 'Haushaltsplan und Ausblick auf das kommende Jahr', aktiv: false },
  { key: 'satzung', titel: 'Satzungsänderungen', aktiv: false, abstimmung: true },
  { key: 'ehrungen', titel: 'Ehrungen', aktiv: false },
  { key: 'antraege', titel: 'Anträge der Mitglieder', aktiv: true, abstimmung: true },
  { key: 'verschiedenes', titel: 'Verschiedenes', aktiv: true },
];

const SCHLUESSEL = 'versammlung_tagesordnung';
let seq = 0;
export const neueId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Zu wählende Ämter: Amtszeit endet spätestens am Versammlungstag. */
export function ablaufendeAemter(datum: string): string[] {
  const aemter = all<{ funktion: string; amtszeit_bis: string | null }>('SELECT funktion, amtszeit_bis FROM officers');
  return [...new Set(aemter.filter((a) => a.amtszeit_bis && a.amtszeit_bis <= datum).map((a) => a.funktion))];
}

export function standardTagesordnung(datum: string): Tagesordnung {
  const wahl = ablaufendeAemter(datum);
  const kp = wahl.includes('Kassenprüfer/in');
  const vorstand = wahl.filter((f) => f !== 'Kassenprüfer/in');
  return {
    punkte: STANDARD_PUNKTE.map((s) => ({
      id: s.key,
      titel: s.titel,
      details: s.key === 'neuwahlen' && vorstand.length ? `Zu wählen: ${vorstand.join(', ')}` : s.details ?? '',
      aktiv: s.key === 'neuwahlen' || s.key === 'wahlleitung' ? vorstand.length > 0 : s.key === 'kassenpruefer' ? kp : s.aktiv,
      abstimmung: !!s.abstimmung,
      standard: s.key,
    })),
    einladung: 'hiermit laden wir alle Mitglieder herzlich zur Mitgliederversammlung ein. Wir freuen uns auf eine rege Teilnahme.',
    antragsfrist: null,
  };
}

export function ladeTagesordnung(datum: string): Tagesordnung {
  const raw = getSetting(SCHLUESSEL);
  if (!raw) return standardTagesordnung(datum);
  try {
    return { ...standardTagesordnung(datum), ...(JSON.parse(raw) as Partial<Tagesordnung>) };
  } catch {
    return standardTagesordnung(datum);
  }
}

export function speichereTagesordnung(t: Tagesordnung) {
  setSetting(SCHLUESSEL, JSON.stringify(t));
}

export function verwerfeTagesordnung() {
  run('DELETE FROM meta WHERE key = ?', [SCHLUESSEL]);
}

/** Eigenen Punkt vor „Verschiedenes“ einfügen (falls vorhanden), sonst ans Ende. */
export function punktHinzufuegen(t: Tagesordnung, titel: string): Tagesordnung {
  const neu: TopPunkt = { id: neueId(), titel: titel.trim(), details: '', aktiv: true, abstimmung: false };
  const i = t.punkte.findIndex((p) => p.standard === 'verschiedenes');
  const punkte = [...t.punkte];
  punkte.splice(i < 0 ? punkte.length : i, 0, neu);
  return { ...t, punkte };
}

export function verschieben(t: Tagesordnung, id: string, richtung: -1 | 1): Tagesordnung {
  const i = t.punkte.findIndex((p) => p.id === id);
  const j = i + richtung;
  if (i < 0 || j < 0 || j >= t.punkte.length) return t;
  const punkte = [...t.punkte];
  [punkte[i], punkte[j]] = [punkte[j], punkte[i]];
  return { ...t, punkte };
}

/** Angehakte Punkte mit fortlaufender TOP-Nummer. */
export function tops(t: Tagesordnung): (TopPunkt & { nr: number })[] {
  return t.punkte.filter((p) => p.aktiv && p.titel.trim()).map((p, i) => ({ ...p, nr: i + 1 }));
}
