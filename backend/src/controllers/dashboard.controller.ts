import type { RequestHandler } from 'express';

import type { ApiSuccess, PeriodSummary } from '@shared/types';

import { getPeriodSummary } from '../services/dashboard.service';
import { optionalMonth, requireYear } from './validation';

/**
 * `GET /api/dashboard?year&month` — the totals for a period.
 *
 * `month` is optional and selects a single month; omitting it means the whole
 * year. Both are validated before use, so a `year` of `"banana"` is a 400 rather
 * than a `NaN` that filters every row out and renders a plausible-looking empty
 * dashboard.
 */
export const getDashboard: RequestHandler = (req, res, next) => {
  try {
    const body: ApiSuccess<PeriodSummary> = {
      status: 'ok',
      data: getPeriodSummary({
        year: requireYear(req.query.year),
        month: optionalMonth(req.query.month),
      }),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
