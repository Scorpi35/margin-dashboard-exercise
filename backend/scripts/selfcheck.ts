/**
 * Enforces the reconciliation invariant from `docs/cost-model.md`:
 *
 * > With overhead set to zero, company-wide total cost equals total salaries — to
 * > the dirham. Verified figure on the sample data: AED 2,400,000.00 for 2025.
 *
 * It reads the committed spreadsheets and runs the engine directly — no database,
 * no server — because the engine is pure and that is exactly what makes the cost
 * model verifiable from the command line.
 *
 * Overhead is forced to zero regardless of any saved settings: non-zero overhead
 * legitimately breaks `cost == salaries`, since overhead is real cost that isn't
 * salary, so the check would stop being testable.
 *
 * Exits non-zero on any failure.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_BILLABLE_CATEGORIES } from '@shared/types';

import {
  computeMonthCostSummaries,
  computePeriodSummary,
  type EngineInput,
} from '../src/calc/engine';
import { parseProjects } from '../src/parse/projects';
import { parseSalary } from '../src/parse/salary';
import { parseTimesheet } from '../src/parse/timesheet';

const SAMPLE_DATA = join(__dirname, '../../sample-data');
const YEAR = 2025;
const EXPECTED_TOTAL = 2_400_000;

/** Money is compared at two decimals — "to the dirham", not to the float. */
const dirhams = (value: number): number => Math.round(value * 100) / 100;
const aed = (value: number): string =>
  value.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const failures: string[] = [];

function check(label: string, actual: number, expected: number): void {
  const ok = dirhams(actual) === dirhams(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${aed(actual).padStart(16)}`);
  if (!ok) failures.push(`${label}: expected ${aed(expected)}, got ${aed(actual)}`);
}

function read(file: string): Buffer {
  return readFileSync(join(SAMPLE_DATA, file));
}

const timesheet = parseTimesheet(read('timesheet-2025.xlsx'), 'timesheet-2025.xlsx');
const salaries = parseSalary(read('salaries-2025.xlsx'), 'salaries-2025.xlsx');
const projects = parseProjects(read('project-prices-2025.xlsx'), 'project-prices-2025.xlsx');

const input: EngineInput = {
  timesheet: timesheet.rows,
  salaries: salaries.rows,
  projects: projects.rows,
  settings: { billableCategories: DEFAULT_BILLABLE_CATEGORIES, monthlyOverhead: {} },
};

console.log(`selfcheck ${YEAR} — overhead forced to zero\n`);
console.log(
  `  parsed ${timesheet.rows.length} timesheet / ${salaries.rows.length} salary / ` +
    `${projects.rows.length} project rows, ` +
    `${timesheet.warnings.length + salaries.warnings.length + projects.warnings.length} warning(s)\n`,
);

const year = computePeriodSummary(input, { year: YEAR, month: null });
check('total cost == total salaries', year.totalCost, year.totalSalaries);
check('total cost == known payroll', year.totalCost, EXPECTED_TOTAL);

console.log('\n  per month:');
for (const month of computeMonthCostSummaries(input).filter((m) => m.year === YEAR)) {
  // The reconciliation proper: every dirham of salary lands in exactly one
  // bucket, and the buckets sum back to payroll. `totalCost` holds by
  // construction, so this is the check that would actually catch double-counting.
  const billableCost = month.employees.reduce(
    (total, employee) => total + employee.billableHours * employee.directRate,
    0,
  );
  check(
    `${month.year}-${String(month.month).padStart(2, '0')} buckets`,
    billableCost + month.indirectPool,
    month.totalSalaries,
  );
}

console.log('');
if (failures.length > 0) {
  console.error(`selfcheck FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`selfcheck PASS — ${YEAR} cost reconciles to salaries at AED ${aed(year.totalCost)}.`);
