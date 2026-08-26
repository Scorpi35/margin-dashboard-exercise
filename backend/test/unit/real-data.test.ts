import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_BILLABLE_CATEGORIES } from '@shared/types';

import {
  computeCategoryBreakdown,
  computeMonthCostSummaries,
  computePeriodSummary,
  computeProductivity,
  computeProjectFinancials,
  type EngineInput,
} from '../../src/calc/engine';
import { parseProjects } from '../../src/parse/projects';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';
import { bucketTotal } from './engine-fixtures';

/**
 * The engine against the committed spreadsheets, pinned to the figures in
 * docs/cost-model.md. A regression against real data surfaces here rather than in
 * a dashboard nobody thought to re-check.
 */

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

const input: EngineInput = {
  timesheet: parseTimesheet(read('timesheet-2025.xlsx'), 'timesheet-2025.xlsx').rows,
  salaries: parseSalary(read('salaries-2025.xlsx'), 'salaries-2025.xlsx').rows,
  projects: parseProjects(read('project-prices-2025.xlsx'), 'project-prices-2025.xlsx').rows,
  settings: { billableCategories: DEFAULT_BILLABLE_CATEGORIES, monthlyOverhead: {} },
};

const YEAR = { year: 2025, month: null };
const JANUARY = { year: 2025, month: 1 };

const months = computeMonthCostSummaries(input);
const january = months[0];

describe('the invariant on real data', () => {
  it('reconciles the year to payroll exactly', () => {
    const summary = computePeriodSummary(input, YEAR);

    expect(summary.totalCost).toBeCloseTo(2_400_000, 2);
    expect(summary.totalCost).toBeCloseTo(summary.totalSalaries, 2);
  });

  it('reconciles every individual month, not just the annual total', () => {
    expect(months).toHaveLength(12);

    for (const month of months) {
      expect(bucketTotal(month)).toBeCloseTo(month.totalSalaries, 2);
      expect(month.totalCost).toBeCloseTo(month.totalSalaries, 2);
    }
  });

  it('sums the twelve months back to the year', () => {
    const total = months.reduce((sum, month) => sum + month.totalCost, 0);

    expect(total).toBeCloseTo(2_400_000, 2);
  });

  it('picks up the July raise rather than averaging it', () => {
    expect(months[5].totalSalaries).toBeCloseTo(197_000, 2);
    expect(months[6].totalSalaries).toBeCloseTo(203_000, 2);
  });
});

describe('January 2025, the worked example', () => {
  it('matches the documented inputs', () => {
    expect(january.totalSalaries).toBeCloseTo(197_000, 2);
    expect(january.totalHours).toBeCloseTo(1_634.6, 1);
    expect(january.billableHours).toBeCloseTo(1_283.5, 1);
    expect(january.nonBillableHours).toBeCloseTo(351.1, 1);
    // Every employee logs hours in the sample, so nothing takes the zero-hour path.
    expect(january.supportStaffSalaries).toBe(0);
  });

  it("gives Ayesha Rahman's direct rate as 18000 / 176", () => {
    const ayesha = january.employees.find((employee) => employee.employeeNo === '10201');

    expect(ayesha?.salary).toBe(18_000);
    expect(ayesha?.totalHours).toBeCloseTo(176, 1);
    expect(ayesha?.billableHours).toBeCloseTo(135.9, 1);
    expect(ayesha?.directRate).toBeCloseTo(102.2727, 4);
  });

  it('gives the indirect rate as 72,612.93 / 1,283.5', () => {
    expect(january.nonBillableCost).toBeCloseTo(72_612.93, 2);
    expect(january.indirectPool).toBeCloseTo(72_612.93, 2);
    expect(january.indirectRate).toBeCloseTo(56.5742, 4);
  });

  it("costs Ayesha's January project work at 21,587.29", () => {
    const contributions = computeProjectFinancials(input, JANUARY).flatMap(
      (project) => project.employees,
    );
    const ayesha = contributions.filter((employee) => employee.employeeNo === '10201');
    const cost = ayesha.reduce((total, employee) => total + employee.cost, 0);

    expect(cost).toBeCloseTo(21_587.29, 2);
  });
});

describe('the year as a whole', () => {
  it('varies the indirect rate month to month, which is why rates are never averaged', () => {
    const rates = months.map((month) => month.indirectRate);

    expect(Math.min(...rates)).toBeCloseTo(48.44, 2);
    expect(Math.max(...rates)).toBeCloseTo(66.87, 2);
  });

  it('reproduces the documented project table, loss-making work first', () => {
    const projects = computeProjectFinancials(input, YEAR).map((project) => ({
      refCode: project.refCode,
      price: project.projectPrice,
      hours: Number(project.totalHours.toFixed(1)),
      cost: Math.round(project.totalCost),
      margin: Number((project.marginPct! * 100).toFixed(1)),
    }));

    expect(projects).toEqual([
      { refCode: 'E2025050a', price: 92_000, hours: 1_225.2, cost: 195_062, margin: -112 },
      { refCode: 'H2025060c', price: 46_000, hours: 644.2, cost: 96_080, margin: -108.9 },
      { refCode: 'E2025055b', price: 104_000, hours: 855.3, cost: 129_854, margin: -24.9 },
      { refCode: 'Q2025021e', price: 250_000, hours: 1_325.5, cost: 218_659, margin: 12.5 },
      { refCode: 'Q2025009b', price: 330_000, hours: 1_842.6, cost: 283_113, margin: 14.2 },
      { refCode: 'Q2025001a', price: 560_000, hours: 3_025.2, cost: 468_776, margin: 16.3 },
      { refCode: 'Q2025033g', price: 300_000, hours: 1_148.3, cost: 177_242, margin: 40.9 },
      { refCode: 'Q2025004c', price: 900_000, hours: 1_808.7, cost: 294_322, margin: 67.3 },
      { refCode: 'Q2025014d', price: 690_000, hours: 1_304.3, cost: 203_009, margin: 70.6 },
      { refCode: 'Q2025041h', price: 760_000, hours: 1_096.8, cost: 176_503, margin: 76.8 },
      { refCode: 'Q2025027f', price: 980_000, hours: 989.5, cost: 157_380, margin: 83.9 },
    ]);
  });

  it('recognises the full contract value over the whole year', () => {
    const summary = computePeriodSummary(input, YEAR);
    const contracted = input.projects.reduce((total, p) => total + (p.projectPrice ?? 0), 0);

    // Pro-rata attribution and booking-at-sale agree over a full year; only a
    // month view differs.
    expect(summary.totalRevenue).toBeCloseTo(contracted, 2);
    expect(summary.totalRevenue).toBeCloseTo(5_012_000, 2);
  });

  it('splits a month revenue pro-rata without losing any of it', () => {
    const monthly = Array.from({ length: 12 }, (_, index) =>
      computePeriodSummary(input, { year: 2025, month: index + 1 }),
    ).reduce((total, summary) => total + summary.totalRevenue, 0);

    expect(monthly).toBeCloseTo(5_012_000, 2);
  });

  it('has no gaps to report — the sample data is clean', () => {
    const summary = computePeriodSummary(input, YEAR);

    expect(summary.unpricedRefCodes).toEqual([]);
    expect(summary.missingSalaryEmployees).toEqual([]);
  });

  it('gives the two management employees zero percent productivity', () => {
    // They log only non-billable time. A different branch from the zero-hour case.
    const rows = computeProductivity(input, YEAR);
    const idle = rows.filter((row) => row.productivityPct === 0).map((row) => row.employeeName);

    expect(idle.sort()).toEqual(['Hana Yousef', 'Omar Zayed']);
    expect(rows).toHaveLength(12);
  });

  it('keeps Tentwenty non-billable despite the missing FC prefix', () => {
    const { rows: categories } = computeCategoryBreakdown(input, YEAR);
    const tentwenty = categories.find((row) => row.category === 'Tentwenty');

    expect(tentwenty?.isBillable).toBe(false);
    expect(tentwenty?.hours).toBeCloseTo(138.7, 1);
  });

  it('reports the documented category hours, largest first', () => {
    const { rows: categories } = computeCategoryBreakdown(input, YEAR);

    expect(categories[0]).toMatchObject({ category: 'Projects', isBillable: true });
    expect(categories[0].hours).toBeCloseTo(12_540.9, 1);
    expect(categories.map((row) => row.hours)).toEqual(
      [...categories.map((row) => row.hours)].sort((a, b) => b - a),
    );
    expect(
      categories
        .filter((row) => row.isBillable)
        .map((row) => row.category)
        .sort(),
    ).toEqual(['Enhancements', 'Hosting', 'Projects']);
  });

  it('carries totals that agree with the dashboard', () => {
    const breakdown = computeCategoryBreakdown(input, YEAR);
    const summary = computePeriodSummary(input, YEAR);

    expect(breakdown.totalHours).toBeCloseTo(19_815.2, 1);
    expect(breakdown.billableHours).toBeCloseTo(15_265.6, 1);
    expect(breakdown.nonBillableHours).toBeCloseTo(4_549.6, 1);

    // Same figures as the dashboard reports, from the same computation.
    expect(breakdown.totalHours).toBeCloseTo(summary.totalHours, 4);
    expect(breakdown.billableHours).toBeCloseTo(summary.billableHours, 4);
    expect(breakdown.rows.reduce((sum, row) => sum + row.hours, 0)).toBeCloseTo(
      breakdown.totalHours,
      4,
    );
  });
});

describe('per-employee profitability on Q2025001a', () => {
  const project = computeProjectFinancials(input, YEAR).find(
    (candidate) => candidate.refCode === 'Q2025001a',
  );

  it('matches a hand-worked figure for one person', () => {
    // Hand-checked against the spreadsheet, not against the engine:
    //   share = 560,000 x 520.9 / 3,025.2       = 96,424.6992
    //   profitability
    //     = (96,424.6992 - 67,222.4559) / 96,424.6992
    //     = 0.302850
    const rohit = project?.employees.find((employee) => employee.employeeNo === '10202');

    expect(rohit?.hours).toBeCloseTo(520.9, 1);
    expect(rohit?.cost).toBeCloseTo(67_222.4559, 2);
    expect(rohit?.revenueShare).toBeCloseTo(96_424.6992, 2);
    expect(rohit?.profitability).toBeCloseTo(0.30285, 5);
  });

  it('gives every contributor a profitability derived from their own share', () => {
    expect(project?.employees).toHaveLength(10);

    for (const employee of project?.employees ?? []) {
      expect(employee.revenueShare).not.toBeNull();
      expect(employee.profitability).toBeCloseTo(
        ((employee.revenueShare ?? 0) - employee.cost) / (employee.revenueShare ?? 1),
        10,
      );
    }
  });

  it('shares the whole price out between the ten of them', () => {
    const shares = (project?.employees ?? []).reduce(
      (total, employee) => total + (employee.revenueShare ?? 0),
      0,
    );

    expect(shares).toBeCloseTo(project?.projectPrice ?? 0, 2);
    expect(shares).toBeCloseTo(560_000, 2);
  });
});

describe('overhead on real data', () => {
  it('is additive and moves the indirect rate without touching salaries', () => {
    const withOverhead = computeMonthCostSummaries({
      ...input,
      settings: { ...input.settings, monthlyOverhead: { '2025-01': 100_000 } },
    })[0];

    expect(withOverhead.totalSalaries).toBeCloseTo(197_000, 2);
    expect(withOverhead.indirectPool).toBeCloseTo(172_612.93, 2);
    expect(withOverhead.indirectRate).toBeGreaterThan(january.indirectRate);
    expect(withOverhead.totalCost).toBeCloseTo(297_000, 2);
  });
});
