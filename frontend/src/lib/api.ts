import type {
  ApiResponse,
  HealthStatus,
  UploadHistoryEntry,
  UploadResult,
  UploadType,
} from '@shared/types';

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

async function unwrap<T>(response: Response): Promise<T> {
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

async function apiGet<T>(path: string): Promise<T> {
  return unwrap<T>(
    await fetch(`${API_BASE_URL}${path}`, { headers: { Accept: 'application/json' } }),
  );
}

/**
 * Posts a file as multipart form data.
 *
 * `Content-Type` is deliberately not set — the browser has to add it itself so it
 * can include the multipart boundary, and setting it by hand produces a body the
 * server cannot split.
 */
async function apiPostFile<T>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData();
  form.append(field, file);

  return unwrap<T>(
    await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: form,
    }),
  );
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

/**
 * `POST /api/uploads/:type` — the file replaces every month it contains and
 * leaves the rest of the year alone.
 */
export function uploadSpreadsheet(type: UploadType, file: File): Promise<UploadResult> {
  return apiPostFile<UploadResult>(`/uploads/${type}`, 'file', file);
}

/** `GET /api/uploads` — what has been ingested, newest first. */
export function getUploadHistory(): Promise<UploadHistoryEntry[]> {
  return apiGet<UploadHistoryEntry[]>('/uploads');
}
