import { useEffect, useState } from 'react';

import type { HealthStatus } from '@shared/types';

import { apiGet, ApiError } from '@/lib/api';

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiGet<HealthStatus>('/health')
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not reach the API.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Margin Dashboard</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Scaffold only — the dashboard lands in later issues.
      </p>

      <section
        className="mt-6 rounded-lg border p-4"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <h2 className="text-sm font-medium">API</h2>
        {error !== null ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--color-negative)' }}>
            {error}
          </p>
        ) : health === null ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Checking…
          </p>
        ) : (
          <p className="mt-1 text-sm" style={{ color: 'var(--color-positive)' }}>
            {health.service} is up — <span className="tabular">{health.uptimeSeconds}</span>s uptime
          </p>
        )}
      </section>
    </main>
  );
}
