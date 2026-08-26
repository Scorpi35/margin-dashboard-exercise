import type { RequestHandler } from 'express';

import type { ApiSuccess, HealthStatus } from '@shared/types';

import { hasIngestedData } from '../services/ingest.service';

/**
 * Liveness probe, and the answer to "is there anything to show yet".
 *
 * `hasData` exists so a page can tell an empty database apart from a period with
 * no work logged in it: the first wants an upload prompt, the second a "nothing
 * logged" note. The pages that consume it arrive with the dashboard.
 */
export const getHealth: RequestHandler = (_req, res, next) => {
  try {
    const body: ApiSuccess<HealthStatus> = {
      status: 'ok',
      data: { hasData: hasIngestedData() },
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
