import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, fingerprints, parseCSV, toTransactions } from '../src/lib/csv';

const load = (f: string) => new Uint8Array(readFileSync(new URL(`../testdata/${f}`, import.meta.url)));

describe('CSV-Import', () => {
  it('erkennt Sparkasse CSV-CAMT (Windows-1252)', () => {
    const a = analyze(load('sparkasse-camt-beispiel.csv'));
    expect(a.config.encoding).toBe('windows-1252');
    expect(a.config.delimiter).toBe(';');
    expect(a.bank).toBe('Sparkasse (CSV-CAMT)');
    const r = toTransactions(a.rows, a.config);
    expect(r.errors).toEqual([]);
    expect(r.pending).toBe(1);
    expect(r.ok).toHaveLength(5);
    const [first, , , shop, fee] = r.ok;
    expect(first).toMatchObject({
      buchungsdatum: '2026-01-02', betrag_cent: 21600, gegen_name: 'Petra Müller',
      gegen_iban: 'DE89370400440532013000', verwendungszweck: 'Mitgliedsbeitrag 2026 Jonas Müller', e2e_ref: null,
      auftragskonto: 'DE02120300000000202051',
    });
    expect(shop.betrag_cent).toBe(-123456);
    expect(shop.verwendungszweck).toContain('Gürtel');
    expect(fee.gegen_iban).toBeNull();
  });

  it('erkennt Sparkasse CSV-MT940', () => {
    const a = analyze(load('sparkasse-mt940-beispiel.csv'));
    expect(a.bank).toBe('Sparkasse (CSV-MT940)');
    const r = toTransactions(a.rows, a.config);
    expect(r.ok[0]).toMatchObject({ betrag_cent: 2500, gegen_iban: 'DE91100000000123456789', gegen_name: 'Lea Schmidt' });
  });

  it('findet die Kopfzeile hinter einem Vorspann (ING)', () => {
    const a = analyze(load('ing-beispiel.csv'));
    expect(a.config.encoding).toBe('utf-8');
    expect(a.bank).toBe('ING');
    const r = toTransactions(a.rows, a.config);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ buchungsdatum: '2026-03-01', betrag_cent: -12000, gegen_name: 'Deutscher Karate Verband', saldo_cent: 400000 });
  });

  it('unterstützt getrennte Soll/Haben-Spalten', () => {
    const rows = parseCSV('Datum;Empfänger;Soll;Haben;Verwendungszweck\n01.02.2026;Halle;150,00;;Miete\n02.02.2026;Lea;;25,00;Beitrag', ';');
    const a = analyze(new TextEncoder().encode(rows.map((r) => r.join(';')).join('\n')));
    const r = toTransactions(a.rows, a.config);
    expect(r.ok.map((t) => t.betrag_cent)).toEqual([-15000, 2500]);
  });

  it('erkennt Duplikate, unterscheidet aber gleiche Buchungen in einer Datei', () => {
    const a = analyze(load('sparkasse-camt-beispiel.csv'));
    const r = toTransactions(a.rows, a.config);
    const h1 = fingerprints(1, r.ok);
    const h2 = fingerprints(1, r.ok);
    expect(h1).toEqual(h2);
    expect(new Set(fingerprints(1, [r.ok[0], r.ok[0]])).size).toBe(2);
  });
});

describe('Kontostände in der Datei', () => {
  it('liest den Kontostand aus dem Vorspann (DKB)', () => {
    const a = analyze(load('dkb-beispiel.csv'));
    expect(a.bank).toBe('DKB');
    expect(a.balances).toEqual([{ art: 'ende', datum: '2026-03-31', saldo_cent: 123456, text: 'Kontostand vom 31.03.2026: 1.234,56 €' }]);
    const r = toTransactions(a.rows, a.config);
    expect(r.ok.map((t) => [t.gegen_name, t.betrag_cent])).toEqual([['IONOS SE', -1200], ['Lea Schmidt', 2500]]);
  });

  it('findet keinen Kontostand in Sparkasse CSV-CAMT', () => {
    expect(analyze(load('sparkasse-camt-beispiel.csv')).balances).toEqual([]);
  });

  it('ermittelt den Endstand aus der Saldo-Spalte unabhängig von der Sortierung', async () => {
    const { endBalanceFromRows } = await import('../src/lib/bank');
    const a = analyze(load('ing-beispiel.csv'));
    const txs = toTransactions(a.rows, a.config).ok;
    expect(endBalanceFromRows(txs)).toEqual({ datum: '2026-03-02', saldo_cent: 402500 });
    // Zwei Buchungen am selben Tag, Datei absteigend sortiert
    const day = [
      { ...txs[0], buchungsdatum: '2026-04-01', betrag_cent: -500, saldo_cent: 9500 },
      { ...txs[0], buchungsdatum: '2026-04-01', betrag_cent: 1000, saldo_cent: 10000 },
    ];
    expect(endBalanceFromRows(day)).toEqual({ datum: '2026-04-01', saldo_cent: 9500 });
    expect(endBalanceFromRows([...day].reverse())).toEqual({ datum: '2026-04-01', saldo_cent: 9500 });
  });
});
