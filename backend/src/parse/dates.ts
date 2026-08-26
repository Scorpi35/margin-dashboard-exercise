import type { MonthNumber } from '@shared/types';

/**
 * The only place a date is ever interpreted.
 *
 * The three source spreadsheets write the same month three different ways —
 * `"January 2025"` in the timesheet, `"January '25"` in the price list, and a
 * bare `"January"` column header in the salary sheet, whose year lives in a title
 * row. Excel adds a fourth whenever a cell is accidentally formatted as a date.
 * Downstream code receives explicit `year` and `month` integers and never sees a
 * date string (`docs/data-sources.md` § Date Formats).
 *
 * Everything here throws rather than guesses. A silently wrong month misfiles
 * both cost and revenue, and the resulting totals still look plausible.
 */

/** A calendar month, resolved. */
export interface YearMonth {
  readonly year: number;
  readonly month: MonthNumber;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/** `"January 2025"`, `"January '25"`, or a bare `"January"`. Trailing dot for `"Sept."`. */
const NAMED_MONTH = /^([a-z]+)\.?(?:\s+'?(\d{2}|\d{4}))?$/i;

/** `"2025-01"`, and the unpadded `"2025-1"` a hand-typed cell produces. */
const ISO_YEAR_MONTH = /^(\d{4})-(\d{1,2})$/;

/**
 * Excel counts days from 1899-12-30 rather than 1900-01-01, which is how it
 * absorbs the phantom 1900-02-29 it believes in.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/**
 * Serials at or below 60 land on or before that phantom day, where the epoch
 * offset above is off by one. No agency spreadsheet reaches back to 1900, so
 * these are rejected rather than corrected.
 */
const MIN_EXCEL_SERIAL = 61;

/**
 * A number in a month column is only a date if it resolves to a plausible one.
 * A bare `2025` is a valid serial — it means 1905-07-17 — and a year with no
 * month is not a month anyway, so the guard turns a silent misfile into a throw.
 */
const MIN_PLAUSIBLE_YEAR = 1970;
const MAX_PLAUSIBLE_YEAR = 2199;

/**
 * Resolves a month name to `1`–`12`, or `null` if it is not one.
 *
 * Matches case-insensitively on prefix, so `"jan"` and `"sept"` resolve while
 * `"ju"` (June or July) and `"ma"` (March or May) stay ambiguous and yield
 * `null`. Never throws — callers decide whether an unresolved name is a skipped
 * row or a rejected file.
 */
export function parseMonthName(raw: string): MonthNumber | null {
  const needle = raw.trim().toLowerCase();
  if (needle === '') return null;

  const matches = MONTH_NAMES.filter((name) => name.startsWith(needle));
  if (matches.length !== 1) return null;

  return MONTH_NAMES.indexOf(matches[0]) + 1;
}

/**
 * Resolves any month format the three source files use into `{ year, month }`.
 *
 * `defaultYear` covers the salary sheet's bare month headers, where the year is
 * carried by the title row above them. Without it a bare month throws rather
 * than assuming the current year — a salary sheet filed under the wrong year is
 * worse than a failed import.
 *
 * @throws if the value is empty, malformed, or a bare month with no `defaultYear`.
 */
export function parseYearMonth(raw: unknown, defaultYear?: number): YearMonth {
  if (typeof raw === 'number') return fromExcelSerial(raw);

  if (typeof raw !== 'string') {
    throw new Error(`Cannot resolve a year and month from a ${typeof raw} value.`);
  }

  const text = raw.trim();
  if (text === '') {
    throw new Error('Cannot resolve a year and month: the value is empty.');
  }

  const iso = ISO_YEAR_MONTH.exec(text);
  if (iso) {
    const month = Number(iso[2]);
    if (month < 1 || month > 12) {
      throw new Error(`Month is outside 1-12 in "${raw}".`);
    }
    return { year: Number(iso[1]), month };
  }

  const named = NAMED_MONTH.exec(text);
  if (named) {
    const month = parseMonthName(named[1]);
    if (month === null) {
      throw new Error(`Unrecognised month name in "${raw}".`);
    }
    return { year: resolveYear(named[2], raw, defaultYear), month };
  }

  throw new Error(`Unrecognised month format: "${raw}".`);
}

/** Zero-padded `"YYYY-MM"`, the key `Settings.monthlyOverhead` is stored under. */
export function yearMonthKey(year: number, month: MonthNumber): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Cannot build a month key: ${month} is outside 1-12.`);
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * A two-digit year is read as `20xx`. Every sheet the agency keeps is this
 * century, and the alternative — a pivot year — guesses a century silently.
 */
function resolveYear(digits: string | undefined, raw: string, defaultYear?: number): number {
  if (digits === undefined) {
    if (defaultYear === undefined) {
      throw new Error(`Cannot resolve a year for "${raw}": no default year was supplied.`);
    }
    return defaultYear;
  }

  const value = Number(digits);
  return digits.length === 2 ? 2000 + value : value;
}

function fromExcelSerial(serial: number): YearMonth {
  if (!Number.isFinite(serial)) {
    throw new Error(`Cannot resolve a year and month from the number ${serial}.`);
  }

  // A date-and-time cell carries the time as a fraction of a day; only the date matters.
  const days = Math.floor(serial);
  if (days < MIN_EXCEL_SERIAL) {
    throw new Error(
      `Excel serial ${serial} falls in the 1900 range Excel's phantom leap day corrupts.`,
    );
  }

  const date = new Date(EXCEL_EPOCH_UTC + days * MS_PER_DAY);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  if (year < MIN_PLAUSIBLE_YEAR || year > MAX_PLAUSIBLE_YEAR) {
    throw new Error(
      `Excel serial ${serial} resolves to ${yearMonthKey(year, month)}, outside the plausible ` +
        `range ${MIN_PLAUSIBLE_YEAR}-${MAX_PLAUSIBLE_YEAR}. It is probably a number, not a date.`,
    );
  }

  return { year, month };
}
