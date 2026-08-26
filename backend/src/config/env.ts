/**
 * The only place `process.env` is read. Everything else imports `env`.
 */
export interface Env {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly port: number;
}

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return parsed;
}

function readNodeEnv(raw: string | undefined): Env['nodeEnv'] {
  return raw === 'production' || raw === 'test' ? raw : 'development';
}

export const env: Env = {
  nodeEnv: readNodeEnv(process.env.NODE_ENV),
  port: readPort(process.env.PORT, 4000),
};
