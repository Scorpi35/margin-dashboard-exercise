import type { RequestHandler } from 'express';

import type { ApiSuccess, CategoryBreakdown } from '@shared/types';

import { getCategoryBreakdown } from '../services/category.service';
import { optionalMonth, requireYear } from './validation';

/** `GET /api/categories?year&month` — hours per category, largest first. */
export const getCategories: RequestHandler = (req, res, next) => {
  try {
    const body: ApiSuccess<CategoryBreakdown> = {
      status: 'ok',
      data: getCategoryBreakdown({
        year: requireYear(req.query.year),
        month: optionalMonth(req.query.month),
      }),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
