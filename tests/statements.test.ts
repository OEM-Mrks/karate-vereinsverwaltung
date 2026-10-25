import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, createNew, run, scalar, setSqlJs } from '../src/db/db';
import type { Account } from '../src/db/schema';
import { balanceAt } from '../src/lib/bank';
import { missingMonths, parseStatementText, saveStatement, statementMonth } from '../src/lib/statements';

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
});
