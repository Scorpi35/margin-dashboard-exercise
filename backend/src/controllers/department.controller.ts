import type { RequestHandler } from 'express';

import type { ApiSuccess, DepartmentBreakdown, DepartmentRow } from '@shared/types';

import { getDepartment, getDepartments } from '../services/department.service';
import { optionalMonth, requireDepartment, requireYear } from './validation';

/** `GET /api/departments?year&month` — every department with people in the period. */
export const getDepartmentList: RequestHandler = (req, res, next) => {
  try {
    const body: ApiSuccess<DepartmentBreakdown> = {
      status: 'ok',
      data: getDepartments({
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
 * `GET /api/departments/:department` — one department and its people.
 *
 * Express decodes the path segment, so a name carrying a space or a slash
 * arrives here as it was written in the spreadsheet.
 */
export const getDepartmentDetail: RequestHandler = (req, res, next) => {
  try {
    const body: ApiSuccess<DepartmentRow> = {
      status: 'ok',
      data: getDepartment(
        { year: requireYear(req.query.year), month: optionalMonth(req.query.month) },
        requireDepartment(req.params.department),
      ),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
