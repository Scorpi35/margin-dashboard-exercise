import { useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import type { MonthNumber } from '@shared/types';

import StatCard from '@/components/StatCard';
import { usePeriodData } from '@/hooks/usePeriodData';
import { getDepartment } from '@/lib/api';
import { formatAED, formatHours, formatPct, formatPeriod } from '@/lib/format';

/**
 * Everyone in one department, with their hours and what they were paid.
 *
 * Cost is salary. Charging the department's hours at a loaded rate would count
 * the indirect pool twice, and the figure would stop reconciling with payroll.
 */
export default function DepartmentDetailPage() {
  const { department = '' } = useParams();
  const [searchParams] = useSearchParams();

  // Through the shared hook, so a URL with no `?year=` adopts the most recent
  // year that has data rather than waiting forever for a period to appear. The
  // department is passed as the resource key: without it, moving between
  // departments would leave the previous one's figures on screen.
  const period = usePeriodData(
    useCallback(
      (year: number, month: MonthNumber | null) => getDepartment(department, year, month),
      [department],
    ),
    'Could not load the department.',
    department,
  );

  const search = searchParams.toString() === '' ? '' : `?${searchParams.toString()}`;
  const backLink = (
    <Link to={`/${search}`} className="text-accent text-sm hover:underline">
      ← Dashboard
    </Link>
  );

  if (period.error !== null) {
    const notFound = period.errorStatus === 404;

    return (
      <section>
        {backLink}
        <h1 className="text-ink mt-3 text-xl font-semibold">
          {notFound ? 'Department not found' : 'Department'}
        </h1>
        <p role="alert" className="text-ink-muted mt-2 text-sm">
          {notFound
            ? `Nobody in this period belongs to "${department}". Try another period, or check the spelling.`
            : period.error}
        </p>
      </section>
    );
  }

  const row = period.data;

  if (row === null) {
    return (
      <section>
        {backLink}
        <p className="text-ink-muted mt-4 text-sm">Loading…</p>
      </section>
    );
  }

  return (
    <section>
      {backLink}

      <div className="mt-3">
        <h1 className="text-ink text-xl font-semibold break-words">{row.department}</h1>
        <p className="text-ink-muted mt-1 text-sm">
          {formatPeriod(period.year, period.month)} · {row.headcount}{' '}
          {row.headcount === 1 ? 'person' : 'people'}
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Headcount" value={String(row.headcount)} />
        <StatCard label="Total hours" value={formatHours(row.totalHours)} />
        <StatCard
          label="Billable hours"
          value={formatHours(row.billableHours)}
          detail={
            row.productivityPct === null
              ? 'No hours logged in this period'
              : `${formatPct(row.productivityPct)} of hours logged`
          }
        />
        <StatCard
          label="Salaries"
          value={formatAED(row.cost)}
          detail="Across all work, not one project. Overhead is not attributed."
        />
      </div>

      <div className="border-line bg-paper-raised mt-8 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-125 text-sm">
          <caption className="text-ink border-line border-b px-4 py-2 text-left text-sm font-semibold">
            People
          </caption>
          <thead>
            <tr className="border-line text-ink-muted border-b text-left">
              <th scope="col" className="px-4 py-2 font-medium">
                Employee
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Total hours
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Billable hours
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Productivity
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Salary
              </th>
            </tr>
          </thead>
          <tbody>
            {row.employees.map((employee) => (
              <tr key={employee.employeeNo} className="border-line border-b last:border-b-0">
                <td className="px-4 py-2">
                  <span className="text-ink block">{employee.employeeName}</span>
                  <span className="text-ink-faint text-xs">{employee.designation}</span>
                </td>
                <td className="tabular text-ink px-4 py-2 text-right">
                  {formatHours(employee.totalHours)}
                </td>
                <td className="tabular text-ink px-4 py-2 text-right">
                  {formatHours(employee.billableHours)}
                </td>
                <td className="tabular text-ink px-4 py-2 text-right">
                  {formatPct(employee.productivityPct)}
                </td>
                {/* An em dash, not AED 0 — nobody works for nothing, so a missing
                    salary row is a gap rather than a figure. */}
                <td className="tabular text-ink px-4 py-2 text-right">
                  {formatAED(employee.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
