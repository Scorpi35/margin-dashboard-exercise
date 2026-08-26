import type { ApiResponse, HealthStatus } from '@shared/types';

/**
 * The only place the app talks to the server.
 *
 * `apiGet` is deliberately not exported: the way out of this module is a named
 * function per endpoint, typed against `shared/`, so a component can never
 * assemble a URL or widen a nullable field on its way in. No `fetch` anywhere
 * else, ever.
 */

/** Thrown for any non-2xx response, carrying the API's own message. */
export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

// Relative in development: the Vite dev server proxies /api to Express.
const API_BASE_URL = '/api';

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
  });

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(response.status, 'The server returned a response we could not read.');
  }

  if (!response.ok || body.status === 'error') {
    const message = body.status === 'error' ? body.message : 'The request failed.';
    throw new ApiError(response.status, message);
  }

  return body.data;
}

/**
 * `GET /api/health` — whether anything has been ingested yet.
 *
 * No caller yet; the pages that branch on an empty database are still
 * placeholders. Kept here because the endpoint's client belongs with the rest of
 * them, not scattered into whichever page needs it first.
 */
export function getHealth(): Promise<HealthStatus> {
  return apiGet<HealthStatus>('/health');
}
