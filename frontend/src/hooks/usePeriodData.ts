import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppMeta, MonthNumber } from '@shared/types';

import { usePeriodFilter } from '@/hooks/usePeriodFilter';
import { ApiError, getMeta } from '@/lib/api';

/**
 * Everything a period-filtered page needs: the years it can offer, the period
 * the URL is asking for, and the data for that period.
 *
 * Shared because every filtered page wants the same four behaviours, and four
 * copies of them would drift: adopt the most recent year with data when the URL
 * names none, write that choice into the address bar, ignore a response that a
 * newer request has superseded, and tell an empty database apart from an empty
 * period.
 */

export interface PeriodData<T> {
  /** `null` while the filters are still loading. */
  readonly meta: AppMeta | null;
  readonly years: readonly number[];
  /** The period in the URL, or the default adopted from `meta`. */
  readonly year: number | null;
  readonly month: MonthNumber | null;
  readonly setPeriod: (year: number, month: MonthNumber | null) => void;
  /** `null` while the current period's data is in flight. */
  readonly data: T | null;
  readonly error: string | null;
}

export function usePeriodData<T>(
  load: (year: number, month: MonthNumber | null) => Promise<T>,
  errorFallback: string,
): PeriodData<T> {
  const { year, month, setPeriod } = usePeriodFilter();
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the fetch effect depends only on the period. A caller that
  // passes an inline arrow would otherwise refetch on every render.
  const loadRef = useRef(load);
  loadRef.current = load;

  const latestRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;

    getMeta()
      .then((loaded) => {
        if (!cancelled) setMeta(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describe(err, 'Could not load the filters.'));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const years = meta?.years ?? [];
  const selectedYear = year ?? years.at(-1) ?? null;

  useEffect(() => {
    // Replace rather than push: the reader did not choose this period, so leaving
    // it in the history would make Back appear to do nothing.
    if (year === null && selectedYear !== null) {
      setPeriod(selectedYear, month, { replace: true });
    }
  }, [year, month, selectedYear, setPeriod]);

  useEffect(() => {
    if (selectedYear === null) return;

    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    loadRef
      .current(selectedYear, month)
      .then((loaded) => {
        if (latestRequest.current !== requestId) return;
        setData(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        if (latestRequest.current !== requestId) return;
        setError(describe(err, errorFallback));
      });

    // Runs when the period changes as well as on unmount, and that is the point:
    // bumping the counter is what makes the request above stale, so a slow
    // response for the previous period cannot land after a newer one.
    return () => {
      latestRequest.current += 1;
    };
  }, [selectedYear, month, errorFallback]);

  const choosePeriod = useCallback(
    (nextYear: number, nextMonth: MonthNumber | null) => setPeriod(nextYear, nextMonth),
    [setPeriod],
  );

  return { meta, years, year: selectedYear, month, setPeriod: choosePeriod, data, error };
}

/** An ApiError carries a message written for a reader; anything else does not. */
function describe(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}
