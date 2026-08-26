import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import type { ProjectFinancials } from '@shared/types';

import ContributorsTable from '@/components/ContributorsTable';
import ProjectDepartmentsTable from '@/components/ProjectDepartmentsTable';
import StatCard, { type StatTone } from '@/components/StatCard';
import { ApiError, getProject } from '@/lib/api';
import { formatAED, formatHours, formatPct } from '@/lib/format';

/**
 * One project's full picture, over its whole life.
 *
 * Deliberately unfiltered: a price covers the whole engagement, so showing one
 * month's cost against the contract value would invite a comparison that does
 * not hold.
 */
export default function ProjectDetailPage() {
  const { refCode } = useParams();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<ProjectFinancials | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setError(null);

    // Routing makes this unreachable, but an empty ref code would request
    // `/api/projects/`, which matches the *list* endpoint and answers with an
    // array — rendered as a project, that is nonsense rather than an error.
    if (refCode === undefined || refCode.trim() === '') {
      setError(new ApiError(404, 'No project ref code was given.'));
      return;
    }

    getProject(refCode)
      .then((loaded) => {
        if (!cancelled) setProject(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
    };
  }, [refCode]);

  // Carried back so returning to the list restores whatever period was chosen,
  // and onward so a department drill-down opens on the same one.
  const search = searchParams.toString() === '' ? '' : `?${searchParams.toString()}`;
  const backTo = `/projects${search}`;

  const backLink = (
    <Link to={backTo} className="text-accent text-sm hover:underline">
      ← All projects
    </Link>
  );

  if (error !== null) {
    const notFound = error instanceof ApiError && error.statusCode === 404;

    return (
      <section>
        {backLink}
        <h1 className="text-ink mt-3 text-xl font-semibold">
          {notFound ? 'Project not found' : 'Projects'}
        </h1>
        <p role="alert" className="text-ink-muted mt-2 text-sm">
          {notFound
            ? `No project has been costed under the ref code "${refCode ?? ''}". It may have no hours logged against it yet.`
            : error.message}
        </p>
      </section>
    );
  }

  if (project === null) {
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
        <h1 className="text-ink text-xl font-semibold break-words">
          {project.projectName ?? project.refCode}
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          {project.refCode} · {project.category}
          {project.status === null ? '' : ` · ${project.status}`} · all time
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Price" value={formatAED(project.projectPrice)} />
        <StatCard label="Total hours" value={formatHours(project.totalHours)} />
        <StatCard label="Cost" value={formatAED(project.totalCost)} />
        <StatCard
          label="Profit"
          value={formatAED(project.profit)}
          detail={
            project.marginPct === null
              ? 'No price recorded for this project'
              : `${formatPct(project.marginPct)} margin`
          }
          tone={profitTone(project.profit)}
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <ProjectDepartmentsTable
          hoursByDepartment={project.hoursByDepartment}
          costByDepartment={project.costByDepartment}
          search={search}
        />
        <ContributorsTable employees={project.employees} />
      </div>
    </section>
  );
}

/** An absent profit is neither good nor bad. */
function profitTone(profit: number | null): StatTone {
  if (profit === null) return 'neutral';

  return profit < 0 ? 'negative' : 'positive';
}
