// Dokumente als PDF: GuV, Bericht der Kassenprüfung, Kündigungsbestätigung, offene Beiträge.

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Audit, Member } from '../db/schema';
import { SPHAEREN } from '../db/schema';
import { gradeIndex, gradeName } from '../db/seed';
import type { AuditItem, AuditSummary } from './audit';
import type { YearSummary } from './fees';
import { formatDate, formatIBAN, todayISO } from './format';
import { memberName } from './lookups';
import { baseDoc, eur, FARBE, signatures, table } from './pdf';
import type { Report, ReportLine } from './report';
import { shiftYear } from './report';
import { getVereinsdaten, namesFor, signatory } from './verein';

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
