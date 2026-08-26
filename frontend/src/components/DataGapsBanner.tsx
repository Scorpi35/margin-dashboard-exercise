import type { MissingSalaryEmployee } from '@shared/types';

import { monthName } from '@/lib/format';

/**
 * The gaps behind the numbers.
 *
 * A missing salary or an unpriced ref code shows up as an em dash in a cell, and
 * a dash the reader cannot account for is worse than no number at all. Saying why
 * is the page's job, not the cell's.
 */

interface DataGapsBannerProps {
  readonly unpricedRefCodes: readonly string[];
  readonly missingSalaryEmployees: readonly MissingSalaryEmployee[];
}

export default function DataGapsBanner({
  unpricedRefCodes,
  missingSalaryEmployees,
}: DataGapsBannerProps) {
  if (unpricedRefCodes.length === 0 && missingSalaryEmployees.length === 0) return null;

  // One person can be missing several months; name them once each.
  const people = [...new Set(missingSalaryEmployees.map((employee) => employee.employeeName))];

  return (
    <div
      role="status"
      className="border-warning bg-warning-soft mb-6 rounded-lg border p-4 text-sm"
    >
      <p className="text-warning font-medium">Some figures are incomplete.</p>
      <ul className="text-ink-muted mt-2 space-y-1 text-xs">
        {unpricedRefCodes.length > 0 && (
          <li>
            <span className="text-ink font-medium">
              {unpricedRefCodes.length} ref code{unpricedRefCodes.length === 1 ? '' : 's'} with no
              price
            </span>{' '}
            — {unpricedRefCodes.join(', ')}. Their revenue and margin are shown as —, and they are
            left out of total revenue.
          </li>
        )}
        {missingSalaryEmployees.length > 0 && (
          <li>
            <span className="text-ink font-medium">
              {people.length} employee{people.length === 1 ? '' : 's'} with no salary
            </span>{' '}
            — {people.join(', ')}. Their hours cost nothing, so cost is understated. Affected:{' '}
            {missingSalaryEmployees
              .map((employee) => `${monthName(employee.month)} ${employee.year}`)
              .filter((period, index, all) => all.indexOf(period) === index)
              .join(', ')}
            .
          </li>
        )}
      </ul>
    </div>
  );
}
