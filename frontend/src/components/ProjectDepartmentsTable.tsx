import { Link } from 'react-router-dom';

import { formatAED, formatHours } from '@/lib/format';

/**
 * Where one project's hours and cost went, by department, largest first.
 *
 * Named for the project rather than "DepartmentBreakdown", which is the
 * company-wide payload — the two are different scopes and they now appear one
 * click apart.
 */

interface ProjectDepartmentsTableProps {
  readonly hoursByDepartment: Readonly<Record<string, number>>;
  readonly costByDepartment: Readonly<Record<string, number>>;
  /** Carried onto each link so the drill-down opens on the same period. */
  readonly search: string;
}

export default function ProjectDepartmentsTable({
  hoursByDepartment,
  costByDepartment,
  search,
}: ProjectDepartmentsTableProps) {
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
            {/* Scoped, because the department name links through to a page
                showing that department's salaries across all work. Both are
                called cost otherwise, and they differ several-fold. */}
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Cost on this project
            </th>
          </tr>
        </thead>
        <tbody>
          {departments.map((department) => (
            <tr key={department} className="border-line border-b last:border-b-0">
              <td className="max-w-48 truncate px-4 py-2" title={department}>
                {/* Through to everyone in the department, not just their work
                    on this project. */}
                <Link
                  to={`/departments/${encodeURIComponent(department)}${search}`}
                  className="text-accent hover:underline"
                >
                  {department}
                </Link>
              </td>
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
