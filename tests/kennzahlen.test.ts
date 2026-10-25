import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, expect, it } from 'vitest';
import { run, scalar, setSqlJs } from '../src/db/db';
import { loadDemo } from '../src/db/demo';
import { beitragsStatistik, jahresbericht, mitgliederStatistik, prognose } from '../src/lib/kennzahlen';
import { pdfBlob } from '../src/lib/pdf';
import { protokollPdf, vorstandsberichtPdf } from '../src/lib/pdfDocs';
import { ladeTagesordnung } from '../src/lib/versammlung';

beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
  setSqlJs(SQL);
  loadDemo();
});

const year = new Date().getFullYear();

it('Mitgliederstatistik zählt ohne Namen: aktiv, Kündigungen, Ehrenmitglieder', () => {
  const stichtag = `${year}-06-30`;
  const vorher = mitgliederStatistik(stichtag);
  const ehren = scalar<number>("SELECT id FROM fee_groups WHERE name LIKE 'Ehren%'")!;
  run(`INSERT INTO members(vorname, nachname, eintritt, fee_group_id) VALUES ('E', 'Hrenmitglied', '${year}-01-15', ?)`, [ehren]);
  run(`INSERT INTO members(vorname, nachname, eintritt, austritt) VALUES ('G', 'Eht', '2010-01-01', '${year}-12-31')`);
  run(`INSERT INTO members(vorname, nachname, eintritt, austritt) VALUES ('W', 'Eg', '2010-01-01', '${year}-03-31')`);
  const s = mitgliederStatistik(stichtag);
  expect(s.aktiv).toBe(vorher.aktiv + 2);
  expect(s.ehrenmitglieder).toBe(vorher.ehrenmitglieder + 1);
  expect(s.eintritte).toBe(vorher.eintritte + 1);
  expect(s.kuendigungen).toBe(vorher.kuendigungen + 1);
  expect(s.austritte).toBe(vorher.austritte + 1);
  expect(JSON.stringify(s)).not.toContain('Hrenmitglied');
});

it('Beitragsstand, Prognose und Jahresbericht passen zusammen', () => {
  const heute = `${year}-10-25`;
  const b = beitragsStatistik(year, heute);
  expect(b.soll).toBeGreaterThan(0);
  expect(b.bezahlt).toBeLessThanOrEqual(b.soll);
  expect(b.mitRueckstand).toBe(b.saeumige.length);
  expect(b.ueberfaellig).toBe(b.saeumige.reduce((s, x) => s + x.betrag, 0));
  const p = prognose(heute);
  expect(p.ende).toBe(p.kontostand + p.beitraege + p.wiederkehrendEin - p.wiederkehrendAus);
  const j = jahresbericht(year - 1);
  expect(j.report.ganzesJahr).toBe(true);
  expect(j.report.kontoEnde - j.report.kontoAnfang).toBe(j.report.kontoBewegung);
});

it('erzeugt Protokollvorlage mit Eckdaten und Vorstandsbericht', async () => {
  const o = {
    titel: 'MV', datum: `${year}-03-01`, uhrzeit: '', ort: '', anschrift: true, telefon: true, email: false,
    minderjaehrige: true, leerzeilen: 0, sortierung: 'name' as const,
  };
  expect((await pdfBlob(protokollPdf(o, ladeTagesordnung(o.datum), jahresbericht(year - 1)))).size).toBeGreaterThan(1000);
  expect((await pdfBlob(vorstandsberichtPdf(`${year}-10-25`, { mitNamen: true }))).size).toBeGreaterThan(1000);
});
