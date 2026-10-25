import { describe, expect, it } from 'vitest';
import { activeMonths, dueMonthCount, rateFor, yearSummary, type FeeContext } from '../src/lib/fees';
import type { Member } from '../src/db/schema';

const rates = [
  { id: 1, fee_group_id: 1, jahr: 2025, monatsbeitrag_cent: 2000 },
  { id: 2, fee_group_id: 1, jahr: 2027, monatsbeitrag_cent: 2500 },
];

describe('Beiträge', () => {
  it('zählt aktive Monate inkl. Eintritts- und Austrittsmonat', () => {
    expect(activeMonths('2020-01-01', null, 2026)).toHaveLength(12);
    expect(activeMonths('2026-03-15', null, 2026)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(activeMonths('2020-01-01', '2026-06-30', 2026)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(activeMonths('2020-01-01', '2025-12-31', 2026)).toEqual([]);
    expect(activeMonths('2027-01-01', null, 2026)).toEqual([]);
  });

  it('übernimmt den letzten gültigen Beitragssatz', () => {
    expect(rateFor(rates, 1, 2025).cent).toBe(2000);
    expect(rateFor(rates, 1, 2026)).toEqual({ cent: 2000, jahr: 2025 });
    expect(rateFor(rates, 1, 2028).cent).toBe(2500);
    expect(rateFor(rates, 1, 2020).cent).toBe(2000);
    expect(rateFor(rates, 9, 2026).cent).toBe(0);
  });

  it('berechnet Fälligkeit je Zahlweise', () => {
    const all12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(dueMonthCount(all12, 'jaehrlich', 2026, '2026-02-10')).toBe(12);
    expect(dueMonthCount(all12, 'halbjaehrlich', 2026, '2026-02-10')).toBe(6);
    expect(dueMonthCount(all12, 'quartal', 2026, '2026-04-01')).toBe(6);
    expect(dueMonthCount(all12, 'monatlich', 2026, '2026-10-25')).toBe(10);
    expect(dueMonthCount([11, 12], 'jaehrlich', 2026, '2026-10-25')).toBe(0);
    expect(dueMonthCount(all12, 'monatlich', 2025, '2026-10-25')).toBe(12);
    expect(dueMonthCount(all12, 'monatlich', 2027, '2026-10-25')).toBe(0);
  });

  it('ergibt Jahressoll, Zahlungen und offenen Betrag', () => {
    const m = { id: 7, eintritt: '2026-04-01', austritt: null, fee_group_id: 1, beitrag_individuell_cent: null, zahlweise: 'jaehrlich' } as unknown as Member;
    const ctx: FeeContext = {
      rates,
      charges: new Map([[7, [{ id: 1, member_id: 7, jahr: 2026, datum: '2026-04-01', betrag_cent: 3000, beschreibung: 'Aufnahmegebühr', category_id: null }]]]),
      payments: new Map([[7, new Map([[2026, 10000]])]]),
      today: '2026-10-25',
      startYear: 0,
    };
    const s = yearSummary(m, 2026, ctx);
    expect(s.monate).toBe(9);
    expect(s.beitragSoll).toBe(18000);
    expect(s.soll).toBe(21000);
    expect(s.offen).toBe(11000);
  });
});
