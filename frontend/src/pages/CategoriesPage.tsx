import type { CategoryBreakdown } from '@shared/types';

import CategoryTable from '@/components/CategoryTable';
import PeriodPage from '@/components/PeriodPage';
import { usePeriodData } from '@/hooks/usePeriodData';
import { getCategories } from '@/lib/api';

/**
 * Where the time actually goes.
 *
 * Billability is a stored setting, so moving a category between billable and
 * internal changes this page — nothing here infers it from a name.
 */
export default function CategoriesPage() {
  const period = usePeriodData(getCategories, 'Could not load the categories.');

  return (
    <PeriodPage<CategoryBreakdown>
      title="Categories"
      description="Where the hours went, billable and internal."
      labelSuffix="largest first"
      years={period.years}
      year={period.year}
      month={period.month}
      onPeriodChange={period.setPeriod}
      ready={period.meta !== null}
      error={period.error}
      data={period.data}
    >
      {(breakdown) => <CategoryTable breakdown={breakdown} />}
    </PeriodPage>
  );
}
