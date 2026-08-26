import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { MonthNumber } from '@shared/types';

/**
 * The selected period, held in the URL rather than in React state.
 *
 * Filter state lives in the address bar so any view is reproducible from a link
 * and survives a refresh — pasting a filtered URL into a new tab has to show the
 * same numbers. Every filtered page shares this hook.
 */

export interface PeriodFilter {
  /** `null` until a year is known — on a fresh database there is nothing to select. */
  readonly year: number | null;
  /** `null` means the whole year. */
  readonly month: MonthNumber | null;
  readonly setPeriod: (year: number, month: MonthNumber | null) => void;
}

export function usePeriodFilter(): PeriodFilter {
  const [searchParams, setSearchParams] = useSearchParams();

  const setPeriod = useCallback(
    (year: number, month: MonthNumber | null) => {
      const next = new URLSearchParams(searchParams);
      next.set('year', String(year));

      // Absent rather than empty: the URL should read as "the whole year", not as
      // a month someone forgot to fill in.
      if (month === null) next.delete('month');
      else next.set('month', String(month));

      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return {
    year: integerParam(searchParams.get('year'), 1970, 2199),
    month: integerParam(searchParams.get('month'), 1, 12),
    setPeriod,
  };
}

/**
 * A whole number inside a range, or `null`.
 *
 * Anything unreadable is treated as absent rather than coerced — a hand-edited
 * `?year=banana` should fall back to the default, not filter every row out and
 * render an empty dashboard that looks like a real answer.
 */
function integerParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;

  const value = Number(raw);

  return value >= min && value <= max ? value : null;
}
