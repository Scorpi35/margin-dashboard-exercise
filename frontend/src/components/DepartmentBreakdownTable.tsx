import { formatAED, formatHours } from '@/lib/format';

/** Where a project's hours and cost went, by department, largest first. */

interface DepartmentBreakdownTableProps {
  readonly hoursByDepartment: Readonly<Record<string, number>>;
  readonly costByDepartment: Readonly<Record<string, number>>;
}

export default function DepartmentBreakdownTable({
  hoursByDepartment,
  costByDepartment,
}: DepartmentBreakdownTableProps) {
  const departments = Object.keys(hoursByDepartment).sort(
    (a, b) => hoursByDepartment[b] - hoursByDepartment[a] || a.localeCompare(b),
  );

  if (departments.length === 0) {
    return <p className="text-ink-muted text-sm">No hours logged.</p>;
  }

  return (
    <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="text-ink border-line border-b px-4 py-2 text-left text-sm font-semibold">
          By department
        </caption>
        <thead>
          <tr className="border-line text-ink-muted border-b text-left">
            <th scope="col" className="px-4 py-2 font-medium">
              Department
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Hours
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {departments.map((department) => (
            <tr key={department} className="border-line border-b last:border-b-0">
              <td className="text-ink px-4 py-2">{department}</td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatHours(hoursByDepartment[department])}
              </td>
              {/* The engine builds both maps from the same rows, so a department
                  always has both. Reading it through `??` keeps a mismatch as a
                  visible em dash rather than a crash. */}
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatAED(costByDepartment[department] ?? null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
