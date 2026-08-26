import type { CategoryBreakdown } from '@shared/types';

import { formatBarWidth, formatHours, formatPct } from '@/lib/format';

/**
 * Where the hours went, largest category first.
 *
 * Bars are scaled against the largest row rather than against 100%, so the
 * smaller categories stay legible — at 63% of the year, Projects would otherwise
 * flatten everything else into a sliver.
 *
 * Billable work is drawn in the accent colour and internal time in grey, but the
 * word is printed too: colour is never the only thing carrying the distinction.
 */

interface CategoryTableProps {
  readonly breakdown: CategoryBreakdown;
}

export default function CategoryTable({ breakdown }: CategoryTableProps) {
  const { rows, totalHours, billableHours, nonBillableHours } = breakdown;

  // Keyed on the total rather than on the row count, so a period whose rows all
  // sit at zero reads the same as one with no rows at all. Both are "no hours
  // were logged", and rendering them differently would suggest a difference.
  if (totalHours === 0) {
    return <p className="text-ink-muted text-sm">No hours were logged in this period.</p>;
  }

  // The tallest row, to scale the bars against. `reduce` rather than a spread so
  // the guard above is not the only thing keeping it safe on a large array.
  const largest = rows.reduce((tallest, row) => Math.max(tallest, row.hours), 0);

  return (
    <>
      <p className="text-ink-muted mb-4 text-sm">
        <span className="tabular text-ink font-medium">{formatHours(totalHours)}</span> hours logged
        · <span className="tabular text-ink font-medium">{formatHours(billableHours)}</span>{' '}
        billable ·{' '}
        <span className="tabular text-ink font-medium">{formatHours(nonBillableHours)}</span>{' '}
        internal
      </p>

      <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
        <table className="w-full min-w-125 text-sm">
          <thead>
            <tr className="border-line text-ink-muted border-b text-left">
              <th scope="col" className="px-4 py-2 font-medium">
                Category
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Billable
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Hours
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Share
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                &nbsp;
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-line border-b last:border-b-0">
                {/* Category names come from the spreadsheet and can be any length;
                    truncating keeps one long name from stretching the table. */}
                <td className="text-ink max-w-56 truncate px-4 py-2" title={row.category}>
                  {row.category}
                </td>
                <td className="text-ink-muted px-4 py-2 whitespace-nowrap">
                  {row.isBillable ? 'Billable' : 'Internal'}
                </td>
                <td className="tabular text-ink px-4 py-2 text-right">{formatHours(row.hours)}</td>
                <td className="tabular text-ink px-4 py-2 text-right">{formatPct(row.hoursPct)}</td>
                <td className="w-full px-4 py-2">
                  <div
                    className="bg-paper-sunken h-2 overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    <div
                      className={`h-full rounded-full ${row.isBillable ? 'bg-accent' : 'bg-ink-faint'}`}
                      style={{ width: formatBarWidth(row.hours, largest) }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
