/**
 * Enforces the reconciliation invariant from `docs/cost-model.md`:
 *
 * > With overhead set to zero, company-wide total cost equals total salaries — to
 * > the dirham. Verified figure on the sample data: AED 2,400,000.00 for 2025.
 *
 * It reads whatever is in the database and runs the engine directly — no server,
 * no HTTP — because the engine is pure, and that is exactly what makes the cost
 * model verifiable from the command line. Run `npm run seed` first.
 *
 * Saved billable categories are honoured; overhead is forced to `{}` regardless
 * of what is stored. Non-zero overhead legitimately breaks `cost == salaries`,
 * since overhead is real cost that isn't salary, so leaving it in would make the
 * check untestable rather than strict.
 *
 * Exits 0 when every year reconciles and 1 otherwise.
 */

import {
  computeMonthCostSummaries,
  computePeriodSummary,
  type EngineInput,
} from '../src/calc/engine';
import { closeDb } from '../src/lib/db';
import { readProjects, readSalaries, readTimesheet } from '../src/services/ingest.service';
import { getSettings } from '../src/services/settings.service';

/** Money is compared at two decimals — "to the dirham", not to the float. */
const dirhams = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number): string => value.toFixed(2);

const timesheet = readTimesheet();
const salaries = readSalaries();

if (timesheet.length === 0 && salaries.length === 0) {
  console.error('selfcheck: the database is empty — run `npm run seed` first.');
  closeDb();
  process.exit(1);
}

const input: EngineInput = {
  timesheet,
  salaries,
  projects: readProjects(),
  settings: { ...getSettings(), monthlyOverhead: {} },
};

const months = computeMonthCostSummaries(input);
const years = [...new Set(months.map((month) => month.year))].sort((a, b) => a - b);

console.log('selfcheck — overhead forced to {}\n');

let failed = false;

for (const year of years) {
  const summary = computePeriodSummary(input, { year, month: null });

  // The right-hand side is derived through the model rather than read back from
  // salaries: every billable hour at its own direct rate, plus the pool that
  // carries the non-billable time and the support staff. Comparing it against
  // payroll is what would actually catch double-counting — `totalCost` alone
  // holds by construction.
  const computedCost = months
    .filter((month) => month.year === year)
    .reduce((total, month) => total + bucketTotal(month), 0);

  const ok = dirhams(computedCost) === dirhams(summary.totalSalaries);
  if (!ok) failed = true;

  console.log(
    `${year}: total salaries = ${money(summary.totalSalaries)} | ` +
      `total computed cost = ${money(computedCost)} | ${ok ? 'PASS' : 'FAIL'}`,
  );

  for (const month of months.filter((month) => month.year === year)) {
    const monthOk = dirhams(bucketTotal(month)) === dirhams(month.totalSalaries);
    if (!monthOk) failed = true;

    console.log(
      `  ${String(month.month).padStart(2, '0')}: ` +
        `salaries = ${money(month.totalSalaries)} | ` +
        `computed = ${money(bucketTotal(month))} | ${monthOk ? 'PASS' : 'FAIL'}`,
    );
  }
}

closeDb();

if (failed) {
  console.error('\nselfcheck FAILED — cost no longer reconciles to salaries.');
  process.exit(1);
}

console.log('\nselfcheck PASS');

/**
 * The three buckets every dirham of salary lands in: billable hours carried by a
 * direct rate, and the indirect pool holding non-billable time plus the salaries
 * of anyone who logged nothing.
 */
function bucketTotal(month: (typeof months)[number]): number {
  const billableCost = month.employees.reduce(
    (total, employee) => total + employee.billableHours * employee.directRate,
    0,
  );

  return billableCost + month.indirectPool;
}
