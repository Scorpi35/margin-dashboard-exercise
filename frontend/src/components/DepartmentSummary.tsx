import { Link } from 'react-router-dom';

import type { DepartmentBreakdown } from '@shared/types';

import { formatAED, formatBarWidth, formatHours, formatPct } from '@/lib/format';

/**
 * Where the payroll goes, by department — the dashboard's way into the
 * drill-down.
 *
 * Cost here is salary, not hours at a loaded rate, so these rows add up to
 * payroll rather than to the period's total cost: overhead belongs to no
 * department.
 */

interface DepartmentSummaryProps {
  readonly breakdown: DepartmentBreakdown;
  /** Carried onto each link so the drill-down opens on the same period. */
  readonly search: string;
}

export default function DepartmentSummary({ breakdown, search }: DepartmentSummaryProps) {
  const { rows, totalCost } = breakdown;

  if (rows.length === 0) return null;

  const largest = rows.reduce((tallest, row) => Math.max(tallest, row.cost), 0);

  return (
    <section className="mt-8">
      <h2 className="text-ink text-sm font-semibold">By department</h2>
      <p className="text-ink-muted mt-1 mb-3 text-xs">
        Salaries of the people in each. Overhead is company-wide and is not split across
        departments, so these add up to {formatAED(totalCost)} rather than to total cost.
      </p>

      <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
        <table className="w-full min-w-125 text-sm">
          <thead>
            <tr className="border-line text-ink-muted border-b text-left">
              <th scope="col" className="px-4 py-2 font-medium">
                Department
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                People
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Hours
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Billable
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Salaries
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                &nbsp;
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.department}
                className="border-line hover:bg-paper-sunken border-b last:border-b-0"
              >
                <td className="max-w-48 truncate px-4 py-2" title={row.department}>
                  <Link
                    to={`/departments/${encodeURIComponent(row.department)}${search}`}
                    className="text-accent hover:underline"
                  >
                    {row.department}
                  </Link>
                </td>
                <td className="tabular text-ink px-4 py-2 text-right">{row.headcount}</td>
                <td className="tabular text-ink px-4 py-2 text-right">
                  {formatHours(row.totalHours)}
                </td>
                <td className="tabular text-ink-muted px-4 py-2 text-right">
                  {formatPct(row.productivityPct)}
                </td>
                <td className="tabular text-ink px-4 py-2 text-right">{formatAED(row.cost)}</td>
                <td className="w-full px-4 py-2">
                  <div
                    className="bg-paper-sunken h-2 overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    <div
                      className="bg-accent h-full rounded-full"
                      style={{ width: formatBarWidth(row.cost, largest) }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
