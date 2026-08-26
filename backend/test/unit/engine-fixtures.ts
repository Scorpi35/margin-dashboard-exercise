import type { SalaryRow, Settings, TimesheetRow } from '@shared/types';

import type { EngineInput } from '../../src/calc/engine';

/**
 * A two-person agency with numbers that divide cleanly, so every figure in
 * `engine.test.ts` can be checked on paper.
 *
 * The sample data contains no support-staff months — all twelve employees log
 * hours in all twelve months — so that branch of the model is only ever exercised
 * by fixtures like this one. Keep them.
 */

export const BILLABLE = ['Projects'];

export function settings(monthlyOverhead: Record<string, number> = {}): Settings {
  return { billableCategories: BILLABLE, monthlyOverhead };
}

export function hours(overrides: Partial<TimesheetRow> = {}): TimesheetRow {
  return {
    year: 2025,
    month: 1,
    employeeNo: '1',
    employeeName: 'Alice',
    expenseType: 'DL',
    department: 'Design',
    designation: 'Designer',
    category: 'Projects',
    refCode: 'P1',
    taskName: null,
    companyName: null,
    description: null,
    hours: 10,
    ...overrides,
  };
}

export function salary(overrides: Partial<SalaryRow> = {}): SalaryRow {
  return {
    year: 2025,
    month: 1,
    employeeNo: '1',
    employeeName: 'Alice',
    monthlySalary: 10_000,
    ...overrides,
  };
}

export function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    timesheet: [],
    salaries: [],
    projects: [],
    settings: settings(),
    ...overrides,
  };
}

/**
 * Two months that reconcile by hand.
 *
 * January — Alice earns 10,000 for 100 hours (80 on P1, 20 in meetings), so her
 * direct rate is 100. Bob earns 5,000 and logs nothing, so his whole salary is
 * pool. Pool = 5,000 + 20 x 100 = 7,000 over 80 billable hours = 87.50/hour.
 *
 * February — the two swap roles. Bob earns 5,000 for 50 billable hours, a rate of
 * 100; Alice logs nothing, so her 10,000 is pool. Pool = 10,000 over 50 hours =
 * 200/hour.
 *
 * Both months reconcile to their payroll of 15,000: 8,000 + 7,000 in January and
 * 5,000 + 10,000 in February. The two-month total is therefore 30,000.
 */
export function twoMonths(monthlyOverhead: Record<string, number> = {}): EngineInput {
  return input({
    timesheet: [
      hours({ month: 1, employeeNo: '1', employeeName: 'Alice', hours: 80, refCode: 'P1' }),
      hours({
        month: 1,
        employeeNo: '1',
        employeeName: 'Alice',
        hours: 20,
        category: 'Meetings',
        refCode: 'Meetings',
      }),
      hours({
        month: 2,
        employeeNo: '2',
        employeeName: 'Bob',
        department: 'Backend',
        designation: 'Engineer',
        hours: 50,
        refCode: 'P1',
      }),
    ],
    salaries: [
      salary({ month: 1, employeeNo: '1', employeeName: 'Alice', monthlySalary: 10_000 }),
      salary({ month: 1, employeeNo: '2', employeeName: 'Bob', monthlySalary: 5_000 }),
      salary({ month: 2, employeeNo: '1', employeeName: 'Alice', monthlySalary: 10_000 }),
      salary({ month: 2, employeeNo: '2', employeeName: 'Bob', monthlySalary: 5_000 }),
    ],
    projects: [
      {
        refCode: 'P1',
        projectName: 'Project One',
        projectPrice: 40_000,
        salesYear: 2025,
        salesMonth: 1,
        category: 'Projects',
        status: 'completed',
      },
    ],
    settings: settings(monthlyOverhead),
  });
}

/** Every dirham of salary, traced through the three buckets it can land in. */
export function bucketTotal(month: {
  employees: readonly { billableHours: number; directRate: number }[];
  indirectPool: number;
}): number {
  const billableCost = month.employees.reduce(
    (total, employee) => total + employee.billableHours * employee.directRate,
    0,
  );

  return billableCost + month.indirectPool;
}

/**
 * The same person on the same project across two years, at different salaries.
 *
 * 2024 — Alice earns 10,000 for 100 billable hours, so her rate is 100 and the
 * project costs 10,000. Nothing is non-billable and nobody is idle, so the pool
 * and the indirect rate are both zero.
 *
 * 2025 — she earns 20,000 for another 100 hours, a rate of 200, costing 20,000.
 *
 * All-time the project has 200 hours and costs 30,000 against a price of 60,000.
 * Filtering to either year halves the hours and the revenue.
 */
export function twoYears(): EngineInput {
  return input({
    timesheet: [
      hours({ year: 2024, month: 1, hours: 100, refCode: 'P1' }),
      hours({ year: 2025, month: 1, hours: 100, refCode: 'P1' }),
    ],
    salaries: [
      salary({ year: 2024, month: 1, monthlySalary: 10_000 }),
      salary({ year: 2025, month: 1, monthlySalary: 20_000 }),
    ],
    projects: [
      {
        refCode: 'P1',
        projectName: 'Project One',
        projectPrice: 60_000,
        salesYear: 2024,
        salesMonth: 1,
        category: 'Projects',
        status: 'completed',
      },
    ],
  });
}
