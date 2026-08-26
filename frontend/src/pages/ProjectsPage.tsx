import { useSearchParams } from 'react-router-dom';

import type { ProjectFinancials } from '@shared/types';

import PeriodPage from '@/components/PeriodPage';
import ProjectsTable from '@/components/ProjectsTable';
import { usePeriodData } from '@/hooks/usePeriodData';
import { getProjects } from '@/lib/api';

/**
 * Did each project make money — loss-making work first.
 *
 * Row order comes from the API rather than being re-sorted here. It is part of
 * the answer, not a display preference.
 */
export default function ProjectsPage() {
  const period = usePeriodData(getProjects, 'Could not load the projects.');
  const [searchParams] = useSearchParams();

  const search = searchParams.toString() === '' ? '' : `?${searchParams.toString()}`;

  return (
    <PeriodPage<readonly ProjectFinancials[]>
      title="Projects"
      description="Did each project make money. Loss-making work sorts first."
      labelSuffix="loss-making first"
      years={period.years}
      year={period.year}
      month={period.month}
      onPeriodChange={period.setPeriod}
      ready={period.meta !== null}
      error={period.error}
      data={period.data}
    >
      {(projects) => <ProjectsTable projects={projects} search={search} />}
    </PeriodPage>
  );
}
