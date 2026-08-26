import type { Request, Response } from 'express';

import { describe, expect, it, vi } from 'vitest';

import { DatabaseUnavailableError } from '../../src/lib/db';
import { errorHandler, HttpError } from '../../src/middleware/errorHandler';

function respond(err: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = { method: 'GET', originalUrl: '/api/health' } as Request;

  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  errorHandler(err, req, { status, json } as unknown as Response, vi.fn());

  return { status: status.mock.calls[0]?.[0] as number, body: json.mock.calls[0]?.[0] };
}

/** What `express.json()` throws on a body it cannot parse. */
function bodyParseError(): Error {
  return Object.assign(new SyntaxError('Unexpected token } in JSON at position 1'), {
    type: 'entity.parse.failed',
    status: 400,
  });
}

/** What better-sqlite3 throws: an Error carrying a `SQLITE_*` code. */
function sqliteError(code: string): Error {
  return Object.assign(new Error('unable to open database file'), { code });
}

describe('errorHandler', () => {
  it('answers a body it could not parse with a 400, not a 500', () => {
    // A 500 says "try again", and the body will not parse on the second attempt
    // either. The validation helpers never see it — express.json throws first.
    const { status, body } = respond(bodyParseError());

    expect(status).toBe(400);
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/could not be read as JSON/i);
  });

  it('leaves a SyntaxError of our own as a 500', () => {
    // Only body-parser's own marker downgrades the status; a syntax error thrown
    // inside our code is still our fault.
    const { status } = respond(new SyntaxError('someone wrote bad code'));

    expect(status).toBe(500);
  });

  it('passes an HttpError through with its own status and message', () => {
    const { status, body } = respond(new HttpError(400, 'The "year" parameter is required.'));

    expect(status).toBe(400);
    expect(body).toEqual({ status: 'error', message: 'The "year" parameter is required.' });
  });

  it('hides an unexpected failure behind a friendly message', () => {
    const { status, body } = respond(new Error('connection pool exhausted at line 42'));

    expect(status).toBe(500);
    expect(body.message).toBe('Something went wrong. Please try again.');
    expect(body.message).not.toMatch(/line 42/);
  });

  it('reports a database failure as something the reader can act on', () => {
    // "Something went wrong, please try again" is a lie here: the connection is
    // broken until the process restarts, so retrying can only fail again.
    const { status, body } = respond(sqliteError('SQLITE_CANTOPEN'));

    expect(status).toBe(503);
    expect(body.message).toMatch(/database could not be read/i);
    expect(body.message).toMatch(/restart/i);
  });

  it('recognises any SQLITE_ code, not one specific failure', () => {
    for (const code of ['SQLITE_IOERR', 'SQLITE_READONLY', 'SQLITE_CORRUPT']) {
      expect(respond(sqliteError(code)).status).toBe(503);
    }
  });

  it('does not mistake an ordinary error carrying a code for a database failure', () => {
    expect(respond(Object.assign(new Error('nope'), { code: 'ENOENT' })).status).toBe(500);
  });

  it('shows the message when the database driver could not be loaded', () => {
    // These messages are ones we wrote and they name the fix — replacing them
    // with "Something went wrong" is how a setup problem reads as a code bug.
    const err = new DatabaseUnavailableError(
      'The database driver could not be loaded. This is Node 20.20.0, and the project needs Node 22.',
    );
    const { status, body } = respond(err);

    expect(status).toBe(503);
    expect(body.message).toMatch(/needs Node 22/);
  });

  it('never puts a data field on an error response', () => {
    expect(respond(new HttpError(404, 'Unknown endpoint')).body).not.toHaveProperty('data');
  });
});
