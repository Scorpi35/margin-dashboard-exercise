import type { RequestHandler } from 'express';

import type { ApiSuccess, ProjectFinancials } from '@shared/types';

import { getProject, listProjects } from '../services/project.service';
import { optionalMonth, requireRefCode, requireYear } from './validation';

/** `GET /api/projects?year&month` — every project with hours in the period. */
export const getProjects: RequestHandler = (req, res, next) => {
  try {
    const body: ApiSuccess<ProjectFinancials[]> = {
      status: 'ok',
      data: listProjects({
        year: requireYear(req.query.year),
        month: optionalMonth(req.query.month),
      }),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};

/**
 * `GET /api/projects/:refCode` — one project over all time.
 *
 * Deliberately ignores any period on the query string: a project's price covers
 * the whole engagement, so its margin is only meaningful against all of its work.
 */
export const getProjectDetail: RequestHandler = (req, res, next) => {
  try {
    const body: ApiSuccess<ProjectFinancials> = {
      status: 'ok',
      data: getProject(requireRefCode(req.params.refCode)),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
