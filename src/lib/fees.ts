// Beitragsberechnung: Monatsbeitrag × aktive Monate im Jahr, plus Sonderforderungen, minus Zahlungen.

import { all, getSetting } from '../db/db';
import type { FeeRate, Member, MemberCharge, Zahlweise } from '../db/schema';
import { todayISO, yearOf } from './format';

export const ZAHLWEISEN: { id: Zahlweise; name: string; perioden: number }[] = [
  { id: 'jaehrlich', name: 'jährlich', perioden: 1 },
  { id: 'halbjaehrlich', name: 'halbjährlich', perioden: 2 },
  { id: 'quartal', name: 'vierteljährlich', perioden: 4 },
  { id: 'monatlich', name: 'monatlich', perioden: 12 },
];

/**
 * Monate (1–12), in denen das Mitglied im Jahr Mitglied ist.
 * Eintritts- und Austrittsmonat zählen jeweils voll (Austritt i. d. R. zum Monatsende).
 */
export function activeMonths(eintritt: string, austritt: string | null, year: number): number[] {
  const months: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${String(m).padStart(2, '0')}-01`;
    const last = `${year}-${String(m).padStart(2, '0')}-31`; // String-Vergleich genügt
    if (eintritt <= last && (!austritt || austritt >= first)) months.push(m);
  }
  return months;
}

/**
 * Wie viele der aktiven Monate sind bis zum Stichtag bereits fällig?
 * Beiträge werden zu Beginn jeder Zahlungsperiode fällig (jährlich: Januar bzw. Eintrittsmonat).
 */
export function dueMonthCount(months: number[], zahlweise: Zahlweise, year: number, today: string): number {
  const ty = yearOf(today);
  if (year < ty) return months.length;
  if (year > ty) return 0;
  const tm = Number(today.slice(5, 7));
  const perioden = ZAHLWEISEN.find((z) => z.id === zahlweise)?.perioden ?? 1;
  const len = 12 / perioden;
  const first = months[0] ?? 13;
  // Ein Monat ist fällig, sobald seine Zahlungsperiode begonnen hat (frühestens mit dem Eintritt).
  return months.filter((m) => {
    const periodStart = Math.floor((m - 1) / len) * len + 1;
    return Math.max(periodStart, first) <= tm;
  }).length;
}

/** Gültiger Monatsbeitrag einer Gruppe in einem Jahr. Fehlt ein Satz, gilt der letzte frühere. */
export function rateFor(rates: FeeRate[], groupId: number | null, year: number): { cent: number; jahr: number | null } {
  if (groupId == null) return { cent: 0, jahr: null };
  const own = rates.filter((r) => r.fee_group_id === groupId).sort((a, b) => a.jahr - b.jahr);
  let best: FeeRate | undefined;
  for (const r of own) if (r.jahr <= year) best = r;
  if (!best) best = own[0];
  return best ? { cent: best.monatsbeitrag_cent, jahr: best.jahr } : { cent: 0, jahr: null };
}

export type FeeContext = {
  rates: FeeRate[];
  charges: Map<number, MemberCharge[]>;
  /** member_id → (jahr → bezahlt in Cent) */
  payments: Map<number, Map<number, number>>;
  today: string;
  /** Ab diesem Jahr werden Beitragskonten geführt (Jahre davor gelten als ausgeglichen). */
  startYear: number;
};

export function loadFeeContext(today = todayISO()): FeeContext {
  const rates = all<FeeRate>('SELECT * FROM fee_rates');
  const charges = new Map<number, MemberCharge[]>();
  for (const c of all<MemberCharge>('SELECT * FROM member_charges ORDER BY datum')) {
    if (!charges.has(c.member_id)) charges.set(c.member_id, []);
    charges.get(c.member_id)!.push(c);
  }
  const payments = new Map<number, Map<number, number>>();
  const rows = all<{ member_id: number; jahr: number; summe: number }>(`
    SELECT a.member_id, COALESCE(a.beitragsjahr, CAST(substr(t.buchungsdatum,1,4) AS INTEGER)) AS jahr,
           SUM(a.betrag_cent) AS summe
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id
    LEFT JOIN categories c ON c.id = a.category_id
    WHERE a.member_id IS NOT NULL AND COALESCE(c.mitgliedskonto, 0) = 1
    GROUP BY a.member_id, jahr`);
  for (const r of rows) {
    if (!payments.has(r.member_id)) payments.set(r.member_id, new Map());
    payments.get(r.member_id)!.set(r.jahr, r.summe);
  }
  return { rates, charges, payments, today, startYear: Number(getSetting('beitragskonto_ab', '0')) || 0 };
}

export type YearSummary = {
  jahr: number;
  monate: number;
  monatsbeitrag: number;
  rateJahr: number | null;
  individuell: boolean;
  beitragSoll: number;
  sonderSoll: number;
  soll: number;
  faelligBisHeute: number;
  bezahlt: number;
  offen: number;        // Jahressoll − bezahlt
  offenFaellig: number; // fällig bis heute − bezahlt (nicht negativ)
};

export function monthlyFee(m: Member, ctx: FeeContext, year: number) {
  if (m.beitrag_individuell_cent != null) return { cent: m.beitrag_individuell_cent, jahr: null, individuell: true };
  return { ...rateFor(ctx.rates, m.fee_group_id, year), individuell: false };
}

export function yearSummary(m: Member, year: number, ctx: FeeContext): YearSummary {
  const months = activeMonths(m.eintritt, m.austritt, year);
  const fee = monthlyFee(m, ctx, year);
  const beitragSoll = months.length * fee.cent;
  const charges = (ctx.charges.get(m.id) ?? []).filter((c) => c.jahr === year);
  const sonderSoll = charges.reduce((s, c) => s + c.betrag_cent, 0);
  const sonderFaellig = charges.filter((c) => c.datum <= ctx.today).reduce((s, c) => s + c.betrag_cent, 0);
  const due = dueMonthCount(months, m.zahlweise, year, ctx.today) * fee.cent + sonderFaellig;
  const bezahlt = ctx.payments.get(m.id)?.get(year) ?? 0;
  const soll = beitragSoll + sonderSoll;
  return {
    jahr: year,
    monate: months.length,
    monatsbeitrag: fee.cent,
    rateJahr: fee.jahr,
    individuell: fee.individuell,
    beitragSoll,
    sonderSoll,
    soll,
    faelligBisHeute: due,
    bezahlt,
    offen: soll - bezahlt,
    offenFaellig: Math.max(0, due - bezahlt),
  };
}

/** Erstes Jahr, für das das Beitragskonto eines Mitglieds geführt wird. */
export function firstFeeYear(m: Member, ctx: FeeContext): number {
  return Math.max(yearOf(m.eintritt), ctx.startYear);
}

/** Saldo aller Vorjahre (positiv = Rückstand, negativ = Guthaben). */
export function balanceBefore(m: Member, year: number, ctx: FeeContext): number {
  const start = firstFeeYear(m, ctx);
  let saldo = 0;
  for (let y = start; y < year; y++) {
    const s = yearSummary(m, y, ctx);
    saldo += s.soll - s.bezahlt;
  }
  // Vorauszahlungen bzw. Fehlbuchungen für Jahre vor dem Eintritt mit berücksichtigen
  for (const [y, v] of ctx.payments.get(m.id) ?? []) if (y < start && y >= ctx.startYear && y < year) saldo -= v;
  return saldo;
}

export function isActive(m: Pick<Member, 'eintritt' | 'austritt'>, at = todayISO()): boolean {
  return m.eintritt <= at && (!m.austritt || m.austritt >= at);
}
