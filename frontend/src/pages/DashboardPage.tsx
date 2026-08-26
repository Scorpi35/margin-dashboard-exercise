import { useEffect, useRef, useState } from 'react';

import type { AppMeta, PeriodSummary } from '@shared/types';

import DataGapsBanner from '@/components/DataGapsBanner';
import NoDataYet from '@/components/NoDataYet';
import PeriodFilter from '@/components/PeriodFilter';
import StatCard, { type StatTone } from '@/components/StatCard';
import { usePeriodFilter } from '@/hooks/usePeriodFilter';
import { ApiError, getDashboard, getMeta } from '@/lib/api';
import { EM_DASH, formatAED, formatHours, formatPct, monthName } from '@/lib/format';

/**
 * The page a director opens on Monday morning: what the agency cost, what it
 * earned, and whether that was a margin.
 *
 * Every figure is the backend engine's. Nothing here derives a rate or a cost —
 * a number that is not in the response is added to the response, not computed
 * in a component.
 */
export default function DashboardPage() {
  const { year, month, setPeriod } = usePeriodFilter();
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestSummaryRequest = useRef(0);

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

  // The period lives in the URL, so a view is reproducible from a link. When the
  // address bar carries no year, adopt the most recent one that has data and
  // write it back — an implicit period the URL does not show is not linkable.
  const availableYears = meta?.years ?? [];
  const selectedYear = year ?? availableYears.at(-1) ?? null;

  useEffect(() => {
    if (year === null && selectedYear !== null) setPeriod(selectedYear, month);
  }, [year, month, selectedYear, setPeriod]);

  useEffect(() => {
    if (selectedYear === null) return;

    const requestId = latestSummaryRequest.current + 1;
    latestSummaryRequest.current = requestId;

    getDashboard(selectedYear, month)
      .then((loaded) => {
        if (latestSummaryRequest.current !== requestId) return;
        setSummary(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        if (latestSummaryRequest.current !== requestId) return;
        setError(describe(err, 'Could not load the dashboard.'));
      });

    return () => {
      latestSummaryRequest.current += 1;
    };
  }, [selectedYear, month]);

  if (error !== null) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">Dashboard</h1>
        <p role="alert" className="text-negative mt-4 text-sm">
          {error}
        </p>
      </section>
    );
  }

  if (meta === null) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">Dashboard</h1>
        <p className="text-ink-muted mt-4 text-sm">Loading…</p>
      </section>
    );
  }

  if (availableYears.length === 0) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">Dashboard</h1>
        <p className="text-ink-muted mt-1 mb-6 text-sm">
          Company-wide cost, revenue and margin for the selected period.
        </p>
        <NoDataYet />
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-ink text-xl font-semibold">Dashboard</h1>
          <p className="text-ink-muted mt-1 text-sm">{periodLabel(selectedYear, month)}</p>
        </div>

        {selectedYear !== null && (
          <PeriodFilter
            years={availableYears}
            year={selectedYear}
            month={month}
            onChange={setPeriod}
          />
        )}
      </div>

      <div className="mt-6">
        {summary === null ? (
          <p className="text-ink-muted text-sm">Loading…</p>
        ) : (
          <>
            <DataGapsBanner
              unpricedRefCodes={summary.unpricedRefCodes}
              missingSalaryEmployees={summary.missingSalaryEmployees}
            />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard label="Total hours" value={formatHours(summary.totalHours)} />
              <StatCard
                label="Billable hours"
                value={formatHours(summary.billableHours)}
                detail={`${formatPct(summary.productivityPct)} of hours logged`}
              />
              <StatCard label="Non-billable hours" value={formatHours(summary.nonBillableHours)} />
              <StatCard
                label="Cost"
                value={formatAED(summary.totalCost)}
                detail={`${formatAED(summary.totalSalaries)} salaries + ${formatAED(summary.totalOverhead)} overhead`}
              />
              <StatCard label="Revenue" value={formatAED(summary.totalRevenue)} />
              <StatCard
                label="Margin"
                value={formatPct(summary.marginPct)}
                detail={
                  summary.marginPct === null
                    ? 'No revenue in this period'
                    : `${formatAED(summary.totalProfit)} profit`
                }
                tone={marginTone(summary.marginPct)}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Neutral when there is no margin to colour — an em dash is neither good nor bad. */
function marginTone(marginPct: number | null): StatTone {
  if (marginPct === null) return 'neutral';

  return marginPct < 0 ? 'negative' : 'positive';
}

function periodLabel(year: number | null, month: number | null): string {
  if (year === null) return EM_DASH;

  return month === null ? `${year} · all months` : `${monthName(month)} ${year}`;
}

function describe(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}
