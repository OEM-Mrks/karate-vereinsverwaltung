// Eckdaten für die Protokollvorlage (Bericht des Kassenwarts, Bericht der Kassenprüfer) – gemeinsam für PDF und Word.
// Nur Statistik, keine Mitgliedernamen.

import { formatDate, formatEUR as eur } from './format';
import type { Jahresbericht, PruefungsStand } from './kennzahlen';

export type Eckdaten = { titel: string; zeilen: [string, string][]; fuss?: string };

export const plural = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;

/** Eckpunkte für den Bericht des Kassenwarts. */
export function kassenberichtEckdaten(d: Jahresbericht): Eckdaten {
  const { report: r, mitglieder: m, beitraege: b } = d;
  const bis = formatDate(r.bis);
  return {
    titel: `Eckdaten Geschäftsjahr ${r.jahr}${r.ganzesJahr ? '' : ` (Stand ${bis})`}`,
    zeilen: [
      [`Kontostand ${formatDate(r.von)}`, eur(r.kontoAnfang)],
      ['Einnahmen', eur(r.summeEin)],
      ['Ausgaben', eur(r.summeAus)],
      [r.ganzesJahr ? 'Jahresergebnis' : 'Ergebnis bisher', eur(r.ergebnis)],
      ...(r.summeNeutral || r.unzugeordnet.summe ? [['Neutrale/nicht zugeordnete Buchungen', eur(r.summeNeutral + r.unzugeordnet.summe)] as [string, string]] : []),
      [`Kontostand ${bis}`, eur(r.kontoEnde)],
      [`Aktive Mitglieder ${bis}`, `${m.aktiv}${m.minderjaehrig ? ` (davon ${m.minderjaehrig} minderjährig)` : ''}`],
      ['Ehrenmitglieder', String(m.ehrenmitglieder)],
      [`Eintritte / Austritte ${r.jahr}`, `${m.eintritte} / ${m.austritte}`],
      ['Vorliegende Kündigungen', m.kuendigungen ? `${plural(m.kuendigungen, 'Mitglied scheidet', 'Mitglieder scheiden')} zum Stichtag oder später aus` : 'keine'],
      ['Mitgliedsbeiträge Soll / bezahlt', `${eur(b.soll)} / ${eur(b.bezahlt)}`],
      ['Beitragsrückstände', b.mitRueckstand ? `${plural(b.mitRueckstand, 'Mitglied', 'Mitglieder')}, zusammen ${eur(b.ueberfaellig)}` : 'keine – alle fälligen Beiträge sind bezahlt'],
      ...(r.fehlendeBelege ? [['Buchungen ohne vollständige Belege', String(r.fehlendeBelege)] as [string, string]] : []),
    ],
    fuss: 'Automatisch aus der Vereinsverwaltung erzeugt – Mitgliederangaben nur als Anzahl, ohne Namen.',
  };
}

/** Eckpunkte für den Bericht der Kassenprüfer. */
export function pruefberichtEckdaten(p: PruefungsStand): Eckdaten {
  if (!p.vorhanden) return { titel: `Kassenprüfung ${p.jahr}`, zeilen: [['Stand', 'Für dieses Geschäftsjahr ist noch keine Kassenprüfung erfasst.']] };
  return {
    titel: `Kassenprüfung ${p.jahr}`,
    zeilen: [
      ['Prüfung am', p.pruefdatum ? formatDate(p.pruefdatum) : '–'],
      ...(p.pruefer.length ? [['Kassenprüfer/innen', p.pruefer.join(', ')] as [string, string]] : []),
      ['Geprüfte Buchungen', `${p.geprueft} von ${p.gesamt}`],
      ['Offene Rückfragen', p.offeneFragen ? String(p.offeneFragen) : 'keine'],
      ...p.hinweise.map((h): [string, string] => [h.ok ? 'In Ordnung' : 'Hinweis', h.text]),
      ...(p.feststellungen?.trim() ? [['Feststellungen', p.feststellungen.trim()] as [string, string]] : []),
      ['Empfehlung', p.entlastung ? 'Entlastung des Vorstands' : 'keine Empfehlung zur Entlastung'],
    ],
  };
}
