// Angaben aus dem (per OCR gelesenen) Text eines Mitgliedsantrags herausziehen.
// Formulare sind von Verein zu Verein verschieden: Gesucht wird nach typischen Feldbezeichnungen („Name, Vorname:“,
// „Geburtsdatum“, „PLZ/Ort“ …) und nach Mustern, die man auch ohne Bezeichnung erkennt (IBAN mit Prüfziffer, E-Mail).
// Alles Erkannte ist nur ein Vorschlag – übernommen wird erst nach Durchsicht.

import { isValidIBAN, parseDate, todayISO } from './format';

export type AntragFeld =
  | 'anrede' | 'vorname' | 'nachname' | 'geburtsdatum' | 'strasse' | 'plz' | 'ort' | 'email' | 'telefon' | 'mobil'
  | 'erziehungsberechtigte' | 'eintritt' | 'kontoinhaber' | 'iban' | 'bic' | 'sepa_mandat_ref';

export type AntragDaten = Partial<Record<AntragFeld, string>>;

export const ANTRAG_FELDER: { id: AntragFeld; label: string; datum?: boolean }[] = [
  { id: 'anrede', label: 'Anrede' },
  { id: 'vorname', label: 'Vorname' },
  { id: 'nachname', label: 'Nachname' },
  { id: 'geburtsdatum', label: 'Geburtsdatum', datum: true },
  { id: 'strasse', label: 'Straße' },
  { id: 'plz', label: 'PLZ' },
  { id: 'ort', label: 'Ort' },
  { id: 'email', label: 'E-Mail' },
  { id: 'telefon', label: 'Telefon' },
  { id: 'mobil', label: 'Handy' },
  { id: 'erziehungsberechtigte', label: 'Erziehungsberechtigte' },
  { id: 'eintritt', label: 'Eintritt', datum: true },
  { id: 'kontoinhaber', label: 'Kontoinhaber' },
  { id: 'iban', label: 'IBAN' },
  { id: 'bic', label: 'BIC' },
  { id: 'sepa_mandat_ref', label: 'Mandatsreferenz' },
];

type Ziel =
  | AntragFeld | 'name' | 'name_vorname' | 'vorname_name' | 'anschrift' | 'plz_ort' | 'ignorieren';

// Feldbezeichnungen auf Formularen. Treffen mehrere an derselben Stelle, gewinnt die längste
// („Name des Erziehungsberechtigten“ vor „Name“, „Ort, Datum“ vor „Ort“).
// Zusatz hinter Namensfeldern, z. B. „Vorname des Mitglieds“
const WER = String.raw`(?:\s+(?:des|der)\s+(?:mitglied(?:e)?s|kindes|antragsteller(?:s|in)?|teilnehmer(?:s|in)?|sportler(?:s|in)?))?`;

const LABELS: [Ziel, string][] = [
  ['name_vorname', String.raw`(?:familien|nach|zu)?name\s*[,/]\s*vorname${WER}`],
  ['vorname_name', String.raw`(?:vorname\s*[,/]\s*(?:familien|nach|zu)?name|vor-?\s*und\s*(?:zu|nach|familien)name)${WER}`],
  ['vorname', String.raw`vorname${WER}`],
  ['nachname', String.raw`(?:nach|familien|zu)name${WER}`],
  ['name', String.raw`name${WER}`],
  ['anrede', String.raw`anrede`],
  ['geburtsdatum', String.raw`geburtsdatum|geb(?:urts)?\.?\s*-?\s*datum|geburtstag|geboren(?:\s+am)?|geb\.(?:\s*am)?`],
  ['anschrift', String.raw`stra(?:ß|ss)e(?:\s*(?:[,/]|und)\s*(?:haus)?-?\s*(?:nr|nummer)\.?)?|(?:wohn)?anschrift|adresse`],
  ['plz_ort', String.raw`plz\s*(?:[,/]|und)?\s*(?:wohn)?ort|postleitzahl(?:\s*(?:[,/]|und)\s*(?:wohn)?ort)?|wohnort|ort`],
  ['plz', String.raw`plz`],
  ['telefon', String.raw`tel(?:efon)?\.?(?:\s*\(?(?:privat|festnetz)\)?)?|festnetz`],
  ['mobil', String.raw`handy(?:nummer)?|mobil(?:telefon|funk|nummer)?|tel(?:efon)?\.?\s*\(?mobil\)?`],
  ['email', String.raw`e\s?-?\s?mail(?:\s*-?\s*adresse)?`],
  ['erziehungsberechtigte', String.raw`(?:name\s+(?:des|der)\s+)?erziehungsberechtigte[nr]?(?:\s*\(\s*r\s*\))?|gesetzliche[rn]?\s+vertreter(?:in|s)?|eltern(?:teil)?`],
  ['eintritt', String.raw`eintritt(?:sdatum)?(?:\s+(?:zum|ab|am))?|aufnahme\s+(?:zum|ab|am)|mitglied(?:schaft)?\s+ab|beginn(?:\s+der\s+mitgliedschaft)?`],
  ['kontoinhaber', String.raw`(?:name\s+(?:des|der)\s+)?kontoinhaber(?:s|in)?(?:\s*\(\s*in\s*\))?`],
  ['iban', String.raw`iban`],
  ['bic', String.raw`bic|swift(?:-?code)?`],
  ['sepa_mandat_ref', String.raw`mandats-?\s*ref(?:erenz)?\.?(?:\s*-?\s*nr\.?)?`],
  // Bezeichnungen, deren Werte nicht gebraucht werden – damit sie nicht in benachbarte Felder rutschen
  ['ignorieren', String.raw`(?:name\s+der\s+)?bank|kreditinstitut|geburtsort|staatsangeh(?:ö|oe)rigkeit|nationalit(?:ä|ae)t|beruf|geschlecht|gl(?:ä|ae)ubiger-?\s*(?:id|identifikationsnummer)|ort\s*[,/]?\s*(?:und\s*)?datum|datum|unterschrift(?:\s+(?:des|der)\s+[\p{L}/()-]+)*`],
];

const LABEL_RES = LABELS.map(([ziel, re]) => [ziel, new RegExp(String.raw`(?<![\p{L}])(?:${re})(?![\p{L}])`, 'giu')] as const);

type Treffer = { ziel: Ziel; start: number; end: number };

function labelsIn(line: string): Treffer[] {
  const all: Treffer[] = [];
  for (const [ziel, re] of LABEL_RES) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) all.push({ ziel, start: m.index, end: m.index + m[0].length });
  }
  // Früheste zuerst, bei gleicher Position die längste; überlappende verwerfen
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Treffer[] = [];
  for (const t of all) if (!out.length || t.start >= out[out.length - 1].end) out.push(t);
  return out;
}

function clean(v: string): string {
  return v
    .replace(/_{2,}|\.{3,}/g, ' ')
    .replace(/^[\s:;.,=|\-–_]+/, '')
    .replace(/[\s:;,=|\-–_]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Wörter in Großbuchstaben (Druckschrift) in normale Schreibweise bringen: MUSTERMANN → Mustermann. */
function nameCase(v: string): string {
  return v.replace(/\p{Lu}{2,}/gu, (w) => w[0] + w.slice(1).toLowerCase());
}

function nameValue(v: string): string {
  return nameCase(v.replace(/[^\p{L}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim());
}

/** „Mustermann, Max“ bzw. „Max Mustermann“ → [Vorname, Nachname] */
function splitName(v: string, nachnameZuerst: boolean): [string, string] {
  if (v.includes(',')) {
    const [a, ...rest] = v.split(',');
    const b = rest.join(' ');
    return nachnameZuerst ? [nameValue(b), nameValue(a)] : [nameValue(a), nameValue(b)];
  }
  const words = nameValue(v).split(' ').filter(Boolean);
  if (words.length < 2) return nachnameZuerst ? ['', words[0] ?? ''] : [words[0] ?? '', ''];
  return nachnameZuerst ? [words.slice(1).join(' '), words[0]] : [words.slice(0, -1).join(' '), words[words.length - 1]];
}

const DATE_RE = /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)/;

function dateValue(v: string, geburt: boolean, today: string): string | undefined {
  const m = v.replace(/[Oo]/g, '0').match(DATE_RE);
  if (!m) return undefined;
  let d = parseDate(`${m[1]}.${m[2]}.${m[3]}`);
  // Zweistellige Jahre: ein Geburtsdatum liegt nie in der Zukunft
  if (d && geburt && m[3].length === 2 && d > today) d = `${Number(d.slice(0, 4)) - 100}${d.slice(4)}`;
  return d ?? undefined;
}

function phoneValue(v: string): string | undefined {
  const m = v.match(/\+?[\d(][\d\s/()-]{4,}\d/);
  if (!m) return undefined;
  const p = m[0].replace(/\s+/g, ' ').trim();
  return p.replace(/\D/g, '').length >= 6 ? p : undefined;
}

const isMobile = (p: string) => /^(?:\+49|0049|0)\s*1[5-7]/.test(p.replace(/[\s/()-]/g, ''));

function emailValue(v: string): string | undefined {
  const m = v.replace(/\s*@\s*/g, '@').replace(/\s*\.\s*(?=[a-z]{2,6}\b)/gi, '.').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/i);
  return m?.[0].toLowerCase();
}

/** IBAN suchen und mit Prüfziffer bestätigen. Typische OCR-Verwechslungen (O/0, I/l/1) werden in den Ziffern korrigiert. */
export function findIBAN(text: string): string | undefined {
  for (const m of text.toUpperCase().matchAll(/\b([A-Z]{2})\s*([0-9OIL]{2}(?:\s*[0-9A-Z]){10,30})/g)) {
    const land = m[1];
    const rest = m[2].replace(/\s+/g, '');
    const laenge = land === 'DE' ? 20 : null;
    const fix = (s: string) => s.replace(/O/g, '0').replace(/[IL]/g, '1');
    const kandidaten = laenge
      ? [land + fix(rest.slice(0, laenge))]
      : Array.from({ length: Math.min(rest.length, 30) - 11 }, (_, i) => land + fix(rest.slice(0, 2)) + rest.slice(2, 13 + i)).reverse();
    for (const k of kandidaten) if (isValidIBAN(k)) return k;
  }
  return undefined;
}

function bicValue(v: string): string | undefined {
  const m = v.toUpperCase().match(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/);
  return m?.[0];
}

const STREET_RE = /([\p{L}][\p{L}.\- ]*?(?:stra(?:ß|ss)e|str\.|weg|allee|platz|ring|gasse|damm|ufer|steig|pfad|chaussee|markt|hof|berg|feld|garten|park)\s*\d+\s*[a-z]?(?:\s*-\s*\d+)?)(?![\p{L}\d])/iu;
const PLZ_ORT_RE = /(?<!\d)(\d{5})\s+([\p{L}][\p{L} .()/-]*[\p{L})])/u;

/** Erkannten Text eines Mitgliedsantrags auswerten. */
export function parseAntragText(text: string, today: string = todayISO()): AntragDaten {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[|[\]{}]/g, ' ').trim()).filter(Boolean);
  const werte = new Map<Ziel, string>();
  const setOnce = (z: Ziel, v: string) => {
    if (v && !werte.has(z)) werte.set(z, v);
  };

  lines.forEach((line, i) => {
    const treffer = labelsIn(line);
    treffer.forEach((t, j) => {
      let v = clean(line.slice(t.end, treffer[j + 1]?.start ?? line.length));
      // Wert steht in der nächsten Zeile (Bezeichnung über der Schreiblinie)
      if (!v && j === treffer.length - 1 && lines[i + 1] && !labelsIn(lines[i + 1]).length) v = clean(lines[i + 1]);
      if (t.ziel !== 'ignorieren') setOnce(t.ziel, v);
    });
  });

  const d: AntragDaten = {};
  const put = (k: AntragFeld, v: string | undefined) => {
    if (v && !d[k]) d[k] = v;
  };

  // Name
  if (werte.has('name_vorname')) {
    const [vn, nn] = splitName(werte.get('name_vorname')!, true);
    put('vorname', vn); put('nachname', nn);
  }
  if (werte.has('vorname_name')) {
    const [vn, nn] = splitName(werte.get('vorname_name')!, false);
    put('vorname', vn); put('nachname', nn);
  }
  put('vorname', nameValue(werte.get('vorname') ?? ''));
  put('nachname', nameValue(werte.get('nachname') ?? ''));
  if (werte.has('name')) {
    const v = werte.get('name')!;
    // „Name: Max Mustermann“ ohne eigenes Vornamenfeld → aufteilen
    if (!d.vorname && (v.includes(',') || nameValue(v).includes(' '))) {
      const [vn, nn] = splitName(v, v.includes(','));
      put('vorname', vn); put('nachname', nn);
    } else put('nachname', nameValue(v));
  }
  const anrede = werte.get('anrede')?.match(/\b(Frau|Herr|Divers)\b/i)?.[1];
  if (anrede) put('anrede', anrede[0].toUpperCase() + anrede.slice(1).toLowerCase());

  // Daten
  put('geburtsdatum', dateValue(werte.get('geburtsdatum') ?? '', true, today));
  put('eintritt', dateValue(werte.get('eintritt') ?? '', false, today));

  // Anschrift
  const anschrift = werte.get('anschrift');
  if (anschrift) {
    const plzOrt = anschrift.match(PLZ_ORT_RE);
    if (plzOrt) {
      put('strasse', nameCase(clean(anschrift.slice(0, plzOrt.index))));
      put('plz', plzOrt[1]);
      put('ort', nameCase(clean(plzOrt[2])));
    } else put('strasse', nameCase(anschrift));
  }
  const plzOrtWert = werte.get('plz_ort');
  if (plzOrtWert) {
    const m = plzOrtWert.match(/(?<!\d)(\d{5})\s*(.*)/);
    if (m) {
      put('plz', m[1]);
      put('ort', nameCase(clean(m[2])));
    } else if (!/\d/.test(plzOrtWert)) put('ort', nameCase(plzOrtWert));
  }
  put('plz', werte.get('plz')?.match(/(?<!\d)\d{5}(?!\d)/)?.[0]);
  // Ohne Bezeichnung: Zeile „12345 Musterstadt“, Straße mit Hausnummer davor oder in derselben Zeile
  if (!d.plz || !d.strasse) {
    lines.forEach((line, i) => {
      if (/iban|bic|tel|fax|mobil|handy/i.test(line)) return;
      const m = line.match(PLZ_ORT_RE);
      if (m && !d.plz) {
        put('plz', m[1]);
        put('ort', nameCase(clean(m[2])));
        put('strasse', (line.slice(0, m.index).match(STREET_RE) ?? lines[i - 1]?.match(STREET_RE))?.[1].trim());
      }
    });
    if (!d.strasse) put('strasse', lines.map((l) => l.match(STREET_RE)?.[1].trim()).find(Boolean));
  }

  // Kontakt
  const tel = phoneValue(werte.get('telefon') ?? '');
  const mobil = phoneValue(werte.get('mobil') ?? '');
  put('mobil', mobil);
  if (tel && isMobile(tel) && !d.mobil) put('mobil', tel);
  else put('telefon', tel);
  put('email', emailValue(werte.get('email') ?? '') ?? emailValue(text));

  // Erziehungsberechtigte, Bankverbindung
  put('erziehungsberechtigte', nameValue(werte.get('erziehungsberechtigte') ?? ''));
  put('kontoinhaber', nameValue(werte.get('kontoinhaber') ?? ''));
  put('iban', findIBAN(werte.get('iban') ?? '') ?? findIBAN(text));
  put('bic', bicValue(werte.get('bic') ?? ''));
  const ref = werte.get('sepa_mandat_ref')?.match(/[A-Z0-9][A-Z0-9+?/:().,'-]{2,34}/i)?.[0];
  put('sepa_mandat_ref', ref);

  return d;
}
