import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, createNew, get, run, scalar, setSqlJs } from '../src/db/db';
import { setAllocations } from '../src/lib/bank';
import { belegFehlt, fehlendeBelege, setBelegeVollstaendig } from '../src/lib/docs';
import { eigenbelegAusBuchung, eigenbelegSpeichern } from '../src/lib/eigenbeleg';
import type { Transaction } from '../src/db/schema';
import {
  abhaken, ausBuchungUebernehmen, betragFuer, entwurfAusBuchung, faelligkeiten, faelligMonat, rhythmusErkennen, saveRecurring, vorschlaege,
  wiederkehrendFuerBuchung,
} from '../src/lib/recurring';

let acc = 0;
const cat = (nr: string) => scalar<number>('SELECT id FROM categories WHERE nummer = ?', [nr])!;
const addTx = (datum: string, betrag: number, name: string, iban: string | null = null) =>
  run('INSERT INTO transactions(account_id, buchungsdatum, betrag_cent, gegen_name, gegen_iban, verwendungszweck, buchungstext) VALUES (?,?,?,?,?,?,?)',
    [acc, datum, betrag, name, iban, 'Beitrag', 'LASTSCHRIFT']);
const doc = (txId: number) =>
  run("INSERT INTO documents(belegnr, belegdatum, transaction_id, dateiname, mime, groesse, daten) VALUES ('x', '2026-01-01', ?, 'r.pdf', 'application/pdf', 1, x'00')", [txId]);

beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
  setSqlJs(SQL);
  createNew();
  acc = run("INSERT INTO accounts(name, anfangsdatum) VALUES ('Giro', '2025-01-01')");
  run('UPDATE categories SET beleg_pflicht = 1 WHERE nummer IN (?, ?)', ['6420', '5200']);
});

describe('Belege bei Splitbuchungen', () => {
  it('erwartet je belegpflichtiger Splitzeile einen Beleg, bis „vollständig“ angehakt ist', () => {
    const t = addTx('2026-03-01', -30000, 'Budo-Shop');
    setAllocations(t, [
      { category_id: cat('5200'), member_id: null, partner_id: null, betrag_cent: -20000, beitragsjahr: null },
      { category_id: cat('6420'), member_id: null, partner_id: null, betrag_cent: -10000, beitragsjahr: null },
    ]);
    expect(fehlendeBelege('2026-01-01', '2026-12-31').map((f) => [f.id, f.soll, f.ist])).toEqual([[t, 2, 0]]);
    doc(t);
    // ein Beleg hochgeladen – der zweite fehlt weiterhin
    expect(fehlendeBelege('2026-01-01', '2026-12-31').map((f) => [f.soll, f.ist])).toEqual([[2, 1]]);
    setBelegeVollstaendig(t, true);
    expect(fehlendeBelege('2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('belegFehlt', () => {
    expect(belegFehlt(0, 0, 0)).toBe(false);
    expect(belegFehlt(1, 0, 0)).toBe(true);
    expect(belegFehlt(2, 1, 0)).toBe(true);
    expect(belegFehlt(2, 1, 1)).toBe(false);
    expect(belegFehlt(1, 2, 0)).toBe(false);
  });
});

describe('Wiederkehrende Zahlungen', () => {
  it('Betrag gilt ab Jahr bis zur nächsten Änderung', () => {
    const a = [{ ab_jahr: 2024, betrag_cent: 1000 }, { ab_jahr: 2026, betrag_cent: 1200 }];
    expect(betragFuer(a, 2023)).toBeNull();
    expect(betragFuer(a, 2025)).toBe(1000);
    expect(betragFuer(a, 2026)).toBe(1200);
    expect(betragFuer(a, 2030)).toBe(1200);
    expect([1, 2, 3, 4].map((p) => faelligMonat({ rhythmus: 'quartal', faellig_monat: 3 }, p))).toEqual([3, 6, 9, 12]);
    expect([1, 2].map((p) => faelligMonat({ rhythmus: 'halbjaehrlich', faellig_monat: 11 }, p))).toEqual([11, 5]);
  });

  it('schlägt die passende Buchung vor, hakt ab, ordnet zu und erzeugt einen Eigenbeleg', async () => {
    const p = run("INSERT INTO partners(name, iban) VALUES ('Germany Shotokan Karate e.V.', 'DE02120300000000202051')");
    const r = saveRecurring(
      { name: 'Jahresbeitrag Dachverband', partner_id: p, category_id: cat('6420'), faellig_monat: 2, eigenbeleg: 1, eigenbeleg_grund: 'Keine Rechnung vom Verband' },
      [{ ab_jahr: 2025, betrag_cent: 24000 }, { ab_jahr: 2026, betrag_cent: 26000 }],
    );
    const fremd = addTx('2026-02-10', -26000, 'Irgendwer');
    const t = addTx('2026-02-20', -26000, 'GERMANY SHOTOKAN KARATE E.V.');

    const [f] = faelligkeiten(2026, '2026-03-05');
    expect(f.betrag_cent).toBe(26000);
    expect(f.status).toBe('ueberfaellig');
    const v = vorschlaege(f);
    expect(v.map((x) => x.id)).toEqual([t]);
    expect(v[0].exakt).toBe(true);
    expect(v.some((x) => x.id === fremd)).toBe(false);

    const z = abhaken({ recurring_id: r, jahr: 2026, periode: 1, bezahlt_am: '2026-02-20', betrag_cent: 26000, transaction_id: t, zuordnen: true });
    expect(get('SELECT category_id, partner_id, betrag_cent FROM allocations WHERE transaction_id = ?', [t])).toEqual({ category_id: cat('6420'), partner_id: p, betrag_cent: -26000 });
    expect(faelligkeiten(2026, '2026-03-05')[0].status).toBe('erledigt');
    // bereits verknüpfte Buchung wird nicht noch einmal vorgeschlagen
    expect(vorschlaege(f)).toEqual([]);
    expect(fehlendeBelege('2026-01-01', '2026-12-31').map((x) => x.id)).toEqual([t]);

    const e = eigenbelegAusBuchung(t, 'Keine Rechnung vom Verband');
    expect(e).toMatchObject({ partner: 'Germany Shotokan Karate e.V.', betrag_cent: -26000, kategorie: expect.stringContaining('6420'), partner_id: p });
    const d = await eigenbelegSpeichern(e);
    run('UPDATE recurring_payments SET document_id = ? WHERE id = ?', [d, z]);
    expect(get('SELECT transaction_id, eigenbeleg, mime, dateiname FROM documents WHERE id = ?', [d])).toEqual({
      transaction_id: t, eigenbeleg: 1, mime: 'application/pdf', dateiname: 'Eigenbeleg 2026-001.pdf',
    });
    expect(fehlendeBelege('2026-01-01', '2026-12-31')).toEqual([]);
    expect(scalar('SELECT document_id FROM recurring_payments WHERE id = ?', [z])).toBe(d);
  });

  it('nur aktive Zahlungen im Gültigkeitszeitraum sind fällig', () => {
    saveRecurring({ name: 'A', faellig_monat: 5, bis_jahr: 2025 }, [{ ab_jahr: 2024, betrag_cent: 100 }]);
    saveRecurring({ name: 'B', faellig_monat: 1, rhythmus: 'halbjaehrlich' }, [{ ab_jahr: 2026, betrag_cent: 100 }]);
    expect(faelligkeiten(2025).map((f) => f.r.name)).toEqual(['A']);
    expect(faelligkeiten(2026, '2026-04-01').map((f) => [f.r.name, f.monat, f.status])).toEqual([['B', 1, 'ueberfaellig'], ['B', 7, 'offen']]);
    expect(() => saveRecurring({ name: 'C' }, [])).toThrow();
    expect(all('SELECT * FROM recurring')).toHaveLength(2);
  });
});

describe('Aus einer Buchung übernehmen', () => {
  const tx = (id: number) => get<Transaction>('SELECT * FROM transactions WHERE id = ?', [id])!;

  it('erkennt monatliche Zahlungen (Ionos), legt sie an und hakt alle passenden Monate ab', () => {
    const iban = 'DE89370400440532013000';
    const ids = Array.from({ length: 10 }, (_, i) => addTx(`2026-${String(i + 1).padStart(2, '0')}-05`, -1200, 'IONOS SE', iban));
    addTx('2026-06-20', -1200, 'IONOS SE', iban); // Zusatzbuchung im Juni, nicht doppelt abhaken
    const p = run("INSERT INTO partners(name, iban, default_category_id) VALUES ('IONOS', ?, ?)", [iban, cat('6810')]);
    const t = tx(ids[9]);
    expect(rhythmusErkennen(t)).toBe('monatlich');
    const e = entwurfAusBuchung(t, { category_id: null, partner_id: p });
    expect(e).toMatchObject({ name: 'IONOS', rhythmus: 'monatlich', faellig_monat: 1, category_id: cat('6810'), richtung: 'aus' });
    expect(e.amounts).toEqual([expect.objectContaining({ ab_jahr: 2026, betrag_cent: 1200 })]);

    const r = saveRecurring(e, e.amounts!);
    const weitere = ausBuchungUebernehmen(r, t.id);
    expect(weitere).toBe(9);
    expect(wiederkehrendFuerBuchung(t.id)).toMatchObject({ recurring_id: r, jahr: 2026, periode: 10 });
    const f = faelligkeiten(2026, '2026-10-25');
    expect(f.filter((x) => x.zahlung).map((x) => x.monat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(f.filter((x) => !x.zahlung).map((x) => x.status)).toEqual(['offen', 'offen']);
    // jeder Monat mit seiner eigenen Buchung
    expect(f.filter((x) => x.zahlung).map((x) => x.zahlung!.bezahlt_am)).toEqual(ids.map((i) => tx(i).buchungsdatum));
    // Buchungen bekommen Kategorie und Partner
    expect(scalar('SELECT COUNT(*) FROM allocations WHERE partner_id = ? AND category_id = ?', [p, cat('6810')])).toBe(10);
  });

  it('jährliche Zahlung mit anderem Betrag wird nicht automatisch abgehakt', () => {
    const a = addTx('2025-02-15', -24000, 'Landesverband', 'DE02500105170137075030');
    const b = addTx('2026-02-14', -25500, 'Landesverband', 'DE02500105170137075030');
    expect(rhythmusErkennen(tx(b))).toBe('jaehrlich');
    const e = entwurfAusBuchung(tx(b), { category_id: cat('6420'), partner_id: null });
    expect(e.faellig_monat).toBe(2);
    const r = saveRecurring({ ...e, name: 'Landesverband' }, [{ ab_jahr: 2025, betrag_cent: 24000 }, { ab_jahr: 2026, betrag_cent: 25500 }]);
    // ohne Partner: Abgleich über Kategorie + Betrag – 2025 hat noch keine Kategorie, wird also nicht gefunden
    expect(ausBuchungUebernehmen(r, b)).toBe(0);
    expect(wiederkehrendFuerBuchung(b)?.jahr).toBe(2026);
    expect(wiederkehrendFuerBuchung(a)).toBeUndefined();
  });
});
