// Dokumente als PDF: GuV, Bericht der Kassenprüfung, Kündigungsbestätigung, offene Beiträge, Anwesenheitsliste.

import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Audit, Member } from '../db/schema';
import { SPHAEREN } from '../db/schema';
import { gradeIndex, gradeName } from '../db/seed';
import type { AuditItem, AuditSummary } from './audit';
import type { YearSummary } from './fees';
import { formatDate, formatIBAN, todayISO } from './format';
import { memberName } from './lookups';
import { baseDoc, eur, FARBE, signatures, table } from './pdf';
import type { Report, ReportLine } from './report';
import { buildReport, shiftYear } from './report';
import { getVereinsdaten, namesFor, signatory } from './verein';
import type { Jahresbericht, PruefungsStand } from './kennzahlen';
import { beitragsStatistik, datenstand, mitgliederStatistik, prognose, pruefungsStand } from './kennzahlen';
import { MONATE } from './recurring';
import { kassenberichtEckdaten, plural, pruefberichtEckdaten, type Eckdaten } from './protokoll';
import type { Tagesordnung, Teilnehmer, TopPunkt, VersammlungOptionen } from './versammlung';
import { tops } from './versammlung';

function zeitraumText(r: Report): string {
  return r.ganzesJahr ? `Geschäftsjahr ${r.jahr}` : `${formatDate(r.von)} – ${formatDate(r.bis)}`;
}

function ortDatum(): string {
  const ort = getVereinsdaten().verein_ort;
  return `${ort ? `${ort}, ` : ''}${formatDate(todayISO())}`;
}

/** Unterschriftszeilen: Kassenwart/in und Kassenprüfer/innen aus „Verein & Vorstand“. */
function finanzUnterschriften(): Content {
  const kw = namesFor('Kassenwart/in')[0];
  const kp = namesFor('Kassenprüfer/in');
  return signatures([
    `Ort, Datum`,
    kw ? `${kw} (Kassenwart/in)` : 'Kassenwart/in',
    ...(kp.length ? kp.map((n) => `${n} (Kassenprüfer/in)`) : ['Kassenprüfer/in']),
  ]);
}

// ---------- GuV ----------

export function guvPdf(r: Report, mitVorjahr: boolean): TDocumentDefinitions {
  const headers = ['Konto', 'Bezeichnung', r.ganzesJahr ? String(r.jahr) : 'Zeitraum', ...(mitVorjahr ? [r.ganzesJahr ? String(r.jahr - 1) : 'Vorjahr'] : [])];
  const num = mitVorjahr ? [2, 3] : [2];
  const vj = (c: number) => (mitVorjahr ? [{ text: eur(c), color: FARBE.muted }] : []);
  const zeilen = (ls: ReportLine[]) => ls.map((l) => [{ text: l.category.nummer, color: FARBE.muted }, l.category.name, eur(l.summe), ...vj(l.vorjahr)]);
  const unter = (t: string) => [{ text: '' }, { text: t, italics: true, color: FARBE.muted, fontSize: 8 }, '', ...(mitVorjahr ? [''] : [])];
  const rows: Parameters<typeof table>[1] = [];
  for (const b of r.bloecke.filter((x) => x.einnahmen.length || x.ausgaben.length)) {
    rows.push({ section: b.name });
    if (b.einnahmen.length) rows.push(unter('Einnahmen'), ...zeilen(b.einnahmen));
    if (b.ausgaben.length) rows.push(unter('Ausgaben'), ...zeilen(b.ausgaben));
    rows.push({ total: ['', `Ergebnis ${b.name}`, eur(b.ergebnis), ...vj(b.vorjahrEin - b.vorjahrAus)] });
  }
  rows.push({ total: ['', 'Summe Einnahmen', eur(r.summeEin), ...(mitVorjahr ? [''] : [])] });
  rows.push(['', { text: 'Summe Ausgaben', bold: true }, { text: eur(r.summeAus), bold: true }, ...(mitVorjahr ? [''] : [])]);
  rows.push({
    total: ['', `${r.ganzesJahr ? 'Jahresergebnis' : 'Ergebnis im Zeitraum'} ${r.ergebnis >= 0 ? '(Überschuss)' : '(Fehlbetrag)'}`,
      { text: eur(r.ergebnis), color: r.ergebnis < 0 ? FARBE.accent : FARBE.text }, ...vj(r.vorjahrErgebnis)],
  });
  if (r.neutral.length || r.unzugeordnet.anzahl) {
    rows.push({ section: 'Nicht ergebniswirksame Kontobewegungen' });
    rows.push(...r.neutral.map((l) => [{ text: l.category.nummer, color: FARBE.muted }, l.category.name, eur(l.summe), ...vj(l.vorjahr)]));
    if (r.unzugeordnet.anzahl) rows.push(['', `Nicht zugeordnet (${r.unzugeordnet.anzahl} Buchungen)`, eur(r.unzugeordnet.summe), ...(mitVorjahr ? [''] : [])]);
  }

  const konten = r.konten.map((k) => [
    { stack: [k.account.name, { text: formatIBAN(k.account.iban), fontSize: 7, color: FARBE.muted }] },
    eur(k.anfang), eur(k.ende), eur(k.bewegung),
    k.laut_auszug ? `${eur(k.laut_auszug.saldo_cent)}${k.ende === k.laut_auszug.saldo_cent ? ' (stimmt)' : ''}` : '–',
  ]);
  const content: Content[] = [
    { text: `Gewinn- und Verlustrechnung ${r.ganzesJahr ? r.jahr : ''}`.trim(), style: 'h1' },
    { text: `${zeitraumText(r)} · Einnahmen-Überschuss-Rechnung nach Zahlungsfluss, alle Beträge brutto${mitVorjahr && !r.ganzesJahr ? ` · Vorjahr: ${formatDate(shiftYear(r.von, -1))} – ${formatDate(shiftYear(r.bis, -1))}` : ''}`, style: 'sub' },
    table(headers, rows, { widths: [36, '*', 72, ...(mitVorjahr ? [72] : [])], numeric: num }),
    // Überschrift, Tabelle und Abstimmung zusammenhalten (kein einsamer Tabellenkopf am Seitenende)
    {
      unbreakable: true,
      stack: [
        { text: 'Kontenentwicklung und Abstimmung', style: 'h2' },
        table(['Konto', 'Anfangsbestand', `Stand ${formatDate(r.bis)}`, 'Veränderung', 'laut Kontoauszug'], [
          ...konten,
          ...(r.konten.length > 1 ? [{ total: ['Summe', eur(r.kontoAnfang), eur(r.kontoEnde), eur(r.kontoBewegung), ''] }] : []),
        ], { widths: ['*', 70, 70, 70, 80], numeric: [1, 2, 3, 4] }),
        {
          margin: [0, 8, 0, 0],
          fontSize: 8.5,
          text: `Kontostand zu Beginn ${eur(r.kontoAnfang)} + Einnahmen ${eur(r.summeEin)} − Ausgaben ${eur(r.summeAus)}`
            + `${r.summeNeutral ? ` ± neutral ${eur(r.summeNeutral)}` : ''}${r.unzugeordnet.summe ? ` ± nicht zugeordnet ${eur(r.unzugeordnet.summe)}` : ''}`
            + ` = Kontostand ${formatDate(r.bis)} ${eur(r.kontoEnde)}${r.differenz === 0 ? ' (stimmt)' : ` (Differenz ${eur(r.differenz)})`}`,
        },
      ],
    },
    finanzUnterschriften(),
  ];
  return baseDoc(`GuV ${zeitraumText(r)}`, content);
}

// ---------- Bericht der Kassenprüfung ----------

export function auditPdf(audit: Audit, items: AuditItem[], s: AuditSummary, anlage: boolean): TDocumentDefinitions {
  const r = s.report;
  const pruefer = (audit.pruefer ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  const fragen = items.filter((i) => i.check?.status === 'frage');
  const umfang = audit.umfang === 'alle' ? 'alle Buchungen des Geschäftsjahres' : audit.umfang === 'ausgaben' ? 'alle Ausgaben des Geschäftsjahres' : 'alle belegpflichtigen Buchungen';
  const kw = namesFor('Kassenwart/in')[0];
  const ort = audit.ort ? `${audit.ort}, ` : '';
  const content: Content[] = [
    { text: `Bericht der Kassenprüfung für das Geschäftsjahr ${audit.jahr}`, style: 'h1' },
    { text: `Prüfung am ${formatDate(audit.pruefdatum)}${audit.ort ? ` in ${audit.ort}` : ''} · Kassenprüfer/innen: ${pruefer.join(', ') || '–'}`, style: 'sub' },
    { text: '1. Umfang der Prüfung', style: 'h2' },
    {
      text: `Geprüft wurden ${umfang} anhand der Kontoauszüge und der digital vorliegenden Belege. ${s.geprueft} von ${s.gesamt} Buchungen wurden einzeln eingesehen und abgezeichnet`
        + `${s.fragen ? `, zu ${s.fragen} ${s.fragen === 1 ? 'Buchung' : 'Buchungen'} gab es Rückfragen` : ''}. `
        + (s.ohneBeleg ? `Bei ${s.ohneBeleg} belegpflichtigen ${s.ohneBeleg === 1 ? 'Buchung' : 'Buchungen'} lag kein Beleg vor.` : 'Zu allen belegpflichtigen Buchungen lagen Belege vor.'),
    },
    { text: '2. Kontenentwicklung', style: 'h2' },
    table(['Konto', 'Stand 01.01.', 'Stand 31.12. (Buchungen)', 'laut Kontoauszug', 'Abgleich'], r.konten.map((k) => [
      { stack: [k.account.name, { text: formatIBAN(k.account.iban), fontSize: 7, color: FARBE.muted }] },
      eur(k.anfang), eur(k.ende),
      k.laut_auszug ? eur(k.laut_auszug.saldo_cent) : 'nicht erfasst',
      k.laut_auszug && k.ende != null ? (k.ende === k.laut_auszug.saldo_cent ? 'stimmt' : eur(k.ende - k.laut_auszug.saldo_cent)) : '–',
    ]), { widths: ['*', 66, 80, 72, 56], numeric: [1, 2, 3, 4] }),
    { text: '3. Einnahmen und Ausgaben', style: 'h2' },
    table(['Bereich', 'Einnahmen', 'Ausgaben', 'Ergebnis'], [
      ...r.bloecke.filter((b) => b.summeEin || b.summeAus).map((b) => [SPHAEREN.find((x) => x.id === b.sphaere)?.name ?? b.name, eur(b.summeEin), eur(b.summeAus), eur(b.ergebnis)]),
      { total: ['Gesamt', eur(r.summeEin), eur(r.summeAus), eur(r.ergebnis)] },
    ], { widths: ['*', 76, 76, 76], numeric: [1, 2, 3] }),
    { text: '4. Feststellungen', style: 'h2' },
    ...(fragen.length
      ? [table(['Datum', 'Buchung', 'Betrag', 'Rückfrage', 'Antwort'], fragen.map((i) => [
          formatDate(i.buchungsdatum), i.gegen_name || i.buchungstext || '', eur(i.betrag_cent), i.check?.kommentar ?? '', i.check?.antwort || 'offen',
        ]), { widths: [50, '*', 56, '*', '*'], numeric: [2], fontSize: 8.5 }) as Content]
      : []),
    {
      margin: [0, 6, 0, 0],
      text: audit.feststellungen?.trim()
        || (s.offeneFragen ? 'Die oben aufgeführten offenen Rückfragen sind noch zu klären.' : 'Die Prüfung ergab keine Beanstandungen. Die Kasse wurde ordnungsgemäß und nachvollziehbar geführt.'),
    },
    ...(audit.entlastung ? [{ text: `Die Kassenprüfer empfehlen der Mitgliederversammlung die Entlastung des Vorstands für das Geschäftsjahr ${audit.jahr}.`, bold: true, margin: [0, 8, 0, 0] } as Content] : []),
    signatures([
      ...pruefer.map((p) => `${ort}${formatDate(audit.pruefdatum)} – ${p} (Kassenprüfung)`),
      `Kenntnis genommen: ${kw ? `${kw} ` : ''}(Kassenwart/in)`,
    ]),
  ];
  if (anlage) {
    content.push(
      { text: `Anlage: Prüfprotokoll ${audit.jahr}`, style: 'h2', pageBreak: 'before' },
      table(['Datum', 'Zahlungspartner / Zweck', 'Kat.', 'Beleg', 'Betrag', 'Prüfung'], items.map((i) => [
        formatDate(i.buchungsdatum),
        { stack: [i.gegen_name || i.buchungstext || '', { text: i.verwendungszweck ?? '', fontSize: 7, color: FARBE.muted }] },
        i.zuordnung.map((z) => z.nummer).filter(Boolean).join(', '),
        i.belege.map((b) => b.belegnr).join(', ') || '–',
        eur(i.betrag_cent),
        i.check ? (i.check.status === 'ok' ? 'geprüft' : `Rückfrage: ${i.check.kommentar ?? ''}`) : '–',
      ]), { widths: [46, '*', 34, 44, 58, 70], numeric: [4], fontSize: 7.5 }),
    );
  }
  return baseDoc(`Kassenprüfung ${audit.jahr}`, content);
}

// ---------- Kündigungsbestätigung ----------

export function kuendigungPdf(m: Member): TDocumentDefinitions {
  const v = getVereinsdaten();
  const absender = [v.verein_name, v.verein_strasse, `${v.verein_plz} ${v.verein_ort}`.trim()].filter(Boolean).join(' · ');
  const anrede = m.anrede === 'Frau' ? `Sehr geehrte Frau ${m.nachname}` : m.anrede === 'Herr' ? `Sehr geehrter Herr ${m.nachname}` : `Guten Tag ${m.vorname} ${m.nachname}`;
  const content: Content[] = [
    // Anschriftfeld (DIN 5008, Fensterposition)
    {
      stack: [
        { text: absender, fontSize: 7, color: FARBE.muted, decoration: 'underline', margin: [0, 0, 0, 6] },
        { text: [m.anrede, m.titel, m.vorname, m.nachname].filter(Boolean).join(' ') },
        ...(m.erziehungsberechtigte && (m.geburtsdatum ? Number(todayISO().slice(0, 4)) - Number(m.geburtsdatum.slice(0, 4)) < 18 : false)
          ? [{ text: `z. Hd. ${m.erziehungsberechtigte}` }] : []),
        { text: m.strasse ?? '' },
        ...(m.adresszusatz ? [{ text: m.adresszusatz }] : []),
        { text: `${m.plz ?? ''} ${m.ort ?? ''}`.trim() },
      ],
      margin: [0, 30, 0, 0],
      fontSize: 10,
    },
    { text: ortDatum(), alignment: 'right', margin: [0, 40, 0, 24] },
    { text: 'Bestätigung Ihrer Kündigung', bold: true, fontSize: 12, margin: [0, 0, 0, 14] },
    { text: `${anrede},`, margin: [0, 0, 0, 10] },
    {
      text: [
        `hiermit bestätigen wir den Eingang Ihrer Kündigung${m.kuendigung_eingang ? ` vom ${formatDate(m.kuendigung_eingang)}` : ''}. Ihre Mitgliedschaft`,
        m.mitgliedsnr ? ` (Mitgliedsnummer ${m.mitgliedsnr})` : '',
        ' endet zum ',
        { text: formatDate(m.austritt), bold: true },
        '.',
      ],
      margin: [0, 0, 0, 10],
    },
    { text: `Bis zu diesem Zeitpunkt sind die Mitgliedsbeiträge noch zu entrichten.${m.sepa_mandat_ref ? ' Das SEPA-Lastschriftmandat erlischt mit Ende der Mitgliedschaft.' : ''}`, margin: [0, 0, 0, 10] },
    { text: `Wir bedanken uns für Ihre Mitgliedschaft${gradeIndex(m.grad) > 0 ? ` und Ihren Weg bis zum ${gradeName(m.grad)}` : ''} und wünschen Ihnen alles Gute.`, margin: [0, 0, 0, 24] },
    { text: 'Mit sportlichen Grüßen' },
    { text: `\n\n\n${signatory()}\n${v.verein_name}` },
  ];
  return baseDoc(`Kündigungsbestätigung ${m.vorname} ${m.nachname}`, content, { letter: true });
}

// ---------- Offene Beiträge ----------

export function offeneBeitraegePdf(jahr: number, rows: { m: Member; s: YearSummary; vortrag: number }[]): TDocumentDefinitions {
  const summe = rows.reduce((a, r) => ({ soll: a.soll + r.s.soll, bez: a.bez + r.s.bezahlt, vj: a.vj + r.vortrag, off: a.off + r.s.offen + r.vortrag }), { soll: 0, bez: 0, vj: 0, off: 0 });
  return baseDoc(`Offene Beiträge ${jahr}`, [
    { text: `Offene Mitgliedsbeiträge ${jahr}`, style: 'h1' },
    { text: `Stand ${formatDate(todayISO())} · ${rows.length} Mitglieder`, style: 'sub' },
    table(['Nr.', 'Name', 'Kontakt', 'Soll', 'Bezahlt', 'Vorjahre', 'Offen'], [
      ...rows.map(({ m, s, vortrag }) => [
        m.mitgliedsnr ?? '', memberName(m), { text: m.email || m.mobil || m.telefon || '', fontSize: 7.5 },
        eur(s.soll), eur(s.bezahlt), vortrag ? eur(vortrag) : '–', { text: eur(s.offen + vortrag), bold: true },
      ]),
      { total: ['', 'Summe', '', eur(summe.soll), eur(summe.bez), eur(summe.vj), eur(summe.off)] },
    ], { widths: [30, '*', '*', 56, 56, 52, 58], numeric: [3, 4, 5, 6], fontSize: 8.5 }),
  ]);
}

// ---------- Anwesenheitsliste Mitgliederversammlung ----------

export function anwesenheitslistePdf(o: VersammlungOptionen, liste: Teilnehmer[]): TDocumentDefinitions {
  const th = (text: string): TableCell => ({ text, style: 'th', fillColor: FARBE.fill });
  const cols: { head: string; width: number | string; cell: (m: Teilnehmer | null) => TableCell }[] = [
    { head: 'Nr.', width: 22, cell: () => ({ text: '' }) },
    {
      head: 'Name', width: 140,
      cell: (m) => m
        ? { stack: [
          { text: `${m.nachname}, ${[m.titel, m.vorname].filter(Boolean).join(' ')}`, bold: true },
          { text: [m.mitgliedsnr ? `Mitgl.-Nr. ${m.mitgliedsnr}` : '', o.minderjaehrige && m.minderjaehrig ? 'minderjährig' : ''].filter(Boolean).join(' · '), fontSize: 7, color: FARBE.muted },
        ] }
        : { text: '' },
    },
    ...(o.anschrift ? [{
      head: 'Anschrift', width: 150,
      cell: (m: Teilnehmer | null): TableCell => ({ text: m ? [m.strasse, `${m.plz ?? ''} ${m.ort ?? ''}`.trim()].filter(Boolean).join('\n') : '', fontSize: 8 }),
    }] : []),
    ...(o.telefon ? [{
      head: 'Telefon', width: 82,
      cell: (m: Teilnehmer | null): TableCell => ({ text: m ? [m.mobil, m.telefon].filter(Boolean).join('\n') : '', fontSize: 8 }),
    }] : []),
    ...(o.email ? [{
      head: 'E-Mail', width: 125,
      cell: (m: Teilnehmer | null): TableCell => ({ text: m?.email ?? '', fontSize: 7.5 }),
    }] : []),
    { head: 'Unterschrift', width: '*', cell: () => ({ text: '' }) },
  ];
  const zeilen = [...liste, ...Array<null>(Math.max(0, o.leerzeilen)).fill(null)];
  const body: TableCell[][] = [
    cols.map((c) => th(c.head)),
    ...zeilen.map((m, i) => cols.map((c, j) => (j === 0 ? { text: String(i + 1), color: FARBE.muted, fontSize: 8 } : c.cell(m)))),
  ];
  const wann = [formatDate(o.datum), o.uhrzeit && `${o.uhrzeit} Uhr`, o.ort].filter(Boolean).join(' · ');
  const minderjaehrig = liste.filter((m) => m.minderjaehrig).length;
  const content: Content[] = [
    { text: o.titel || 'Mitgliederversammlung', style: 'h1' },
    { text: `Anwesenheitsliste · ${wann}`, style: 'sub', margin: [0, 0, 0, 2] },
    {
      text: `${liste.length} aktive Mitglieder am ${formatDate(o.datum)}`
        + (o.minderjaehrige && minderjaehrig ? `, davon ${minderjaehrig} minderjährig (Stimmrecht laut Satzung)` : '')
        + '. Mit der Unterschrift wird die Anwesenheit bestätigt.',
      fontSize: 8, color: FARBE.muted, margin: [0, 0, 0, 8],
    },
    {
      table: { headerRows: 1, widths: cols.map((c) => c.width), body, dontBreakRows: true, heights: (i: number) => (i === 0 ? 'auto' : 30) },
      layout: {
        hLineWidth: (i: number) => (i === 0 || i === body.length ? 0.8 : i === 1 ? 0.8 : 0.3),
        vLineWidth: (i: number) => (i === cols.length - 1 ? 0.3 : 0),
        hLineColor: (i: number) => (i <= 1 || i === body.length ? FARBE.text : FARBE.line),
        vLineColor: () => FARBE.line,
        paddingTop: () => 4,
        paddingBottom: () => 4,
        paddingLeft: () => 4,
        paddingRight: () => 4,
      },
    },
    {
      unbreakable: true,
      stack: [
        {
          columns: [
            { text: 'Anwesende Mitglieder: ________', width: 'auto' },
            { text: 'davon stimmberechtigt: ________', width: 'auto' },
            { text: 'Gäste: ________', width: 'auto' },
          ],
          columnGap: 36,
          margin: [0, 16, 0, 0],
        },
        signatures(['Versammlungsleitung', 'Protokollführung']),
      ],
    },
  ];
  return baseDoc(`${o.titel || 'Mitgliederversammlung'} · ${formatDate(o.datum)}`, content, { landscape: true });
}

// ---------- Einladung mit Tagesordnung, Protokollvorlage ----------

function wannWo(o: VersammlungOptionen): Content {
  const zeile = (label: string, value: string) => [{ text: label, color: FARBE.muted }, { text: value || '–', bold: true }];
  return {
    table: {
      widths: [70, '*'],
      body: [zeile('Datum', formatDate(o.datum)), zeile('Uhrzeit', o.uhrzeit ? `${o.uhrzeit} Uhr` : ''), zeile('Ort', o.ort)],
    },
    layout: 'noBorders',
    margin: [0, 6, 0, 10],
  };
}

export function einladungPdf(o: VersammlungOptionen, t: Tagesordnung): TDocumentDefinitions {
  const v = getVereinsdaten();
  const titel = o.titel || 'Mitgliederversammlung';
  const content: Content[] = [
    { text: 'Einladung', fontSize: 10, bold: true, color: FARBE.accent, margin: [0, 0, 0, 2] },
    { text: titel, style: 'h1', margin: [0, 0, 0, 12] },
    { text: 'Liebe Mitglieder,', margin: [0, 0, 0, 6] },
    { text: t.einladung.trim(), margin: [0, 0, 0, 4] },
    wannWo(o),
    { text: 'Tagesordnung', style: 'h2', margin: [0, 6, 0, 6] },
    {
      table: {
        widths: [44, '*'],
        body: tops(t).map((p): TableCell[] => [
          { text: `TOP ${p.nr}`, bold: true, color: FARBE.muted },
          { stack: [{ text: p.titel, bold: true }, ...(p.details.trim() ? [{ text: p.details.trim(), fontSize: 8.5, color: FARBE.muted }] : [])] },
        ]),
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.3),
        vLineWidth: () => 0,
        hLineColor: () => FARBE.line,
        paddingTop: () => 4,
        paddingBottom: () => 4,
        paddingLeft: () => 0,
      },
    },
    ...(t.antragsfrist ? [{
      text: `Anträge zur Tagesordnung sind bis zum ${formatDate(t.antragsfrist)} schriftlich beim Vorstand einzureichen.`,
      margin: [0, 12, 0, 0],
    } as Content] : []),
    { text: 'Wir freuen uns auf euer Kommen.', margin: [0, 12, 0, 18] },
    { unbreakable: true, stack: [{ text: 'Mit sportlichen Grüßen' }, { text: `\n\n${signatory()}\n${v.verein_name}` }] },
  ];
  return baseDoc(`Einladung · ${titel}`, content, { letter: true });
}

/** Kleine Kennzahlentabelle mit grauem Hintergrund (Label | Wert). */
function eckdaten(titel: string, zeilen: [string, string][], fuss?: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [[{
        fillColor: FARBE.fill,
        stack: [
          { text: titel, bold: true, fontSize: 8.5, color: FARBE.muted, margin: [0, 0, 0, 3] },
          {
            table: { widths: [170, '*'], body: zeilen.map(([l, v]) => [{ text: l, color: FARBE.muted }, { text: v }]) },
            layout: { defaultBorder: false, paddingTop: () => 1, paddingBottom: () => 1, paddingLeft: () => 0 },
            fontSize: 8.5,
          },
          ...(fuss ? [{ text: fuss, fontSize: 7.5, color: FARBE.muted, margin: [0, 3, 0, 0] } as Content] : []),
        ],
      }]],
    },
    layout: { defaultBorder: false, paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 8, paddingRight: () => 8 },
    margin: [0, 4, 0, 2],
  };
}

/** Eckdaten-Block als grauer Kasten. */
const eckdatenKasten = (e: Eckdaten) => eckdaten(e.titel, e.zeilen, e.fuss);

/**
 * Protokollvorlage. Mit `daten` stehen beim Bericht des Kassenwarts die Eckdaten des Berichtsjahres;
 * `pruefungen` sind die Kassenprüfungen, über die berichtet wird (ein Kasten je Jahr, ältestes zuerst).
 */
export function protokollPdf(o: VersammlungOptionen, t: Tagesordnung, daten?: Jahresbericht, pruefungen?: PruefungsStand[]): TDocumentDefinitions {
  const titel = o.titel || 'Mitgliederversammlung';
  const pruef = [...(pruefungen ?? (daten ? [daten.pruefung] : []))].sort((a, b) => a.jahr - b.jahr);
  const mitDaten = (p: TopPunkt) => (!!daten && p.standard === 'bericht_kasse') || (!!pruef.length && p.standard === 'bericht_pruefer');
  const linien = (n: number): Content => ({
    canvas: Array.from({ length: n }, (_, i) => ({ type: 'line' as const, x1: 0, y1: 18 + i * 20, x2: 483, y2: 18 + i * 20, lineWidth: 0.3, lineColor: FARBE.line })),
    margin: [0, 0, 0, 4],
  });
  const feld = (label: string) => ({ text: [{ text: `${label}: `, color: FARBE.muted }, '______________________'] });
  const content: Content[] = [
    { text: 'Protokoll', fontSize: 10, bold: true, color: FARBE.accent, margin: [0, 0, 0, 2] },
    { text: titel, style: 'h1' },
    { text: [formatDate(o.datum), o.ort].filter(Boolean).join(' · '), style: 'sub' },
    {
      columns: [
        { stack: [feld('Beginn'), feld('Versammlungsleitung'), feld('Anwesende Mitglieder')], width: '*' },
        { stack: [feld('Ende'), feld('Protokollführung'), feld('davon stimmberechtigt')], width: '*' },
      ],
      columnGap: 20,
      fontSize: 9,
      lineHeight: 1.6,
      margin: [0, 0, 0, 6],
    },
    { text: 'Die Anwesenheitsliste ist dem Protokoll als Anlage beigefügt.', fontSize: 8, color: FARBE.muted, margin: [0, 0, 0, 6] },
    ...tops(t).map((p): Content => ({
      // Mehrere Prüfungsberichte dürfen über die Seite laufen, alles andere bleibt zusammen
      unbreakable: !(p.standard === 'bericht_pruefer' && pruef.length > 1),
      stack: [
        { text: `TOP ${p.nr}: ${p.titel}`, bold: true, fontSize: 10.5, margin: [0, 10, 0, 1] },
        ...(p.details.trim() ? [{ text: p.details.trim(), fontSize: 8, color: FARBE.muted } as Content] : []),
        ...(daten && p.standard === 'bericht_kasse' ? [eckdatenKasten(kassenberichtEckdaten(daten))] : []),
        ...(p.standard === 'bericht_pruefer' ? pruef.map((x) => eckdatenKasten(pruefberichtEckdaten(x))) : []),
        linien(mitDaten(p) ? 2 : p.abstimmung ? 3 : 4),
        ...(p.abstimmung ? [{
          text: [
            { text: 'Abstimmung:  ', color: FARBE.muted },
            'Ja ______    Nein ______    Enthaltung ______    ',
            { text: 'Ergebnis: ', color: FARBE.muted },
            'angenommen / abgelehnt',
          ],
          fontSize: 8.5,
          margin: [0, 2, 0, 0],
        } as Content] : []),
      ],
    })),
    signatures(['Versammlungsleitung', 'Protokollführung']),
  ];
  return baseDoc(`Protokoll ${formatDate(o.datum)}`, content);
}

// ---------- Vorstandsbericht (Schnellbericht zum aktuellen Stand) ----------

export function vorstandsberichtPdf(heute: string, opts: { mitNamen: boolean }): TDocumentDefinitions {
  const jahr = Number(heute.slice(0, 4));
  const vj = jahr - 1;
  const lfd = buildReport(jahr, `${jahr}-01-01`, heute);
  const vjGleich = buildReport(vj, `${vj}-01-01`, shiftYear(heute, -1));
  const vjGesamt = buildReport(vj);
  const mJetzt = mitgliederStatistik(heute);
  const mVj = mitgliederStatistik(`${vj}-12-31`);
  const bJetzt = beitragsStatistik(jahr, heute);
  const bVj = beitragsStatistik(vj, `${vj}-12-31`);
  const p = prognose(heute);
  const pruefung = pruefungsStand(vj);
  const ds = datenstand();

  const kachel = (label: string, wert: string, sub: string, farbe?: string): TableCell => ({
    stack: [
      { text: label, fontSize: 7.5, color: FARBE.muted },
      { text: wert, fontSize: 14, bold: true, color: farbe ?? FARBE.text, margin: [0, 2, 0, 1] },
      { text: sub, fontSize: 7, color: FARBE.muted },
    ],
    fillColor: FARBE.fill,
  });
  const kacheln: Content = {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [[
        kachel('Kontostand', eur(p.kontostand), `Stand ${formatDate(heute)}`),
        kachel(`Ergebnis ${jahr}`, eur(lfd.ergebnis), `bis ${formatDate(heute)}`, lfd.ergebnis < 0 ? FARBE.accent : undefined),
        kachel('Aktive Mitglieder', String(mJetzt.aktiv), `${mJetzt.eintritte} Eintritte · ${mJetzt.austritte} Austritte ${jahr}`),
        kachel('Prognose 31.12.', eur(p.ende), 'voraussichtlicher Kontostand'),
      ]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i > 0 && i < 4 ? 6 : 0), vLineColor: () => '#ffffff', paddingTop: () => 7, paddingBottom: () => 7, paddingLeft: () => 8 },
    margin: [0, 0, 0, 6],
  };

  const zeitraum = (r: Report) => `${formatDate(r.von).slice(0, 6)}–${formatDate(r.bis).slice(0, 6)}${r.jahr}`;
  const finanzen = table(['', `${jahr} bis heute`, `${vj} gleicher Zeitraum`, `${vj} gesamt`], [
    ['Kontostand zu Beginn', eur(lfd.kontoAnfang), eur(vjGleich.kontoAnfang), eur(vjGesamt.kontoAnfang)],
    ['Einnahmen', eur(lfd.summeEin), eur(vjGleich.summeEin), eur(vjGesamt.summeEin)],
    ['Ausgaben', eur(lfd.summeAus), eur(vjGleich.summeAus), eur(vjGesamt.summeAus)],
    { total: ['Ergebnis', eur(lfd.ergebnis), eur(vjGleich.ergebnis), eur(vjGesamt.ergebnis)] },
    ['Neutral / nicht zugeordnet', eur(lfd.summeNeutral + lfd.unzugeordnet.summe), eur(vjGleich.summeNeutral + vjGleich.unzugeordnet.summe), eur(vjGesamt.summeNeutral + vjGesamt.unzugeordnet.summe)],
    { total: ['Kontostand am Ende', eur(lfd.kontoEnde), eur(vjGleich.kontoEnde), eur(vjGesamt.kontoEnde)] },
  ], { widths: ['*', 90, 100, 90], numeric: [1, 2, 3] });

  // Einnahmen und Ausgaben nach Kategorie (lfd. Jahr vs. Vorjahr gleicher Zeitraum)
  const vjSumme = new Map<number, number>();
  for (const b of vjGesamt.bloecke) for (const l of [...b.einnahmen, ...b.ausgaben]) vjSumme.set(l.category.id, l.summe);
  const linien = (typ: 'einnahmen' | 'ausgaben') => lfd.bloecke.flatMap((b) => b[typ])
    .filter((l) => l.summe || l.vorjahr)
    .sort((a, b) => Math.abs(b.summe) - Math.abs(a.summe))
    .map((l) => [`${l.category.nummer} ${l.category.name}`, eur(Math.abs(l.summe)), eur(Math.abs(l.vorjahr)), eur(Math.abs(vjSumme.get(l.category.id) ?? 0))]);
  const kategorien = table(['Kategorie', `${jahr} bis heute`, `${vj} gleicher Zeitraum`, `${vj} gesamt`], [
    { section: 'Einnahmen' }, ...linien('einnahmen'),
    { section: 'Ausgaben' }, ...linien('ausgaben'),
  ], { widths: ['*', 90, 100, 90], numeric: [1, 2, 3], fontSize: 8.5 });

  const mitglieder = table(['', `Stand ${formatDate(heute)}`, `31.12.${vj}`], [
    ['Aktive Mitglieder', String(mJetzt.aktiv), String(mVj.aktiv)],
    ['davon minderjährig', String(mJetzt.minderjaehrig), String(mVj.minderjaehrig)],
    ['Ehrenmitglieder', String(mJetzt.ehrenmitglieder), String(mVj.ehrenmitglieder)],
    ['Eintritte im Jahr', String(mJetzt.eintritte), String(mVj.eintritte)],
    ['Austritte im Jahr', String(mJetzt.austritte), String(mVj.austritte)],
    ['Vorliegende Kündigungen (Austritt steht bevor)', String(mJetzt.kuendigungen), String(mVj.kuendigungen)],
    ...mJetzt.gruppen.map((g) => [`Beitragsgruppe ${g.name}`, String(g.anzahl), String(mVj.gruppen.find((x) => x.name === g.name)?.anzahl ?? 0)]),
  ], { widths: ['*', 90, 90], numeric: [1, 2] });

  const beitraege = table(['', `${jahr} (Stand ${formatDate(heute)})`, `${vj}`], [
    ['Beitragssoll des Jahres', eur(bJetzt.soll), eur(bVj.soll)],
    ['Bezahlt', eur(bJetzt.bezahlt), eur(bVj.bezahlt)],
    ['Noch ausstehend (inkl. noch nicht fällig)', eur(bJetzt.ausstehend), eur(bVj.ausstehend)],
    { total: ['Überfällig (inkl. Vorjahre)', eur(bJetzt.ueberfaellig), eur(bVj.ueberfaellig)] },
    ['Mitglieder mit Rückstand', String(bJetzt.mitRueckstand), String(bVj.mitRueckstand)],
  ], { widths: ['*', 110, 90], numeric: [1, 2] });

  const prognoseTab = table(['Voraussichtlicher Kontostand zum 31.12.' + jahr, 'Betrag'], [
    [`Kontostand ${formatDate(heute)}`, eur(p.kontostand)],
    ['+ noch ausstehende Mitgliedsbeiträge', eur(p.beitraege)],
    ...(p.wiederkehrendEin ? [['+ erwartete regelmäßige Einnahmen', eur(p.wiederkehrendEin)]] : []),
    ['− erwartete regelmäßige Ausgaben', eur(-p.wiederkehrendAus)],
    { total: ['= Prognose Kontostand 31.12.', eur(p.ende)] },
  ], { widths: ['*', 100], numeric: [1] });

  const offenePunkte: string[] = [
    ds.letzteBuchung ? `Datenstand: letzte Kontobewegung vom ${formatDate(ds.letzteBuchung)}` : 'Noch keine Kontobewegungen importiert',
    ...(ds.nichtAbgeglichen.length ? [`Kontostand nicht abgeglichen: ${ds.nichtAbgeglichen.join(', ')}`] : []),
    ...(ds.nichtZugeordnet ? [`${plural(ds.nichtZugeordnet, 'Buchung', 'Buchungen')} noch nicht zugeordnet`] : []),
    ...(lfd.fehlendeBelege ? [`${plural(lfd.fehlendeBelege, 'Buchung', 'Buchungen')} ${jahr} ohne vollständige Belege`] : []),
    pruefung.vorhanden
      ? `Kassenprüfung ${vj}: ${pruefung.abgeschlossen ? 'abgeschlossen' : 'läuft'} – ${pruefung.geprueft} von ${pruefung.gesamt} Buchungen geprüft${pruefung.offeneFragen ? `, ${plural(pruefung.offeneFragen, 'offene Rückfrage', 'offene Rückfragen')}` : ''}`
      : `Kassenprüfung ${vj}: noch nicht begonnen`,
  ];

  const content: Content[] = [
    { text: 'Vorstandsbericht', style: 'h1' },
    { text: `Stand ${formatDate(heute)} · Geschäftsjahr ${jahr} im Vergleich zum Vorjahr ${vj}`, style: 'sub' },
    kacheln,
    { text: 'Finanzen', style: 'h2' },
    finanzen,
    // Abschnitte nicht über Seiten hinweg trennen
    { unbreakable: true, stack: [{ text: 'Mitglieder', style: 'h2' }, mitglieder] },
    {
      unbreakable: true,
      stack: [
        { text: 'Mitgliedsbeiträge', style: 'h2' },
        beitraege,
        opts.mitNamen && bJetzt.saeumige.length
          ? { text: 'Rückstände nach Mitglied – vertraulich, nur für den Vorstand', bold: true, fontSize: 9, color: FARBE.accent, margin: [0, 8, 0, 4] }
          : { text: bJetzt.mitRueckstand ? 'Ohne Namensnennung – Einzelheiten beim Kassenwart.' : 'Alle fälligen Beiträge sind bezahlt.', fontSize: 8, color: FARBE.muted, margin: [0, 4, 0, 0] },
      ],
    },
    ...(opts.mitNamen && bJetzt.saeumige.length
      ? [table(['Mitglied', 'Überfällig'], bJetzt.saeumige.map((x) => [x.name, eur(x.betrag)]), { widths: ['*', 90], numeric: [1], fontSize: 8.5 })]
      : []),
    {
      unbreakable: true,
      stack: [
        { text: `Prognose bis 31.12.${jahr}`, style: 'h2' },
        prognoseTab,
        ...(p.offeneZahlungen.length ? [
          { text: 'Noch offene regelmäßige Zahlungen', bold: true, fontSize: 9, margin: [0, 8, 0, 4] } as Content,
          table(['Zahlung', 'Fällig', 'Betrag'], p.offeneZahlungen.map((z) => [
            z.name, `${MONATE[z.monat - 1]}${z.ueberfaellig ? ' (überfällig)' : ''}`, eur(z.richtung === 'aus' ? -z.betrag : z.betrag),
          ]), { widths: ['*', 110, 80], numeric: [2], fontSize: 8.5 }),
        ] : []),
        {
          text: 'Die Prognose berücksichtigt nur noch ausstehende Mitgliedsbeiträge und die hinterlegten wiederkehrenden Zahlungen – unregelmäßige Ausgaben (Anschaffungen, Veranstaltungen …) sind nicht enthalten.',
          fontSize: 7.5, color: FARBE.muted, margin: [0, 4, 0, 0],
        },
      ],
    },
    { text: `Einnahmen und Ausgaben nach Kategorie`, style: 'h2', pageBreak: 'before' },
    { text: `${zeitraum(lfd)} im Vergleich zum Vorjahr`, style: 'sub' },
    kategorien,
    { text: 'Offene Punkte der Kassenführung', style: 'h2' },
    { ul: offenePunkte, fontSize: 9 },
  ];
  return baseDoc(`Vorstandsbericht ${formatDate(heute)}`, content);
}
