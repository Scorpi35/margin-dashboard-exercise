import type {
  CategoryRow,
  EmployeeMonthCost,
  EmployeeProjectContribution,
  MissingSalaryEmployee,
  MonthCostSummary,
  MonthNumber,
  PeriodSummary,
  ProductivityRow,
  ProjectFinancials,
  ProjectRow,
  SalaryRow,
  Settings,
  TimesheetRow,
} from '@shared/types';
import { YEAR_MONTH_KEY_PATTERN } from '@shared/types';

import { yearMonthKey } from '../parse/dates';

/**
 * The cost model, implemented verbatim from `docs/cost-model.md`.
 *
 * Pure by design: plain data in, plain data out, no database, no `req`/`res`, no
 * clock. That is what lets `npm run selfcheck` verify the whole model from the
 * command line without booting Express, and what makes every number here
 * reproducible from a fixture.
 *
 * The one invariant everything else is arranged around:
 *
 * > With overhead set to zero, company-wide total cost equals total salaries — to
 * > the dirham.
 *
 * It holds because every dirham of salary lands in exactly one bucket: the
 * billable hours of someone who logged hours (carried by their direct rate), the
 * non-billable hours of that same person (valued at that rate, pushed into the
 * indirect pool), or the whole salary of someone who logged nothing (pushed into
 * the pool outright). Period cost is therefore computed straight from salaries —
 * never by summing project costs, which double-counts the pool.
 */

/**
 * What it takes to cost time: hours, what they were paid, and which categories
 * count as billable.
 *
 * Prices are not part of it. Rates, the indirect pool, productivity and the
 * category split are all decided before any project is priced, and saying so in
 * the type means a caller can see which inputs an answer actually depends on.
 */
export interface CostInput {
  readonly timesheet: readonly TimesheetRow[];
  readonly salaries: readonly SalaryRow[];
  readonly settings: Settings;
}

/** Everything the engine needs. Assembled by a service; the engine reads no storage. */
export interface EngineInput extends CostInput {
  readonly projects: readonly ProjectRow[];
}

/** Which rows get aggregated. Rates are always derived from the whole month regardless. */
export interface Period {
  /** `null` selects every year — what a project's all-time figures are computed over. */
  readonly year: number | null;
  /** `null` selects the whole year. */
  readonly month: MonthNumber | null;
}

/** Every row there is, whatever period it falls in. */
export const ALL_TIME: Period = { year: null, month: null };

/* -------------------------------------------------------------------------- */
/* Per person, per month                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Each person's hours, salary and direct cost rate for each month.
 *
 * Rates are per person per month and are never averaged across the year —
 * several employees take a raise in July, and a project spanning both halves is
 * costed with each month's own rates.
 */
export function computeEmployeeMonthCosts(input: CostInput): EmployeeMonthCost[] {
  const { timesheet, salaries, settings } = input;
  const billable = new Set(settings.billableCategories);
  const departments = departmentsByEmployee(timesheet);

  const groups = new Map<
    string,
    {
      year: number;
      month: MonthNumber;
      employeeNo: string;
      employeeName: string;
      totalHours: number;
      billableHours: number;
    }
  >();

  for (const row of timesheet) {
    const key = employeeMonthKey(row.employeeNo, row.year, row.month);
    const group = groups.get(key) ?? {
      year: row.year,
      month: row.month,
      employeeNo: row.employeeNo,
      employeeName: row.employeeName,
      totalHours: 0,
      billableHours: 0,
    };

    group.totalHours += row.hours;
    if (billable.has(row.category)) group.billableHours += row.hours;
    groups.set(key, group);
  }

  const salaryOf = salaryIndex(salaries);
  const costs: EmployeeMonthCost[] = [];

  for (const group of groups.values()) {
    const salary =
      salaryOf.get(employeeMonthKey(group.employeeNo, group.year, group.month)) ?? null;

    costs.push({
      year: group.year,
      month: group.month,
      employeeNo: group.employeeNo,
      employeeName: group.employeeName,
      department: departments.get(group.employeeNo) ?? '',
      salary,
      totalHours: group.totalHours,
      billableHours: group.billableHours,
      nonBillableHours: group.totalHours - group.billableHours,
      // Guarded twice over: no salary and no hours both give 0 rather than NaN.
      directRate: salary === null || group.totalHours === 0 ? 0 : salary / group.totalHours,
      // Keyed off hours rather than off the absence of timesheet rows. Someone
      // whose rows happen to sum to zero is support staff too — treating them as
      // anything else would strand their salary outside the pool and break the
      // reconciliation.
      isSupportStaff: group.totalHours === 0,
    });
  }

  // Salaried people with no timesheet rows at all. Their whole salary is carried
  // by the indirect pool, so they have to appear even with nothing to show.
  for (const row of salaries) {
    const key = employeeMonthKey(row.employeeNo, row.year, row.month);
    if (groups.has(key)) continue;

    costs.push({
      year: row.year,
      month: row.month,
      employeeNo: row.employeeNo,
      employeeName: row.employeeName,
      department: departments.get(row.employeeNo) ?? '',
      salary: row.monthlySalary,
      totalHours: 0,
      billableHours: 0,
      nonBillableHours: 0,
      directRate: 0,
      isSupportStaff: true,
    });
  }

  return costs.sort(
    (a, b) => a.year - b.year || a.month - b.month || a.employeeNo.localeCompare(b.employeeNo),
  );
}

/* -------------------------------------------------------------------------- */
/* Per month                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Each month's indirect pool and the rate it redistributes at.
 *
 * The pool holds the salaries of people who logged nothing, the value of everyone
 * else's non-billable time, and the overhead entered for that month. Dividing it
 * across the month's billable hours is what loads a designer-hour with its share
 * of every meeting, leave day and support colleague.
 */
export function computeMonthCostSummaries(input: CostInput): MonthCostSummary[] {
  const byMonth = new Map<string, EmployeeMonthCost[]>();

  for (const cost of computeEmployeeMonthCosts(input)) {
    const key = yearMonthKey(cost.year, cost.month);
    pushInto(byMonth, key, cost);
  }

  // Overhead is entered per month on the Settings page, often before the
  // spreadsheets for those months are uploaded. Costing only the months that
  // already have rows would drop that overhead from every total without saying
  // so — real cost, silently missing. Each overhead month therefore gets an
  // empty summary to carry it.
  for (const key of overheadMonths(input.settings.monthlyOverhead)) {
    if (!byMonth.has(key)) byMonth.set(key, []);
  }

  const summaries: MonthCostSummary[] = [];

  for (const [key, employees] of byMonth) {
    const { year, month } = employees[0] ?? parseYearMonthKey(key);
    const overhead = input.settings.monthlyOverhead[key] ?? 0;

    const totalSalaries = sum(employees, (e) => e.salary ?? 0);
    const billableHours = sum(employees, (e) => e.billableHours);
    const supportStaffSalaries = sum(employees, (e) => (e.isSupportStaff ? (e.salary ?? 0) : 0));
    const nonBillableCost = sum(employees, (e) => e.nonBillableHours * e.directRate);
    const indirectPool = supportStaffSalaries + nonBillableCost + overhead;

    summaries.push({
      year,
      month,
      totalSalaries,
      totalHours: sum(employees, (e) => e.totalHours),
      billableHours,
      nonBillableHours: sum(employees, (e) => e.nonBillableHours),
      overhead,
      supportStaffSalaries,
      nonBillableCost,
      indirectPool,
      // A month with no billable hours still carries its pool into total cost;
      // the rate is 0 rather than Infinity.
      indirectRate: billableHours === 0 ? 0 : indirectPool / billableHours,
      // Straight from salaries. Summing project costs here is what double-counts.
      totalCost: totalSalaries + overhead,
      employees,
    });
  }

  return summaries.sort((a, b) => a.year - b.year || a.month - b.month);
}

/* -------------------------------------------------------------------------- */
/* Per project                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Did each project make money, over the selected period.
 *
 * Only billable rows are costed to a project — non-billable time is already
 * carried by the indirect rate, and charging it again would double-count. Each
 * row is costed at its own month's rates.
 */
export function computeProjectFinancials(input: EngineInput, period: Period): ProjectFinancials[] {
  const billable = new Set(input.settings.billableCategories);
  const rates = rateIndex(input);
  const priced = new Map(input.projects.map((project) => [project.refCode, project]));

  const billableRows = input.timesheet.filter((row) => billable.has(row.category));
  const allTimeHours = new Map<string, number>();
  for (const row of billableRows) {
    allTimeHours.set(row.refCode, (allTimeHours.get(row.refCode) ?? 0) + row.hours);
  }

  const groups = new Map<string, TimesheetRow[]>();
  for (const row of billableRows.filter((row) => inPeriod(row, period))) {
    pushInto(groups, row.refCode, row);
  }

  const financials: ProjectFinancials[] = [];

  for (const [refCode, rows] of groups) {
    const project = priced.get(refCode) ?? null;
    const totalHours = sum(rows, (row) => row.hours);
    const totalCost = sum(rows, (row) => rowCost(row, rates));

    // Revenue follows the hours, not the sales month: a project's price is spread
    // across the periods its billable time was logged in, so cost and revenue
    // always land in the same month (docs/cost-model.md § Revenue Recognition).
    const lifetimeHours = allTimeHours.get(refCode) ?? 0;
    const revenue =
      project?.projectPrice == null || lifetimeHours === 0
        ? null
        : project.projectPrice * (totalHours / lifetimeHours);

    const profit = revenue === null ? null : revenue - totalCost;
    const marginPct =
      revenue === null || revenue === 0 || profit === null ? null : profit / revenue;

    financials.push({
      refCode,
      projectName: project?.projectName || null,
      category: project?.category || rows[0].category,
      status: project?.status ?? null,
      projectPrice: project?.projectPrice ?? null,
      revenue,
      totalHours,
      totalCost,
      profit,
      marginPct,
      hoursByDepartment: totalsBy(
        rows,
        (row) => row.department,
        (row) => row.hours,
      ),
      costByDepartment: totalsBy(
        rows,
        (row) => row.department,
        (row) => rowCost(row, rates),
      ),
      employees: contributions(rows, rates, revenue, totalHours),
    });
  }

  // Loss-making work first, and unpriced work — a gap rather than a loss — ahead
  // of it. Three of the eleven sample projects lose money; a default order that
  // buries them under the profitable eight has failed at the job.
  return financials.sort(
    (a, b) =>
      rankMargin(a.marginPct) - rankMargin(b.marginPct) || a.refCode.localeCompare(b.refCode),
  );
}

/* -------------------------------------------------------------------------- */
/* Per period                                                                  */
/* -------------------------------------------------------------------------- */

/** Company-wide totals for the period, plus the gaps in the data behind them. */
export function computePeriodSummary(input: EngineInput, period: Period): PeriodSummary {
  const months = computeMonthCostSummaries(input).filter((month) => inPeriod(month, period));
  const employees = months.flatMap((month) => month.employees);
  const projects = computeProjectFinancials(input, period);

  const totalSalaries = sum(employees, (e) => e.salary ?? 0);
  const totalOverhead = sum(months, (month) => month.overhead);
  const totalCost = totalSalaries + totalOverhead;
  const totalRevenue = sum(projects, (project) => project.revenue ?? 0);
  const totalProfit = totalRevenue - totalCost;

  const totalHours = sum(months, (month) => month.totalHours);
  const billableHours = sum(months, (month) => month.billableHours);

  const billable = new Set(input.settings.billableCategories);
  const pricedRefCodes = new Set(
    input.projects.filter((p) => p.projectPrice !== null).map((p) => p.refCode),
  );
  const unpricedRefCodes = [
    ...new Set(
      input.timesheet
        .filter((row) => billable.has(row.category) && inPeriod(row, period))
        .map((row) => row.refCode)
        .filter((refCode) => !pricedRefCodes.has(refCode)),
    ),
  ].sort();

  return {
    year: period.year,
    month: period.month,
    totalSalaries,
    totalOverhead,
    totalCost,
    totalRevenue,
    totalProfit,
    marginPct: totalRevenue === 0 ? null : totalProfit / totalRevenue,
    totalHours,
    billableHours,
    nonBillableHours: sum(months, (month) => month.nonBillableHours),
    productivityPct: totalHours === 0 ? null : billableHours / totalHours,
    unpricedRefCodes,
    missingSalaryEmployees: missingSalaries(employees),
    months,
  };
}

/* -------------------------------------------------------------------------- */
/* Aggregations                                                                */
/* -------------------------------------------------------------------------- */

/** Billable share of each person's logged time over the period. */
export function computeProductivity(input: CostInput, period: Period): ProductivityRow[] {
  const designations = designationsByEmployee(input.timesheet);
  const rows = new Map<string, ProductivityRow>();

  for (const cost of computeEmployeeMonthCosts(input).filter((c) => inPeriod(c, period))) {
    const previous = rows.get(cost.employeeNo);
    const totalHours = (previous?.totalHours ?? 0) + cost.totalHours;
    const billableHours = (previous?.billableHours ?? 0) + cost.billableHours;

    rows.set(cost.employeeNo, {
      employeeNo: cost.employeeNo,
      employeeName: cost.employeeName,
      department: cost.department,
      designation: designations.get(cost.employeeNo) ?? '',
      totalHours,
      billableHours,
      nonBillableHours: (previous?.nonBillableHours ?? 0) + cost.nonBillableHours,
      // No hours means no ratio to report — null, not a misleading 0%.
      productivityPct: totalHours === 0 ? null : billableHours / totalHours,
    });
  }

  return [...rows.values()].sort(
    (a, b) =>
      (b.productivityPct ?? -1) - (a.productivityPct ?? -1) ||
      a.employeeName.localeCompare(b.employeeName),
  );
}

/** Where the hours went, by category, largest first. */
export function computeCategoryBreakdown(input: CostInput, period: Period): CategoryRow[] {
  const billable = new Set(input.settings.billableCategories);
  const rows = input.timesheet.filter((row) => inPeriod(row, period));
  const totalHours = sum(rows, (row) => row.hours);

  const hours = new Map<string, number>();
  for (const row of rows) {
    hours.set(row.category, (hours.get(row.category) ?? 0) + row.hours);
  }

  return [...hours.entries()]
    .map(([category, categoryHours]) => ({
      category,
      // Never inferred from a name prefix: Tentwenty is internal work and carries
      // no "FC - " prefix (docs/data-sources.md).
      billable: billable.has(category),
      hours: categoryHours,
      hoursPct: totalHours === 0 ? null : categoryHours / totalHours,
    }))
    .sort((a, b) => b.hours - a.hours || a.category.localeCompare(b.category));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

interface Rates {
  readonly direct: ReadonlyMap<string, number>;
  readonly indirect: ReadonlyMap<string, number>;
}

/** Direct rates per employee-month and indirect rates per month, resolved once. */
function rateIndex(input: CostInput): Rates {
  const direct = new Map<string, number>();
  const indirect = new Map<string, number>();

  for (const month of computeMonthCostSummaries(input)) {
    indirect.set(yearMonthKey(month.year, month.month), month.indirectRate);
    for (const employee of month.employees) {
      direct.set(
        employeeMonthKey(employee.employeeNo, employee.year, employee.month),
        employee.directRate,
      );
    }
  }

  return { direct, indirect };
}

/** A row's fully-loaded cost, at its own month's rates. */
function rowCost(row: TimesheetRow, rates: Rates): number {
  const directRate = rates.direct.get(employeeMonthKey(row.employeeNo, row.year, row.month)) ?? 0;
  const indirectRate = rates.indirect.get(yearMonthKey(row.year, row.month)) ?? 0;

  return row.hours * (directRate + indirectRate);
}

/**
 * Each person's slice of one project.
 *
 * The share is taken out of `revenue` — what the project earned in this period —
 * rather than out of the whole contract price, so the shares add up to the figure
 * shown on the project row. Over a full year the two are the same number.
 */
function contributions(
  rows: readonly TimesheetRow[],
  rates: Rates,
  revenue: number | null,
  totalProjectHours: number,
): EmployeeProjectContribution[] {
  const byEmployee = new Map<string, TimesheetRow[]>();
  for (const row of rows) {
    pushInto(byEmployee, row.employeeNo, row);
  }

  return [...byEmployee.values()]
    .map((employeeRows) => {
      const hours = sum(employeeRows, (row) => row.hours);
      const cost = sum(employeeRows, (row) => rowCost(row, rates));
      const revenueShare =
        revenue === null || totalProjectHours === 0 ? null : revenue * (hours / totalProjectHours);

      return {
        employeeNo: employeeRows[0].employeeNo,
        employeeName: employeeRows[0].employeeName,
        department: employeeRows[0].department,
        hours,
        cost,
        revenueShare,
        profitability:
          revenueShare === null || revenueShare === 0 ? null : (revenueShare - cost) / revenueShare,
      };
    })
    .sort((a, b) => b.hours - a.hours || a.employeeName.localeCompare(b.employeeName));
}

/** People who logged hours with no salary behind them. Never costed at zero silently. */
function missingSalaries(employees: readonly EmployeeMonthCost[]): MissingSalaryEmployee[] {
  return employees
    .filter((employee) => employee.salary === null)
    .map(({ employeeNo, employeeName, year, month }) => ({
      employeeNo,
      employeeName,
      year,
      month,
    }))
    .sort(
      (a, b) => a.year - b.year || a.month - b.month || a.employeeNo.localeCompare(b.employeeNo),
    );
}

function departmentsByEmployee(timesheet: readonly TimesheetRow[]): Map<string, string> {
  const departments = new Map<string, string>();
  for (const row of timesheet) {
    if (row.department !== '' && !departments.has(row.employeeNo)) {
      departments.set(row.employeeNo, row.department);
    }
  }
  return departments;
}

function designationsByEmployee(timesheet: readonly TimesheetRow[]): Map<string, string> {
  const designations = new Map<string, string>();
  for (const row of timesheet) {
    if (row.designation !== '' && !designations.has(row.employeeNo)) {
      designations.set(row.employeeNo, row.designation);
    }
  }
  return designations;
}

function salaryIndex(salaries: readonly SalaryRow[]): Map<string, number> {
  return new Map(
    salaries.map((row) => [
      employeeMonthKey(row.employeeNo, row.year, row.month),
      row.monthlySalary,
    ]),
  );
}

function inPeriod(row: { year: number; month: MonthNumber }, period: Period): boolean {
  return (
    (period.year === null || row.year === period.year) &&
    (period.month === null || row.month === period.month)
  );
}

/** Unpriced sorts ahead of the worst loss: a gap is more urgent than a bad margin. */
function rankMargin(marginPct: number | null): number {
  return marginPct ?? Number.NEGATIVE_INFINITY;
}

function totalsBy<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  valueOf: (row: T) => number,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const key = keyOf(row);
    totals[key] = (totals[key] ?? 0) + valueOf(row);
  }
  return totals;
}

/**
 * The months overhead has been entered for, well-formed ones only.
 *
 * A key the settings service would have rejected is ignored rather than
 * conjuring a month out of `"banana"`.
 */
function overheadMonths(monthlyOverhead: Readonly<Record<string, number>>): string[] {
  return Object.keys(monthlyOverhead).filter((key) => YEAR_MONTH_KEY_PATTERN.test(key));
}

/** Splits a `YYYY-MM` key back into its parts. Only ever called on a matched key. */
function parseYearMonthKey(key: string): { year: number; month: MonthNumber } {
  const [year, month] = key.split('-');

  return { year: Number(year), month: Number(month) };
}

function pushInto<K, V>(groups: Map<K, V[]>, key: K, value: V): void {
  const existing = groups.get(key);
  if (existing === undefined) {
    groups.set(key, [value]);
  } else {
    existing.push(value);
  }
}

function sum<T>(rows: readonly T[], valueOf: (row: T) => number): number {
  return rows.reduce((total, row) => total + valueOf(row), 0);
}

function employeeMonthKey(employeeNo: string, year: number, month: MonthNumber): string {
  return `${employeeNo}:${yearMonthKey(year, month)}`;
}
