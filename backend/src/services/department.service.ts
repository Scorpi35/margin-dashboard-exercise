import type { DepartmentBreakdown, DepartmentRow } from '@shared/types';

import type { Period } from '../calc/engine';
import { computeDepartmentBreakdown } from '../calc/engine';
import { HttpError } from '../middleware/errorHandler';
import { readSalaries, readTimesheet } from './ingest.service';
import { getSettings } from './settings.service';

/**
 * Hours and cost per department.
 *
 * No prices are loaded: a department's cost is the salaries of its people, and
 * nothing here depends on what a project sold for.
 */

function breakdown(period: Period): DepartmentBreakdown {
  // The whole dataset goes to the engine with the period alongside it: the period
  // selects which rows are aggregated, never how anyone is grouped or costed.
  return computeDepartmentBreakdown(
    { timesheet: readTimesheet(), salaries: readSalaries(), settings: getSettings() },
    period,
  );
}

export function getDepartments(period: Period): DepartmentBreakdown {
  return breakdown(period);
}

/**
 * One department, with the people in it.
 *
 * @throws `HttpError(404)` when nobody in the period belongs to it — which is
 * also why it is absent from the list.
 */
export function getDepartment(period: Period, department: string): DepartmentRow {
  // Costs every department to return one, as `getProject` does. An agency-year is
  // a few thousand rows and the engine is a handful of passes over them; the
  // alternative is a second implementation of the same grouping.
  const row = breakdown(period).rows.find((candidate) => candidate.department === department);

  if (row === undefined) {
    throw new HttpError(404, `No department named "${department}" has anyone in this period.`);
  }

  return row;
}
