import type { CategoryBreakdown } from '@shared/types';

import type { Period } from '../calc/engine';
import { computeCategoryBreakdown } from '../calc/engine';
import { readSalaries, readTimesheet } from './ingest.service';
import { getSettings } from './settings.service';

/**
 * Where the hours went.
 *
 * No prices: which categories count as billable is a stored setting, decided
 * before any project is costed. No arithmetic either — the totals come back from
 * the engine alongside the rows.
 */
export function getCategoryBreakdown(period: Period): CategoryBreakdown {
  // The whole dataset goes to the engine with the period alongside it: the period
  // selects which rows are aggregated, never how they are classified.
  return computeCategoryBreakdown(
    { timesheet: readTimesheet(), salaries: readSalaries(), settings: getSettings() },
    period,
  );
}
