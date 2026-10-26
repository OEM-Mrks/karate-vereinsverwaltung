import { describe, expect, it } from 'vitest';
import { findIBAN, parseAntragText } from '../src/lib/antrag';

const HEUTE = '2026-10-26';

describe('Mitgliedsantrag auslesen', () => {
  it('Formular mit „Name, Vorname“, Kontakt und SEPA-Mandat', () => {
    const text = `Karate-Dojo Musterstadt e. V. - Aufnahmeantrag
Hiermit beantrage ich die Mitgliedschaft im Verein.
Name, Vorname: Musterfrau, Lena
Geburtsdatum: 14.03.2014
Straße, Hausnr.: Lindenallee 12a
PLZ, Wohnort: 45127 Essen
Telefon: 0201 123456 Handy: 0171 9876543
E-Mail: lena.musterfrau@example.de
Erziehungsberechtigte: Petra Musterfrau
Eintritt zum: 01.11.2026
SEPA-Lastschriftmandat
Kontoinhaber: Petra Musterfrau
IBAN: DE89 3704 0044 0532 0130 00 BIC: COBADEFFXXX
Essen, den 20.10.2026 Unterschrift`;
    expect(parseAntragText(text, HEUTE)).toEqual({
      vorname: 'Lena', nachname: 'Musterfrau', geburtsdatum: '2014-03-14',
      strasse: 'Lindenallee 12a', plz: '45127', ort: 'Essen',
      telefon: '0201 123456', mobil: '0171 9876543', email: 'lena.musterfrau@example.de',
      erziehungsberechtigte: 'Petra Musterfrau', eintritt: '2026-11-01',
      kontoinhaber: 'Petra Musterfrau', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX',
    });
  });

  it('getrennte Felder in einer Zeile, Druckbuchstaben, Anschrift in einem Feld', () => {
    const text = `Anrede: Herr
Name: MUSTERMANN Vorname: MAX
geb. am 01.02.75
Anschrift: Hauptstr. 5, 12345 Musterdorf
Tel. 0170/1234567
E-Mail max @ example . de`;
    expect(parseAntragText(text, HEUTE)).toEqual({
      anrede: 'Herr', vorname: 'Max', nachname: 'Mustermann', geburtsdatum: '1975-02-01',
      strasse: 'Hauptstr. 5', plz: '12345', ort: 'Musterdorf', mobil: '0170/1234567', email: 'max@example.de',
    });
  });

  it('Wert in der Zeile unter der Bezeichnung, „Vor- und Zuname“', () => {
    const text = `Vor- und Zuname des Mitglieds
Anna Maria Beispiel
Geburtsdatum
3.7.2010
Name des Erziehungsberechtigten: Klaus Beispiel
Ort, Datum: Köln, 01.09.2026`;
    expect(parseAntragText(text, HEUTE)).toMatchObject({
      vorname: 'Anna Maria', nachname: 'Beispiel', geburtsdatum: '2010-07-03', erziehungsberechtigte: 'Klaus Beispiel',
    });
    expect(parseAntragText(text, HEUTE).ort).toBeUndefined();
  });

  it('„Name: Vorname Nachname“ ohne eigenes Vornamenfeld', () => {
    expect(parseAntragText('Name: Jonas Weber\nMitglied ab 01.01.2027', HEUTE)).toEqual({ vorname: 'Jonas', nachname: 'Weber', eintritt: '2027-01-01' });
  });

  it('Anschrift ohne Bezeichnung', () => {
    const text = `Lisa Sommer
Am Kirchberg 7
50667 Köln`;
    expect(parseAntragText(text, HEUTE)).toMatchObject({ strasse: 'Am Kirchberg 7', plz: '50667', ort: 'Köln' });
  });
});

describe('IBAN im OCR-Text', () => {
  it('korrigiert O/0 und I/1 und prüft die Prüfziffer', () => {
    expect(findIBAN('IBAN: DE89 37O4 OO44 O532 Ol3O OO')).toBe('DE89370400440532013000');
  });
  it('verwirft IBANs mit falscher Prüfziffer', () => {
    expect(findIBAN('DE88 3704 0044 0532 0130 00')).toBeUndefined();
  });
});
