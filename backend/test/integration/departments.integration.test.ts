import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DepartmentBreakdown, DepartmentRow, PeriodSummary } from '@shared/types';

import { createApp } from '../../src/app';
import { closeDb, useDatabase } from '../../src/lib/db';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';
import { ingestSalaries, ingestTimesheet, readTimesheet } from '../../src/services/ingest.service';
import { saveSettings } from '../../src/services/settings.service';

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-departments-'));
  useDatabase(join(directory, 'test.db'));
  ingestTimesheet(parseTimesheet(read('timesheet-2025.xlsx'), 't.xlsx'), 't.xlsx');
  ingestSalaries(parseSalary(read('salaries-2025.xlsx'), 's.xlsx'), 's.xlsx');
});

afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

async function departments(query = 'year=2025'): Promise<DepartmentBreakdown> {
  const response = await request(createApp()).get(`/api/departments?${query}`).expect(200);

  return response.body.data as DepartmentBreakdown;
}

async function department(name: string, query = 'year=2025'): Promise<DepartmentRow> {
  const response = await request(createApp())
    .get(`/api/departments/${encodeURIComponent(name)}?${query}`)
    .expect(200);

  return response.body.data as DepartmentRow;
}

async function dashboard(): Promise<PeriodSummary> {
  const response = await request(createApp()).get('/api/dashboard?year=2025').expect(200);

  return response.body.data as PeriodSummary;
}

describe('GET /api/departments', () => {
  it('lists the six sample departments, costliest first', async () => {
    const { rows } = await departments();

    expect(rows.map((row) => row.department)).toEqual([
      'Design',
      'Backend',
      'Management',
      'Frontend',
      'App',
      'QA',
    ]);
  });

  it('sums hours to the company total for the period', async () => {
    const breakdown = await departments();
    const summary = await dashboard();

    expect(breakdown.totalHours).toBeCloseTo(summary.totalHours, 4);
    expect(breakdown.rows.reduce((total, row) => total + row.totalHours, 0)).toBeCloseTo(
      summary.totalHours,
      4,
    );
  });

  it('sums cost to payroll, because a department costs its salaries', async () => {
    const breakdown = await departments();
    const summary = await dashboard();

    expect(breakdown.totalCost).toBeCloseTo(2_400_000, 2);
    expect(breakdown.totalCost).toBeCloseTo(summary.totalSalaries, 2);
    expect(breakdown.rows.reduce((total, row) => total + row.cost, 0)).toBeCloseTo(
      breakdown.totalCost,
      2,
    );
  });

  it('leaves overhead out, since it belongs to no department', async () => {
    saveSettings({
      billableCategories: ['Projects', 'Enhancements', 'Hosting'],
      monthlyOverhead: { '2025-01': 60_000 },
    });

    const breakdown = await departments();
    const summary = await dashboard();

    expect(breakdown.totalCost).toBeCloseTo(2_400_000, 2);
    expect(summary.totalCost - breakdown.totalCost).toBeCloseTo(60_000, 2);
  });

  it('accounts for all twelve employees exactly once', async () => {
    const { rows } = await departments();
    const everyone = rows.flatMap((row) => row.employees.map((employee) => employee.employeeNo));

    expect(everyone).toHaveLength(12);
    expect(new Set(everyone).size).toBe(12);
    expect(rows.reduce((total, row) => total + row.headcount, 0)).toBe(12);
  });

  it('narrows to a single month', async () => {
    const january = await departments('year=2025&month=1');

    expect(january.totalHours).toBeCloseTo(1_634.6, 1);
    expect(january.totalCost).toBeCloseTo(197_000, 2);
  });

  it('rejects a year that is not a number', async () => {
    await request(createApp()).get('/api/departments?year=banana').expect(400);
  });
});

describe('GET /api/departments/:department', () => {
  it('lists every person in the department', async () => {
    const design = await department('Design');
    const expected = new Set(
      readTimesheet()
        .filter((row) => row.department === 'Design')
        .map((row) => row.employeeNo),
    );

    expect(design.headcount).toBe(expected.size);
    expect(new Set(design.employees.map((employee) => employee.employeeNo))).toEqual(expected);
  });

  it('reports hours and cost that match the row in the list', async () => {
    const design = await department('Design');
    const fromList = (await departments()).rows.find((row) => row.department === 'Design');

    expect(design.totalHours).toBeCloseTo(fromList!.totalHours, 4);
    expect(design.cost).toBeCloseTo(fromList!.cost, 2);
    expect(design.cost).toBeCloseTo(633_000, 2);
  });

  it("sums its people's hours back to the department total", async () => {
    const design = await department('Design');
    const hours = design.employees.reduce((total, employee) => total + employee.totalHours, 0);

    expect(hours).toBeCloseTo(design.totalHours, 4);
  });

  it('gives Management a zero billable share rather than hiding it', async () => {
    const management = await department('Management');

    expect(management.billableHours).toBe(0);
    expect(management.productivityPct).toBe(0);
    expect(management.headcount).toBe(2);
  });

  it('answers an unknown department with a 404', async () => {
    const response = await request(createApp())
      .get('/api/departments/Marketing?year=2025')
      .expect(404);

    expect(response.body.status).toBe('error');
    expect(response.body.message).toMatch(/Marketing/);
    expect(response.body).not.toHaveProperty('data');
  });

  it('rejects a blank department name', async () => {
    await request(createApp()).get('/api/departments/%20?year=2025').expect(400);
  });
});

describe('department names in a URL', () => {
  /** Names come from a spreadsheet column and are not guaranteed to be URL-safe. */
  const AWKWARD = 'R&D / Special Projects';

  beforeEach(() => {
    ingestTimesheet(
      {
        rows: [
          {
            year: 2025,
            month: 1,
            employeeNo: '90001',
            employeeName: 'Sam Lee',
            expenseType: 'DL',
            department: AWKWARD,
            designation: 'Researcher',
            category: 'Projects',
            refCode: 'Q2025001a',
            taskName: null,
            companyName: null,
            description: null,
            hours: 12,
          },
        ],
        warnings: [],
      },
      'extra.xlsx',
    );
  });

  it('round-trips a name carrying a slash and an ampersand', async () => {
    // %2F is the case that breaks a router that splits on the raw path.
    const row = await department(AWKWARD);

    expect(row.department).toBe(AWKWARD);
    expect(row.headcount).toBe(1);
    expect(row.totalHours).toBe(12);
  });

  it('lists the same name unencoded in the breakdown', async () => {
    const { rows } = await departments();

    expect(rows.map((row) => row.department)).toContain(AWKWARD);
  });
});
