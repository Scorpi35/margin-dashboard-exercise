import type { ReactNode } from 'react';

import type { MonthNumber } from '@shared/types';

import NoDataYet from '@/components/NoDataYet';
import PeriodFilter from '@/components/PeriodFilter';
import { formatPeriod } from '@/lib/format';

/**
 * The frame every period-filtered page sits in: heading, period label, filter,
 * and the four states each of them has to handle — loading the filters, an empty
 * database, a failed request, and the data itself.
 *
 * Kept together so the pages differ only in what they render, not in how they
 * decide what to render.
 */

interface PeriodPageProps<T> {
  readonly title: string;
  /** Shown beside the period label, and alone in the empty state. */
  readonly description: string;
  readonly years: readonly number[];
  readonly year: number | null;
  readonly month: MonthNumber | null;
  readonly onPeriodChange: (year: number, month: MonthNumber | null) => void;
  /** `null` until the filters have loaded. */
  readonly ready: boolean;
  readonly error: string | null;
  readonly data: T | null;
  readonly children: (data: T) => ReactNode;
  /** Appended to the period label, e.g. "loss-making first". */
  readonly labelSuffix?: string;
}

export default function PeriodPage<T>({
  title,
  description,
  years,
  year,
  month,
  onPeriodChange,
  ready,
  error,
  data,
  children,
  labelSuffix,
}: PeriodPageProps<T>) {
  if (error !== null) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">{title}</h1>
        <p role="alert" className="text-negative mt-4 text-sm">
          {error}
        </p>
      </section>
    );
  }

  if (!ready) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">{title}</h1>
        <p className="text-ink-muted mt-4 text-sm">Loading…</p>
      </section>
    );
  }

  // No years at all means nothing has been ingested — a different claim from a
  // period in which the agency did no work.
  if (years.length === 0) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">{title}</h1>
        <p className="text-ink-muted mt-1 mb-6 text-sm">{description}</p>
        <NoDataYet />
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-ink text-xl font-semibold">{title}</h1>
          <p className="text-ink-muted mt-1 text-sm">
            {formatPeriod(year, month)}
            {labelSuffix === undefined ? '' : ` · ${labelSuffix}`}
          </p>
        </div>

        {year !== null && (
          <PeriodFilter years={years} year={year} month={month} onChange={onPeriodChange} />
        )}
      </div>

      <div className="mt-6">
        {data === null ? <p className="text-ink-muted text-sm">Loading…</p> : children(data)}
      </div>
    </section>
  );
}
