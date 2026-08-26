import type { EmployeeProjectContribution } from '@shared/types';

import { formatAED, formatHours, formatPct } from '@/lib/format';

/**
 * Who worked on a project, what their time cost, and whether their share of the
 * work paid for itself.
 *
 * Profitability is `(revenue share − cost) ÷ revenue share`, computed by the
 * engine. An unpriced project has no revenue to share out, so the column reads
 * as an em dash for every row — a gap, not a break-even.
 */

interface ContributorsTableProps {
  readonly employees: readonly EmployeeProjectContribution[];
}

export default function ContributorsTable({ employees }: ContributorsTableProps) {
  if (employees.length === 0) {
    return <p className="text-ink-muted text-sm">Nobody has logged time on this project.</p>;
  }

  return (
    <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="text-ink border-line border-b px-4 py-2 text-left text-sm font-semibold">
          By person
        </caption>
        <thead>
          <tr className="border-line text-ink-muted border-b text-left">
            <th scope="col" className="px-4 py-2 font-medium">
              Employee
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Hours
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Cost
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Profitability
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee.employeeNo} className="border-line border-b last:border-b-0">
              <td className="px-4 py-2">
                <span className="text-ink block">{employee.employeeName}</span>
                <span className="text-ink-faint text-xs">{employee.department}</span>
              </td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatHours(employee.hours)}
              </td>
              <td className="tabular text-ink px-4 py-2 text-right">{formatAED(employee.cost)}</td>
              <td className={`tabular px-4 py-2 text-right ${amountClass(employee.profitability)}`}>
                {formatPct(employee.profitability)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** An absent figure is neither good nor bad, so it stays neutral. */
function amountClass(value: number | null): string {
  if (value === null) return 'text-ink-muted';

  return value < 0 ? 'text-negative font-medium' : 'text-positive';
}
