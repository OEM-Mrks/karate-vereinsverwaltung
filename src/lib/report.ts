// Gewinn- und Verlustrechnung (Einnahmen-Überschuss nach Zuflussprinzip, alle Beträge brutto)
// mit Kontostand zum 1.1. und 31.12. und Abstimmung gegen die Kontobewegungen.

import { all } from '../db/db';
import type { Account, BalanceCheckpoint, Category, Sphaere } from '../db/schema';
import { SPHAEREN } from '../db/schema';
import { balanceAt, balanceAtStartOf } from './bank';
import { fehlendeBelege as fehlendeBelegeListe } from './docs';

export type ReportLine = { category: Category; summe: number; vorjahr: number; anzahl: number };

export type SphereBlock = {
  sphaere: Sphaere;
  name: string;
  einnahmen: ReportLine[];
  ausgaben: ReportLine[];
  summeEin: number;
  summeAus: number;
  ergebnis: number;
  vorjahrEin: number;
  vorjahrAus: number;
};

export type AccountBalance = {
  account: Account;
  anfang: number | null;
  anfangDatum: string;
  ende: number | null;
  bewegung: number;
  laut_auszug: BalanceCheckpoint | null;
};

export type Report = {
  jahr: number;
  von: string;
  bis: string;
  ganzesJahr: boolean;
  bloecke: SphereBlock[];
  summeEin: number;
  summeAus: number;
  ergebnis: number;
  vorjahrErgebnis: number;
  neutral: ReportLine[];
  summeNeutral: number;
  unzugeordnet: { anzahl: number; summe: number };
  konten: AccountBalance[];
  kontoAnfang: number;
  kontoEnde: number;
  kontoBewegung: number;
  differenz: number; // sollte 0 sein
  fehlendeBelege: number;
};

/** Verschiebt ein ISO-Datum um n Jahre (29.02. → 28.02.). */
export function shiftYear(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y + n, m, 0).getDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

function sums(von: string, bis: string) {
  return all<{ category_id: number; summe: number; anzahl: number }>(
    `SELECT a.category_id, SUM(a.betrag_cent) AS summe, COUNT(*) AS anzahl
     FROM allocations a JOIN transactions t ON t.id = a.transaction_id
     WHERE a.category_id IS NOT NULL AND t.buchungsdatum BETWEEN ? AND ?
     GROUP BY a.category_id`,
    [von, bis],
  );
}

/** GuV für ein Geschäftsjahr oder einen Zeitraum darin (unterjährig); Vergleich mit demselben Zeitraum des Vorjahres. */
export function buildReport(year: number, von = `${year}-01-01`, bis = `${year}-12-31`): Report {
  const cats = all<Category>('SELECT * FROM categories ORDER BY nummer');
  const cur = new Map(sums(von, bis).map((r) => [r.category_id, r]));
  const prev = new Map(sums(shiftYear(von, -1), shiftYear(bis, -1)).map((r) => [r.category_id, r]));
  const line = (c: Category): ReportLine => ({
    category: c,
    summe: cur.get(c.id)?.summe ?? 0,
    vorjahr: prev.get(c.id)?.summe ?? 0,
    anzahl: cur.get(c.id)?.anzahl ?? 0,
  });
  const used = (l: ReportLine) => l.summe !== 0 || l.vorjahr !== 0;

  const bloecke: SphereBlock[] = SPHAEREN.filter((s) => s.id !== 'neutral').map((s) => {
    const einnahmen = cats.filter((c) => c.sphaere === s.id && c.typ === 'einnahme').map(line).filter(used);
    const ausgaben = cats.filter((c) => c.sphaere === s.id && c.typ === 'ausgabe').map(line).filter(used);
    // Ausgaben sind auf dem Konto negativ – für die Darstellung positiv
    ausgaben.forEach((l) => { l.summe = -l.summe || 0; l.vorjahr = -l.vorjahr || 0; });
    const summeEin = einnahmen.reduce((a, l) => a + l.summe, 0);
    const summeAus = ausgaben.reduce((a, l) => a + l.summe, 0);
    return {
      sphaere: s.id,
      name: s.name,
      einnahmen,
      ausgaben,
      summeEin,
      summeAus,
      ergebnis: summeEin - summeAus,
      vorjahrEin: einnahmen.reduce((a, l) => a + l.vorjahr, 0),
      vorjahrAus: ausgaben.reduce((a, l) => a + l.vorjahr, 0),
    };
  });
  const neutral = cats.filter((c) => c.typ === 'neutral').map(line).filter((l) => l.summe !== 0 || l.vorjahr !== 0);
  const summeEin = bloecke.reduce((a, b) => a + b.summeEin, 0);
  const summeAus = bloecke.reduce((a, b) => a + b.summeAus, 0);
  const vorjahrErgebnis = bloecke.reduce((a, b) => a + b.vorjahrEin - b.vorjahrAus, 0);
  const summeNeutral = neutral.reduce((a, l) => a + l.summe, 0);

  // Nicht (vollständig) zugeordnete Beträge
  const un = all<{ anzahl: number; summe: number }>(
    `SELECT COUNT(*) AS anzahl, COALESCE(SUM(t.betrag_cent - COALESCE(x.zugeordnet, 0)), 0) AS summe
     FROM transactions t
     LEFT JOIN (SELECT transaction_id, SUM(CASE WHEN category_id IS NOT NULL THEN betrag_cent ELSE 0 END) AS zugeordnet
                FROM allocations GROUP BY transaction_id) x ON x.transaction_id = t.id
     WHERE t.buchungsdatum BETWEEN ? AND ? AND t.betrag_cent != COALESCE(x.zugeordnet, 0)`,
    [von, bis],
  )[0] ?? { anzahl: 0, summe: 0 };

  // Kontostände
  const accounts = all<Account>('SELECT * FROM accounts ORDER BY id');
  const checkpoints = all<BalanceCheckpoint>('SELECT * FROM balance_checkpoints WHERE datum = ?', [bis]);
  const konten: AccountBalance[] = accounts
    .filter((a) => a.anfangsdatum <= bis)
    .map((a) => {
      const startDate = a.anfangsdatum > von ? a.anfangsdatum : von;
      const anfang = balanceAtStartOf(a, startDate);
      const ende = balanceAt(a, bis);
      return {
        account: a,
        anfang,
        anfangDatum: startDate,
        ende,
        bewegung: (ende ?? 0) - (anfang ?? 0),
        laut_auszug: checkpoints.find((c) => c.account_id === a.id) ?? null,
      };
    });
  const kontoAnfang = konten.reduce((s, k) => s + (k.anfang ?? 0), 0);
  const kontoEnde = konten.reduce((s, k) => s + (k.ende ?? 0), 0);
  const kontoBewegung = kontoEnde - kontoAnfang;
  const ergebnis = summeEin - summeAus;

  const fehlendeBelege = fehlendeBelegeListe(von, bis).length;

  return {
    jahr: year,
    von,
    bis,
    ganzesJahr: von === `${year}-01-01` && bis === `${year}-12-31`,
    bloecke,
    summeEin,
    summeAus,
    ergebnis,
    vorjahrErgebnis,
    neutral,
    summeNeutral,
    unzugeordnet: un,
    konten,
    kontoAnfang,
    kontoEnde,
    kontoBewegung,
    differenz: kontoBewegung - (ergebnis + summeNeutral + un.summe),
    fehlendeBelege,
  };
}

export function reportToCSV(r: Report, vereinName: string): string {
  const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  const zeitraum = r.ganzesJahr ? String(r.jahr) : `${r.von} bis ${r.bis}`;
  const lines: string[][] = [[`Gewinn- und Verlustrechnung ${zeitraum}`, vereinName], [], ['Konto', 'Bezeichnung', 'Bereich', 'Zeitraum', 'Vorjahreszeitraum']];
  for (const b of r.bloecke) {
    if (!b.einnahmen.length && !b.ausgaben.length) continue;
    lines.push([], ['', b.name]);
    for (const l of b.einnahmen) lines.push([l.category.nummer, l.category.name, 'Einnahme', eur(l.summe), eur(l.vorjahr)]);
    for (const l of b.ausgaben) lines.push([l.category.nummer, l.category.name, 'Ausgabe', eur(-l.summe), eur(-l.vorjahr)]);
    lines.push(['', `Ergebnis ${b.name}`, '', eur(b.ergebnis), eur(b.vorjahrEin - b.vorjahrAus)]);
  }
  lines.push([], ['', 'Summe Einnahmen', '', eur(r.summeEin)], ['', 'Summe Ausgaben', '', eur(-r.summeAus)], ['', r.ganzesJahr ? 'Jahresergebnis' : 'Ergebnis im Zeitraum', '', eur(r.ergebnis), eur(r.vorjahrErgebnis)]);
  if (r.neutral.length) {
    lines.push([], ['', 'Neutrale Buchungen']);
    for (const l of r.neutral) lines.push([l.category.nummer, l.category.name, 'neutral', eur(l.summe), eur(l.vorjahr)]);
  }
  if (r.unzugeordnet.anzahl) lines.push(['', `Nicht zugeordnet (${r.unzugeordnet.anzahl} Buchungen)`, '', eur(r.unzugeordnet.summe)]);
  lines.push([], ['', 'Kontostände']);
  for (const k of r.konten) {
    lines.push(['', `${k.account.name} – Stand ${k.anfangDatum}`, '', k.anfang == null ? '' : eur(k.anfang)]);
    lines.push(['', `${k.account.name} – Stand ${r.bis}`, '', k.ende == null ? '' : eur(k.ende)]);
  }
  lines.push(['', 'Veränderung Kontostand', '', eur(r.kontoBewegung)]);
  return lines.map((l) => l.map(csvCell).join(';')).join('\r\n');
}

export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
