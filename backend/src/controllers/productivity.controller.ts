import type { RequestHandler } from 'express';

import type { ApiSuccess, ProductivityRow } from '@shared/types';

import { getProductivity } from '../services/productivity.service';
import { optionalMonth, requireYear } from './validation';

/** `GET /api/productivity?year&month` — billable share of each person's time. */
export const getProductivityRows: RequestHandler = (req, res, next) => {
  try {
    const body: ApiSuccess<ProductivityRow[]> = {
      status: 'ok',
      data: getProductivity({
        year: requireYear(req.query.year),
        month: optionalMonth(req.query.month),
      }),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
