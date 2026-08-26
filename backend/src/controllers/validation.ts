import type { MonthNumber, UploadType } from '@shared/types';
import { MAX_DATA_YEAR, MIN_DATA_YEAR } from '@shared/types';

import { HttpError } from '../middleware/errorHandler';

/**
 * Hand-rolled validation for everything arriving on a request. There is no `zod`
 * in this repo, and this is the only place request input is trusted enough to use.
 *
 * The rule every helper follows: a value that cannot be understood is a `400`
 * naming the parameter, never a `NaN` or a silent default. A `year` of `"banana"`
 * that slips through as `NaN` filters every row out and renders an empty
 * dashboard that looks like a real answer.
 */

const UPLOAD_TYPES: readonly UploadType[] = ['timesheet', 'salary', 'projects'];

/**
 * The earliest and latest years a spreadsheet could plausibly be filed under.
 * Shared with `parse/dates.ts`, which applies the same window to Excel serials.
 */
/** Longer than any ref code the source files use, and short enough to reject junk. */
const MAX_REF_CODE_LENGTH = 64;

const MIN_YEAR = MIN_DATA_YEAR;
const MAX_YEAR = MAX_DATA_YEAR;

/** @throws `HttpError(400)` when `year` is absent, not a number, or out of range. */
export function requireYear(value: unknown): number {
  const year = integerOrNull(value);

  if (year === null || year < MIN_YEAR || year > MAX_YEAR) {
    throw new HttpError(
      400,
      `The "year" parameter must be a year between ${MIN_YEAR} and ${MAX_YEAR}.`,
    );
  }

  return year;
}

/**
 * A month filter, or `null` for the whole year.
 *
 * Absent means "no filter" and is fine; present-but-unreadable is a mistake and
 * is rejected, because silently widening it to the year would answer a question
 * nobody asked.
 *
 * @throws `HttpError(400)` when `month` is present but not 1–12.
 */
export function optionalMonth(value: unknown): MonthNumber | null {
  if (value === undefined || value === null || value === '') return null;

  const month = integerOrNull(value);
  if (month === null || month < 1 || month > 12) {
    throw new HttpError(400, 'The "month" parameter must be a whole number from 1 to 12.');
  }

  return month;
}

/**
 * A project ref code from a path segment.
 *
 * Ref codes come from the spreadsheet rather than a fixed list, so the only thing
 * worth checking is that there is one and that it is a plausible length — an
 * unknown code is the service's 404 to report, not a 400.
 *
 * @throws `HttpError(400)` when the segment is missing or empty.
 */
export function requireRefCode(value: unknown): string {
  const refCode = typeof value === 'string' ? value.trim() : '';

  if (refCode === '' || refCode.length > MAX_REF_CODE_LENGTH) {
    throw new HttpError(400, 'A project ref code is required.');
  }

  return refCode;
}

/** @throws `HttpError(400)` when the `:type` segment is not one of the three files. */
export function requireUploadType(value: unknown): UploadType {
  const type = UPLOAD_TYPES.find((candidate) => candidate === value);

  if (type === undefined) {
    throw new HttpError(
      400,
      `Upload type must be one of ${UPLOAD_TYPES.map((t) => `"${t}"`).join(', ')}.`,
    );
  }

  return type;
}

/** Plain digits only — see `integerOrNull` for why `Number()` is not enough. */
const DIGITS = /^\d+$/;

/**
 * A whole number written as digits, or `null` for anything else.
 *
 * Deliberately stricter than `Number()`, which is far too willing: it reads
 * `"2e3"` as 2000 and `"0x7e9"` as 2025, both of which would sail through a range
 * check and silently filter the dashboard to a year nobody typed. `Number('')`
 * and `Number(' ')` are `0`, so blanks are rejected before the conversion too.
 *
 * An array is what Express produces from a repeated query parameter
 * (`?year=2025&year=2026`); there is no sensible way to pick one, so it is
 * rejected rather than guessed at.
 */
function integerOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim();
  return DIGITS.test(text) ? Number(text) : null;
}
