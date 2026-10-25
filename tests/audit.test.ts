import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, createNew, run, scalar, setSqlJs } from '../src/db/db';
import type { Transaction } from '../src/db/schema';
import { analyze, toTransactions } from '../src/lib/csv';
import { autoAssign, findOrCreateAccount, importTransactions } from '../src/lib/bank';
import { bulkSetCategory, bulkSetPartner, partnerBackfillCandidates, similarWithoutPartner } from '../src/lib/bulk';
import { buildReport, shiftYear } from '../src/lib/report';
import { auditItems, auditSummary, exportProtocol, getAudit, importProtocol, setAnswer, setCheck, startAudit } from '../src/lib/audit';

const load = (f: string) => new Uint8Array(readFileSync(new URL(`../testdata/${f}`, import.meta.url)));
let acc = 0;

beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
  setSqlJs(SQL);
  createNew();
  const a = analyze(load('sparkasse-camt-beispiel.csv'));
  const parsed = toTransactions(a.rows, a.config).ok;
  acc = findOrCreateAccount(parsed[0].auftragskonto, 'Giro', '2026-01-01');
  run("UPDATE accounts SET anfangsdatum = '2026-01-01', anfangssaldo_cent = 100000 WHERE id = ?", [acc]);
  importTransactions(acc, parsed, { dateiname: 'a.csv', profil: a.bank });
});

const cat = (nr: string) => scalar<number>('SELECT id FROM categories WHERE nummer = ?', [nr])!;
const addTx = (datum: string, betrag: number, name: string, iban: string | null) =>
  run('INSERT INTO transactions(account_id, buchungsdatum, betrag_cent, gegen_name, gegen_iban, verwendungszweck) VALUES (?,?,?,?,?,?)', [acc, datum, betrag, name, iban, 'Rechnung']);

describe('Sammelbearbeitung', () => {
  it('trägt einen Lieferanten bei allen Buchungen desselben Zahlungspartners nach', () => {
    const ids = [addTx('2026-02-01', -1200, 'IONOS SE', 'DE11111111111111111111'), addTx('2026-03-01', -1200, 'IONOS SE', 'DE11111111111111111111'), addTx('2026-04-01', -1200, 'IONOS SE', 'DE11111111111111111111')];
    // Nur Kategorie zugeordnet, kein Lieferant
    bulkSetCategory(ids, cat('6810'));
    const first = all<Transaction>('SELECT * FROM transactions WHERE id = ?', [ids[0]])[0];
    expect(similarWithoutPartner(first)).toEqual([ids[1], ids[2]]);

    const p = run("INSERT INTO partners(name, iban, default_category_id) VALUES ('IONOS', 'DE11111111111111111111', ?)", [cat('6810')]);
    expect(partnerBackfillCandidates(p)).toEqual(ids);
    expect(bulkSetPartner(ids, p)).toEqual({ geaendert: 3, uebersprungen: 0 });
    expect(scalar('SELECT COUNT(*) FROM allocations WHERE partner_id = ? AND category_id = ?', [p, cat('6810')])).toBe(3);
    expect(partnerBackfillCandidates(p)).toEqual([]);
  });

  it('überspringt Splitbuchungen beim Setzen der Kategorie', () => {
    const id = addTx('2026-02-01', -1000, 'Shop', null);
    run('INSERT INTO allocations(transaction_id, category_id, betrag_cent) VALUES (?,?,?), (?,?,?)', [id, cat('5200'), -600, id, cat('6845'), -400]);
    expect(bulkSetCategory([id], cat('6300'))).toEqual({ geaendert: 0, uebersprungen: 1 });
  });
});

describe('Unterjährige GuV', () => {
  it('berechnet Zeiträume und Kontostand zum Stichtag', () => {
    autoAssign();
    const jan = buildReport(2026, '2026-01-01', '2026-01-10');
    expect(jan.ganzesJahr).toBe(false);
    // 02.01. +216, 05.01. +300, 10.01. −150
    expect(jan.kontoAnfang).toBe(100000);
    expect(jan.kontoEnde).toBe(100000 + 21600 + 30000 - 15000);
    expect(jan.kontoBewegung).toBe(jan.ergebnis + jan.summeNeutral + jan.unzugeordnet.summe);
    expect(buildReport(2026).ganzesJahr).toBe(true);
    expect(shiftYear('2028-02-29', -1)).toBe('2027-02-28');
  });
});

describe('Kassenprüfung', () => {
  it('Prüfvermerke, Rückfragen und Austausch per Protokolldatei', () => {
    autoAssign();
    startAudit(2026, { pruefer: 'Anna Prüfer\nBernd Prüfer', pruefdatum: '2027-02-15', ort: 'Musterstadt', umfang: 'alle' });
    const audit = getAudit(2026)!;
    const items = auditItems(audit);
    expect(items).toHaveLength(5);
    setCheck(audit.id, items[0].id, 'ok', null);
    setCheck(audit.id, items[1].id, 'frage', 'Beleg fehlt?');
    let s = auditSummary(audit, auditItems(audit));
    expect(s).toMatchObject({ gesamt: 5, geprueft: 2, ok: 1, fragen: 1, offeneFragen: 1 });
    expect(s.hinweise.some((h) => h.text.includes('noch nicht erfasst'))).toBe(true);

    // Kassenprüfer arbeitet auf einer Kopie, Protokoll wird zurückgespielt
    const json = exportProtocol(audit);
    run('DELETE FROM audit_checks');
    setAnswer(audit.id, items[1].id, 'x');
    const r = importProtocol(audit, json);
    expect(r).toEqual({ uebernommen: 2, unbekannt: 0 });
    setAnswer(audit.id, items[1].id, 'Beleg nachgereicht');
    s = auditSummary(audit, auditItems(audit));
    expect(s.offeneFragen).toBe(0);
    expect(() => importProtocol({ ...audit, jahr: 2025 }, json)).toThrow(/2026/);

    const ausgaben = auditItems({ ...audit, umfang: 'ausgaben' });
    expect(ausgaben.every((i) => i.betrag_cent < 0)).toBe(true);
  });
});
