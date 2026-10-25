// Protokollvorlage als Word-Dokument (.docx) – zum Ausfüllen direkt am Tablet oder Laptop während der Versammlung.
// Gleicher Inhalt wie die PDF-Vorlage, aber mit leeren Absätzen und Tabellenzellen statt Schreiblinien.

import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, Packer, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ITableBordersOptions,
} from 'docx';
import { formatDate } from './format';
import type { Jahresbericht, PruefungsStand } from './kennzahlen';
import { getLogo } from './logo';
import { kassenberichtEckdaten, pruefberichtEckdaten, type Eckdaten } from './protokoll';
import { getVereinsdaten } from './verein';
import { tops, type Tagesordnung, type VersammlungOptionen } from './versammlung';

const GRAU = '78716C';
const LINIE = 'D6D3D1';
const FLAECHE = 'F5F5F4';
const AKZENT = 'B91C1C';

// Feste Breiten (Twips) statt Prozent – Pages und die Vorschau auf iPad/Mac werten Prozentbreiten nicht zuverlässig aus
const SATZBREITE = 11906 - 2 * 1100; // A4 abzüglich Seitenränder
const anteil = (prozent: number) => Math.round((SATZBREITE * prozent) / 100);
function tabelle(spalten: number[], rows: TableRow[], borders: ITableBordersOptions): Table {
  return new Table({ width: { size: SATZBREITE, type: WidthType.DXA }, columnWidths: spalten.map(anteil), borders, rows });
}

const ohneRahmen = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const duenn = { style: BorderStyle.SINGLE, size: 4, color: LINIE };
const rahmenLos = { top: ohneRahmen, bottom: ohneRahmen, left: ohneRahmen, right: ohneRahmen, insideHorizontal: ohneRahmen, insideVertical: ohneRahmen };
const rahmenDuenn = { top: duenn, bottom: duenn, left: duenn, right: duenn, insideHorizontal: duenn, insideVertical: duenn };

const text = (t: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) => new TextRun({ text: t, ...o });
const absatz = (t: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean; nach?: number } = {}) =>
  new Paragraph({ children: [text(t, o)], spacing: { after: o.nach ?? 80 } });
const leer = () => new Paragraph({ children: [], spacing: { after: 120 } });

function zelle(inhalt: string | Paragraph[], o: { breite?: number; fett?: boolean; grau?: boolean; flaeche?: boolean; spalten?: number; zusammen?: boolean } = {}) {
  return new TableCell({
    children: typeof inhalt === 'string' ? [new Paragraph({ keepNext: o.zusammen, children: [text(inhalt, { bold: o.fett, color: o.grau ? GRAU : undefined, size: 20 })] })] : inhalt,
    width: o.breite ? { size: anteil(o.breite), type: WidthType.DXA } : undefined,
    shading: o.flaeche ? { type: ShadingType.CLEAR, color: 'auto', fill: FLAECHE } : undefined,
    columnSpan: o.spalten,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

/** Zweispaltige Ausfüll-Tabelle: Bezeichnung | leeres Feld. */
function felder(labels: string[]): Table {
  return tabelle([35, 65], labels.map((l) => new TableRow({ children: [zelle(l, { breite: 35, grau: true }), zelle('', { breite: 65 })] })), rahmenDuenn);
}

/** Eckdaten als grau hinterlegte Tabelle. */
function eckdatenTabelle(e: Eckdaten): (Table | Paragraph)[] {
  return [
    tabelle([38, 62], [
      new TableRow({ cantSplit: true, children: [zelle(e.titel, { fett: true, grau: true, flaeche: true, spalten: 2, breite: 100, zusammen: true })] }),
      ...e.zeilen.map(([l, v]) => new TableRow({ cantSplit: true, children: [zelle(l, { breite: 38, grau: true, flaeche: true, zusammen: true }), zelle(v, { breite: 62, flaeche: true, zusammen: true })] })),
    ], rahmenLos),
    ...(e.fuss ? [absatz(e.fuss, { size: 16, color: GRAU, italics: true })] : [new Paragraph({ children: [], spacing: { after: 80 } })]),
  ];
}

function abstimmung(): Table {
  const kopf = ['Ja', 'Nein', 'Enthaltung', 'Ergebnis (angenommen / abgelehnt)'];
  const breiten = [18, 18, 18, 46];
  return tabelle(breiten, [
    new TableRow({ children: kopf.map((k, i) => zelle(k, { grau: true, flaeche: true, breite: breiten[i] })) }),
    new TableRow({ children: kopf.map((_, i) => zelle('', { breite: breiten[i] })) }),
  ], rahmenDuenn);
}

function unterschriften(labels: string[]): Table {
  return tabelle([45, 10, 45], [new TableRow({
      children: labels.flatMap((l, i) => [
        new TableCell({
          width: { size: anteil(45), type: WidthType.DXA },
          borders: { top: { style: BorderStyle.SINGLE, size: 6, color: '1C1917' }, bottom: ohneRahmen, left: ohneRahmen, right: ohneRahmen },
          children: [new Paragraph({ children: [text(l, { size: 16, color: GRAU })] })],
        }),
        ...(i < labels.length - 1 ? [new TableCell({ width: { size: anteil(10), type: WidthType.DXA }, borders: rahmenLos, children: [new Paragraph('')] })] : []),
      ]),
    })], rahmenLos);
}

/** Logo (PNG-Data-URL) für den Kopf; Seitenverhältnis aus dem PNG-Header. */
function logoRun(): ImageRun | null {
  const logo = getLogo();
  const m = logo?.match(/^data:image\/png;base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[1]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const dv = new DataView(bytes.buffer);
  const w = dv.getUint32(16);
  const h = dv.getUint32(20);
  const hoehe = 28;
  return new ImageRun({ type: 'png', data: bytes, transformation: { width: Math.round((w / h) * hoehe), height: hoehe } });
}

export function protokollDocx(o: VersammlungOptionen, t: Tagesordnung, daten?: Jahresbericht, pruefungen?: PruefungsStand[]): Document {
  const v = getVereinsdaten();
  const titel = o.titel || 'Mitgliederversammlung';
  const pruef = [...(pruefungen ?? (daten ? [daten.pruefung] : []))].sort((a, b) => a.jahr - b.jahr);
  const logo = logoRun();
  const anschrift = [v.verein_strasse, `${v.verein_plz} ${v.verein_ort}`.trim()].filter(Boolean).join(' · ');

  const inhalt: (Paragraph | Table)[] = [
    new Paragraph({ children: [text('Protokoll', { bold: true, color: AKZENT, size: 20 })], spacing: { after: 40 } }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [text(titel)], spacing: { after: 60 } }),
    absatz([formatDate(o.datum), o.ort].filter(Boolean).join(' · '), { color: GRAU, nach: 200 }),
    felder(['Beginn', 'Ende', 'Versammlungsleitung', 'Protokollführung', 'Anwesende Mitglieder', 'davon stimmberechtigt']),
    absatz('Die Anwesenheitsliste ist dem Protokoll als Anlage beigefügt.', { size: 16, color: GRAU, italics: true }),
  ];

  for (const p of tops(t)) {
    inhalt.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text(`TOP ${p.nr}: ${p.titel}`)], spacing: { before: 240, after: 80 }, keepNext: true }));
    if (p.details.trim()) inhalt.push(new Paragraph({ children: [text(p.details.trim(), { size: 18, color: GRAU, italics: true })], spacing: { after: 80 }, keepNext: true }));
    if (daten && p.standard === 'bericht_kasse') inhalt.push(...eckdatenTabelle(kassenberichtEckdaten(daten)));
    if (p.standard === 'bericht_pruefer') for (const x of pruef) inhalt.push(...eckdatenTabelle(pruefberichtEckdaten(x)));
    inhalt.push(absatz('Notizen:', { size: 18, color: GRAU, nach: 40 }), leer(), leer());
    if (p.abstimmung) inhalt.push(abstimmung(), new Paragraph({ children: [], spacing: { after: 80 } }));
  }

  inhalt.push(
    new Paragraph({ children: [], spacing: { before: 480 } }),
    absatz(`${o.ort || v.verein_ort ? `${o.ort || v.verein_ort}, ` : ''}${formatDate(o.datum)}`, { nach: 600 }),
    unterschriften(['Versammlungsleitung', 'Protokollführung']),
  );

  return new Document({
    creator: v.verein_name,
    title: `Protokoll ${titel}`,
    styles: {
      default: { document: { run: { font: 'Arial', size: 20, color: '1C1917' } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 36, bold: true } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1700, bottom: 1100, left: 1100, right: 1100, header: 600 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              ...(logo ? [logo, text('   ')] : []),
              text(v.verein_name, { bold: true, size: 22 }),
              ...(anschrift ? [text(`   ${anschrift}`, { size: 16, color: GRAU })] : []),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ children: [`Protokoll ${formatDate(o.datum)} · Seite `, PageNumber.CURRENT, ' von ', PageNumber.TOTAL_PAGES], size: 16, color: GRAU })],
          })],
        }),
      },
      children: inhalt,
    }],
  });
}

export function docxBlob(doc: Document): Promise<Blob> {
  return Packer.toBlob(doc);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
