// CSV-Import von Kontoumsätzen – bankunabhängig.
// Erkennt Zeichensatz, Trennzeichen, Kopfzeile und ordnet Spalten automatisch den benötigten Feldern zu.
// Getestet mit den Formaten Sparkasse (CSV-CAMT V2 und CSV-MT940); weitere Banken über Synonyme bzw. manuelle Zuordnung.

import { normalizeIBAN, parseAmount, parseDate } from './format';

export type FieldId =
  | 'buchungsdatum' | 'valutadatum' | 'betrag' | 'soll' | 'haben' | 'soll_haben_kz' | 'waehrung'
  | 'auftragskonto' | 'gegen_name' | 'zahler_name' | 'empfaenger_name' | 'gegen_iban' | 'gegen_bic'
  | 'verwendungszweck' | 'buchungstext' | 'mandatsreferenz' | 'glaeubiger_id' | 'e2e_ref' | 'saldo' | 'info';

export const FIELDS: { id: FieldId; label: string; hint?: string; synonyms: string[]; multi?: boolean }[] = [
  { id: 'buchungsdatum', label: 'Buchungsdatum', hint: 'Pflichtfeld', synonyms: ['buchungstag', 'buchungsdatum', 'datum', 'buchung', 'bookingdate', 'date', 'buchungstagdatum'] },
  { id: 'valutadatum', label: 'Valuta / Wertstellung', synonyms: ['valutadatum', 'valuta', 'wertstellung', 'wertstellungsdatum', 'wertstellungstag', 'valuedate', 'wert'] },
  { id: 'betrag', label: 'Betrag (mit Vorzeichen)', hint: 'oder Soll/Haben', synonyms: ['betrag', 'betrageur', 'betragineur', 'betrageuro', 'umsatz', 'umsatzineur', 'umsatzeur', 'amount', 'betragwaehrung'] },
  { id: 'soll', label: 'Soll / Ausgang', synonyms: ['soll', 'solleur', 'sollbetrag', 'ausgang', 'ausgaben', 'lastschrift', 'belastung', 'debit'] },
  { id: 'haben', label: 'Haben / Eingang', synonyms: ['haben', 'habeneur', 'habenbetrag', 'eingang', 'einnahmen', 'gutschrift', 'credit'] },
  { id: 'soll_haben_kz', label: 'Soll/Haben-Kennzeichen', hint: 'S/H', synonyms: ['sollhaben', 'sh', 'sollhabenkennzeichen'] },
  { id: 'waehrung', label: 'Währung', synonyms: ['waehrung', 'wahrung', 'currency', 'whrg'] },
  { id: 'auftragskonto', label: 'Eigenes Konto (IBAN)', synonyms: ['auftragskonto', 'ibanauftragskonto', 'kontonummerauftragskonto', 'eigeneiban', 'eigeneskonto', 'ibankontoinhaber'] },
  { id: 'gegen_name', label: 'Name Zahlungspartner', synonyms: ['beguenstigterzahlungspflichtiger', 'namezahlungsbeteiligter', 'zahlungsbeteiligter', 'auftraggeberempfaenger', 'beguenstigterauftraggeber', 'empfaengerauftraggeber', 'zahlungsempfaengerauftraggeber', 'gegenkontoinhaber', 'beguenstigter', 'auftraggeber', 'empfaenger', 'gegenpartei', 'counterparty', 'payee', 'name'] },
  { id: 'zahler_name', label: 'Name Zahler (bei Eingang)', synonyms: ['zahlungspflichtiger', 'zahlungspflichtige', 'zahler'] },
  { id: 'empfaenger_name', label: 'Name Empfänger (bei Ausgang)', synonyms: ['zahlungsempfaengerin', 'zahlungsempfaenger', 'zahlungsempfaengerinnen'] },
  { id: 'gegen_iban', label: 'IBAN Zahlungspartner', synonyms: ['kontonummeriban', 'iban', 'ibanzahlungsbeteiligter', 'gegenkontoiban', 'ibangegenkonto', 'ibanauftraggeberempfaenger', 'kontonummer', 'gegenkonto', 'counterpartyiban'] },
  { id: 'gegen_bic', label: 'BIC Zahlungspartner', synonyms: ['bic', 'bicswiftcode', 'biczahlungsbeteiligter', 'swift', 'bicswift', 'swiftcode'] },
  { id: 'verwendungszweck', label: 'Verwendungszweck', multi: true, synonyms: ['verwendungszweck', 'buchungsdetails', 'umsatztext', 'zweck', 'beschreibung', 'vorgangverwendungszweck', 'verwendungszweckkundenreferenz', 'reference', 'description'] },
  { id: 'buchungstext', label: 'Buchungstext / Umsatzart', synonyms: ['buchungstext', 'umsatzart', 'buchungsart', 'vorgang', 'transaktionstyp', 'umsatztyp', 'art', 'transactiontype'] },
  { id: 'mandatsreferenz', label: 'Mandatsreferenz', synonyms: ['mandatsreferenz', 'mandatreferenz', 'mandat', 'mandateid'] },
  { id: 'glaeubiger_id', label: 'Gläubiger-ID', synonyms: ['glaeubigerid', 'glaubigerid', 'creditorid', 'glaeubigeridentifikation'] },
  { id: 'e2e_ref', label: 'End-to-End-Referenz', synonyms: ['kundenreferenzendtoend', 'endtoendreferenz', 'kundenreferenz', 'endtoendid', 'e2e', 'e2ereferenz'] },
  { id: 'saldo', label: 'Saldo nach Buchung', synonyms: ['saldo', 'saldonachbuchung', 'kontostand', 'saldoeur', 'balance'] },
  { id: 'info', label: 'Info / Status', hint: 'z. B. „Umsatz vorgemerkt"', synonyms: ['info', 'status'] },
];

export type Mapping = Partial<Record<FieldId, number[]>>;

export type CsvConfig = {
  encoding: string;
  delimiter: string;
  headerRow: number;
  decimal: ',' | '.';
  mapping: Mapping;
  skipPending: boolean;
};

export type ParsedTx = {
  row: number;
  buchungsdatum: string;
  valutadatum: string | null;
  betrag_cent: number;
  waehrung: string;
  auftragskonto: string | null;
  gegen_name: string | null;
  gegen_iban: string | null;
  gegen_bic: string | null;
  verwendungszweck: string | null;
  buchungstext: string | null;
  mandatsreferenz: string | null;
  glaeubiger_id: string | null;
  e2e_ref: string | null;
  saldo_cent: number | null;
  pending: boolean;
};

export type ParseResult = { ok: ParsedTx[]; errors: { row: number; message: string }[]; pending: number };

// ---------- Rohdaten ----------

/** Dekodiert die Datei: UTF-8, sonst Windows-1252 (Sparkasse u. a. liefern ISO-8859-1). */
export function decodeBytes(buf: ArrayBuffer | Uint8Array, forced?: string): { text: string; encoding: string } {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const strip = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  if (forced) return { text: strip(new TextDecoder(forced).decode(bytes)), encoding: forced };
  try {
    return { text: strip(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'utf-8' };
  } catch {
    return { text: strip(new TextDecoder('windows-1252').decode(bytes)), encoding: 'windows-1252' };
  }
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 25);
  let best = ';';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    // Wie viele Zeilen haben die häufigste Spaltenzahl?
    const freq = new Map<number, number>();
    counts.forEach((c) => freq.set(c, (freq.get(c) ?? 0) + 1));
    const [cols, n] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = n * 100 + cols;
    if (cols >= 3 && score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  return parseCSV(line, d)[0] ?? [];
}

/** RFC-4180-Parser (Anführungszeichen, verdoppelte Anführungszeichen, Zeilenumbrüche in Feldern). */
export function parseCSV(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

// ---------- Kopfzeile & Zuordnung ----------

export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function fieldForHeader(h: string): FieldId | null {
  const k = normalizeKey(h);
  if (!k) return null;
  for (const f of FIELDS) if (f.synonyms.includes(k)) return f.id;
  // Mehrteilige Verwendungszwecke ("Verwendungszweck 1", "VWZ2" …)
  if (/^(verwendungszweck|vwz)\d+$/.test(k)) return 'verwendungszweck';
  return null;
}

export function detectHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const score = rows[i].filter((c) => fieldForHeader(c)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function autoMap(header: string[]): Mapping {
  const mapping: Mapping = {};
  header.forEach((h, idx) => {
    const f = fieldForHeader(h);
    if (!f) return;
    const def = FIELDS.find((x) => x.id === f)!;
    if (!mapping[f]) mapping[f] = [idx];
    else if (def.multi) mapping[f]!.push(idx);
  });
  return mapping;
}

export function headerSignature(header: string[]): string {
  return header.map(normalizeKey).join('|');
}

/** Liefert einen sprechenden Namen für bekannte Bankformate. */
export function guessBank(header: string[]): string {
  const keys = new Set(header.map(normalizeKey));
  if (keys.has('auftragskonto') && keys.has('beguenstigterzahlungspflichtiger')) {
    if (keys.has('glaeubigerid') || keys.has('mandatsreferenz')) return 'Sparkasse (CSV-CAMT)';
    if (keys.has('blz')) return 'Sparkasse (CSV-MT940)';
    return 'Sparkasse';
  }
  if (keys.has('namezahlungsbeteiligter')) return 'Volksbank / Raiffeisenbank';
  if (keys.has('zahlungspflichtiger') || keys.has('zahlungsempfaengerin')) return 'DKB';
  if (keys.has('auftraggeberempfaenger')) return 'ING';
  if (keys.has('umsatzart') && keys.has('buchungstext')) return 'Commerzbank';
  if (keys.has('beguenstigterauftraggeber')) return 'Deutsche Bank / Postbank';
  return 'Unbekanntes Format';
}

export function detectDecimal(rows: string[][], mapping: Mapping): ',' | '.' {
  const cols = [...(mapping.betrag ?? []), ...(mapping.soll ?? []), ...(mapping.haben ?? []), ...(mapping.saldo ?? [])];
  let comma = 0;
  let dot = 0;
  for (const r of rows.slice(0, 200)) {
    for (const c of cols) {
      const v = (r[c] ?? '').replace(/\s|€|EUR/g, '');
      if (/,\d{1,2}-?$/.test(v)) comma++;
      else if (/\.\d{1,2}-?$/.test(v)) dot++;
    }
  }
  return dot > comma ? '.' : ',';
}

/** Analysiert eine Datei vollständig und schlägt eine Konfiguration vor. */
export function analyze(buf: ArrayBuffer | Uint8Array) {
  const { text, encoding } = decodeBytes(buf);
  const delimiter = detectDelimiter(text);
  const rows = parseCSV(text, delimiter);
  const headerRow = detectHeaderRow(rows);
  const header = rows[headerRow] ?? [];
  const mapping = autoMap(header);
  const decimal = detectDecimal(rows.slice(headerRow + 1), mapping);
  const config: CsvConfig = { encoding, delimiter, headerRow, decimal, mapping, skipPending: true };
  return { text, rows, header, config, bank: guessBank(header), signature: headerSignature(header) };
}

// ---------- Zeilen umwandeln ----------

function pick(r: string[], cols: number[] | undefined, joiner = ' '): string | null {
  if (!cols?.length) return null;
  const parts = cols.map((c) => (r[c] ?? '').trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts.join(joiner).replace(/\s{2,}/g, ' ');
}

export function toTransactions(rows: string[][], config: CsvConfig): ParseResult {
  const m = config.mapping;
  const ok: ParsedTx[] = [];
  const errors: { row: number; message: string }[] = [];
  let pending = 0;
  if (!m.buchungsdatum?.length) return { ok, errors: [{ row: 0, message: 'Keine Spalte für das Buchungsdatum zugeordnet.' }], pending };
  if (!m.betrag?.length && !m.soll?.length && !m.haben?.length)
    return { ok, errors: [{ row: 0, message: 'Keine Spalte für den Betrag (oder Soll/Haben) zugeordnet.' }], pending };

  for (let i = config.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    const dateRaw = pick(r, m.buchungsdatum);
    const buchungsdatum = parseDate(dateRaw);
    if (!buchungsdatum) {
      // Fußzeilen ("Kontostand", "Summe" …) ohne Datum stillschweigend überspringen
      if (dateRaw && /\d/.test(dateRaw)) errors.push({ row: rowNo, message: `Datum nicht lesbar: „${dateRaw}"` });
      continue;
    }
    let betrag: number | null = null;
    if (m.betrag?.length) {
      betrag = parseAmount(pick(r, m.betrag), config.decimal);
      const kz = (pick(r, m.soll_haben_kz) ?? '').toUpperCase();
      if (betrag != null && kz) betrag = /^(S|D|SOLL|DEBIT|-)/.test(kz) ? -Math.abs(betrag) : Math.abs(betrag);
    } else {
      const soll = parseAmount(pick(r, m.soll), config.decimal);
      const haben = parseAmount(pick(r, m.haben), config.decimal);
      if (soll != null || haben != null) betrag = Math.abs(haben ?? 0) - Math.abs(soll ?? 0);
    }
    if (betrag == null) {
      errors.push({ row: rowNo, message: 'Betrag nicht lesbar' });
      continue;
    }
    const info = pick(r, m.info) ?? '';
    const isPending = /vorgemerkt|vormerk|pending|nicht gebucht/i.test(info);
    if (isPending) {
      pending++;
      if (config.skipPending) continue;
    }
    const name =
      pick(r, m.gegen_name) ??
      (betrag >= 0 ? pick(r, m.zahler_name) ?? pick(r, m.empfaenger_name) : pick(r, m.empfaenger_name) ?? pick(r, m.zahler_name));
    const iban = normalizeIBAN(pick(r, m.gegen_iban));
    const own = normalizeIBAN(pick(r, m.auftragskonto));
    ok.push({
      row: rowNo,
      buchungsdatum,
      valutadatum: parseDate(pick(r, m.valutadatum)),
      betrag_cent: betrag,
      waehrung: pick(r, m.waehrung) ?? 'EUR',
      auftragskonto: own || null,
      gegen_name: name,
      gegen_iban: iban && !/^0+$/.test(iban) ? iban : null,
      gegen_bic: pick(r, m.gegen_bic)?.toUpperCase() ?? null,
      verwendungszweck: pick(r, m.verwendungszweck),
      buchungstext: pick(r, m.buchungstext),
      mandatsreferenz: pick(r, m.mandatsreferenz),
      glaeubiger_id: pick(r, m.glaeubiger_id),
      e2e_ref: cleanRef(pick(r, m.e2e_ref)),
      saldo_cent: parseAmount(pick(r, m.saldo), config.decimal),
      pending: isPending,
    });
  }
  return { ok, errors, pending };
}

function cleanRef(s: string | null): string | null {
  if (!s || /^NOTPROVIDED$/i.test(s)) return null;
  return s;
}

// ---------- Duplikaterkennung ----------

/** Schneller, stabiler 53-Bit-Hash (cyrb53). */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Fingerabdruck je Buchung. Identische Buchungen innerhalb einer Datei bekommen eine laufende Nummer,
 * damit z. B. zwei gleiche Überweisungen am selben Tag nicht als Duplikat verworfen werden.
 */
export function fingerprints(accountId: number, txs: ParsedTx[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    const base = [
      accountId,
      t.buchungsdatum,
      t.betrag_cent,
      t.gegen_iban ?? '',
      normalizeKey(t.verwendungszweck ?? '').slice(0, 120),
    ].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return hash53(`${base}#${n}`);
  });
}
