import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, expect, it } from 'vitest';
import { createNew, run, setSqlJs } from '../src/db/db';
import { pdfBlob } from '../src/lib/pdf';
import { anwesenheitslistePdf } from '../src/lib/pdfDocs';
import { teilnehmer } from '../src/lib/versammlung';

beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
  setSqlJs(SQL);
  createNew();
});

const add = (nr: string, vorname: string, nachname: string, eintritt: string, austritt: string | null, geburt: string | null) =>
  run('INSERT INTO members(mitgliedsnr, vorname, nachname, eintritt, austritt, geburtsdatum) VALUES (?,?,?,?,?,?)', [nr, vorname, nachname, eintritt, austritt, geburt]);

it('listet die am Versammlungstag aktiven Mitglieder und erkennt Minderjährige', async () => {
  add('1003', 'Anna', 'Zeller', '2020-01-01', null, '1980-05-01');
  add('1001', 'Ben', 'Ärmel', '2021-01-01', null, '2010-04-01');   // am 01.03.2028 noch 17
  add('1002', 'Cem', 'Bauer', '2019-01-01', '2026-12-31', null);   // ausgetreten
  add('1004', 'Dora', 'Mertens', '2028-06-01', null, null);         // tritt erst später ein

  const l = teilnehmer('2028-03-01');
  expect(l.map((m) => m.nachname)).toEqual(['Ärmel', 'Zeller']);
  expect(l.map((m) => m.minderjaehrig)).toEqual([true, false]);
  expect(teilnehmer('2026-06-01', 'nr').map((m) => m.mitgliedsnr)).toEqual(['1001', '1002', '1003']);

  const blob = await pdfBlob(anwesenheitslistePdf({
    titel: 'Ordentliche Mitgliederversammlung 2028', datum: '2028-03-01', uhrzeit: '19:00', ort: 'Vereinsheim',
    anschrift: true, telefon: true, email: false, minderjaehrige: true, leerzeilen: 3, sortierung: 'name',
  }, l));
  expect(blob.size).toBeGreaterThan(1000);
});
