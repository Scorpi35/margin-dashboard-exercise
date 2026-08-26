import type { ProductivityRow } from '@shared/types';

import PeriodPage from '@/components/PeriodPage';
import ProductivityTable from '@/components/ProductivityTable';
import { usePeriodData } from '@/hooks/usePeriodData';
import { getProductivity } from '@/lib/api';

/**
 * How much of each person's logged time was billable.
 *
 * Row order comes from the API. Billability is a saved setting, so a category
 * moving between billable and internal changes these figures — nothing here
 * infers it from a name.
 */
export default function ProductivityPage() {
  const period = usePeriodData(getProductivity, 'Could not load productivity.');

  return (
    <PeriodPage<readonly ProductivityRow[]>
      title="Productivity"
      description="Billable share of each person's logged time."
      labelSuffix="most billable first"
      years={period.years}
      year={period.year}
      month={period.month}
      onPeriodChange={period.setPeriod}
      ready={period.meta !== null}
      error={period.error}
      data={period.data}
    >
      {(rows) => <ProductivityTable rows={rows} />}
    </PeriodPage>
  );
}
