import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, createNew, run, scalar, setSqlJs } from '../src/db/db';
import type { Member } from '../src/db/schema';
import { analyze, toTransactions } from '../src/lib/csv';
import { findOrCreateAccount, importTransactions } from '../src/lib/bank';
import { missingFields } from '../src/lib/completeness';
import {
  applyAndAssign, createMember, createPartner, guessFeeGroup, guessMemberName, linkMember, memberNoFromText, nextMemberNo, openGroups, ruleForGroup, splitName,
} from '../src/lib/setup';

const load = (f: string) => new Uint8Array(readFileSync(new URL(`../testdata/${f}`, import.meta.url)));

beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
  setSqlJs(SQL);
  createNew();
  run('DELETE FROM fee_rates');
  run("INSERT INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) SELECT id, 2026, 2500 FROM fee_groups WHERE name = 'Erwachsene'");
  run("INSERT INTO fee_rates(fee_group_id, jahr, monatsbeitrag_cent) SELECT id, 2026, 1800 FROM fee_groups WHERE name LIKE 'Kinder%'");
  const a = analyze(load('sparkasse-camt-beispiel.csv'));
  const parsed = toTransactions(a.rows, a.config).ok;
  importTransactions(findOrCreateAccount(parsed[0].auftragskonto, 'Giro', parsed[0].buchungsdatum), parsed, { dateiname: 'a.csv', profil: a.bank });
});

describe('Ersteinrichtung aus dem Kontoauszug', () => {
  it('teilt Namen auf', () => {
    expect(splitName('Petra Müller')).toEqual({ vorname: 'Petra', nachname: 'Müller' });
    expect(splitName('Müller, Petra')).toEqual({ vorname: 'Petra', nachname: 'Müller' });
    expect(splitName('Dr. Anna Maria von der Heide')).toEqual({ vorname: 'Anna Maria', nachname: 'von der Heide' });
    expect(splitName('Mustermann')).toEqual({ vorname: '', nachname: 'Mustermann' });
  });

  it('erkennt das Kind im Verwendungszweck', () => {
    expect(guessMemberName({ gegen_name: 'Petra Müller', verwendungszweck: 'Mitgliedsbeitrag 2026 Jonas Müller' })).toEqual({ vorname: 'Jonas', nachname: 'Müller', ausZweck: true });
    expect(guessMemberName({ gegen_name: 'Petra Müller', verwendungszweck: 'Beitrag Petra Müller' })).toEqual({ vorname: 'Petra', nachname: 'Müller', ausZweck: false });
    expect(guessMemberName({ gegen_name: 'Sabine Schäfer', verwendungszweck: 'Beitrag Mitgl.-Nr. 1002' }).vorname).toBe('Sabine');
    expect(guessMemberName({ gegen_name: 'Thomas Weber', verwendungszweck: 'Beitrag Anna-Lena Weber 2026' }).vorname).toBe('Anna-Lena');
  });

  it('Mitgliedsnummern: Start bei 1001, Übernahme aus dem Verwendungszweck', () => {
    expect(nextMemberNo()).toBe('1001');
    expect(memberNoFromText('Beitrag Mitgl.-Nr. 1002')).toBe('1002');
    expect(memberNoFromText('Mitgliedsnummer: 77 Beitrag')).toBe('77');
    expect(memberNoFromText('MNr 42')).toBe('42');
    expect(memberNoFromText('Rechnung 4711')).toBeNull();
    run("INSERT INTO members(mitgliedsnr, vorname, nachname, eintritt) VALUES ('1002', 'A', 'B', '2020-01-01')");
    expect(memberNoFromText('Beitrag Mitgl.-Nr. 1002')).toBeNull();
    expect(nextMemberNo()).toBe('1003');
  });

  it('erkennt Beitragsgruppe und Zahlweise am Betrag', () => {
    const erw = scalar<number>("SELECT id FROM fee_groups WHERE name = 'Erwachsene'");
    const kind = scalar<number>("SELECT id FROM fee_groups WHERE name LIKE 'Kinder%'");
    expect(guessFeeGroup(30000, 2026)).toEqual({ fee_group_id: erw, zahlweise: 'jaehrlich' });
    expect(guessFeeGroup(21600, 2026)).toEqual({ fee_group_id: kind, zahlweise: 'jaehrlich' });
    expect(guessFeeGroup(7500, 2026)).toEqual({ fee_group_id: erw, zahlweise: 'quartal' });
    expect(guessFeeGroup(1234, 2026)).toBeNull();
    expect(guessFeeGroup(-30000, 2026)).toBeNull();
  });

  it('gruppiert offene Buchungen nach Zahlungspartner', () => {
    const g = openGroups();
    expect(g).toHaveLength(5);
    expect(g.find((x) => x.name === 'Budo-Shop GmbH')).toMatchObject({ iban: 'DE44500105175407324931', anzahl: 1, aus: 1 });
    expect(g.find((x) => x.iban === null)?.key).toBe('text:entgeltabschluss');
  });

  it('neues Mitglied nur mit Namen + IBAN ordnet die Zahlungen sofort zu', () => {
    const g = openGroups().find((x) => x.name === 'Sabine Schäfer')!;
    let id = 0;
    const n = applyAndAssign(() => {
      id = createMember({ vorname: 'Sabine', nachname: 'Schäfer', eintritt: '2026-01-01', fee_group_id: null, zahlweise: 'jaehrlich', iban: g.iban, kontoinhaber: 'Sabine Schäfer' });
    });
    expect(n).toBe(2); // Schäfer + Kontoführung (Standardregel)
    expect(scalar("SELECT member_id FROM allocations a JOIN transactions t ON t.id = a.transaction_id WHERE t.gegen_name = 'Sabine Schäfer'")).toBe(id);
    const m = all<Member>('SELECT * FROM members')[0];
    expect(missingFields(m)).toEqual(['Geburtsdatum', 'Anschrift', 'Telefon/Handy', 'Beitragsgruppe']);
  });

  it('Kind über Elternkonto: Mitglied ohne passenden Namen wird über den Kontoinhaber gefunden', () => {
    const g = openGroups().find((x) => x.name === 'Petra Müller')!;
    // Ohne IBAN anlegen, damit der Kontoinhaber-Abgleich greift
    applyAndAssign(() => createMember({ vorname: 'Jonas', nachname: 'Müller', eintritt: '2025-01-01', fee_group_id: null, zahlweise: 'jaehrlich', iban: null, kontoinhaber: g.name }));
    expect(scalar("SELECT a.auto FROM allocations a JOIN transactions t ON t.id = a.transaction_id WHERE t.gegen_name = 'Petra Müller'")).toBe('Name Mitglied');
  });

  it('Lieferant mit Standardkategorie und Kategorie-Regel ohne IBAN', () => {
    const shop = openGroups().find((x) => x.name === 'Budo-Shop GmbH')!;
    const cat5200 = scalar<number>("SELECT id FROM categories WHERE nummer = '5200'")!;
    expect(applyAndAssign(() => createPartner({ name: shop.name, typ: 'lieferant', iban: shop.iban, default_category_id: cat5200 }))).toBeGreaterThanOrEqual(1);
    expect(scalar("SELECT c.nummer FROM allocations a JOIN categories c ON c.id = a.category_id JOIN transactions t ON t.id = a.transaction_id WHERE t.gegen_name = 'Budo-Shop GmbH'")).toBe('5200');

    // Gruppe ohne IBAN/Namen (Entgeltabschluss) → Regel über den Buchungstext
    run('DELETE FROM rules');
    run('DELETE FROM allocations');
    const fee = openGroups().find((x) => x.key === 'text:entgeltabschluss')!;
    const cat6855 = scalar<number>("SELECT id FROM categories WHERE nummer = '6855'")!;
    applyAndAssign(() => ruleForGroup(fee, cat6855), fee.ids);
    expect(scalar('SELECT category_id FROM allocations WHERE transaction_id = ?', [fee.ids[0]])).toBe(cat6855);
  });

  it('bestehendes Mitglied: IBAN übernehmen, bei vorhandener IBAN eine Regel anlegen', () => {
    const id = run("INSERT INTO members(vorname, nachname, eintritt, iban) VALUES ('Max', 'Muster', '2020-01-01', 'DE89370400440532013000')");
    const g = openGroups().find((x) => x.name === 'Sabine Schäfer')!;
    applyAndAssign(() => linkMember(id, g));
    expect(scalar('SELECT COUNT(*) FROM rules WHERE member_id = ?', [id])).toBe(1);
    expect(scalar('SELECT member_id FROM allocations a JOIN transactions t ON t.id = a.transaction_id WHERE t.gegen_name = ?', ['Sabine Schäfer'])).toBe(id);
  });
});
