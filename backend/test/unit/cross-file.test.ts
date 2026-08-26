import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_BILLABLE_CATEGORIES } from '@shared/types';

import { parseProjects } from '../../src/parse/projects';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';

/**
 * The three files only mean anything together: `Ref Code` joins a timesheet row to
 * a price, `Employee No.` joins it to a salary. A parser can be individually
 * correct and still leave the set unjoinable, so the joins are asserted here.
 */

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

const timesheet = parseTimesheet(read('timesheet-2025.xlsx'), 'timesheet-2025.xlsx');
const salary = parseSalary(read('salaries-2025.xlsx'), 'salaries-2025.xlsx');
const projects = parseProjects(read('project-prices-2025.xlsx'), 'project-prices-2025.xlsx');

const billableRefCodes = new Set(
  timesheet.rows
    .filter((row) => DEFAULT_BILLABLE_CATEGORIES.includes(row.category))
    .map((row) => row.refCode),
);

describe('the three sample files join up', () => {
  it('parses all three without a single warning', () => {
    expect([...timesheet.warnings, ...salary.warnings, ...projects.warnings]).toEqual([]);
  });

  it('gives every billable ref code a matching price row', () => {
    const priced = new Set(projects.rows.map((row) => row.refCode));
    const unpriced = [...billableRefCodes].filter((refCode) => !priced.has(refCode)).sort();

    expect(unpriced).toEqual([]);
  });

  it('gives every priced project hours in the timesheet', () => {
    const unworked = projects.rows
      .map((row) => row.refCode)
      .filter((refCode) => !billableRefCodes.has(refCode))
      .sort();

    expect(unworked).toEqual([]);
    expect(billableRefCodes.size).toBe(11);
  });

  it('gives every employee who logged hours a salary row for that month', () => {
    const paid = new Set(salary.rows.map((row) => `${row.employeeNo}:${row.year}-${row.month}`));
    const unpaid = timesheet.rows
      .map((row) => `${row.employeeNo}:${row.year}-${row.month}`)
      .filter((key) => !paid.has(key));

    expect([...new Set(unpaid)]).toEqual([]);
  });

  it('agrees on the set of employees across the timesheet and the salary sheet', () => {
    const logged = new Set(timesheet.rows.map((row) => row.employeeNo));
    const onPayroll = new Set(salary.rows.map((row) => row.employeeNo));

    expect([...logged].sort()).toEqual([...onPayroll].sort());
  });

  it('resolves both month formats onto the same periods', () => {
    // "January 2025" in the timesheet, "January '25" in the price list.
    const salesPeriods = projects.rows.map((row) => `${row.salesYear}-${row.salesMonth}`);
    const loggedPeriods = new Set(timesheet.rows.map((row) => `${row.year}-${row.month}`));

    expect(salesPeriods.every((period) => loggedPeriods.has(period))).toBe(true);
  });

  it('treats Tentwenty as internal work despite the missing FC prefix', () => {
    // 138.7 hours that a prefix test would wrongly bill. Its ref code must not
    // appear among the billable ones.
    const tentwenty = timesheet.rows.filter((row) => row.category === 'Tentwenty');

    expect(tentwenty.length).toBeGreaterThan(0);
    expect(DEFAULT_BILLABLE_CATEGORIES.includes('Tentwenty')).toBe(false);
    expect(tentwenty.every((row) => !billableRefCodes.has(row.refCode))).toBe(true);
  });
});
