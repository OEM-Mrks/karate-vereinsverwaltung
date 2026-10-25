// Geld wird überall als ganze Cent (Integer) gespeichert, damit keine Rundungsfehler entstehen.

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatEUR(cent: number | null | undefined): string {
  if (cent == null || Number.isNaN(cent)) return '–';
  return eur.format(cent / 100);
}

/** Betrag ohne Währungszeichen, z. B. für Eingabefelder: 1234,50 */
export function formatAmountInput(cent: number | null | undefined): string {
  if (cent == null) return '';
  return num.format(cent / 100).replace(/\./g, '');
}

/**
 * Wandelt einen Betragstext in Cent um. Versteht deutsche und englische Schreibweise:
 * "1.234,56", "1234,56", "-12,00 €", "1,234.56", "12.5", "+3", "12,00-" (nachgestelltes Minus).
 * decimal = ',' | '.' erzwingt das Dezimaltrennzeichen, sonst wird geraten.
 */
export function parseAmount(input: string | number | null | undefined, decimal?: ',' | '.'): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Math.round(input * 100);
  let s = input.trim().replace(/\s| /g, '').replace(/€|EUR/gi, '');
  if (!s) return null;
  let neg = false;
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,']+$/.test(s)) return null;
  s = s.replace(/'/g, '');
  let dec = decimal;
  if (!dec) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) dec = lastComma > lastDot ? ',' : '.';
    else if (lastComma >= 0) dec = ',';
    else if (lastDot >= 0) {
      // "1.234" ist im Deutschen ein Tausender, "12.5" eher ein Dezimalpunkt
      const parts = s.split('.');
      dec = parts.length === 2 && parts[1].length !== 3 ? '.' : ',';
    } else dec = ',';
  }
  const thousands = dec === ',' ? '.' : ',';
  s = s.split(thousands).join('');
  if (dec === ',') s = s.replace(',', '.');
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  const cent = Math.round(v * 100);
  return neg ? -cent : cent;
}

// ---------- Datum (ISO yyyy-mm-dd als String) ----------

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  if (!d) return iso;
  return `${d}.${m}.${y}`;
}

/** Datum aus Bank-CSV oder Eingabe: 31.12.2026, 31.12.26, 2026-12-31, 31/12/2026, 20261231 */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return iso(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return toISO(dt);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Addiert Monate; fällt der Tag weg (31.01. + 1 Monat), wird auf den Monatsletzten gekürzt. */
export function addMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = endOfMonth(target).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return target;
}

/**
 * Frühestmögliches Austrittsdatum bei Kündigung am Stichtag:
 * Stichtag + Kündigungsfrist (Monate), dann zum Ende dieses Monats.
 * Beispiel (3 Monate): Kündigung am 25.10.2026 → 25.01.2027 → Austritt zum 31.01.2027.
 */
export function earliestExitDate(noticeISO: string, noticeMonths = 3): string {
  return toISO(endOfMonth(addMonths(fromISO(noticeISO), noticeMonths)));
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function ageAt(birthISO: string | null | undefined, atISO: string = todayISO()): number | null {
  if (!birthISO) return null;
  const [by, bm, bd] = birthISO.split('-').map(Number);
  const [y, m, d] = atISO.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

// ---------- IBAN ----------

export function normalizeIBAN(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, '').toUpperCase();
}

export function formatIBAN(s: string | null | undefined): string {
  return normalizeIBAN(s).replace(/(.{4})/g, '$1 ').trim();
}

export function isValidIBAN(s: string | null | undefined): boolean {
  const iban = normalizeIBAN(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** Für unscharfe Textvergleiche: Kleinbuchstaben, Umlaute ausgeschrieben, nur a-z0-9 und Leerzeichen. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
