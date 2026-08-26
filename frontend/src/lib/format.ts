/**
 * How numbers are written on screen.
 *
 * Formatting is the frontend's job; calculating is not. Nothing here derives a
 * value — every rate, cost and margin arrives from the backend engine already
 * computed.
 */

/**
 * What a missing value looks like. A gap the reader can account for beats a `0`
 * they will read as a real number.
 */
export const EM_DASH = '—';

const AED = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const HOURS = new Intl.NumberFormat('en-AE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Money, to the dirham and without decimals — at these magnitudes the fils are
 * noise that stops columns scanning.
 *
 * `null` is an absent value, not zero: an unpriced project has no revenue, which
 * is a different fact from earning nothing.
 */
export function formatAED(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;

  return AED.format(value);
}

/** Hours to one decimal, matching the precision the timesheets are kept in. */
export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;

  return HOURS.format(value);
}

/**
 * A ratio as a percentage. The engine returns margins as fractions, so `0.163`
 * reads as `16.3%`.
 *
 * Losses keep their sign — a margin of −112% is the headline, not a footnote.
 */
export function formatPct(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;

  return `${(value * 100).toFixed(fractionDigits)}%`;
}

const MONTH_NAMES = [
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

/** The name of a 1–12 month, or an em dash for anything that is not one. */
export function monthName(month: number | null | undefined): string {
  if (month === null || month === undefined || !Number.isInteger(month)) return EM_DASH;

  return MONTH_NAMES[month - 1] ?? EM_DASH;
}

/**
 * How a selected period reads under a page heading.
 *
 * `null` month means the whole year; `null` year means there is no period to
 * describe yet.
 */
export function formatPeriod(year: number | null, month: number | null): string {
  if (year === null) return EM_DASH;

  return month === null ? `${year} · all months` : `${monthName(month)} ${year}`;
}

/**
 * A value as a CSS width for an inline bar, clamped to 0–100%.
 *
 * Lives here beside `formatPct` because it is the same domain conversion — a
 * number becoming a percentage — and a component should not be doing that
 * itself. The clamp is presentation: it keeps the drawing inside its cell
 * without touching the figure printed beside it, so a value outside the range
 * stays visible as a wrong number rather than being quietly corrected.
 *
 * `max` is what a full bar represents. It defaults to `1`, so a ratio can be
 * passed straight in; pass the largest row to scale a column of bars against
 * each other instead of against 100%.
 *
 * Rounded to one decimal so the markup reads as `82.7%` rather than
 * `82.69999999999999%`.
 */
export function formatBarWidth(value: number | null | undefined, max = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0%';
  // A zero or unusable maximum has no scale to draw against.
  if (!Number.isFinite(max) || max <= 0) return '0%';

  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  return `${percent.toFixed(1)}%`;
}
