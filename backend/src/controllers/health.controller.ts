import type { RequestHandler } from 'express';

import type { ApiSuccess, HealthStatus } from '@shared/types';

/** Liveness probe. Proves the Vite dev proxy reaches Express. */
export const getHealth: RequestHandler = (_req, res, next) => {
  try {
    const body: ApiSuccess<HealthStatus> = {
      status: 'ok',
      data: {
        service: 'margin-dashboard-api',
        uptimeSeconds: Math.round(process.uptime()),
      },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
};
