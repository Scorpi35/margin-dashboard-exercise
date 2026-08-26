/**
 * The vocabulary both workspaces share. Types only — `shared/` imports nothing
 * from `backend/` or `frontend/` and ships no runtime code.
 */

/** Every successful response is wrapped in this envelope. */
export interface ApiSuccess<T> {
  readonly status: 'ok';
  readonly data: T;
}

/** Every failed response is wrapped in this envelope by `errorHandler`. */
export interface ApiFailure {
  readonly status: 'error';
  readonly message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Payload of `GET /api/health`. */
export interface HealthStatus {
  readonly service: string;
  readonly uptimeSeconds: number;
}
