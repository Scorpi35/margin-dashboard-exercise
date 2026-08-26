import type { RequestHandler } from 'express';

import type { ApiSuccess, Settings } from '@shared/types';

import { HttpError } from '../middleware/errorHandler';
import { getSettings, saveSettings } from '../services/settings.service';
import { requireBillableCategories, requireMonthlyOverhead } from './validation';

/** `GET /api/settings` — the two user-configurable inputs to the cost model. */
export const readSettings: RequestHandler = (_req, res, next) => {
  try {
    const body: ApiSuccess<Settings> = { status: 'ok', data: getSettings() };

    res.json(body);
  } catch (err) {
    next(err);
  }
};

/**
 * `PUT /api/settings` — replaces both settings.
 *
 * A whole-document PUT rather than a patch: the billable list is a selection, and
 * "the categories I did not send" is exactly how a user unchecks one. Both fields
 * are validated here before the service sees them, so a `NaN` overhead can never
 * reach the indirect pool.
 */
export const writeSettings: RequestHandler = (req, res, next) => {
  try {
    const submitted: unknown = req.body;
    if (typeof submitted !== 'object' || submitted === null || Array.isArray(submitted)) {
      throw new HttpError(
        400,
        'A settings object with "billableCategories" and "monthlyOverhead" is required.',
      );
    }

    const { billableCategories, monthlyOverhead } = submitted as Record<string, unknown>;
    const body: ApiSuccess<Settings> = {
      status: 'ok',
      data: saveSettings({
        billableCategories: requireBillableCategories(billableCategories),
        monthlyOverhead: requireMonthlyOverhead(monthlyOverhead),
      }),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
