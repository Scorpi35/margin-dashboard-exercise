import { Link } from 'react-router-dom';

import type { ProjectFinancials } from '@shared/types';

import { formatAED, formatHours, formatPct } from '@/lib/format';

/**
 * Every project in the period, in the order the API returned them: unpriced work
 * first, then by margin ascending.
 *
 * That order is the point of the page. Three of the eleven sample projects lose
 * money, and a table that buries them under eight profitable rows has failed at
 * its job.
 */

interface ProjectsTableProps {
  readonly projects: readonly ProjectFinancials[];
  /** Carried onto each row link so returning to the list keeps the filter. */
  readonly search: string;
}

export default function ProjectsTable({ projects, search }: ProjectsTableProps) {
  if (projects.length === 0) {
    return <p className="text-ink-muted text-sm">No project work was logged in this period.</p>;
  }

  return (
    <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-line text-ink-muted border-b text-left">
            <th scope="col" className="px-4 py-2 font-medium">
              Project
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Hours
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Price
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Cost
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Profit
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Margin
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              key={project.refCode}
              className="border-line hover:bg-paper-sunken border-b last:border-b-0"
            >
              <td className="px-4 py-2">
                <Link
                  to={`/projects/${encodeURIComponent(project.refCode)}${search}`}
                  className="text-accent hover:underline"
                >
                  {/* Project names are filenames — long, so they truncate, with the
                      ref code beneath as the stable identifier. */}
                  <span className="block max-w-[22rem] truncate" title={project.projectName ?? ''}>
                    {project.projectName ?? project.refCode}
                  </span>
                </Link>
                {/* Suppressed when it is already the heading — an unpriced ref code
                    has no name to sit above, and printing it twice reads as a bug. */}
                {project.projectName !== null && (
                  <span className="text-ink-faint text-xs">{project.refCode}</span>
                )}
              </td>
              <td className="text-ink-muted px-4 py-2 whitespace-nowrap">
                {project.status ?? '—'}
              </td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatHours(project.totalHours)}
              </td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatAED(project.projectPrice)}
              </td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {formatAED(project.totalCost)}
              </td>
              <td className={`tabular px-4 py-2 text-right ${amountClass(project.profit)}`}>
                {formatAED(project.profit)}
              </td>
              <td className={`tabular px-4 py-2 text-right ${amountClass(project.marginPct)}`}>
                {formatPct(project.marginPct)}
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
