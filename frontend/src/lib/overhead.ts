import type { YearMonthKey } from '@shared/types';

/**
 * The overhead table's text, and the map the API wants.
 *
 * Kept out of the component because a currency field is edited as text and stored
 * as a number, and the two have to disagree for a moment: a half-typed `"12."` is
 * not yet a number, and blanking a field must leave the row on screen rather than
 * dropping the month out of the map and taking its input with it.
 */

/** Digits, optional thousands separators, at most two decimal places. */
const AMOUNT = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

/** What a blank field means. Stated once, because three places rely on it. */
export const BLANK_MEANS_ZERO = 0;

/**
 * The amount a field holds, or `null` when it does not hold one.
 *
 * Blank is `0` rather than `null` — an empty overhead box is a month with no
 * overhead, which is a real answer. `null` is reserved for text that cannot be
 * read as an amount, which the page shows an inline message for rather than
 * coercing: `Number('12,000')` is `NaN`, and a `NaN` in the indirect pool turns
 * every figure on the dashboard into `NaN`.
 */
export function parseOverheadAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return BLANK_MEANS_ZERO;
  if (!AMOUNT.test(trimmed)) return null;

  const amount = Number(trimmed.replace(/,/g, ''));

  return Number.isFinite(amount) ? amount : null;
}

/** The months whose text cannot be read as an amount, in the order given. */
export function invalidOverheadMonths(
  draft: Readonly<Record<YearMonthKey, string>>,
): YearMonthKey[] {
  return Object.keys(draft).filter((month) => parseOverheadAmount(draft[month]) === null);
}

/**
 * The draft as the API's map.
 *
 * A month at zero is omitted rather than stored as `0`: the engine reads an
 * absent month as no overhead, so the two are the same figure, and omitting them
 * keeps the stored map to the months that actually carry a cost.
 *
 * Unreadable text is skipped — the page blocks saving on it, so this is only ever
 * reached with a valid draft.
 */
export function overheadFromDraft(
  draft: Readonly<Record<YearMonthKey, string>>,
): Record<YearMonthKey, number> {
  const overhead: Record<YearMonthKey, number> = {};

  for (const [month, text] of Object.entries(draft)) {
    const amount = parseOverheadAmount(text);
    if (amount !== null && amount !== 0) overhead[month] = amount;
  }

  return overhead;
}

/**
 * One text field per month, seeded from what was saved.
 *
 * `months` fixes the rows for as long as the page is open, so clearing a field
 * cannot make its row disappear from under the cursor.
 */
export function draftFromOverhead(
  months: readonly YearMonthKey[],
  overhead: Readonly<Record<YearMonthKey, number>>,
): Record<YearMonthKey, string> {
  return Object.fromEntries(
    months.map((month) => [month, month in overhead ? String(overhead[month]) : '']),
  );
}

/**
 * Every month the table needs a row for: the months that have data, plus any
 * month already carrying overhead.
 *
 * The second half matters — overhead entered for a month whose timesheet was
 * later replaced is still costed by the engine, and a row that is invisible
 * cannot be cleared.
 */
export function overheadMonths(
  monthsWithData: readonly YearMonthKey[],
  overhead: Readonly<Record<YearMonthKey, number>>,
): YearMonthKey[] {
  return [...new Set([...monthsWithData, ...Object.keys(overhead)])].sort();
}
