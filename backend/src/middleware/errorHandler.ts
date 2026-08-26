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
/**
 * A failure inside SQLite rather than in our own logic.
 *
 * Duck-typed on the driver's error shape so this module stays free of a
 * `better-sqlite3` import — the error handler should not depend on which database
 * happens to be underneath it.
 */
function isDatabaseError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof err.code === 'string' &&
    err.code.startsWith('SQLITE_')
  );
}

/**
 * A body `express.json()` could not read.
 *
 * It throws before any controller runs, so the hand-rolled validation never gets
 * the chance to say what was wrong. Left as the generic 500 it reads as "try
 * again", which is the one thing that cannot help: the body will not parse on the
 * second attempt either.
 *
 * Duck-typed on body-parser's own marker rather than on `SyntaxError`, so an
 * unrelated syntax error in our code is still the 500 it ought to be.
 */
function isMalformedBody(err: unknown): boolean {
  return (
    err instanceof Error &&
    'type' in err &&
    typeof err.type === 'string' &&
    err.type === 'entity.parse.failed'
  );
}

/**
 * The database could not be opened. The message is one we wrote and names the
 * fix, so it is shown rather than swallowed.
 */
function isDatabaseUnavailable(err: unknown): err is Error {
  return err instanceof Error && err.name === 'DatabaseUnavailableError';
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isHttpError = err instanceof HttpError;
  const malformedBody = !isHttpError && isMalformedBody(err);
  const unavailable = !isHttpError && !malformedBody && isDatabaseUnavailable(err);
  const databaseFailed = !isHttpError && !unavailable && !malformedBody && isDatabaseError(err);

  // A dead database is still our problem, but it is a specific one the reader can
  // act on. Left as the generic 500 it says "try again", and trying again never
  // works — the connection is broken until the process restarts.
  const statusCode = isHttpError
    ? err.statusCode
    : malformedBody
      ? 400
      : unavailable || databaseFailed
        ? 503
        : 500;
  const message = isHttpError
    ? err.message
    : malformedBody
      ? 'The request body could not be read as JSON.'
      : unavailable
        ? err.message
        : databaseFailed
          ? 'The database could not be read. If data/app.db was deleted or replaced while the ' +
            'server was running, restart it — the open connection does not survive that.'
          : 'Something went wrong. Please try again.';

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
