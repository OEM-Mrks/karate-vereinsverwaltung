// Ablage der Kontoauszüge (PDF) nach Jahr und Monat inkl. automatischer Erkennung von Zeitraum und Kontoständen.

import { all, get, run, scalar, tx } from '../db/db';
import type { Account, Statement } from '../db/schema';
import { balanceAt, calibrateOpening, isCalibrated, saveCheckpoint } from './bank';
import { fromISO, normalizeIBAN, parseAmount, parseDate, toISO } from './format';

export type StatementInfo = {
  iban: string | null;
  nummer: string | null;
  von: string | null;
  bis: string | null;
  saldo_alt_cent: number | null;
  saldo_neu_cent: number | null;
};

const AMOUNT = String.raw`(-?\s?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s?\d+,\d{2})\s*(?:EUR|€)?\s*([+\-SH])?(?![\d,])`;

function amount(raw: string, sign?: string): number | null {
  const v = parseAmount(raw.replace(/\s/g, ''), ',');
  if (v == null) return null;
  return sign === '-' || sign === 'S' ? -Math.abs(v) : v;
}

/**
 * Liest typische Angaben aus dem Text eines Kontoauszugs (Sparkasse, Volksbank, DKB, ING u. a.):
 * IBAN, Auszugsnummer, Zeitraum, alter und neuer Kontostand. Fehlende Angaben bleiben null.
 *
 * Reihenfolge für den Zeitraum: ausdrücklicher Zeitraum („01.03.2026 bis 31.03.2026“) → Monat, in dem die meisten
 * Buchungen liegen → späteste Kontostandsangabe → Auszugsnummer n/Jahr. Kontostände werden danach dem Zeitraum
 * zugeordnet: vor Beginn = alter, ab Beginn = neuer Kontostand.
 */
export function parseStatementText(text: string): StatementInfo {
  const t = text.replace(/\u00a0/g, ' ');
  const ibanM = t.match(/\b(DE\d{2}(?:\s?\d{4}){4}\s?\d{2})\b/);
  const iban = ibanM ? normalizeIBAN(ibanM[1]) : null;

  const nrM =
    t.match(/(?:Kontoauszug|Auszug)\s*(?:Nr\.?|Nummer)?\s*:?\s*(\d{1,3})\s*\/\s*(\d{4})/i) ??
    t.match(/(?:Kontoauszug|Auszug)\s*(?:Nr\.?|Nummer)\s*:?\s*(\d{1,3})\b/i);
  const nummer = nrM ? (nrM[2] ? `${Number(nrM[1])}/${nrM[2]}` : String(Number(nrM[1]))) : null;
  const nrJahr = nrM?.[2] ? Number(nrM[2]) : null;

  // 1. Ausdrücklicher Zeitraum – nur plausible Spannen (1 Woche bis 4 Monate), damit keine Buchungszeilen greifen
  let von: string | null = null;
  let bis: string | null = null;
  for (const m of t.matchAll(/(\d{1,2}\.\d{1,2}\.\d{2,4})\s*(?:bis|-|–|—)\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/g)) {
    const a = parseDate(m[1]);
    const b = parseDate(m[2]);
    if (!a || !b) continue;
    const tage = (fromISO(b).getTime() - fromISO(a).getTime()) / 86_400_000;
    if (tage >= 6 && tage <= 125) {
      von = a;
      bis = b;
      break;
    }
  }

  // Kontostandsangaben mit Datum; der Betrag darf auch am Anfang der nächsten Zeile stehen
  const datedRe = new RegExp(String.raw`(?:Kontostand|Saldo)\s+(?:am|per|zum|vom)\s+(\d{1,2}\.\d{1,2}\.\d{2,4})[^\n]{0,60}?(?:\n\s*)?` + AMOUNT, 'gi');
  const dated = [...t.matchAll(datedRe)]
    .map((m) => ({ datum: parseDate(m[1]), saldo: amount(m[2], m[3]) }))
    .filter((d): d is { datum: string; saldo: number } => !!d.datum && d.saldo != null)
    .sort((a, b) => a.datum.localeCompare(b.datum));

  // 2. Monat mit den meisten Buchungen (Zeilen, die mit einem Datum beginnen)
  if (!von) {
    const jahrHint = nrJahr ?? (dated.length ? Number(dated[dated.length - 1].datum.slice(0, 4)) : null);
    const counts = new Map<string, number>();
    for (const line of t.split('\n')) {
      if (/^\s*(Kontostand|Saldo|alter|neuer)/i.test(line)) continue;
      const m = line.match(/^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
      if (!m) continue;
      const d = m[3] ? parseDate(`${m[1]}.${m[2]}.${m[3]}`) : jahrHint ? parseDate(`${m[1]}.${m[2]}.${jahrHint}`) : null;
      if (!d) continue;
      const key = d.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
    if (best) setMonth(best[0]);
  }
  // 3. Späteste Kontostandsangabe (bei mehreren: Zeitraum dazwischen)
  if (!von && dated.length >= 2 && dated[0].datum < dated[dated.length - 1].datum) {
    von = nextDay(dated[0].datum);
    bis = dated[dated.length - 1].datum;
  }
  // 4. Auszugsnummer n/Jahr bei monatlichen Auszügen
  if (!von && nrM?.[2] && Number(nrM[1]) >= 1 && Number(nrM[1]) <= 12 && !dated.length) {
    setMonth(`${nrM[2]}-${String(Number(nrM[1])).padStart(2, '0')}`);
  }
  if (!von && dated.length === 1) bis = dated[0].datum;

  function setMonth(ym: string) {
    const [y, mo] = ym.split('-').map(Number);
    von = toISO(new Date(y, mo - 1, 1));
    bis = toISO(new Date(y, mo, 0));
  }

  // Kontostände dem Zeitraum zuordnen
  let alt: number | null = null;
  let neu: number | null = null;
  const altM = t.match(new RegExp(String.raw`(?:alter\s+(?:Kontostand|Saldo)|Anfangssaldo|Saldo\s+alt|Anfangsbestand)[^\n\d-]{0,80}?(?:\d{1,2}\.\d{1,2}\.\d{2,4}[^\n\d-]{0,20})?(?:\n\s*)?` + AMOUNT, 'i'));
  if (altM) alt = amount(altM[1], altM[2]);
  const neuM = t.match(new RegExp(String.raw`(?:neuer\s+(?:Kontostand|Saldo)|Endsaldo|Schlusssaldo|Saldo\s+neu|Endbestand)[^\n\d-]{0,80}?(?:\d{1,2}\.\d{1,2}\.\d{2,4}[^\n\d-]{0,20})?(?:\n\s*)?` + AMOUNT, 'i'));
  if (neuM) neu = amount(neuM[1], neuM[2]);
  if (dated.length) {
    const vor = von ? dated.filter((d) => d.datum < von!) : [];
    const ab = von ? dated.filter((d) => d.datum >= von!) : dated;
    if (vor.length) alt ??= vor[vor.length - 1].saldo;
    if (ab.length) neu ??= ab[ab.length - 1].saldo;
  }
  return { iban, nummer, von, bis, saldo_alt_cent: alt, saldo_neu_cent: neu };
}

function nextDay(iso: string): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + 1);
  return toISO(d);
}

export function dayBefore(iso: string): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() - 1);
  return toISO(d);
}

/** Jahr/Monat, unter dem der Auszug abgelegt wird: Monat des Zeitraum-Endes. */
export function statementMonth(info: Pick<StatementInfo, 'von' | 'bis'>): { jahr: number; monat: number } | null {
  const d = info.bis ?? info.von;
  if (!d) return null;
  return { jahr: Number(d.slice(0, 4)), monat: Number(d.slice(5, 7)) };
}

export function findAccountForIban(iban: string | null): Account | undefined {
  if (iban) {
    const a = get<Account>('SELECT * FROM accounts WHERE iban = ?', [iban]);
    if (a) return a;
  }
  const accounts = all<Account>('SELECT * FROM accounts WHERE aktiv = 1');
  return accounts.length === 1 ? accounts[0] : undefined;
}

export type SaveStatementInput = StatementInfo & {
  account_id: number;
  jahr: number;
  monat: number;
  dateiname: string;
  mime: string;
  daten: Uint8Array;
  erkannt: boolean;
};

export type SaveStatementResult = { id: number; abgleich: 'kalibriert' | 'stimmt' | 'abweichung' | 'ohne'; differenz: number };

/**
 * Speichert einen Kontoauszug. Erkannte Kontostände werden als Kontrollwerte hinterlegt;
 * ist das Konto noch nicht abgeglichen, wird der Anfangssaldo aus dem neuen Kontostand berechnet.
 */
export function saveStatement(s: SaveStatementInput): SaveStatementResult {
  let result: SaveStatementResult = { id: 0, abgleich: 'ohne', differenz: 0 };
  tx(() => {
    const id = run(
      `INSERT INTO statements(account_id, jahr, monat, nummer, von, bis, saldo_alt_cent, saldo_neu_cent, dateiname, mime, groesse, daten, erkannt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.account_id, s.jahr, s.monat, s.nummer, s.von, s.bis, s.saldo_alt_cent, s.saldo_neu_cent, s.dateiname, s.mime, s.daten.length, s.daten, s.erkannt ? 1 : 0],
    );
    result = { id, ...checkBalances(s.account_id, s) };
  });
  return result;
}

function checkBalances(accountId: number, s: Omit<StatementInfo, 'iban'>): Omit<SaveStatementResult, 'id'> {
  const acc = get<Account>('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!acc) return { abgleich: 'ohne', differenz: 0 };
  const notiz = `Kontoauszug${s.nummer ? ` Nr. ${s.nummer}` : ''}`;
  // Vor dem Speichern der Kontrollwerte prüfen – sonst gälte das Konto sofort als abgeglichen
  const calibrated = isCalibrated(acc);
  if (s.von && s.saldo_alt_cent != null) {
    if (!calibrated && (!s.bis || s.saldo_neu_cent == null)) {
      calibrateOpening(accountId, dayBefore(s.von), s.saldo_alt_cent, notiz);
      return { abgleich: 'kalibriert', differenz: 0 };
    }
    saveCheckpoint(accountId, dayBefore(s.von), s.saldo_alt_cent, notiz);
  }
  if (!s.bis || s.saldo_neu_cent == null) return { abgleich: 'ohne', differenz: 0 };
  if (!calibrated) {
    calibrateOpening(accountId, s.bis, s.saldo_neu_cent, notiz);
    return { abgleich: 'kalibriert', differenz: 0 };
  }
  saveCheckpoint(accountId, s.bis, s.saldo_neu_cent, notiz);
  const berechnet = balanceAt(acc, s.bis);
  const differenz = (berechnet ?? 0) - s.saldo_neu_cent;
  return { abgleich: differenz === 0 ? 'stimmt' : 'abweichung', differenz };
}

export type StatementMeta = Omit<Statement, 'daten'>;

export function listStatements(jahr: number): StatementMeta[] {
  return all<StatementMeta>(
    `SELECT id, account_id, jahr, monat, nummer, von, bis, saldo_alt_cent, saldo_neu_cent, dateiname, mime, groesse, erkannt, notiz, created_at
     FROM statements WHERE jahr = ? ORDER BY monat, COALESCE(bis, ''), id`,
    [jahr],
  );
}

export function statementBlobUrl(id: number): { url: string; mime: string; name: string } | null {
  const d = get<{ daten: Uint8Array; mime: string; dateiname: string }>('SELECT daten, mime, dateiname FROM statements WHERE id = ?', [id]);
  if (!d) return null;
  return { url: URL.createObjectURL(new Blob([d.daten as BlobPart], { type: d.mime })), mime: d.mime, name: d.dateiname };
}

export function updateStatement(id: number, v: Partial<Pick<Statement, 'account_id' | 'jahr' | 'monat' | 'nummer' | 'von' | 'bis' | 'saldo_alt_cent' | 'saldo_neu_cent' | 'notiz'>>) {
  const keys = Object.keys(v) as (keyof typeof v)[];
  if (!keys.length) return;
  tx(() => {
    // Von Hand bearbeitete Auszüge werden beim Neu-Einsortieren nicht mehr überschrieben (erkannt = 0)
    run(`UPDATE statements SET ${keys.map((k) => `${k} = ?`).join(', ')}, erkannt = 0 WHERE id = ?`, [...keys.map((k) => v[k] ?? null), id]);
    const s = get<Statement>('SELECT * FROM statements WHERE id = ?', [id]);
    if (s) checkBalances(s.account_id, s);
  });
}

export function deleteStatement(id: number) {
  run('DELETE FROM statements WHERE id = ?', [id]);
}

/** Entfernt die aus Kontoauszügen gespeicherten Kontrollwerte und legt sie aus den abgelegten Auszügen neu an. */
function rebuildStatementCheckpoints(accountId: number) {
  run("DELETE FROM balance_checkpoints WHERE account_id = ? AND notiz LIKE 'Kontoauszug%'", [accountId]);
  const list = all<Statement>('SELECT * FROM statements WHERE account_id = ? ORDER BY COALESCE(bis, von, \'\'), id', [accountId]);
  for (const st of list) checkBalances(accountId, st);
}

/** Löscht alle Kontoauszüge eines Kontos in einem Jahr (inkl. der daraus gespeicherten Kontrollwerte). */
export function deleteStatementsOfYear(accountId: number, jahr: number): number {
  let n = 0;
  tx(() => {
    n = scalar<number>('SELECT COUNT(*) FROM statements WHERE account_id = ? AND jahr = ?', [accountId, jahr]) ?? 0;
    run('DELETE FROM statements WHERE account_id = ? AND jahr = ?', [accountId, jahr]);
    rebuildStatementCheckpoints(accountId);
  });
  return n;
}

/**
 * Liest alle automatisch erkannten Auszüge eines Kontos neu aus und sortiert sie neu ein.
 * Von Hand bearbeitete oder nicht lesbare Auszüge bleiben unverändert. Der Text-Extraktor wird übergeben,
 * damit diese Funktion ohne pdf.js testbar bleibt.
 */
export async function resortStatements(accountId: number, extract: (bytes: Uint8Array) => Promise<string>): Promise<{ geprueft: number; verschoben: number }> {
  const list = all<Statement>("SELECT * FROM statements WHERE account_id = ? AND erkannt = 1 AND mime = 'application/pdf'", [accountId]);
  const updates: { id: number; info: StatementInfo; jahr: number; monat: number }[] = [];
  for (const st of list) {
    const info = parseStatementText(await extract(st.daten));
    const ym = statementMonth(info);
    if (ym) updates.push({ id: st.id, info, ...ym });
  }
  let verschoben = 0;
  tx(() => {
    for (const u of updates) {
      const old = list.find((x) => x.id === u.id)!;
      if (old.jahr !== u.jahr || old.monat !== u.monat) verschoben++;
      run(
        'UPDATE statements SET jahr = ?, monat = ?, nummer = ?, von = ?, bis = ?, saldo_alt_cent = ?, saldo_neu_cent = ? WHERE id = ?',
        [u.jahr, u.monat, u.info.nummer ?? old.nummer, u.info.von, u.info.bis, u.info.saldo_alt_cent, u.info.saldo_neu_cent, u.id],
      );
    }
    rebuildStatementCheckpoints(accountId);
  });
  return { geprueft: list.length, verschoben };
}

/** Monate (1–12) eines Jahres, für die beim Konto kein Auszug vorliegt – nur bis zum aktuellen Monat. */
export function missingMonths(accountId: number, jahr: number, today = toISO(new Date())): number[] {
  const acc = get<Account>('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!acc) return [];
  const have = new Set(all<{ monat: number }>('SELECT DISTINCT monat FROM statements WHERE account_id = ? AND jahr = ?', [accountId, jahr]).map((r) => r.monat));
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthEnd = toISO(new Date(jahr, m, 0));
    const monthStart = `${jahr}-${String(m).padStart(2, '0')}-01`;
    if (monthEnd >= today) break; // laufender Monat: Auszug kommt erst noch
    if (monthEnd < acc.anfangsdatum && !scalar('SELECT 1 FROM transactions WHERE account_id = ? AND buchungsdatum BETWEEN ? AND ?', [accountId, monthStart, monthEnd])) continue;
    if (!have.has(m)) out.push(m);
  }
  return out;
}
