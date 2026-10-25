import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, expect, it } from 'vitest';
import { run, scalar, setSqlJs } from '../src/db/db';
import { loadDemo } from '../src/db/demo';
import { beitragsStatistik, jahresbericht, mitgliederStatistik, prognose, pruefungsStand } from '../src/lib/kennzahlen';
import { startAudit } from '../src/lib/audit';
import { pdfBlob } from '../src/lib/pdf';
import { protokollPdf, vorstandsberichtPdf } from '../src/lib/pdfDocs';
import { ladeTagesordnung, pruefungsjahreVon } from '../src/lib/versammlung';

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

it('Protokollvorlage berichtet über die gewählten Prüfungsjahre', async () => {
  expect(pruefungsjahreVon({ datum: `${year}-03-01` })).toEqual([year - 1]);
  expect(pruefungsjahreVon({ datum: `${year}-03-01`, pruefungsjahre: [year - 2, year - 1] })).toEqual([year - 2, year - 1]);
  startAudit(year - 1, { pruefer: 'A\nB', pruefdatum: `${year}-02-01`, ort: '', umfang: 'alle' });
  const p = [pruefungsStand(year - 1), pruefungsStand(year - 2)];
  expect(p.map((x) => x.vorhanden)).toEqual([true, false]);
  expect(p[0].pruefer).toEqual(['A', 'B']);
  const o = {
    titel: 'MV', datum: `${year}-03-01`, uhrzeit: '', ort: '', anschrift: true, telefon: true, email: false,
    minderjaehrige: true, leerzeilen: 0, sortierung: 'name' as const,
  };
  expect((await pdfBlob(protokollPdf(o, ladeTagesordnung(o.datum), jahresbericht(year - 1), p))).size).toBeGreaterThan(1000);
});

it('Protokollvorlage als Word-Dokument mit Tagesordnung und Eckdaten, ohne Namen', async () => {
  const { default: JSZip } = await import('jszip');
  const { docxBlob, protokollDocx } = await import('../src/lib/protokollDocx');
  const o = {
    titel: 'Ordentliche Mitgliederversammlung', datum: `${year}-03-01`, uhrzeit: '19:00', ort: 'Vereinsheim', anschrift: true, telefon: true,
    email: false, minderjaehrige: true, leerzeilen: 0, sortierung: 'name' as const,
  };
  startAudit(year - 1, { pruefer: 'Prüfer Eins', pruefdatum: `${year}-02-01`, ort: '', umfang: 'alle' });
  const blob = await docxBlob(protokollDocx(o, ladeTagesordnung(o.datum), jahresbericht(year - 1), [pruefungsStand(year - 1)]));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  const textInhalt = xml.replace(/<[^>]+>/g, ' ');
  expect(textInhalt).toContain('TOP 6: Bericht des Kassenwarts');
  expect(textInhalt).toContain(`Eckdaten Geschäftsjahr ${year - 1}`);
  expect(textInhalt).toContain(`Kassenprüfung ${year - 1}`);
  expect(textInhalt).toContain('Prüfer Eins');
  expect(textInhalt).toContain('Notizen:');
  // keine Mitgliedernamen aus dem Demoverein
  const namen = (await import('../src/db/db')).all<{ nachname: string }>('SELECT nachname FROM members');
  for (const n of namen) expect(textInhalt).not.toContain(n.nachname);
});
