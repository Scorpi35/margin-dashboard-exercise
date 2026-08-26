import type {
  ApiResponse,
  AppMeta,
  HealthStatus,
  PeriodSummary,
  ProductivityRow,
  ProjectFinancials,
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
 * The query string for a period.
 *
 * A `null` month is omitted rather than sent empty, so the URL reads as "the
 * whole year" instead of a month someone forgot to fill in. Stated once here
 * because every filtered endpoint needs the same rule.
 */
function periodQuery(year: number, month: number | null): string {
  const query = new URLSearchParams({ year: String(year) });
  if (month !== null) query.set('month', String(month));

  return query.toString();
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

/**
 * `GET /api/dashboard` — totals for a period.
 *
 * `month` of `null` means the whole year. The parameter is omitted rather than
 * sent empty, so the URL says what it means.
 */
export function getDashboard(year: number, month: number | null): Promise<PeriodSummary> {
  return apiGet<PeriodSummary>(`/dashboard?${periodQuery(year, month)}`);
}

/** `GET /api/meta` — the years, categories and settings the filters are built from. */
export function getMeta(): Promise<AppMeta> {
  return apiGet<AppMeta>('/meta');
}

/** `GET /api/projects` — every project with hours in the period, loss-making first. */
export function getProjects(year: number, month: number | null): Promise<ProjectFinancials[]> {
  return apiGet<ProjectFinancials[]>(`/projects?${periodQuery(year, month)}`);
}

/**
 * `GET /api/projects/:refCode` — one project over its whole life.
 *
 * Takes no period: a price covers the whole engagement, so the margin only means
 * anything against all of the work done on it.
 */
export function getProject(refCode: string): Promise<ProjectFinancials> {
  return apiGet<ProjectFinancials>(`/projects/${encodeURIComponent(refCode)}`);
}

/** `GET /api/productivity` — billable share of each person's time, most billable first. */
export function getProductivity(year: number, month: number | null): Promise<ProductivityRow[]> {
  return apiGet<ProductivityRow[]>(`/productivity?${periodQuery(year, month)}`);
}
