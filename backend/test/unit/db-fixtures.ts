import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ParseResult, ProjectRow, SalaryRow, TimesheetRow } from '@shared/types';

import { closeDb, useDatabase } from '../../src/lib/db';
import { parseProjects } from '../../src/parse/projects';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';

/** Each test gets its own database file, so nothing leaks between them. */
let directory: string | null = null;

export function openTestDatabase(): string {
  directory = mkdtempSync(join(tmpdir(), 'margin-db-'));
  const path = join(directory, 'test.db');
  useDatabase(path);

  return path;
}

export function closeTestDatabase(): void {
  closeDb();
  if (directory !== null) rmSync(directory, { recursive: true, force: true });
  directory = null;
}

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

export const sample = {
  timesheet: (): ParseResult<TimesheetRow> =>
    parseTimesheet(read('timesheet-2025.xlsx'), 'timesheet-2025.xlsx'),
  salaries: (): ParseResult<SalaryRow> =>
    parseSalary(read('salaries-2025.xlsx'), 'salaries-2025.xlsx'),
  projects: (): ParseResult<ProjectRow> =>
    parseProjects(read('project-prices-2025.xlsx'), 'project-prices-2025.xlsx'),
};

/** A parse result with no warnings, for driving the ingest service directly. */
export function parsed<T>(rows: T[]): ParseResult<T> {
  return { rows, warnings: [] };
}

export function entry(overrides: Partial<TimesheetRow> = {}): TimesheetRow {
  return {
    year: 2025,
    month: 1,
    employeeNo: '10201',
    employeeName: 'Ayesha Rahman',
    expenseType: 'DL',
    department: 'Design',
    designation: 'Senior UI/UX Designer',
    category: 'Projects',
    refCode: 'Q2025001a',
    taskName: 'Meridian Website',
    companyName: 'Meridian',
    description: 'design',
    hours: 8,
    ...overrides,
  };
}

export function pay(overrides: Partial<SalaryRow> = {}): SalaryRow {
  return {
    year: 2025,
    month: 1,
    employeeNo: '10201',
    employeeName: 'Ayesha Rahman',
    monthlySalary: 18_000,
    ...overrides,
  };
}

export function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    refCode: 'Q2025001a',
    projectName: 'Meridian-Website.pdf',
    projectPrice: 560_000,
    salesYear: 2025,
    salesMonth: 1,
    category: 'Projects',
    status: 'in progress',
    ...overrides,
  };
}
