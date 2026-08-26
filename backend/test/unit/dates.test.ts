import { describe, expect, it } from 'vitest';

import { parseMonthName, parseYearMonth, yearMonthKey } from '../../src/parse/dates';

describe('parseMonthName', () => {
  it('resolves every full month name, case-insensitively', () => {
    const names = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    names.forEach((name, index) => {
      expect(parseMonthName(name)).toBe(index + 1);
      expect(parseMonthName(name.toUpperCase())).toBe(index + 1);
      expect(parseMonthName(name.toLowerCase())).toBe(index + 1);
    });
  });

  it('resolves a prefix that can only be one month', () => {
    expect(parseMonthName('jan')).toBe(1);
    expect(parseMonthName('feb')).toBe(2);
    expect(parseMonthName('sep')).toBe(9);
    expect(parseMonthName('sept')).toBe(9);
    expect(parseMonthName('jun')).toBe(6);
    expect(parseMonthName('jul')).toBe(7);
    expect(parseMonthName('mar')).toBe(3);
    expect(parseMonthName('may')).toBe(5);
  });

  it('returns null for a prefix that fits more than one month', () => {
    // 'ju' is June or July, 'ma' is March or May, 'a' is April or August.
    expect(parseMonthName('ju')).toBeNull();
    expect(parseMonthName('ma')).toBeNull();
    expect(parseMonthName('a')).toBeNull();
    expect(parseMonthName('j')).toBeNull();
  });

  it('returns null rather than throwing on anything that is not a month', () => {
    expect(parseMonthName('')).toBeNull();
    expect(parseMonthName('   ')).toBeNull();
    expect(parseMonthName('Q1')).toBeNull();
    expect(parseMonthName('Janurary')).toBeNull();
    expect(parseMonthName('13')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(parseMonthName('  January  ')).toBe(1);
  });
});

describe('parseYearMonth', () => {
  it('reads the timesheet format, "January 2025"', () => {
    expect(parseYearMonth('January 2025')).toEqual({ year: 2025, month: 1 });
    expect(parseYearMonth('December 2025')).toEqual({ year: 2025, month: 12 });
    expect(parseYearMonth('  July 2025  ')).toEqual({ year: 2025, month: 7 });
  });

  it('reads the price-list format, "January \'25"', () => {
    expect(parseYearMonth("January '25")).toEqual({ year: 2025, month: 1 });
    expect(parseYearMonth("September '25")).toEqual({ year: 2025, month: 9 });
  });

  it('resolves both spellings of the same month to the same period', () => {
    // The timesheet and the price list disagree on format but not on meaning.
    expect(parseYearMonth('January 2025')).toEqual(parseYearMonth("January '25"));
  });

  it('reads a bare month against the year the salary title row supplied', () => {
    expect(parseYearMonth('January', 2025)).toEqual({ year: 2025, month: 1 });
    expect(parseYearMonth('Dec', 2024)).toEqual({ year: 2024, month: 12 });
  });

  it('throws on a bare month when no default year was supplied', () => {
    expect(() => parseYearMonth('January')).toThrow(/no default year/i);
  });

  it('prefers the year written on the value over the default', () => {
    expect(parseYearMonth('January 2024', 2025)).toEqual({ year: 2024, month: 1 });
  });

  it('reads the ISO year-month form', () => {
    expect(parseYearMonth('2025-01')).toEqual({ year: 2025, month: 1 });
    expect(parseYearMonth('2025-12')).toEqual({ year: 2025, month: 12 });
    expect(parseYearMonth('2025-1')).toEqual({ year: 2025, month: 1 });
  });

  it('throws when the ISO month is outside 1-12', () => {
    expect(() => parseYearMonth('2025-13')).toThrow(/2025-13/);
    expect(() => parseYearMonth('2025-00')).toThrow(/2025-00/);
  });

  it('reads an Excel serial number against the 1899-12-30 epoch', () => {
    expect(parseYearMonth(45658)).toEqual({ year: 2025, month: 1 });
    // The month several employees take their raise in.
    expect(parseYearMonth(45839)).toEqual({ year: 2025, month: 7 });
    expect(parseYearMonth(45992)).toEqual({ year: 2025, month: 12 });
  });

  it('ignores the time fraction on a date-and-time cell', () => {
    expect(parseYearMonth(45658.75)).toEqual({ year: 2025, month: 1 });
  });

  it('throws on a number too small to be a real date', () => {
    // A bare year is a valid serial — 2025 means 1905-07-17 — but a year carries
    // no month, so resolving it would silently misfile a whole period.
    expect(() => parseYearMonth(2025)).toThrow(/plausible/i);
    expect(() => parseYearMonth(60)).toThrow(/phantom leap day/i);
    expect(() => parseYearMonth(0)).toThrow();
    expect(() => parseYearMonth(-45658)).toThrow();
  });

  it('throws on a non-finite number', () => {
    expect(() => parseYearMonth(Number.NaN)).toThrow();
    expect(() => parseYearMonth(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('throws on an unrecognised format, naming the offending value', () => {
    expect(() => parseYearMonth('Q1 2025')).toThrow(/"Q1 2025"/);
    expect(() => parseYearMonth('Janurary 2025')).toThrow(/"Janurary 2025"/);
    expect(() => parseYearMonth('2025/01')).toThrow(/"2025\/01"/);
    expect(() => parseYearMonth('the fourteenth of never')).toThrow();
  });

  it('throws on an empty value rather than defaulting', () => {
    expect(() => parseYearMonth('   ')).toThrow(/empty/i);
    expect(() => parseYearMonth('')).toThrow(/empty/i);
    // Even with a default year to fall back on — an empty cell is not a month.
    expect(() => parseYearMonth('   ', 2025)).toThrow(/empty/i);
  });

  it('throws on a value that is neither a string nor a number', () => {
    expect(() => parseYearMonth(null)).toThrow();
    expect(() => parseYearMonth(undefined)).toThrow();
    expect(() => parseYearMonth(new Date('2025-01-01'))).toThrow();
  });
});

describe('yearMonthKey', () => {
  it('zero-pads the month', () => {
    expect(yearMonthKey(2025, 1)).toBe('2025-01');
    expect(yearMonthKey(2025, 9)).toBe('2025-09');
    expect(yearMonthKey(2025, 12)).toBe('2025-12');
  });

  it('round-trips through parseYearMonth', () => {
    const period = parseYearMonth('January 2025');
    expect(parseYearMonth(yearMonthKey(period.year, period.month))).toEqual(period);
  });

  it('throws on a month outside 1-12 so a bad key cannot reach the overhead map', () => {
    expect(() => yearMonthKey(2025, 0)).toThrow(/outside 1-12/);
    expect(() => yearMonthKey(2025, 13)).toThrow(/outside 1-12/);
    expect(() => yearMonthKey(2025, 1.5)).toThrow(/outside 1-12/);
  });
});
