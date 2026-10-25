import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, createNew, run, scalar, setSqlJs } from '../src/db/db';
import type { Account } from '../src/db/schema';
import { balanceAt } from '../src/lib/bank';
import { deleteStatementsOfYear, missingMonths, parseStatementText, resortStatements, saveStatement, statementMonth } from '../src/lib/statements';

describe('Kontoauszug auslesen', () => {
  it('Sparkasse-Stil: "Kontostand am …"', () => {
    const text = `Sparkasse Musterstadt
Kontoauszug 3/2026 Blatt 1
Girokonto IBAN DE02 1203 0000 0000 2020 51
Kontostand am 28.02.2026, Auszug Nr. 2 4.123,45
02.03.2026 Gutschrift Mitgliedsbeitrag 216,00
Kontostand am 31.03.2026 um 20:15 Uhr 4.339,45`;
    const i = parseStatementText(text);
    expect(i).toEqual({ iban: 'DE02120300000000202051', nummer: '3/2026', von: '2026-03-01', bis: '2026-03-31', saldo_alt_cent: 412345, saldo_neu_cent: 433945 });
    expect(statementMonth(i)).toEqual({ jahr: 2026, monat: 3 });
  });

  it('Volksbank-Stil: alter/neuer Kontostand mit S/H', () => {
    const text = `Kontoauszug Nr. 5/2026 vom 31.05.2026
Zeitraum 01.05.2026 - 31.05.2026
alter Kontostand vom 30.04.2026 1.000,00 H
neuer Kontostand vom 31.05.2026 120,00 S`;
    expect(parseStatementText(text)).toMatchObject({ nummer: '5/2026', von: '2026-05-01', bis: '2026-05-31', saldo_alt_cent: 100000, saldo_neu_cent: -12000 });
  });

  it('Zeitraum mit "bis" und Anfangs-/Endsaldo', () => {
    const text = `Auszug Nummer 7 Zeitraum vom 01.07.2026 bis 31.07.2026
Anfangssaldo 2.500,00 EUR
Endsaldo 2.750,10 EUR`;
    expect(parseStatementText(text)).toMatchObject({ nummer: '7', von: '2026-07-01', bis: '2026-07-31', saldo_alt_cent: 250000, saldo_neu_cent: 275010 });
  });

  it('Februar-Auszug mit Anfangsstand 31.01. landet im Februar (Betrag in der nächsten Zeile)', () => {
    const text = `Kontoauszug 2/2026
Kontostand am 31.01.2026, Auszug Nr. 1 5.000,00+
02.02.2026 Lastschrift IONOS SE 12,00-
15.02.2026 Gutschrift Lea Schmidt 25,00+
Kontostand am 28.02.2026 um 20:15 Uhr
5.013,00+`;
    expect(parseStatementText(text)).toMatchObject({ nummer: '2/2026', von: '2026-02-01', bis: '2026-02-28', saldo_alt_cent: 500000, saldo_neu_cent: 501300 });
  });

  it('Monat aus den Buchungen, auch wenn der Endstand nicht lesbar ist', () => {
    const text = `Kontoauszug 2/2026
Kontostand am 31.01.2026 5.000,00
02.02.2026 Lastschrift 12,00-
03.02.2026 Gutschrift 25,00
Kontostand am 28.02.2026 siehe Rückseite`;
    expect(parseStatementText(text)).toMatchObject({ von: '2026-02-01', bis: '2026-02-28', saldo_alt_cent: 500000, saldo_neu_cent: null });
  });

  it('Buchungsdaten ohne Jahr nutzen das Jahr der Auszugsnummer', () => {
    const text = `Auszug 3/2026
01.03. 01.03. Lastschrift 10,00
15.03. 15.03. Gutschrift 20,00
16.03. 16.03. Gutschrift 5,00`;
    expect(parseStatementText(text)).toMatchObject({ von: '2026-03-01', bis: '2026-03-31' });
  });

  it('Januar-Auszug mit Anfangsstand aus dem Vorjahr bleibt im Januar', () => {
    const text = `Kontoauszug 1/2026
Kontostand am 31.12.2025 4.123,45
02.01.2026 Gutschrift 216,00
Kontostand am 31.01.2026 4.339,45`;
    expect(parseStatementText(text)).toMatchObject({ von: '2026-01-01', bis: '2026-01-31', saldo_alt_cent: 412345, saldo_neu_cent: 433945 });
  });

  it('liefert null bei unbekanntem Inhalt (z. B. gescanntes PDF)', () => {
    expect(parseStatementText('')).toEqual({ iban: null, nummer: null, von: null, bis: null, saldo_alt_cent: null, saldo_neu_cent: null });
  });
});

describe('Ablage und Abgleich', () => {
  beforeEach(async () => {
    const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
    setSqlJs(SQL);
    createNew();
  });

  it('gleicht den Kontostand mit dem Auszug ab und meldet fehlende Monate', () => {
    const acc = run("INSERT INTO accounts(name, iban, anfangsdatum, anfangssaldo_cent) VALUES ('Giro', 'DE02120300000000202051', '2026-01-01', 0)");
    run("INSERT INTO transactions(account_id, buchungsdatum, betrag_cent) VALUES (?, '2026-01-10', 10000), (?, '2026-02-10', -2500)", [acc, acc]);
    const pdf = new Uint8Array([37, 80, 68, 70]);
    // Konto noch nicht abgeglichen → Anfangssaldo wird aus dem Auszug berechnet
    const r1 = saveStatement({ account_id: acc, jahr: 2026, monat: 1, iban: null, nummer: '1/2026', von: '2026-01-01', bis: '2026-01-31', saldo_alt_cent: 50000, saldo_neu_cent: 60000, dateiname: 'a.pdf', mime: 'application/pdf', daten: pdf, erkannt: true });
    expect(r1.abgleich).toBe('kalibriert');
    const a = () => all<Account>('SELECT * FROM accounts WHERE id = ?', [acc])[0];
    expect(a().anfangssaldo_cent).toBe(50000);
    // Februar passt, März weicht ab (fehlende Buchung)
    expect(saveStatement({ account_id: acc, jahr: 2026, monat: 2, iban: null, nummer: '2/2026', von: '2026-02-01', bis: '2026-02-28', saldo_alt_cent: 60000, saldo_neu_cent: 57500, dateiname: 'b.pdf', mime: 'application/pdf', daten: pdf, erkannt: true }).abgleich).toBe('stimmt');
    const r3 = saveStatement({ account_id: acc, jahr: 2026, monat: 3, iban: null, nummer: '3/2026', von: '2026-03-01', bis: '2026-03-31', saldo_alt_cent: 57500, saldo_neu_cent: 55000, dateiname: 'c.pdf', mime: 'application/pdf', daten: pdf, erkannt: true });
    expect(r3).toMatchObject({ abgleich: 'abweichung', differenz: 2500 });
    expect(balanceAt(a(), '2026-03-31')).toBe(57500);
    expect(scalar('SELECT COUNT(*) FROM balance_checkpoints WHERE account_id = ?', [acc])).toBeGreaterThanOrEqual(4);
    expect(missingMonths(acc, 2026, '2026-07-15')).toEqual([4, 5, 6]);
  });

  it('sortiert falsch abgelegte Auszüge neu ein und löscht ein ganzes Jahr', async () => {
    const acc = run("INSERT INTO accounts(name, anfangsdatum, anfangssaldo_cent) VALUES ('Giro', '2026-01-01', 100)");
    const texte = new Map<number, string>([
      [1, 'Kontoauszug 1/2026\nKontostand am 31.12.2025 100,00\n05.01.2026 Gutschrift 10,00\nKontostand am 31.01.2026\n110,00'],
      [2, 'Kontoauszug 2/2026\nKontostand am 31.01.2026 110,00\n05.02.2026 Gutschrift 10,00\nKontostand am 28.02.2026\n120,00'],
    ]);
    const pdf = (n: number) => new Uint8Array([n]);
    // Beide fälschlich im Januar abgelegt (wie mit der alten Erkennung)
    for (const n of [1, 2]) {
      saveStatement({ account_id: acc, jahr: 2026, monat: 1, iban: null, nummer: `${n}/2026`, von: null, bis: '2026-01-31', saldo_alt_cent: null, saldo_neu_cent: null, dateiname: `${n}.pdf`, mime: 'application/pdf', daten: pdf(n), erkannt: true });
    }
    const r = await resortStatements(acc, async (b) => texte.get(b[0])!);
    expect(r).toEqual({ geprueft: 2, verschoben: 1 });
    const rows = all<{ nummer: string; monat: number; saldo_neu_cent: number }>('SELECT nummer, monat, saldo_neu_cent FROM statements ORDER BY monat');
    expect(rows).toEqual([{ nummer: '1/2026', monat: 1, saldo_neu_cent: 11000 }, { nummer: '2/2026', monat: 2, saldo_neu_cent: 12000 }]);
    expect(all('SELECT datum, saldo_cent FROM balance_checkpoints ORDER BY datum')).toEqual([
      { datum: '2025-12-31', saldo_cent: 10000 }, { datum: '2026-01-31', saldo_cent: 11000 }, { datum: '2026-02-28', saldo_cent: 12000 },
    ]);
    expect(deleteStatementsOfYear(acc, 2026)).toBe(2);
    expect(scalar('SELECT COUNT(*) FROM statements')).toBe(0);
    expect(scalar('SELECT COUNT(*) FROM balance_checkpoints')).toBe(0);
  });
});
