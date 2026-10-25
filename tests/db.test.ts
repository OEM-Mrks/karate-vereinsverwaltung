import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, createNew, exportBytes, openBytes, run, scalar, setSqlJs } from '../src/db/db';
import { analyze, toTransactions } from '../src/lib/csv';
import { autoAssign, findOrCreateAccount, importTransactions } from '../src/lib/bank';
import { loadFeeContext, yearSummary } from '../src/lib/fees';
import { buildReport } from '../src/lib/report';
import type { Member } from '../src/db/schema';

const load = (f: string) => new Uint8Array(readFileSync(new URL(`../testdata/${f}`, import.meta.url)));

beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
  setSqlJs(SQL);
  createNew({ vereinName: 'Test-Karateverein' });
});

function addMember(v: Partial<Member>) {
  const g = scalar<number>("SELECT id FROM fee_groups WHERE name = 'Erwachsene'");
  return run('INSERT INTO members(vorname, nachname, eintritt, fee_group_id, iban, mitgliedsnr, kontoinhaber) VALUES (?,?,?,?,?,?,?)', [
    v.vorname, v.nachname, v.eintritt ?? '2020-01-01', g, v.iban ?? null, v.mitgliedsnr ?? null, v.kontoinhaber ?? null,
  ]);
}

describe('Import, Zuordnung und GuV', () => {
  it('ordnet automatisch zu und erstellt die GuV mit Kontoständen', () => {
    run("DELETE FROM fee_rates");
    run("INSERT INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) SELECT id, 2026, 1800 FROM fee_groups WHERE name = 'Erwachsene'");
    const jonas = addMember({ vorname: 'Jonas', nachname: 'Müller' });
    const sabine = addMember({ vorname: 'Sabine', nachname: 'Schäfer', mitgliedsnr: '1002' });
    const lea = addMember({ vorname: 'Lea', nachname: 'Schmidt', iban: 'DE91 1000 0000 0123 4567 89' });
    const halle = scalar<number>("SELECT id FROM categories WHERE nummer = '6310'");
    run('INSERT INTO partners(name, iban, default_category_id) VALUES (?,?,?)', ['Stadt Musterstadt', 'DE12500105170648489890', halle]);
    run("INSERT INTO partners(name, default_category_id) SELECT 'Budo-Shop', id FROM categories WHERE nummer = '5200'");

    const a = analyze(load('sparkasse-camt-beispiel.csv'));
    const parsed = toTransactions(a.rows, a.config).ok;
    const acc = findOrCreateAccount(parsed[0].auftragskonto, 'Girokonto Sparkasse', parsed[0].buchungsdatum);
    run("UPDATE accounts SET anfangssaldo_cent = 500000, anfangsdatum = '2026-01-01' WHERE id = ?", [acc]);
    const r1 = importTransactions(acc, parsed, { dateiname: 'a.csv', profil: a.bank });
    expect(r1).toMatchObject({ neu: 5, duplikate: 0 });
    // Gleiche Datei erneut → alles Duplikate
    expect(importTransactions(acc, parsed, { dateiname: 'a.csv', profil: a.bank })).toMatchObject({ neu: 0, duplikate: 5 });

    const b = analyze(load('sparkasse-mt940-beispiel.csv'));
    importTransactions(acc, toTransactions(b.rows, b.config).ok, { dateiname: 'b.csv', profil: b.bank });

    const res = autoAssign();
    expect(res.zugeordnet).toBe(6);
    const alloc = all<{ member_id: number | null; partner_id: number | null; nummer: string; auto: string; betrag_cent: number }>(
      'SELECT a.member_id, a.partner_id, c.nummer, a.auto, a.betrag_cent FROM allocations a LEFT JOIN categories c ON c.id = a.category_id ORDER BY a.transaction_id');
    expect(alloc.map((x) => [x.member_id, x.nummer, x.auto])).toEqual([
      [jonas, '4010', 'Name Mitglied'],
      [sabine, '4010', 'Mitgliedsnummer'],
      [null, '6310', 'IBAN Partner'],
      [null, '5200', 'Name Partner'],
      [null, '6855', 'Regel „Kontoführungsentgelt"'],
      [lea, '4010', 'IBAN Mitglied'],
    ]);

    const ctx = loadFeeContext('2026-10-25');
    const m = all<Member>('SELECT * FROM members WHERE id = ?', [jonas])[0];
    const s = yearSummary(m, 2026, ctx);
    expect(s.soll).toBe(21600);
    expect(s.bezahlt).toBe(21600);
    expect(s.offen).toBe(0);

    const rep = buildReport(2026);
    expect(rep.summeEin).toBe(21600 + 30000 + 2500);
    expect(rep.summeAus).toBe(15000 + 123456 + 990);
    expect(rep.konten[0].anfang).toBe(500000);
    expect(rep.kontoBewegung).toBe(rep.ergebnis);
    expect(rep.differenz).toBe(0);
    expect(rep.unzugeordnet.anzahl).toBe(0);
    expect(rep.fehlendeBelege).toBe(2); // Hallenmiete und Budo-Shop ohne Beleg
  });

  it('exportiert und öffnet die Datenbank inkl. Belege', () => {
    addMember({ vorname: 'A', nachname: 'B' });
    run("INSERT INTO documents(dateiname, mime, groesse, daten) VALUES ('x.pdf','application/pdf',3, ?)", [new Uint8Array([1, 2, 3])]);
    const bytes = exportBytes();
    createNew();
    expect(scalar('SELECT COUNT(*) FROM members')).toBe(0);
    openBytes(bytes);
    expect(scalar('SELECT COUNT(*) FROM members')).toBe(1);
    expect(Array.from(scalar<Uint8Array>('SELECT daten FROM documents')!)).toEqual([1, 2, 3]);
  });
});

describe('Kontostand abgleichen', () => {
  it('rechnet den Anfangssaldo aus einem bekannten Kontostand zurück', async () => {
    const { calibrateOpening, isCalibrated, balanceAt } = await import('../src/lib/bank');
    const a = analyze(load('sparkasse-camt-beispiel.csv'));
    const parsed = toTransactions(a.rows, a.config).ok;
    const acc = findOrCreateAccount(parsed[0].auftragskonto, 'Giro', parsed[0].buchungsdatum);
    importTransactions(acc, parsed, { dateiname: 'a.csv', profil: a.bank });
    const account = () => all<import('../src/db/schema').Account>('SELECT * FROM accounts WHERE id = ?', [acc])[0];
    expect(isCalibrated(account())).toBe(false);
    // Ohne Abgleich ist der "Kontostand" nur die Summe der Buchungen
    const summe = 21600 + 30000 - 15000 - 123456 - 990;
    expect(balanceAt(account(), '2026-01-31')).toBe(summe);
    // Online-Banking zeigt am 31.01.: 5.000,00 €
    const opening = calibrateOpening(acc, '2026-01-31', 500000);
    expect(opening).toBe(500000 - summe);
    expect(isCalibrated(account())).toBe(true);
    expect(balanceAt(account(), '2026-01-31')).toBe(500000);
    expect(balanceAt(account(), '2026-01-04')).toBe(500000 - summe + 21600);
    expect(scalar('SELECT saldo_cent FROM balance_checkpoints WHERE account_id = ? AND datum = ?', [acc, '2026-01-31'])).toBe(500000);
  });
});
