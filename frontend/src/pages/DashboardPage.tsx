import { useSearchParams } from 'react-router-dom';

import type { DepartmentBreakdown, PeriodSummary } from '@shared/types';

import DataGapsBanner from '@/components/DataGapsBanner';
import DepartmentSummary from '@/components/DepartmentSummary';
import PeriodPage from '@/components/PeriodPage';
import StatCard, { type StatTone } from '@/components/StatCard';
import { usePeriodData } from '@/hooks/usePeriodData';
import { getDashboard, getDepartments } from '@/lib/api';
import { formatAED, formatHours, formatPct } from '@/lib/format';

/**
 * The page a director opens on Monday morning: what the agency cost, what it
 * earned, and whether that was a margin.
 *
 * Every figure is the backend engine's. Nothing here derives a rate or a cost —
 * a number that is not in the response is added to the response, not computed in
 * a component.
 */
/**
 * Both payloads for one period. `usePeriodData` keeps the loader in a ref, so a
 * composed one like this does not refetch on every render.
 */
function loadDashboard(
  year: number,
  month: number | null,
): Promise<[PeriodSummary, DepartmentBreakdown]> {
  return Promise.all([getDashboard(year, month), getDepartments(year, month)]);
}

export default function DashboardPage() {
  const period = usePeriodData(loadDashboard, 'Could not load the dashboard.');
  const [searchParams] = useSearchParams();
  const search = searchParams.toString() === '' ? '' : `?${searchParams.toString()}`;

  return (
    <PeriodPage<[PeriodSummary, DepartmentBreakdown]>
      title="Dashboard"
      description="Company-wide cost, revenue and margin for the selected period."
      years={period.years}
      year={period.year}
      month={period.month}
      onPeriodChange={period.setPeriod}
      ready={period.meta !== null}
      error={period.error}
      data={period.data}
    >
      {([summary, departments]) =>
        isEmpty(summary) ? (
          <p className="text-ink-muted text-sm">
            No hours were logged in this period, and no overhead was entered against it. Pick
            another month, or upload the spreadsheets that cover it.
          </p>
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
                detail={
                  summary.productivityPct === null
                    ? 'No hours logged in this period'
                    : `${formatPct(summary.productivityPct)} of hours logged`
                }
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

            <DepartmentSummary breakdown={departments} search={search} />
          </>
        )
      }
    </PeriodPage>
  );
}

/**
 * A period with nothing in it at all.
 *
 * Keyed on cost and revenue as well as hours, not on hours alone: overhead is
 * costed for a month even when no rows have been ingested for it, so a month
 * carrying 5,000 of overhead and no timesheet has a real cost figure and has to
 * keep its cards. Six cards reading AED 0 say "the agency did nothing" with the
 * same confidence they would report a real figure.
 */
function isEmpty(summary: PeriodSummary): boolean {
  return summary.totalHours === 0 && summary.totalCost === 0 && summary.totalRevenue === 0;
}

/** Neutral when there is no margin to colour — an em dash is neither good nor bad. */
function marginTone(marginPct: number | null): StatTone {
  if (marginPct === null) return 'neutral';

  return marginPct < 0 ? 'negative' : 'positive';
}
