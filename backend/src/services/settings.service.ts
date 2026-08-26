import type { Settings, YearMonthKey } from '@shared/types';
import { DEFAULT_BILLABLE_CATEGORIES, YEAR_MONTH_KEY_PATTERN } from '@shared/types';

import { getDb } from '../lib/db';
import { HttpError } from '../middleware/errorHandler';

/**
 * The two things a user can change without a code change: which categories count
 * as billable, and how much overhead to add per month.
 *
 * Both are stored as JSON under a key, so a fresh database needs no seeding and a
 * new setting needs no migration.
 */

const BILLABLE_CATEGORIES_KEY = 'billableCategories';
const MONTHLY_OVERHEAD_KEY = 'monthlyOverhead';

/** Defaults on a fresh database: the three billable categories, and no overhead. */
export function getSettings(): Settings {
  return {
    billableCategories: readJson(
      BILLABLE_CATEGORIES_KEY,
      [...DEFAULT_BILLABLE_CATEGORIES],
      isStringArray,
    ),
    monthlyOverhead: readJson(MONTHLY_OVERHEAD_KEY, {}, isOverheadMap),
  };
}

/**
 * @throws if the overhead map is malformed. Storing it and quietly falling back
 * on the next read would tell the user their overhead was saved when it was not.
 */
export function saveSettings(settings: Settings): Settings {
  if (!isOverheadMap(settings.monthlyOverhead)) {
    throw new HttpError(
      400,
      'Monthly overhead must be keyed by month as "YYYY-MM", with a non-negative amount for each.',
    );
  }

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );

  db.transaction(() => {
    upsert.run(BILLABLE_CATEGORIES_KEY, JSON.stringify([...settings.billableCategories]));
    upsert.run(MONTHLY_OVERHEAD_KEY, JSON.stringify(settings.monthlyOverhead));
  })();

  return getSettings();
}

/**
 * Every category the timesheet has ever contained, so the settings page can offer
 * real choices rather than a free-text box.
 *
 * Listing them is all this does. Which of them count as billable is a stored
 * setting, applied by the engine — never inferred from a name prefix, since
 * `Tentwenty` is internal work and carries no `FC - ` prefix.
 */
export function getAllKnownCategories(): string[] {
  const rows = getDb()
    .prepare('SELECT DISTINCT category FROM timesheet_entries ORDER BY category')
    .all() as { category: string }[];

  return rows.map((row) => row.category);
}

/**
 * Reads one setting, falling back to the default when it is unset or unreadable.
 *
 * A corrupt row is logged rather than thrown: the dashboard staying up on default
 * settings beats a 500 on every page, and the log says which key to look at.
 */
function readJson<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;

  if (row === undefined) return fallback;

  try {
    const parsed: unknown = JSON.parse(row.value);
    if (isValid(parsed)) return parsed;
    console.warn(`[warn] settings.${key} has an unexpected shape; using the default.`);
  } catch (err) {
    console.warn(`[warn] settings.${key} is not valid JSON; using the default.`, err);
  }

  return fallback;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Overhead must be keyed `YYYY-MM` and non-negative.
 *
 * An unchecked key is worse than a rejected one: the engine looks overhead up by
 * month key, so `"banana"` or `"2025-13"` would be stored, shown back to the user
 * as saved, and then never applied to anything.
 */
function isOverheadMap(value: unknown): value is Record<YearMonthKey, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  return Object.entries(value).every(
    ([key, entry]) =>
      YEAR_MONTH_KEY_PATTERN.test(key) &&
      typeof entry === 'number' &&
      Number.isFinite(entry) &&
      entry >= 0,
  );
}
