import type { ProductivityRow } from '@shared/types';

import type { Period } from '../calc/engine';
import { computeProductivity } from '../calc/engine';
import { readSalaries, readTimesheet } from './ingest.service';
import { getSettings } from './settings.service';

/**
 * How much of each person's logged time was billable.
 *
 * No arithmetic here — the service loads rows and settings and hands them to the
 * engine, which decides billability from `settings.billableCategories` rather
 * than from any name prefix.
 */
export function getProductivity(period: Period): ProductivityRow[] {
  // The whole dataset goes to the engine with the period alongside it: the period
  // selects which rows are aggregated, never how they are costed.
  // No prices: productivity is billable hours over total hours, decided before
  // any project is costed. Loading them would imply a dependency there isn't one.
  return computeProductivity(
    { timesheet: readTimesheet(), salaries: readSalaries(), settings: getSettings() },
    period,
  );
}
