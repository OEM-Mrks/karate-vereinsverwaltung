import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, expect, it } from 'vitest';
import { createNew, run, setSqlJs } from '../src/db/db';
import { pdfBlob } from '../src/lib/pdf';
import { anwesenheitslistePdf, einladungPdf, protokollPdf } from '../src/lib/pdfDocs';
import {
  ladeTagesordnung, punktHinzufuegen, speichereTagesordnung, teilnehmer, tops, verschieben, verwerfeTagesordnung,
} from '../src/lib/versammlung';

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

it('Tagesordnung: Standardpunkte, Neuwahlen bei ablaufender Amtszeit, eigene Punkte vor „Verschiedenes“', async () => {
  run("INSERT INTO officers(funktion, name, amtszeit_bis) VALUES ('Kassenwart/in', 'K. Wart', '2028-03-01'), ('Vorsitzende/r', 'V. Sitz', '2030-03-01')");
  let t = ladeTagesordnung('2028-03-10');
  const neuwahl = t.punkte.find((p) => p.standard === 'neuwahlen')!;
  expect(neuwahl.aktiv).toBe(true);
  expect(neuwahl.details).toBe('Zu wählen: Kassenwart/in');
  expect(ladeTagesordnung('2027-03-10').punkte.find((p) => p.standard === 'neuwahlen')!.aktiv).toBe(false);

  const vorher = tops(t).length;
  t = punktHinzufuegen(t, '  Anschaffung neuer Matten ');
  const liste = tops(t);
  expect(liste).toHaveLength(vorher + 1);
  expect(liste.at(-2)!.titel).toBe('Anschaffung neuer Matten');
  expect(liste.at(-1)!.titel).toBe('Verschiedenes');
  expect(liste.map((p) => p.nr)).toEqual(liste.map((_, i) => i + 1));

  const eigen = liste.at(-2)!.id;
  t = verschieben(t, eigen, -1);
  expect(tops(t).at(-3)!.id).toBe(eigen);
  // abgewählte Punkte bekommen keine Nummer
  t = { ...t, punkte: t.punkte.map((p) => (p.standard === 'eroeffnung' ? { ...p, aktiv: false } : p)) };
  expect(tops(t)[0].titel).toBe('Feststellung der ordnungsgemäßen Einladung und der Beschlussfähigkeit');

  speichereTagesordnung({ ...t, antragsfrist: '2028-02-20' });
  expect(ladeTagesordnung('2028-03-10').punkte.some((p) => p.titel === 'Anschaffung neuer Matten')).toBe(true);
  const o = {
    titel: 'Ordentliche Mitgliederversammlung 2028', datum: '2028-03-10', uhrzeit: '19:00', ort: 'Vereinsheim',
    anschrift: true, telefon: true, email: false, minderjaehrige: true, leerzeilen: 0, sortierung: 'name' as const,
  };
  const gespeichert = ladeTagesordnung(o.datum);
  expect((await pdfBlob(einladungPdf(o, gespeichert))).size).toBeGreaterThan(1000);
  expect((await pdfBlob(protokollPdf(o, gespeichert))).size).toBeGreaterThan(1000);

  verwerfeTagesordnung();
  expect(ladeTagesordnung(o.datum).punkte.some((p) => !p.standard)).toBe(false);
});
