import type { ErrorRequestHandler, RequestHandler } from 'express';

import type { ApiFailure } from '@shared/types';

/** An error with an intended HTTP status. Anything else becomes a 500. */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Unknown endpoint: ${req.method} ${req.originalUrl}`));
};

/**
 * Registered last. The only place an error response is written — services and
 * controllers throw, they never respond.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isHttpError = err instanceof HttpError;
  const statusCode = isHttpError ? err.statusCode : 500;
  const message = isHttpError ? err.message : 'Something went wrong. Please try again.';

  // A 4xx is the caller's mistake and needs no stack trace; a 5xx is ours and does.
  const context = `${req.method} ${req.originalUrl} -> ${statusCode}`;
  if (statusCode >= 500) {
    console.error(`[error] ${context}`, err);
  } else {
    console.warn(`[warn] ${context}: ${message}`);
  }

  const body: ApiFailure = { status: 'error', message };
  res.status(statusCode).json(body);
};
