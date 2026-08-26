import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PeriodSummary } from '@shared/types';

import { createApp } from '../../src/app';
import { closeDb, getDb, useDatabase } from '../../src/lib/db';
import { parseProjects } from '../../src/parse/projects';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';
import { ingestProjects, ingestSalaries, ingestTimesheet } from '../../src/services/ingest.service';
import { saveSettings } from '../../src/services/settings.service';

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-dash-'));
  useDatabase(join(directory, 'test.db'));
});

afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

function seed(): void {
  ingestTimesheet(parseTimesheet(read('timesheet-2025.xlsx'), 't.xlsx'), 't.xlsx');
  ingestSalaries(parseSalary(read('salaries-2025.xlsx'), 's.xlsx'), 's.xlsx');
  ingestProjects(parseProjects(read('project-prices-2025.xlsx'), 'p.xlsx'), 'p.xlsx');
}

async function dashboard(query: string): Promise<PeriodSummary> {
  const response = await request(createApp()).get(`/api/dashboard?${query}`).expect(200);

  return response.body.data as PeriodSummary;
}

describe('GET /api/dashboard', () => {
  it('reports the documented annual figure for 2025', async () => {
    seed();
    const summary = await dashboard('year=2025');

    expect(summary.totalCost).toBeCloseTo(2_400_000, 2);
    expect(summary.totalSalaries).toBeCloseTo(2_400_000, 2);
    expect(summary.totalRevenue).toBeCloseTo(5_012_000, 2);
    // From docs/data-sources.md: 12,540.9 + 2,080.5 + 644.2 billable, and 4,549.6
    // of internal time across the eight non-billable categories.
    expect(summary.billableHours).toBeCloseTo(15_265.6, 1);
    expect(summary.nonBillableHours).toBeCloseTo(4_549.6, 1);
    expect(summary.totalHours).toBeCloseTo(19_815.2, 1);
  });

  it('narrows every total when a month is selected', async () => {
    seed();
    const january = await dashboard('year=2025&month=1');

    expect(january.month).toBe(1);
    expect(january.totalSalaries).toBeCloseTo(197_000, 2);
    expect(january.totalHours).toBeCloseTo(1_634.6, 1);
    expect(january.billableHours).toBeCloseTo(1_283.5, 1);
    expect(january.nonBillableHours).toBeCloseTo(351.1, 1);
    expect(january.months).toHaveLength(1);
  });

  it('sums the twelve months back to the year', async () => {
    seed();
    const year = await dashboard('year=2025');

    let cost = 0;
    for (let month = 1; month <= 12; month += 1) {
      cost += (await dashboard(`year=2025&month=${month}`)).totalCost;
    }

    expect(cost).toBeCloseTo(year.totalCost, 2);
  });

  it('treats an omitted month as the whole year', async () => {
    seed();

    expect((await dashboard('year=2025')).month).toBeNull();
    expect((await dashboard('year=2025&month=')).month).toBeNull();
  });

  it('reports zeroes rather than failing on a year with no data', async () => {
    seed();
    const summary = await dashboard('year=2024');

    expect(summary.totalCost).toBe(0);
    expect(summary.totalHours).toBe(0);
    // No revenue means no ratio to report — null, never 0% and never NaN.
    expect(summary.marginPct).toBeNull();
    expect(summary.productivityPct).toBeNull();
  });

  it('surfaces the gaps in the data alongside the totals', async () => {
    seed();
    const summary = await dashboard('year=2025');

    expect(summary.unpricedRefCodes).toEqual([]);
    expect(summary.missingSalaryEmployees).toEqual([]);
  });

  it('names the employee behind a salary row that is missing', async () => {
    // The banner's own claim, end to end: take one salary away and the dashboard
    // says whose, rather than costing those hours at zero in silence.
    seed();
    getDb()
      .prepare("DELETE FROM salaries WHERE employee_no = '10201' AND year = 2025 AND month = 3")
      .run();

    const summary = await dashboard('year=2025');

    expect(summary.missingSalaryEmployees).toEqual([
      { employeeNo: '10201', employeeName: 'Ayesha Rahman', year: 2025, month: 3 },
    ]);
    // Cost is understated by exactly the salary that went missing, which is what
    // the banner warns the reader about.
    expect(summary.totalCost).toBeCloseTo(2_400_000 - 18_000, 2);
  });

  it('applies saved overhead to the totals', async () => {
    seed();
    saveSettings({
      billableCategories: ['Projects', 'Enhancements', 'Hosting'],
      monthlyOverhead: { '2025-01': 50_000 },
    });

    const summary = await dashboard('year=2025');

    expect(summary.totalOverhead).toBe(50_000);
    expect(summary.totalCost).toBeCloseTo(2_450_000, 2);
  });
});

describe('GET /api/dashboard input validation', () => {
  it('rejects a year that is not a number', async () => {
    const response = await request(createApp()).get('/api/dashboard?year=banana').expect(400);

    expect(response.body.status).toBe('error');
    expect(response.body.message).toMatch(/"year"/);
    expect(response.body).not.toHaveProperty('data');
  });

  it('rejects a missing year rather than guessing one', async () => {
    await request(createApp()).get('/api/dashboard').expect(400);
  });

  it('rejects a month outside 1-12', async () => {
    for (const month of ['0', '13', 'January', '1.5']) {
      const response = await request(createApp())
        .get(`/api/dashboard?year=2025&month=${month}`)
        .expect(400);

      expect(response.body.message).toMatch(/"month"/);
    }
  });
});

describe('GET /api/meta', () => {
  it('is empty on a fresh database, so the UI can offer an upload', async () => {
    const response = await request(createApp()).get('/api/meta').expect(200);

    expect(response.body.data.years).toEqual([]);
    expect(response.body.data.months).toEqual([]);
    expect(response.body.data.categories).toEqual([]);
    expect(response.body.data.settings).toEqual({
      billableCategories: ['Projects', 'Enhancements', 'Hosting'],
      monthlyOverhead: {},
    });
  });

  it('lists the years and categories once data is in', async () => {
    seed();
    const response = await request(createApp()).get('/api/meta').expect(200);

    expect(response.body.data.years).toEqual([2025]);
    expect(response.body.data.categories).toHaveLength(11);
    expect(response.body.data.categories).toContain('Tentwenty');
  });

  it('lists every month that has data, so overhead can be entered against it', async () => {
    seed();
    const response = await request(createApp()).get('/api/meta').expect(200);

    expect(response.body.data.months).toHaveLength(12);
    expect(response.body.data.months[0]).toBe('2025-01');
    expect(response.body.data.months.at(-1)).toBe('2025-12');
  });

  it('offers a year that has salaries but no logged hours', async () => {
    // That year still has cost in it; leaving it out would hide the cost.
    ingestSalaries(
      {
        rows: [{ year: 2024, month: 1, employeeNo: '1', employeeName: 'A', monthlySalary: 100 }],
        warnings: [],
      },
      's.xlsx',
    );

    const response = await request(createApp()).get('/api/meta').expect(200);

    expect(response.body.data.years).toEqual([2024]);
    expect(response.body.data.months).toEqual(['2024-01']);
  });
});
