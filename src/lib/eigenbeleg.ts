// Eigenbeleg (Ersatzbeleg) für Zahlungen ohne Rechnung, z. B. Verbandsbeiträge: Angaben aus der Buchung, Begründung, Unterschrift.

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { all, get } from '../db/db';
import type { Transaction } from '../db/schema';
import { addDocument, nextBelegNr } from './docs';
import { formatDate, formatIBAN, todayISO } from './format';
import { baseDoc, eur, FARBE, pdfBlob, signatures } from './pdf';
import { getVereinsdaten, namesFor } from './verein';

export type Eigenbeleg = {
  datum: string;              // Zahlungsdatum
  betrag_cent: number;        // negativ = Ausgabe
  partner: string;            // Empfänger bzw. Einzahler
  iban: string | null;
  zweck: string;
  kategorie: string | null;
  zahlungsart: string | null;
  grund: string;              // Warum es keinen Originalbeleg gibt
  transaction_id: number | null;
  partner_id: number | null;
};

/** Vorbelegung aus einer Buchung (Kategorie und Partner aus der Zuordnung). */
export function eigenbelegAusBuchung(transactionId: number, grund = ''): Eigenbeleg {
  const t = get<Transaction>('SELECT * FROM transactions WHERE id = ?', [transactionId]);
  if (!t) throw new Error('Buchung nicht gefunden');
  const allocs = all<{ kat: string | null; partner: string | null; partner_id: number | null }>(
    `SELECT CASE WHEN c.id IS NULL THEN NULL ELSE c.nummer || ' ' || c.name END AS kat, p.name AS partner, a.partner_id
     FROM allocations a LEFT JOIN categories c ON c.id = a.category_id LEFT JOIN partners p ON p.id = a.partner_id
     WHERE a.transaction_id = ? ORDER BY a.id`,
    [transactionId],
  );
  const kats = [...new Set(allocs.map((a) => a.kat).filter(Boolean))];
  return {
    datum: t.buchungsdatum,
    betrag_cent: t.betrag_cent,
    partner: allocs.find((a) => a.partner)?.partner || t.gegen_name || '',
    iban: t.gegen_iban,
    zweck: t.verwendungszweck ?? '',
    kategorie: kats.join(', ') || null,
    zahlungsart: t.buchungstext,
    grund,
    transaction_id: t.id,
    partner_id: allocs.find((a) => a.partner_id)?.partner_id ?? null,
  };
}

export function eigenbelegPdf(e: Eigenbeleg, belegnr: string): TDocumentDefinitions {
  const ausgabe = e.betrag_cent < 0;
  const kw = namesFor('Kassenwart/in')[0];
  const vorsitz = namesFor('Vorsitzende/r')[0];
  const ort = getVereinsdaten().verein_ort;
  const zeile = (label: string, value: Content) => [{ text: label, color: FARBE.muted }, value];
  const content: Content[] = [
    { text: 'Eigenbeleg', style: 'h1' },
    { text: `Ersatzbeleg für eine ${ausgabe ? 'Ausgabe' : 'Einnahme'} ohne Originalbeleg`, style: 'sub' },
    {
      table: {
        widths: [140, '*'],
        body: [
          zeile('Beleg-Nr.', { text: belegnr, bold: true }),
          zeile('Datum der Zahlung', formatDate(e.datum)),
          zeile('Betrag', { text: eur(Math.abs(e.betrag_cent)), bold: true, fontSize: 12 }),
          zeile('Art', ausgabe ? 'Ausgabe (Zahlung des Vereins)' : 'Einnahme (Zahlung an den Verein)'),
          zeile(ausgabe ? 'Zahlungsempfänger' : 'Einzahler', e.partner || '–'),
          ...(e.iban ? [zeile('IBAN', formatIBAN(e.iban))] : []),
          ...(e.zahlungsart ? [zeile('Zahlungsweg', e.zahlungsart)] : []),
          zeile('Verwendungszweck', e.zweck || '–'),
          ...(e.kategorie ? [zeile('Kategorie (SKR04)', e.kategorie)] : []),
        ],
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0.8 : 0.3),
        vLineWidth: () => 0,
        hLineColor: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? FARBE.text : FARBE.line),
        paddingTop: () => 5,
        paddingBottom: () => 5,
      },
    },
    { text: 'Grund für den Eigenbeleg', style: 'h2' },
    { text: e.grund.trim() || '–', margin: [0, 0, 0, 10] },
    {
      text: 'Ein Originalbeleg (Rechnung/Quittung) liegt nicht vor. Die Angaben wurden aus der Kontobewegung übernommen. '
        + 'Hiermit wird bestätigt, dass die Zahlung in der angegebenen Höhe für den genannten Zweck erfolgt ist und die Angaben sachlich und rechnerisch richtig sind.',
      fontSize: 8.5, color: FARBE.muted, margin: [0, 6, 0, 14],
    },
    { text: `${ort ? `${ort}, ` : ''}${formatDate(todayISO())}`, margin: [0, 0, 0, 4] },
    signatures([kw ? `${kw} (Kassenwart/in)` : 'Kassenwart/in', vorsitz ? `${vorsitz} (Vorstand, Gegenzeichnung)` : 'Vorstand (Gegenzeichnung)']),
  ];
  return baseDoc(`Eigenbeleg ${belegnr}`, content);
}

/** PDF erzeugen, als Beleg speichern und mit der Buchung verknüpfen. Gibt die Beleg-ID zurück. */
export async function eigenbelegSpeichern(e: Eigenbeleg): Promise<number> {
  if (!e.grund.trim()) throw new Error('Bitte einen Grund angeben, warum es keinen Originalbeleg gibt.');
  const belegnr = nextBelegNr(e.datum);
  const blob = await pdfBlob(eigenbelegPdf(e, belegnr));
  const file = Object.assign(blob, { name: `Eigenbeleg ${belegnr}.pdf` });
  return addDocument(file, {
    transaction_id: e.transaction_id,
    partner_id: e.partner_id,
    belegdatum: e.datum,
    beschreibung: `Eigenbeleg: ${e.grund.trim().split('\n')[0]}`,
    belegnr,
    eigenbeleg: true,
  });
}

/** Häufige Begründungen zur Auswahl. */
export const EIGENBELEG_GRUENDE = [
  'Mitgliedsbeitrag an den Dachverband – der Verband stellt keine Rechnung, die Höhe ergibt sich aus der Beitragsordnung.',
  'Beitrag an den Landesverband – keine Rechnung, Zahlung laut Beitragsordnung bzw. Beitragsmeldung.',
  'Originalbeleg ist verloren gegangen und kann nicht mehr beschafft werden.',
  'Für diese Zahlung wird üblicherweise kein Beleg ausgestellt (z. B. Spende, Startgeld, Kleinbetrag).',
];
