import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectFinancials } from '@shared/types';

import { createApp } from '../../src/app';
import { closeDb, useDatabase } from '../../src/lib/db';
import { parseProjects } from '../../src/parse/projects';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';
import {
  ingestProjects,
  ingestSalaries,
  ingestTimesheet,
  readTimesheet,
} from '../../src/services/ingest.service';

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-projects-'));
  useDatabase(join(directory, 'test.db'));
  ingestTimesheet(parseTimesheet(read('timesheet-2025.xlsx'), 't.xlsx'), 't.xlsx');
  ingestSalaries(parseSalary(read('salaries-2025.xlsx'), 's.xlsx'), 's.xlsx');
  ingestProjects(parseProjects(read('project-prices-2025.xlsx'), 'p.xlsx'), 'p.xlsx');
});

afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

async function list(query = 'year=2025'): Promise<ProjectFinancials[]> {
  const response = await request(createApp()).get(`/api/projects?${query}`).expect(200);

  return response.body.data as ProjectFinancials[];
}

async function detail(refCode: string): Promise<ProjectFinancials> {
  const response = await request(createApp()).get(`/api/projects/${refCode}`).expect(200);

  return response.body.data as ProjectFinancials;
}

const total = (values: Record<string, number>): number =>
  Object.values(values).reduce((sum, value) => sum + value, 0);

describe('GET /api/projects', () => {
  it('lists all eleven sample projects when unfiltered', async () => {
    expect(await list()).toHaveLength(11);
  });

  it('puts the three loss-making projects first', async () => {
    // The answer the tool exists to give. Burying them under eight profitable
    // rows would be a failure of the page, not a preference.
    const projects = await list();

    expect(projects.slice(0, 3).map((project) => project.refCode)).toEqual([
      'E2025050a',
      'H2025060c',
      'E2025055b',
    ]);
    expect(projects.slice(0, 3).every((project) => (project.marginPct ?? 0) < 0)).toBe(true);
  });

  it('gives every row a profit equal to price minus cost, to the dirham', async () => {
    for (const project of await list()) {
      expect(project.profit).toBeCloseTo((project.projectPrice ?? 0) - project.totalCost, 2);
    }
  });

  it('reproduces the documented margins', async () => {
    const margins = Object.fromEntries(
      (await list()).map((project) => [
        project.refCode,
        Number((project.marginPct! * 100).toFixed(1)),
      ]),
    );

    expect(margins).toMatchObject({
      E2025050a: -112,
      H2025060c: -108.9,
      E2025055b: -24.9,
      Q2025027f: 83.9,
    });
  });

  it('narrows to the projects worked on in a single month', async () => {
    const january = await list('year=2025&month=1');
    const workedInJanuary = new Set(
      readTimesheet()
        .filter((row) => row.month === 1 && row.refCode.startsWith('Q'))
        .map((row) => row.refCode),
    );

    expect(january.length).toBeLessThan(11);
    expect(january.every((project) => workedInJanuary.has(project.refCode))).toBe(true);
  });

  it('rejects a year that is not a number', async () => {
    const response = await request(createApp()).get('/api/projects?year=banana').expect(400);

    expect(response.body.message).toMatch(/"year"/);
  });
});

describe('GET /api/projects/:refCode', () => {
  it('breaks Q2025001a down by department and by person', async () => {
    const project = await detail('Q2025001a');

    expect(Object.keys(project.hoursByDepartment)).toHaveLength(5);
    expect(project.employees).toHaveLength(10);
  });

  it('sums department hours and costs back to the project totals', async () => {
    const project = await detail('Q2025001a');

    expect(total(project.hoursByDepartment)).toBeCloseTo(project.totalHours, 4);
    expect(total(project.costByDepartment)).toBeCloseTo(project.totalCost, 2);
  });

  it('sums employee hours and costs back to the project totals', async () => {
    const project = await detail('Q2025001a');
    const hours = project.employees.reduce((sum, employee) => sum + employee.hours, 0);
    const cost = project.employees.reduce((sum, employee) => sum + employee.cost, 0);

    expect(hours).toBeCloseTo(project.totalHours, 4);
    expect(cost).toBeCloseTo(project.totalCost, 2);
  });

  it('gives every contributor a profitability, none of them absent', async () => {
    const project = await detail('Q2025001a');

    for (const employee of project.employees) {
      expect(employee.revenueShare).not.toBeNull();
      expect(Number.isFinite(employee.profitability)).toBe(true);
      expect(employee.profitability).toBeCloseTo(
        ((employee.revenueShare ?? 0) - employee.cost) / (employee.revenueShare ?? 1),
        10,
      );
    }
  });

  it('shares the price out across the contributors, to the dirham', async () => {
    const project = await detail('Q2025001a');
    const shares = project.employees.reduce(
      (sum, employee) => sum + (employee.revenueShare ?? 0),
      0,
    );

    expect(shares).toBeCloseTo(project.projectPrice ?? 0, 2);
  });

  it('reports the whole engagement, not the period the list was filtered to', async () => {
    // A price covers the whole project, so its margin only means anything
    // against all of the work done on it.
    const project = await detail('Q2025001a');
    const unfiltered = (await list()).find((row) => row.refCode === 'Q2025001a');

    expect(project.totalHours).toBeCloseTo(3_025.2, 1);
    expect(project.totalCost).toBeCloseTo(unfiltered!.totalCost, 2);
    expect(project.revenue).toBeCloseTo(project.projectPrice!, 2);
  });

  it('carries the identity a detail page needs', async () => {
    const project = await detail('Q2025001a');

    expect(project.projectName).toMatch(/Meridian/);
    expect(project.status).toBe('in progress');
    expect(project.category).toBe('Projects');
  });

  it('answers an unknown ref code with a 404, not a crash', async () => {
    const response = await request(createApp()).get('/api/projects/NOPE').expect(404);

    expect(response.body.status).toBe('error');
    expect(response.body.message).toMatch(/NOPE/);
    expect(response.body).not.toHaveProperty('data');
  });

  it('does not confuse a ref code with the list endpoint', async () => {
    await request(createApp()).get('/api/projects/Q2025001a').expect(200);
    await request(createApp()).get('/api/projects?year=2025').expect(200);
  });
});

describe('a ref code with hours but no price', () => {
  beforeEach(() => {
    ingestTimesheet(
      {
        rows: [
          {
            year: 2025,
            month: 1,
            employeeNo: '10201',
            employeeName: 'Ayesha Rahman',
            expenseType: 'DL',
            department: 'Design',
            designation: 'Senior UI/UX Designer',
            category: 'Projects',
            refCode: 'Q2025999x',
            taskName: null,
            companyName: null,
            description: null,
            hours: 10,
          },
        ],
        warnings: [],
      },
      'extra.xlsx',
    );
  });

  it('reports null price, profit and margin rather than zero', async () => {
    const unpriced = (await list()).find((project) => project.refCode === 'Q2025999x');

    expect(unpriced).toBeDefined();
    expect(unpriced!.projectPrice).toBeNull();
    expect(unpriced!.revenue).toBeNull();
    expect(unpriced!.profit).toBeNull();
    expect(unpriced!.marginPct).toBeNull();
    // The cost is real and still reported.
    expect(unpriced!.totalCost).toBeGreaterThan(0);
  });

  it('sorts an unpriced project ahead of the losses — a gap is more urgent', async () => {
    expect((await list())[0].refCode).toBe('Q2025999x');
  });

  it('gives every contributor a null revenue share and a null profitability', async () => {
    // Nothing to divide by, so the column is a gap rather than a break-even 0%.
    const project = await detail('Q2025999x');

    expect(project.employees.every((employee) => employee.revenueShare === null)).toBe(true);
    expect(project.employees.every((employee) => employee.profitability === null)).toBe(true);
  });
});
