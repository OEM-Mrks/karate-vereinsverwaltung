// Kennzahlen für Berichte (Protokollvorlage, Vorstandsbericht): Finanzen, Mitglieder, Beiträge, Prognose.
// Mitglieder und Beiträge nur als Statistik – Namen nur, wenn ausdrücklich angefordert.

import { all, scalar } from '../db/db';
import type { Account, FeeGroup, Member } from '../db/schema';
import { auditItems, auditSummary, getAudit } from './audit';
import { balanceAt, isCalibrated } from './bank';
import { balanceBefore, isActive, loadFeeContext, yearSummary } from './fees';
import { ageAt, todayISO } from './format';
import { memberName } from './lookups';
import { faelligkeiten } from './recurring';
import { buildReport, type Report } from './report';

export type MitgliederStatistik = {
  stichtag: string;
  aktiv: number;
  minderjaehrig: number;
  ehrenmitglieder: number;
  eintritte: number;      // im Jahr bis zum Stichtag
  austritte: number;      // im Jahr vor dem Stichtag ausgeschieden
  kuendigungen: number;   // noch aktiv, Austritt zum Stichtag oder später bereits festgelegt
  gruppen: { name: string; anzahl: number }[];
};

/** Mitgliederzahlen zum Stichtag; Eintritte/Austritte im Jahr des Stichtags. */
export function mitgliederStatistik(stichtag: string): MitgliederStatistik {
  const jahr = stichtag.slice(0, 4);
  const members = all<Member>('SELECT * FROM members');
  const gruppen = new Map(all<FeeGroup>('SELECT * FROM fee_groups').map((g) => [g.id, g.name]));
  const aktiv = members.filter((m) => isActive(m, stichtag));
  const zaehler = new Map<string, number>();
  for (const m of aktiv) {
    const g = (m.fee_group_id && gruppen.get(m.fee_group_id)) || 'ohne Beitragsgruppe';
    zaehler.set(g, (zaehler.get(g) ?? 0) + 1);
  }
  return {
    stichtag,
    aktiv: aktiv.length,
    minderjaehrig: aktiv.filter((m) => (ageAt(m.geburtsdatum, stichtag) ?? 99) < 18).length,
    ehrenmitglieder: aktiv.filter((m) => /ehren/i.test((m.fee_group_id && gruppen.get(m.fee_group_id)) || '')).length,
    eintritte: members.filter((m) => m.eintritt >= `${jahr}-01-01` && m.eintritt <= stichtag).length,
    austritte: members.filter((m) => m.austritt && m.austritt >= `${jahr}-01-01` && m.austritt < stichtag).length,
    kuendigungen: aktiv.filter((m) => m.austritt).length,
    gruppen: [...zaehler].map(([name, anzahl]) => ({ name, anzahl })).sort((a, b) => b.anzahl - a.anzahl),
  };
}

export type BeitragsStatistik = {
  jahr: number;
  soll: number;
  bezahlt: number;
  ausstehend: number;           // Jahressoll − bezahlt (inkl. noch nicht fällig)
  ueberfaellig: number;         // fällig bis Stichtag, nicht bezahlt – inkl. Rückstände aus Vorjahren
  rueckstandVorjahre: number;
  mitRueckstand: number;        // Anzahl Mitglieder mit überfälligem Betrag
  saeumige: { name: string; betrag: number }[];
};

/** Beitragsstand eines Jahres, Fälligkeiten bis zum Stichtag. */
export function beitragsStatistik(jahr: number, stichtag: string): BeitragsStatistik {
  const ctx = loadFeeContext(stichtag);
  const s: BeitragsStatistik = { jahr, soll: 0, bezahlt: 0, ausstehend: 0, ueberfaellig: 0, rueckstandVorjahre: 0, mitRueckstand: 0, saeumige: [] };
  for (const m of all<Member>('SELECT * FROM members')) {
    const y = yearSummary(m, jahr, ctx);
    const vortrag = balanceBefore(m, jahr, ctx);
    s.soll += y.soll;
    s.bezahlt += y.bezahlt;
    s.ausstehend += Math.max(0, y.offen);
    if (vortrag > 0) s.rueckstandVorjahre += vortrag;
    const ueber = y.offenFaellig + vortrag;
    if (ueber > 0) {
      s.ueberfaellig += ueber;
      s.mitRueckstand++;
      s.saeumige.push({ name: memberName(m), betrag: ueber });
    }
  }
  s.saeumige.sort((a, b) => b.betrag - a.betrag);
  return s;
}

export function kontostand(stichtag: string): number {
  return all<Account>('SELECT * FROM accounts WHERE aktiv = 1').reduce((s, a) => s + (balanceAt(a, stichtag) ?? 0), 0);
}

export type Prognose = {
  stichtag: string;
  kontostand: number;
  beitraege: number;            // noch ausstehende Beiträge des Jahres
  wiederkehrendEin: number;
  wiederkehrendAus: number;
  offeneZahlungen: { name: string; monat: number; betrag: number; richtung: 'ein' | 'aus'; ueberfaellig: boolean }[];
  ende: number;                 // voraussichtlicher Kontostand 31.12.
};

/** Voraussichtlicher Kontostand zum Jahresende: heute + ausstehende Beiträge ± offene wiederkehrende Zahlungen. */
export function prognose(stichtag = todayISO()): Prognose {
  const jahr = Number(stichtag.slice(0, 4));
  const konto = kontostand(stichtag);
  const beitraege = beitragsStatistik(jahr, stichtag).ausstehend;
  const offen = faelligkeiten(jahr, stichtag).filter((f) => !f.zahlung && f.betrag_cent);
  const wiederkehrendEin = offen.filter((f) => f.r.richtung === 'ein').reduce((s, f) => s + f.betrag_cent!, 0);
  const wiederkehrendAus = offen.filter((f) => f.r.richtung === 'aus').reduce((s, f) => s + f.betrag_cent!, 0);
  return {
    stichtag,
    kontostand: konto,
    beitraege,
    wiederkehrendEin,
    wiederkehrendAus,
    offeneZahlungen: offen.map((f) => ({ name: f.r.name, monat: f.monat, betrag: f.betrag_cent!, richtung: f.r.richtung, ueberfaellig: f.status === 'ueberfaellig' })),
    ende: konto + beitraege + wiederkehrendEin - wiederkehrendAus,
  };
}

export type PruefungsStand = {
  jahr: number;
  vorhanden: boolean;
  pruefdatum: string | null;
  pruefer: string[];
  gesamt: number;
  geprueft: number;
  offeneFragen: number;
  entlastung: boolean;
  abgeschlossen: boolean;
  feststellungen: string | null;
  hinweise: { ok: boolean; text: string }[];
};

export function pruefungsStand(jahr: number): PruefungsStand {
  const a = getAudit(jahr);
  if (!a) return { jahr, vorhanden: false, pruefdatum: null, pruefer: [], gesamt: 0, geprueft: 0, offeneFragen: 0, entlastung: false, abgeschlossen: false, feststellungen: null, hinweise: [] };
  const items = auditItems(a);
  const s = auditSummary(a, items);
  return {
    jahr,
    vorhanden: true,
    pruefdatum: a.pruefdatum,
    pruefer: (a.pruefer ?? '').split('\n').map((x) => x.trim()).filter(Boolean),
    gesamt: s.gesamt,
    geprueft: s.geprueft,
    offeneFragen: s.offeneFragen,
    entlastung: !!a.entlastung,
    abgeschlossen: !!a.abgeschlossen,
    feststellungen: a.feststellungen,
    hinweise: s.hinweise,
  };
}

/** Eckdaten eines Geschäftsjahres für den Bericht des Kassenwarts. */
export type Jahresbericht = { report: Report; mitglieder: MitgliederStatistik; beitraege: BeitragsStatistik; pruefung: PruefungsStand };

export function jahresbericht(jahr: number): Jahresbericht {
  const ende = `${jahr}-12-31`;
  const stichtag = ende < todayISO() ? ende : todayISO();
  return {
    report: buildReport(jahr, `${jahr}-01-01`, stichtag),
    mitglieder: mitgliederStatistik(stichtag),
    beitraege: beitragsStatistik(jahr, stichtag),
    pruefung: pruefungsStand(jahr),
  };
}

/** Datenstand und offene Punkte der Kassenführung. */
export function datenstand() {
  const accounts = all<Account>('SELECT * FROM accounts WHERE aktiv = 1');
  return {
    letzteBuchung: scalar<string>('SELECT MAX(buchungsdatum) FROM transactions') ?? null,
    nichtZugeordnet: scalar<number>('SELECT COUNT(*) FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id = t.id)') ?? 0,
    nichtAbgeglichen: accounts.filter((a) => !isCalibrated(a)).map((a) => a.name),
  };
}
