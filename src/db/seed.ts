import type { CatTyp, Sphaere } from './schema';

// Karate-Graduierungen: unranked, 9. Kyu … 1. Kyu, 1. Dan … 5. Dan.
// Die Gurtfarben unterscheiden sich je nach Verband/Stilrichtung; hier die in Deutschland verbreitete Folge.
export const GRADES: { id: string; name: string; farbe: string; rand?: string }[] = [
  { id: 'unranked', name: 'Ohne Graduierung', farbe: '#f5f5f4', rand: '#a8a29e' },
  { id: 'kyu9', name: '9. Kyu', farbe: '#ffffff', rand: '#a8a29e' },
  { id: 'kyu8', name: '8. Kyu', farbe: '#facc15' },
  { id: 'kyu7', name: '7. Kyu', farbe: '#fb923c' },
  { id: 'kyu6', name: '6. Kyu', farbe: '#22c55e' },
  { id: 'kyu5', name: '5. Kyu', farbe: '#3b82f6' },
  { id: 'kyu4', name: '4. Kyu', farbe: '#8b5cf6' },
  { id: 'kyu3', name: '3. Kyu', farbe: '#92400e' },
  { id: 'kyu2', name: '2. Kyu', farbe: '#78350f' },
  { id: 'kyu1', name: '1. Kyu', farbe: '#5c2d0b' },
  { id: 'dan1', name: '1. Dan', farbe: '#111111' },
  { id: 'dan2', name: '2. Dan', farbe: '#111111' },
  { id: 'dan3', name: '3. Dan', farbe: '#111111' },
  { id: 'dan4', name: '4. Dan', farbe: '#111111' },
  { id: 'dan5', name: '5. Dan', farbe: '#111111' },
];

export function gradeName(id: string | null | undefined): string {
  return GRADES.find((g) => g.id === id)?.name ?? id ?? '–';
}

export function gradeIndex(id: string): number {
  return GRADES.findIndex((g) => g.id === id);
}

// Kategorien angelehnt an SKR04 (Kontenklasse 4 = Erträge, 5/6 = Aufwendungen, 7 = Zinsen, 1 = Geldtransit).
// Für Vereine zusätzlich nach steuerlichen Sphären gegliedert. Alles frei änderbar.
export const DEFAULT_CATEGORIES: {
  nummer: string; name: string; typ: CatTyp; sphaere: Sphaere; mitgliedskonto?: 1; beleg_pflicht?: 1;
}[] = [
  // ---- Einnahmen ----
  { nummer: '4010', name: 'Mitgliedsbeiträge', typ: 'einnahme', sphaere: 'ideell', mitgliedskonto: 1 },
  { nummer: '4011', name: 'Aufnahmegebühren', typ: 'einnahme', sphaere: 'ideell', mitgliedskonto: 1 },
  { nummer: '4020', name: 'Spenden', typ: 'einnahme', sphaere: 'ideell' },
  { nummer: '4030', name: 'Zuschüsse (Stadt, Kreis, Sportbund)', typ: 'einnahme', sphaere: 'ideell' },
  { nummer: '4830', name: 'Sonstige Erträge', typ: 'einnahme', sphaere: 'ideell' },
  { nummer: '4200', name: 'Lehrgangs- und Kursgebühren', typ: 'einnahme', sphaere: 'zweck' },
  { nummer: '4210', name: 'Prüfungsgebühren (Kyu/Dan)', typ: 'einnahme', sphaere: 'zweck', mitgliedskonto: 1 },
  { nummer: '4220', name: 'Startgelder Turniere (Einnahmen)', typ: 'einnahme', sphaere: 'zweck' },
  { nummer: '4400', name: 'Verkauf Anzüge, Gürtel, Ausrüstung', typ: 'einnahme', sphaere: 'wgb' },
  { nummer: '4410', name: 'Veranstaltungen und Bewirtung (Einnahmen)', typ: 'einnahme', sphaere: 'wgb' },
  { nummer: '4420', name: 'Sponsoring und Werbung', typ: 'einnahme', sphaere: 'wgb' },
  { nummer: '7100', name: 'Zinserträge', typ: 'einnahme', sphaere: 'vermoegen' },
  // ---- Ausgaben ----
  { nummer: '6310', name: 'Hallen- und Raummiete', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6325', name: 'Energie (Strom, Gas, Wasser)', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6020', name: 'Übungsleitervergütung (§ 3 Nr. 26 EStG)', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6027', name: 'Ehrenamtspauschale (§ 3 Nr. 26a EStG)', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6845', name: 'Sportgeräte und Trainingsmaterial', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6260', name: 'Anschaffungen (Matten, Geräte)', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6821', name: 'Lehrgänge und Fortbildung Trainer', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6850', name: 'Prüfungsbedarf (Urkunden, Pässe, Marken)', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6860', name: 'Wettkampfkosten und Startgelder', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6670', name: 'Reise- und Fahrtkosten', typ: 'ausgabe', sphaere: 'zweck', beleg_pflicht: 1 },
  { nummer: '6420', name: 'Verbandsbeiträge (DKV, Landesverband, Sportbund)', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6400', name: 'Versicherungen', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6600', name: 'Werbekosten, Öffentlichkeitsarbeit', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6610', name: 'Geschenke und Ehrungen', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6800', name: 'Porto', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6810', name: 'Telefon, Internet, Website, Software', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6815', name: 'Bürobedarf', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6825', name: 'Rechts- und Beratungskosten, Registergericht', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '6855', name: 'Kontoführung und Bankgebühren', typ: 'ausgabe', sphaere: 'ideell' },
  { nummer: '6300', name: 'Sonstige Aufwendungen', typ: 'ausgabe', sphaere: 'ideell', beleg_pflicht: 1 },
  { nummer: '5200', name: 'Wareneinkauf (Anzüge, Gürtel zum Weiterverkauf)', typ: 'ausgabe', sphaere: 'wgb', beleg_pflicht: 1 },
  { nummer: '6640', name: 'Veranstaltungen und Bewirtung (Ausgaben)', typ: 'ausgabe', sphaere: 'wgb', beleg_pflicht: 1 },
  // ---- Neutral (nicht in der GuV, aber im Kontostand) ----
  { nummer: '1360', name: 'Geldtransit / Umbuchung zwischen eigenen Konten', typ: 'neutral', sphaere: 'neutral' },
  { nummer: '1370', name: 'Durchlaufende Posten (z. B. Sammelbestellungen)', typ: 'neutral', sphaere: 'neutral' },
];

export const DEFAULT_FEE_GROUPS: { name: string; beschreibung: string; monat_cent: number }[] = [
  { name: 'Erwachsene', beschreibung: 'ab 18 Jahren', monat_cent: 2500 },
  { name: 'Kinder & Jugendliche', beschreibung: 'bis 17 Jahre', monat_cent: 1800 },
  { name: 'Familienmitglied', beschreibung: 'ermäßigt ab dem 2. Familienmitglied', monat_cent: 1200 },
  { name: 'Passiv / Förderer', beschreibung: '', monat_cent: 500 },
  { name: 'Ehrenmitglied', beschreibung: 'beitragsfrei', monat_cent: 0 },
];

export const DEFAULT_RULES: { name: string; text_enthaelt: string; richtung: 'ein' | 'aus' | 'beide'; nummer: string }[] = [
  { name: 'Kontoführungsentgelt', text_enthaelt: 'entgelt|kontofuehrung|rechnungsabschluss|abschluss|preis fuer|buchungsposten', richtung: 'aus', nummer: '6855' },
  { name: 'Zinsen', text_enthaelt: 'habenzins|zinsen|zinsgutschrift', richtung: 'ein', nummer: '7100' },
];
