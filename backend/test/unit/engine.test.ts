import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALL_TIME,
  computeCategoryBreakdown,
  computeEmployeeMonthCosts,
  computeMonthCostSummaries,
  computePeriodSummary,
  computeProductivity,
  computeProjectFinancials,
} from '../../src/calc/engine';
import {
  bucketTotal,
  hours,
  input,
  salary,
  settings,
  twoMonths,
  twoYears,
} from './engine-fixtures';

const YEAR = { year: 2025, month: null };
const JANUARY = { year: 2025, month: 1 };
const FEBRUARY = { year: 2025, month: 2 };

describe('the reconciliation invariant', () => {
  it('makes total cost equal total salaries with overhead at zero', () => {
    const summary = computePeriodSummary(twoMonths(), YEAR);

    // 15,000 of payroll in each of the two months.
    expect(summary.totalCost).toBeCloseTo(30_000, 2);
    expect(summary.totalCost).toBeCloseTo(summary.totalSalaries, 2);
  });

  it('holds for each month, not only the annual total', () => {
    for (const month of computeMonthCostSummaries(twoMonths())) {
      expect(month.totalCost).toBeCloseTo(month.totalSalaries, 2);
    }
  });

  it('sums the three buckets back to payroll, which is the check that can fail', () => {
    // totalCost holds by construction; this is what would catch double-counting.
    const [january, february] = computeMonthCostSummaries(twoMonths());

    expect(bucketTotal(january)).toBeCloseTo(15_000, 2);
    expect(bucketTotal(february)).toBeCloseTo(15_000, 2);
  });

  it('holds when a person logs hours one month and nothing the next', () => {
    // Alice works in January and is support staff in February; Bob is the reverse.
    const [january, february] = computeMonthCostSummaries(twoMonths());

    expect(january.supportStaffSalaries).toBeCloseTo(5_000, 2);
    expect(february.supportStaffSalaries).toBeCloseTo(10_000, 2);
    expect(bucketTotal(january)).toBeCloseTo(january.totalSalaries, 2);
    expect(bucketTotal(february)).toBeCloseTo(february.totalSalaries, 2);
  });

  it('is not disturbed by an employee whose rows sum to zero hours', () => {
    // Their salary must still reach the pool, or it vanishes from one side.
    const model = input({
      timesheet: [hours({ hours: 0 })],
      salaries: [salary({ monthlySalary: 10_000 })],
    });
    const [month] = computeMonthCostSummaries(model);

    expect(month.employees[0].isSupportStaff).toBe(true);
    expect(month.indirectPool).toBeCloseTo(10_000, 2);
    expect(bucketTotal(month)).toBeCloseTo(month.totalSalaries, 2);
  });
});

describe('computeEmployeeMonthCosts', () => {
  it('divides salary by total hours, billable and not', () => {
    const [alice] = computeEmployeeMonthCosts(twoMonths());

    expect(alice.salary).toBe(10_000);
    expect(alice.totalHours).toBe(100);
    expect(alice.billableHours).toBe(80);
    expect(alice.nonBillableHours).toBe(20);
    expect(alice.directRate).toBeCloseTo(100, 4);
  });

  it('flags a salaried employee with no timesheet rows as support staff', () => {
    const bob = computeEmployeeMonthCosts(twoMonths()).find(
      (cost) => cost.employeeNo === '2' && cost.month === 1,
    );

    expect(bob?.isSupportStaff).toBe(true);
    expect(bob?.totalHours).toBe(0);
    expect(bob?.directRate).toBe(0);
    expect(bob?.salary).toBe(5_000);
  });

  it('leaves the rate at zero rather than NaN when there is no salary', () => {
    const model = input({ timesheet: [hours({ hours: 40 })] });
    const [alice] = computeEmployeeMonthCosts(model);

    expect(alice.salary).toBeNull();
    expect(alice.directRate).toBe(0);
    expect(Number.isNaN(alice.directRate)).toBe(false);
  });

  it('does not average a mid-year raise across months', () => {
    const model = input({
      timesheet: [hours({ month: 1, hours: 100 }), hours({ month: 7, hours: 100 })],
      salaries: [
        salary({ month: 1, monthlySalary: 18_000 }),
        salary({ month: 7, monthlySalary: 18_500 }),
      ],
    });
    const costs = computeEmployeeMonthCosts(model);

    expect(costs.find((c) => c.month === 1)?.directRate).toBeCloseTo(180, 4);
    expect(costs.find((c) => c.month === 7)?.directRate).toBeCloseTo(185, 4);
  });
});

describe('computeMonthCostSummaries', () => {
  it('reports the three pool components alongside the pool', () => {
    const [january] = computeMonthCostSummaries(twoMonths());

    expect(january.supportStaffSalaries).toBeCloseTo(5_000, 2);
    expect(january.nonBillableCost).toBeCloseTo(2_000, 2);
    expect(january.overhead).toBe(0);
    expect(january.indirectPool).toBeCloseTo(7_000, 2);
  });

  it('divides the pool across billable hours', () => {
    const [january] = computeMonthCostSummaries(twoMonths());

    expect(january.indirectRate).toBeCloseTo(87.5, 4);
  });

  it('adds overhead to the pool and moves the rate', () => {
    const [january] = computeMonthCostSummaries(twoMonths({ '2025-01': 800 }));

    expect(january.overhead).toBe(800);
    expect(january.indirectPool).toBeCloseTo(7_800, 2);
    expect(january.indirectRate).toBeCloseTo(97.5, 4);
    // Overhead is real cost that is not salary, so it intentionally breaks the
    // equality — which is why selfcheck forces overhead to zero.
    expect(january.totalCost).toBeCloseTo(15_800, 2);
    expect(january.totalCost).not.toBeCloseTo(january.totalSalaries, 2);
  });

  it('leaves the rate at zero rather than Infinity when nothing is billable', () => {
    const model = input({
      timesheet: [hours({ category: 'Meetings', refCode: 'Meetings', hours: 100 })],
      salaries: [salary({ monthlySalary: 10_000 })],
    });
    const [january] = computeMonthCostSummaries(model);

    expect(january.billableHours).toBe(0);
    expect(january.indirectRate).toBe(0);
    expect(Number.isFinite(january.indirectRate)).toBe(true);
    // The pool still counts toward total cost.
    expect(january.indirectPool).toBeCloseTo(10_000, 2);
    expect(january.totalCost).toBeCloseTo(10_000, 2);
  });
});

describe('computeProjectFinancials', () => {
  it('costs each row at its own month rates', () => {
    // January: 80 x (100 + 87.50) = 15,000. February: 50 x (100 + 200) = 15,000.
    const [project] = computeProjectFinancials(twoMonths(), YEAR);

    expect(project.totalHours).toBe(130);
    expect(project.totalCost).toBeCloseTo(30_000, 2);
  });

  it('computes profit and margin from the price over a full period', () => {
    const [project] = computeProjectFinancials(twoMonths(), YEAR);

    expect(project.revenue).toBeCloseTo(40_000, 2);
    expect(project.profit).toBeCloseTo(10_000, 2);
    expect(project.marginPct).toBeCloseTo(0.25, 6);
  });

  it('gives revenue share as price x (employee hours / total project hours)', () => {
    // Hand-verified: 40,000 x 80/130 = 24,615.38 and 40,000 x 50/130 = 15,384.62.
    const [project] = computeProjectFinancials(twoMonths(), YEAR);
    const alice = project.employees.find((e) => e.employeeNo === '1');
    const bob = project.employees.find((e) => e.employeeNo === '2');

    expect(alice?.revenueShare).toBeCloseTo(24_615.38, 2);
    expect(bob?.revenueShare).toBeCloseTo(15_384.62, 2);
    expect((alice?.revenueShare ?? 0) + (bob?.revenueShare ?? 0)).toBeCloseTo(40_000, 2);
  });

  it('gives per-employee profitability from that share', () => {
    const [project] = computeProjectFinancials(twoMonths(), YEAR);
    const alice = project.employees.find((e) => e.employeeNo === '1');

    // (24,615.38 - 15,000) / 24,615.38
    expect(alice?.cost).toBeCloseTo(15_000, 2);
    expect(alice?.profitability).toBeCloseTo(0.390625, 6);
  });

  it('attributes revenue to the period the hours were logged in', () => {
    // 80 of 130 hours fall in January, so January earns 40,000 x 80/130.
    const [january] = computeProjectFinancials(twoMonths(), JANUARY);
    const [february] = computeProjectFinancials(twoMonths(), FEBRUARY);

    expect(january.revenue).toBeCloseTo(24_615.38, 2);
    expect(february.revenue).toBeCloseTo(15_384.62, 2);
    expect((january.revenue ?? 0) + (february.revenue ?? 0)).toBeCloseTo(40_000, 2);
  });

  it('breaks hours and cost down by department', () => {
    const [project] = computeProjectFinancials(twoMonths(), YEAR);

    expect(project.hoursByDepartment).toEqual({ Design: 80, Backend: 50 });
    expect(project.costByDepartment.Design).toBeCloseTo(15_000, 2);
    expect(project.costByDepartment.Backend).toBeCloseTo(15_000, 2);
    const departmentTotal = Object.values(project.costByDepartment).reduce((a, b) => a + b, 0);
    expect(departmentTotal).toBeCloseTo(project.totalCost, 2);
  });

  it('costs only billable rows to a project', () => {
    // Non-billable time is already carried by the indirect rate; charging it to a
    // project as well would count the same hours twice.
    const refCodes = computeProjectFinancials(twoMonths(), YEAR).map((p) => p.refCode);

    expect(refCodes).toEqual(['P1']);
  });

  it('nulls price, profit, margin and every revenue share when there is no price row', () => {
    const model = input({
      timesheet: [hours({ hours: 80 }), hours({ employeeNo: '2', employeeName: 'Bob', hours: 20 })],
      salaries: [
        salary({ monthlySalary: 10_000 }),
        salary({ employeeNo: '2', employeeName: 'Bob', monthlySalary: 5_000 }),
      ],
    });
    const [project] = computeProjectFinancials(model, YEAR);

    expect(project.projectPrice).toBeNull();
    expect(project.revenue).toBeNull();
    expect(project.profit).toBeNull();
    expect(project.marginPct).toBeNull();
    expect(project.employees.every((e) => e.revenueShare === null)).toBe(true);
    expect(project.employees.every((e) => e.profitability === null)).toBe(true);
    // The cost is still real and still reported.
    expect(project.totalCost).toBeGreaterThan(0);
  });

  it('gives a zero price a null margin rather than dividing by zero', () => {
    const model = twoMonths();
    const [project] = computeProjectFinancials(
      { ...model, projects: [{ ...model.projects[0], projectPrice: 0 }] },
      YEAR,
    );

    expect(project.projectPrice).toBe(0);
    expect(project.revenue).toBe(0);
    expect(project.profit).toBeCloseTo(-30_000, 2);
    expect(project.marginPct).toBeNull();
  });

  it('sorts loss-making work first and unpriced work ahead of it', () => {
    const model = twoMonths();
    const withLoss = {
      ...model,
      timesheet: [
        ...model.timesheet,
        hours({ month: 1, refCode: 'LOSS', hours: 10 }),
        hours({ month: 1, refCode: 'GAP', hours: 10 }),
      ],
      projects: [
        ...model.projects,
        {
          refCode: 'LOSS',
          projectName: 'Loss',
          projectPrice: 100,
          salesYear: 2025,
          salesMonth: 1,
          category: 'Projects',
          status: null,
        },
      ],
    };

    expect(computeProjectFinancials(withLoss, YEAR).map((p) => p.refCode)).toEqual([
      'GAP',
      'LOSS',
      'P1',
    ]);
  });
});

describe('computePeriodSummary', () => {
  it('does not double-count by adding non-billable cost to project costs', () => {
    // The trap docs/cost-model.md warns about. A project's cost already carries a
    // share of the indirect pool, and the pool already holds the value of
    // non-billable time, so adding the two charges those hours twice. The result
    // still looks plausible, which is what makes it dangerous.
    const summary = computePeriodSummary(twoMonths(), YEAR);
    const projectCosts = computeProjectFinancials(twoMonths(), YEAR).reduce(
      (total, project) => total + project.totalCost,
      0,
    );
    const nonBillableCost = summary.months.reduce(
      (total, month) => total + month.nonBillableCost,
      0,
    );

    expect(summary.totalCost).toBeCloseTo(summary.totalSalaries, 2);
    expect(projectCosts + nonBillableCost).toBeGreaterThan(summary.totalCost);
    // Computed straight from salaries, so it cannot drift with the project mix.
    expect(summary.totalCost).toBeCloseTo(30_000, 2);
  });

  it('reports an employee with hours but no salary row', () => {
    const model = input({ timesheet: [hours({ hours: 40 })] });
    const summary = computePeriodSummary(model, YEAR);

    expect(summary.missingSalaryEmployees).toEqual([
      { employeeNo: '1', employeeName: 'Alice', year: 2025, month: 1 },
    ]);
  });

  it('reports a billable ref code with no price row', () => {
    const model = input({
      timesheet: [hours({ refCode: 'NOPRICE' }), hours({ category: 'Meetings', refCode: 'FC' })],
      salaries: [salary()],
    });

    expect(computePeriodSummary(model, YEAR).unpricedRefCodes).toEqual(['NOPRICE']);
  });

  it('costs overhead for a month with no rows yet, rather than dropping it', () => {
    // Overhead is entered on the Settings page, often before the spreadsheets for
    // those months exist. Costing only months that already have rows would lose
    // it from every total with nothing to show that it had gone.
    const model = twoMonths({ '2025-01': 800, '2025-08': 9_999 });
    const summary = computePeriodSummary(model, YEAR);

    expect(summary.totalOverhead).toBe(10_799);
    expect(summary.totalCost).toBeCloseTo(40_799, 2);

    const august = computePeriodSummary(model, { year: 2025, month: 8 });
    expect(august.totalOverhead).toBe(9_999);
    expect(august.totalCost).toBeCloseTo(9_999, 2);
    expect(august.months).toHaveLength(1);
    expect(august.months[0].totalSalaries).toBe(0);
  });

  it('ignores an overhead key that is not a month', () => {
    // The settings service rejects these on the way in; the engine must not
    // invent a month out of one that slipped past an older write.
    const summary = computePeriodSummary(
      twoMonths({ banana: 500, '2025-13': 500 } as Record<string, number>),
      YEAR,
    );

    expect(summary.totalOverhead).toBe(0);
  });

  it('adds overhead for the months in the period', () => {
    const summary = computePeriodSummary(twoMonths({ '2025-01': 800, '2025-02': 200 }), YEAR);

    expect(summary.totalOverhead).toBe(1_000);
    expect(summary.totalCost).toBeCloseTo(31_000, 2);
  });

  it('narrows to a single month without recomputing that month rates', () => {
    const january = computePeriodSummary(twoMonths(), JANUARY);

    expect(january.totalSalaries).toBeCloseTo(15_000, 2);
    expect(january.months).toHaveLength(1);
    expect(january.months[0].indirectRate).toBeCloseTo(87.5, 4);
  });

  it('gives null rather than a ratio when there is nothing to divide by', () => {
    const summary = computePeriodSummary(input(), YEAR);

    expect(summary.totalCost).toBe(0);
    expect(summary.marginPct).toBeNull();
    expect(summary.productivityPct).toBeNull();
  });
});

describe('computeProductivity', () => {
  it('gives the billable share of logged time', () => {
    const rows = computeProductivity(twoMonths(), JANUARY);
    const alice = rows.find((row) => row.employeeNo === '1');

    expect(alice?.totalHours).toBe(100);
    expect(alice?.billableHours).toBe(80);
    expect(alice?.productivityPct).toBeCloseTo(0.8, 6);
  });

  it('gives null, not zero percent, to someone who logged nothing', () => {
    const bob = computeProductivity(twoMonths(), JANUARY).find((row) => row.employeeNo === '2');

    expect(bob?.totalHours).toBe(0);
    expect(bob?.productivityPct).toBeNull();
  });

  it('reports zero percent for someone who logged only internal time', () => {
    // A different branch from the zero-hour case, and the one the real data has.
    const model = input({
      timesheet: [hours({ category: 'Meetings', refCode: 'Meetings', hours: 40 })],
      salaries: [salary()],
    });
    const [alice] = computeProductivity(model, YEAR);

    expect(alice.productivityPct).toBe(0);
  });
});

describe('computeCategoryBreakdown', () => {
  it('sorts categories by hours descending and flags billability', () => {
    const model = input({
      timesheet: [
        hours({ category: 'Projects', hours: 10 }),
        hours({ category: 'Meetings', refCode: 'Meetings', hours: 30 }),
        hours({ category: 'Tentwenty', refCode: 'Tentwenty', hours: 20 }),
      ],
      settings: settings(),
    });

    expect(computeCategoryBreakdown(model, YEAR)).toEqual([
      { category: 'Meetings', billable: false, hours: 30, hoursPct: 0.5 },
      { category: 'Tentwenty', billable: false, hours: 20, hoursPct: 1 / 3 },
      { category: 'Projects', billable: true, hours: 10, hoursPct: 1 / 6 },
    ]);
  });

  it('is empty rather than dividing by zero when nothing was logged', () => {
    expect(computeCategoryBreakdown(input(), YEAR)).toEqual([]);
  });
});

describe('no path produces NaN or Infinity', () => {
  it('survives zero hours, zero billable hours, no salary and a zero price', () => {
    const model = input({
      timesheet: [
        hours({ hours: 0 }),
        hours({ employeeNo: '2', employeeName: 'Bob', category: 'Meetings', refCode: 'FC' }),
      ],
      salaries: [salary({ employeeNo: '3', employeeName: 'Carol', monthlySalary: 0 })],
      projects: [
        {
          refCode: 'P1',
          projectName: 'Zero',
          projectPrice: 0,
          salesYear: null,
          salesMonth: null,
          category: 'Projects',
          status: null,
        },
      ],
    });

    const numbers = JSON.stringify({
      summary: computePeriodSummary(model, YEAR),
      projects: computeProjectFinancials(model, YEAR),
      productivity: computeProductivity(model, YEAR),
      categories: computeCategoryBreakdown(model, YEAR),
    });

    // JSON.stringify writes NaN and Infinity as null, so scan the values instead.
    const parsed = JSON.parse(numbers) as unknown;
    expect(collectNumbers(parsed).every(Number.isFinite)).toBe(true);
    expect(numbers).not.toMatch(/NaN|Infinity/);
  });
});

function collectNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(collectNumbers);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(collectNumbers);
  }
  return [];
}

describe('the engine stays pure', () => {
  const source = readFileSync(join(__dirname, '../../src/calc/engine.ts'), 'utf8');
  // The set of modules, not the count of import statements — a module may be
  // imported twice, once for types and once for a value.
  const imports = [
    ...new Set([...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])),
  ].sort();

  it('imports nothing from lib/, services/ or express', () => {
    // Purity is what lets selfcheck verify the whole model from the command line
    // without booting Express, and it is explicitly part of the grade.
    expect(imports).toEqual(['../parse/dates', '@shared/types']);
    expect(imports.some((specifier) => /lib\/|services\/|express/.test(specifier))).toBe(false);
  });

  it('reads no storage, no request and no clock', () => {
    for (const forbidden of ['better-sqlite3', 'node:fs', 'Date.now', 'new Date', 'process.env']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('returns the same numbers for the same input', () => {
    const first = computePeriodSummary(twoMonths(), YEAR);
    const second = computePeriodSummary(twoMonths(), YEAR);

    expect(first).toEqual(second);
  });
});

describe('ALL_TIME', () => {
  it('selects every year, which is what a project detail is costed over', () => {
    const [project] = computeProjectFinancials(twoYears(), ALL_TIME);

    expect(project.totalHours).toBe(200);
    expect(project.totalCost).toBeCloseTo(30_000, 2);
    // The whole price is recognised once every hour has been logged.
    expect(project.revenue).toBeCloseTo(60_000, 2);
    expect(project.profit).toBeCloseTo(30_000, 2);
  });

  it('decomposes exactly into the individual years', () => {
    // The guarantee behind "rates are always derived from the full month": a
    // filtered view must not recompute anything, only aggregate less.
    const model = twoYears();
    const allTime = computeProjectFinancials(model, ALL_TIME)[0];

    const perYear = [2024, 2025].map(
      (year) => computeProjectFinancials(model, { year, month: null })[0],
    );

    expect(perYear.reduce((sum, project) => sum + project.totalCost, 0)).toBeCloseTo(
      allTime.totalCost,
      2,
    );
    expect(perYear.reduce((sum, project) => sum + project.totalHours, 0)).toBe(allTime.totalHours);
    // Revenue is attributed pro-rata, so the years split the price between them.
    expect(perYear.map((project) => project.revenue)).toEqual([30_000, 30_000]);
  });

  it('costs each year at its own rates rather than averaging them', () => {
    const model = twoYears();

    expect(computeProjectFinancials(model, { year: 2024, month: null })[0].totalCost).toBeCloseTo(
      10_000,
      2,
    );
    expect(computeProjectFinancials(model, { year: 2025, month: null })[0].totalCost).toBeCloseTo(
      20_000,
      2,
    );
  });

  it('narrows to a month across every year when only the year is null', () => {
    const model = twoYears();

    expect(computeProjectFinancials(model, { year: null, month: 1 })[0].totalHours).toBe(200);
    expect(computeProjectFinancials(model, { year: null, month: 2 })).toEqual([]);
  });

  it('reports a period summary spanning both years, with a null year', () => {
    const summary = computePeriodSummary(twoYears(), ALL_TIME);

    expect(summary.year).toBeNull();
    expect(summary.totalSalaries).toBeCloseTo(30_000, 2);
    expect(summary.totalCost).toBeCloseTo(summary.totalSalaries, 2);
    expect(summary.months).toHaveLength(2);
  });

  it('keeps the invariant across years, not just within one', () => {
    for (const month of computeMonthCostSummaries(twoYears())) {
      expect(bucketTotal(month)).toBeCloseTo(month.totalSalaries, 2);
    }
  });

  it('aggregates productivity and categories across years too', () => {
    expect(computeProductivity(twoYears(), ALL_TIME)[0].totalHours).toBe(200);
    expect(computeCategoryBreakdown(twoYears(), ALL_TIME)[0].hours).toBe(200);
  });
});
