import { describe, expect, it } from 'vitest';
import { earliestExitDate, isValidIBAN, parseAmount, parseDate } from '../src/lib/format';

describe('Kündigung', () => {
  it('heute + 3 Monate zum Monatsende', () => {
    expect(earliestExitDate('2026-10-25')).toBe('2027-01-31');
    expect(earliestExitDate('2026-11-30')).toBe('2027-02-28');
    expect(earliestExitDate('2027-11-30')).toBe('2028-02-29');
    expect(earliestExitDate('2026-01-01')).toBe('2026-04-30');
    expect(earliestExitDate('2026-12-31')).toBe('2027-03-31');
    expect(earliestExitDate('2026-10-25', 6)).toBe('2027-04-30');
  });
});

describe('Beträge', () => {
  it('versteht deutsche und englische Schreibweisen', () => {
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('-1.234,56')).toBe(-123456);
    expect(parseAmount('12,00 €')).toBe(1200);
    expect(parseAmount('12,00-')).toBe(-1200);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('12.5')).toBe(1250);
    expect(parseAmount('+3')).toBe(300);
    expect(parseAmount('1.234')).toBe(123400);
    expect(parseAmount('1234.56', '.')).toBe(123456);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('Datum', () => {
  it('liest Bankformate', () => {
    expect(parseDate('02.01.26')).toBe('2026-01-02');
    expect(parseDate('31.12.2026')).toBe('2026-12-31');
    expect(parseDate('2026-12-31')).toBe('2026-12-31');
    expect(parseDate('20261231')).toBe('2026-12-31');
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('Kontostand')).toBeNull();
  });
});

describe('IBAN', () => {
  it('prüft die Prüfziffer', () => {
    expect(isValidIBAN('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIBAN('DE89 3704 0044 0532 0130 01')).toBe(false);
  });
});
