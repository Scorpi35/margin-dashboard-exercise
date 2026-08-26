import type { ApiResponse } from '@shared/types';

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

/**
 * The single entry point for server calls. Components never call `fetch`.
 */
export async function apiGet<T>(path: string): Promise<T> {
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
