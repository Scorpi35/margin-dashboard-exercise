import type { ProjectFinancials } from '@shared/types';

import type { Period } from '../calc/engine';
import { ALL_TIME, computeProjectFinancials } from '../calc/engine';
import { HttpError } from '../middleware/errorHandler';
import { readProjects, readSalaries, readTimesheet } from './ingest.service';
import { getSettings } from './settings.service';

/**
 * Did each project make money.
 *
 * No arithmetic here — the service loads rows and settings, hands them to the
 * engine, and passes the result on.
 */

function engineInput() {
  return {
    timesheet: readTimesheet(),
    salaries: readSalaries(),
    projects: readProjects(),
    settings: getSettings(),
  };
}

/**
 * Projects with billable hours in the period, loss-making first.
 *
 * The whole dataset goes to the engine with the period alongside it: the period
 * selects which rows are aggregated, while the rates they are costed at stay
 * derived from the full month each row belongs to.
 */
export function listProjects(period: Period): ProjectFinancials[] {
  return computeProjectFinancials(engineInput(), period);
}

/**
 * One project, over its whole life rather than the period the list was filtered
 * to.
 *
 * A project's price is a single figure for the whole engagement, so its margin
 * only means anything against all the work done on it. Narrowing the detail to
 * March would show March's cost against a pro-rata slice of the price and invite
 * the reader to compare it with the contract value.
 *
 * @throws `HttpError(404)` when no billable hours have ever been logged against
 * the ref code — which is also why it is absent from the list.
 */
export function getProject(refCode: string): ProjectFinancials {
  // Costs every project to return one. An agency-year is a few thousand rows and
  // the engine is a handful of passes over them, so this stays well under a
  // millisecond — and computing one project in isolation would mean a second
  // implementation of the same arithmetic, which is the thing worth avoiding.
  const project = computeProjectFinancials(engineInput(), ALL_TIME).find(
    (candidate) => candidate.refCode === refCode,
  );

  if (project === undefined) {
    throw new HttpError(404, `No project has been costed under the ref code "${refCode}".`);
  }

  return project;
}
