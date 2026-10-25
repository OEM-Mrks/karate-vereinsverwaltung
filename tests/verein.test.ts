import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNew, getSetting, run, setSetting, setSqlJs } from '../src/db/db';
import { getVereinsdaten, namesFor, officers, saveOfficer, saveVereinsdaten, signatory } from '../src/lib/verein';

beforeEach(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${f}`, import.meta.url)) });
  setSqlJs(SQL);
  createNew({ vereinName: 'Shotokan Karate Haan e.V.' });
});

describe('Verein & Vorstand', () => {
  it('übernimmt die frühere einzeilige Anschrift und schreibt sie zusammengesetzt zurück', () => {
    setSetting('verein_anschrift', 'Am Dojo 1\n42781 Haan');
    expect(getVereinsdaten()).toMatchObject({ verein_strasse: 'Am Dojo 1', verein_plz: '42781', verein_ort: 'Haan' });
    saveVereinsdaten({ verein_strasse: 'Turnhallenweg 2', verein_registernummer: 'VR 123' });
    expect(getSetting('verein_anschrift')).toBe('Turnhallenweg 2\n42781 Haan');
  });

  it('sortiert Ämter, erkennt abgelaufene Amtszeiten und liefert Namen für Bericht und Briefe', () => {
    const m = run("INSERT INTO members(vorname, nachname, eintritt, email) VALUES ('Erika', 'Beispiel', '2010-01-01', 'erika@example.org')");
    expect(signatory()).toBe('Der Vorstand');
    saveOfficer({ funktion: 'Kassenprüfer/in', name: 'Anna Prüfer' });
    saveOfficer({ funktion: 'Kassenprüfer/in', name: 'Bernd Alt', amtszeit_bis: '2020-03-31' });
    saveOfficer({ funktion: 'Vorsitzende/r', member_id: m, vertretungsberechtigt: 1 });
    const list = officers();
    expect(list.map((o) => o.funktion)).toEqual(['Vorsitzende/r', 'Kassenprüfer/in', 'Kassenprüfer/in']);
    expect(list[0]).toMatchObject({ anzeigename: 'Erika Beispiel', kontakt: 'erika@example.org' });
    expect(namesFor('Kassenprüfer/in')).toEqual(['Anna Prüfer']);
    expect(signatory()).toBe('Erika Beispiel\nVorsitz');
  });
});
