import type { AppMeta, PeriodSummary } from '@shared/types';

import type { Period } from '../calc/engine';
import { computePeriodSummary } from '../calc/engine';
import {
  readAvailableMonths,
  readAvailableYears,
  readProjects,
  readSalaries,
  readTimesheet,
} from './ingest.service';
import { getAllKnownCategories, getSettings } from './settings.service';

/**
 * Assembles what the dashboard needs: load the rows, load the settings, hand both
 * to the engine.
 *
 * No arithmetic lives here. Every rate, cost and margin is the engine's, which is
 * what keeps the cost model in one reviewable place.
 */

/** Company-wide totals for a period, with the gaps in the data behind them. */
export function getPeriodSummary(period: Period): PeriodSummary {
  // The whole dataset goes to the engine, not a pre-filtered slice. `period`
  // selects which rows are *aggregated*; the rates those rows are costed at are
  // always derived from the full month they belong to. Filtering to March must
  // never recompute March's direct and indirect rates from a subset of March.
  return computePeriodSummary(
    {
      timesheet: readTimesheet(),
      salaries: readSalaries(),
      projects: readProjects(),
      settings: getSettings(),
    },
    period,
  );
}

/** What the filters and the settings page need to offer real choices. */
export function getAppMeta(): AppMeta {
  return {
    years: readAvailableYears(),
    months: readAvailableMonths(),
    categories: getAllKnownCategories(),
    settings: getSettings(),
  };
}
