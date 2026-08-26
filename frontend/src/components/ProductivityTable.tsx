import type { ProductivityRow } from '@shared/types';

import { formatBarWidth, formatHours, formatPct } from '@/lib/format';

/**
 * Billable share of each person's logged time, most productive first.
 *
 * The bar is a second reading of the same number, never the only one — the
 * percentage sits beside it, so the figure survives being printed, or read by
 * someone who cannot distinguish the fill from the track.
 */

interface ProductivityTableProps {
  readonly rows: readonly ProductivityRow[];
}

export default function ProductivityTable({ rows }: ProductivityTableProps) {
  if (rows.length === 0) {
    return <p className="text-ink-muted text-sm">Nobody logged any hours in this period.</p>;
  }

  return (
    <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-line text-ink-muted border-b text-left">
            <th scope="col" className="px-4 py-2 font-medium">
              Employee
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Department
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Total hours
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Billable hours
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Productivity
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.employeeNo} className="border-line border-b last:border-b-0">
              <td className="px-4 py-2">
                <span className="text-ink block">{row.employeeName}</span>
                <span className="text-ink-faint text-xs">{row.designation}</span>
              </td>
              <td className="text-ink-muted px-4 py-2 whitespace-nowrap">{row.department}</td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatHours(row.totalHours)}
              </td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatHours(row.billableHours)}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-3">
                  <span className="tabular text-ink w-14 text-right">
                    {formatPct(row.productivityPct)}
                  </span>
                  <ProductivityBar share={row.productivityPct} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The bar itself.
 *
 * `overflow-hidden` on the track is a second guard alongside the clamp in
 * `formatBarWidth`: the fill can never spill past its cell even if the width
 * were ever wrong.
 */
function ProductivityBar({ share }: { readonly share: number | null }) {
  if (share === null) return null;

  return (
    <div
      className="bg-paper-sunken h-2 w-28 shrink-0 overflow-hidden rounded-full"
      aria-hidden="true"
    >
      <div className="bg-bar h-full rounded-full" style={{ width: formatBarWidth(share) }} />
    </div>
  );
}
