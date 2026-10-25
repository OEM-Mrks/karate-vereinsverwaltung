// Echte PDF-Dokumente direkt im Browser erzeugen (pdfmake, Schrift eingebettet) – ohne Druckdialog, ohne Server.

import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as vfsModule from 'pdfmake/build/vfs_fonts';
import type { Content, ContentTable, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { formatEUR } from './format';
import { getLogo } from './logo';
import { getVereinsdaten } from './verein';

type PdfMake = typeof pdfMakeModule;
// UMD-Bundle: je nach Bundler liegt die API direkt oder unter "default"
const pdfMake: PdfMake = (pdfMakeModule as unknown as { default?: PdfMake }).default ?? pdfMakeModule;
const vfs = (vfsModule as unknown as { default?: Record<string, string> }).default ?? (vfsModule as unknown as Record<string, string>);
let fontsReady = false;

export const FARBE = { text: '#1c1917', muted: '#78716c', accent: '#b91c1c', line: '#d6d3d1', fill: '#f5f5f4' };

export const eur = (c: number | null | undefined) => formatEUR(c);

function footerLine(): string {
  const v = getVereinsdaten();
  return [
    v.verein_name,
    [v.verein_strasse, `${v.verein_plz} ${v.verein_ort}`.trim()].filter(Boolean).join(', '),
    v.verein_registernummer ? `${v.verein_registergericht} ${v.verein_registernummer}`.trim() : '',
    v.verein_steuernummer ? `St.-Nr. ${v.verein_steuernummer}` : '',
    v.verein_email,
  ].filter(Boolean).join(' · ');
}

/** Grunddokument mit Briefkopf (Logo, Vereinsname), Fußzeile (Vereinsdaten) und Seitenzahlen. */
export function baseDoc(title: string, content: Content[], opts: { landscape?: boolean; letter?: boolean } = {}): TDocumentDefinitions {
  const v = getVereinsdaten();
  const logo = getLogo();
  const anschrift = [v.verein_strasse, `${v.verein_plz} ${v.verein_ort}`.trim()].filter(Boolean).join(' · ');
  return {
    pageSize: 'A4',
    pageOrientation: opts.landscape ? 'landscape' : 'portrait',
    pageMargins: [56, opts.letter ? 96 : 92, 56, 64],
    info: { title, author: v.verein_name, creator: `Vereinsverwaltung ${__APP_VERSION__}` },
    header: () => ({
      margin: [56, 28, 56, 0],
      columns: [
        ...(logo ? [{ image: logo, fit: [44, 44] as [number, number], width: 52 }] : []),
        {
          width: '*',
          stack: [
            { text: v.verein_name, bold: true, fontSize: 12, color: FARBE.text },
            { text: anschrift, fontSize: 8, color: FARBE.muted, margin: [0, 2, 0, 0] },
          ],
          margin: [0, logo ? 6 : 0, 0, 0],
        },
        { width: 'auto', text: opts.letter ? '' : title, fontSize: 8, color: FARBE.muted, alignment: 'right', margin: [0, logo ? 8 : 2, 0, 0] },
      ],
    }),
    footer: (current: number, total: number) => ({
      margin: [56, 24, 56, 0],
      columns: [
        { text: footerLine(), fontSize: 7, color: FARBE.muted, width: '*' },
        { text: `Seite ${current} von ${total}`, fontSize: 7, color: FARBE.muted, alignment: 'right', width: 'auto' },
      ],
    }),
    content,
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.2, color: FARBE.text },
    styles: {
      h1: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
      h2: { fontSize: 11.5, bold: true, margin: [0, 14, 0, 6] },
      sub: { fontSize: 9, color: FARBE.muted, margin: [0, 0, 0, 10] },
      th: { bold: true, fontSize: 8.5, color: FARBE.muted },
      small: { fontSize: 8 },
      muted: { color: FARBE.muted },
    },
  };
}

type Cell = string | number | TableCell;

/**
 * Tabelle im Stil der App: dünne Linien, Kopfzeile grau, Zahlenspalten rechtsbündig.
 * Zeilen mit `{ _total: true }` am Anfang werden fett mit Linie darüber gesetzt.
 */
export function table(
  headers: string[],
  rows: (Cell[] | { total: Cell[] } | { section: string })[],
  opts: { widths?: (string | number)[]; numeric?: number[]; fontSize?: number } = {},
): ContentTable {
  const numeric = new Set(opts.numeric ?? []);
  const cols = headers.length;
  const cell = (c: Cell, i: number, extra: Record<string, unknown> = {}): TableCell => {
    const base = typeof c === 'object' && c !== null ? c : { text: String(c ?? '') };
    return { ...(base as object), alignment: numeric.has(i) ? 'right' : undefined, ...extra } as TableCell;
  };
  const body: TableCell[][] = [headers.map((h, i) => cell({ text: h, style: 'th' }, i))];
  const totalRows = new Set<number>();
  const sectionRows = new Set<number>();
  for (const r of rows) {
    if ('section' in r) {
      sectionRows.add(body.length);
      body.push([{ text: r.section, bold: true, colSpan: cols, fillColor: FARBE.fill } as TableCell, ...Array(cols - 1).fill({})]);
    } else if ('total' in r) {
      totalRows.add(body.length);
      body.push(r.total.map((c, i) => cell(c, i, { bold: true })));
    } else body.push(r.map((c, i) => cell(c, i)));
  }
  return {
    table: { headerRows: 1, widths: opts.widths ?? headers.map((_, i) => (i === 0 ? '*' : 'auto')), body, dontBreakRows: true },
    fontSize: opts.fontSize,
    layout: {
      hLineWidth: (i: number) => (i === 1 || totalRows.has(i) ? 0.8 : i === 0 || i === body.length ? 0 : 0.3),
      vLineWidth: () => 0,
      hLineColor: (i: number) => (i === 1 || totalRows.has(i) ? FARBE.text : FARBE.line),
      paddingTop: () => 3.5,
      paddingBottom: () => 3.5,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
  };
}

/** Unterschriftszeilen nebeneinander (je zwei pro Zeile). */
export function signatures(labels: string[]): Content {
  const rows: Content[] = [];
  for (let i = 0; i < labels.length; i += 2) {
    rows.push({
      columns: labels.slice(i, i + 2).map((l) => ({
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.6 }], margin: [0, 34, 0, 3] },
          { text: l, fontSize: 8, color: FARBE.muted },
        ],
      })),
      columnGap: 30,
    });
  }
  return { stack: rows, unbreakable: true, margin: [0, 10, 0, 0] };
}

export async function pdfBlob(dd: TDocumentDefinitions): Promise<Blob> {
  if (!fontsReady) {
    pdfMake.addVirtualFileSystem(vfs);
    fontsReady = true;
  }
  return pdfMake.createPdf(dd).getBlob();
}
