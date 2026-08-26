import type { RequestHandler } from 'express';

import type { ApiSuccess, AppMeta } from '@shared/types';

import { getAppMeta } from '../services/dashboard.service';

/** `GET /api/meta` — the years, categories and settings the filters are built from. */
export const getMeta: RequestHandler = (_req, res, next) => {
  try {
    const body: ApiSuccess<AppMeta> = { status: 'ok', data: getAppMeta() };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
