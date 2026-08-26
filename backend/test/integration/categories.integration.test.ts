import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CategoryBreakdown, PeriodSummary } from '@shared/types';

import { createApp } from '../../src/app';
import { closeDb, useDatabase } from '../../src/lib/db';
import { parseProjects } from '../../src/parse/projects';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';
import { ingestProjects, ingestSalaries, ingestTimesheet } from '../../src/services/ingest.service';
import { saveSettings } from '../../src/services/settings.service';

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-categories-'));
  useDatabase(join(directory, 'test.db'));
  ingestTimesheet(parseTimesheet(read('timesheet-2025.xlsx'), 't.xlsx'), 't.xlsx');
  ingestSalaries(parseSalary(read('salaries-2025.xlsx'), 's.xlsx'), 's.xlsx');
  ingestProjects(parseProjects(read('project-prices-2025.xlsx'), 'p.xlsx'), 'p.xlsx');
});

afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

async function categories(query = 'year=2025'): Promise<CategoryBreakdown> {
  const response = await request(createApp()).get(`/api/categories?${query}`).expect(200);

  return response.body.data as CategoryBreakdown;
}

async function dashboard(query = 'year=2025'): Promise<PeriodSummary> {
  const response = await request(createApp()).get(`/api/dashboard?${query}`).expect(200);

  return response.body.data as PeriodSummary;
}

describe('GET /api/categories', () => {
  it('lists all eleven sample categories, largest first', async () => {
    const { rows } = await categories();

    expect(rows).toHaveLength(11);
    expect(rows[0].category).toBe('Projects');
    expect(rows[0].hours).toBeCloseTo(12_540.9, 1);
    expect(rows.map((row) => row.hours)).toEqual(
      [...rows.map((row) => row.hours)].sort((a, b) => b - a),
    );
  });

  it('sums the category hours back to the period total', async () => {
    const breakdown = await categories();
    const summed = breakdown.rows.reduce((total, row) => total + row.hours, 0);

    expect(summed).toBeCloseTo(breakdown.totalHours, 4);
    // And the total is the one the dashboard reports.
    expect(breakdown.totalHours).toBeCloseTo((await dashboard()).totalHours, 4);
  });

  it('splits billable from internal the same way the dashboard does', async () => {
    const breakdown = await categories();
    const summary = await dashboard();

    expect(breakdown.billableHours).toBeCloseTo(summary.billableHours, 4);
    expect(breakdown.nonBillableHours).toBeCloseTo(summary.nonBillableHours, 4);
    expect(breakdown.billableHours + breakdown.nonBillableHours).toBeCloseTo(
      breakdown.totalHours,
      4,
    );
  });

  it('adds the shares up to 100%', async () => {
    const { rows } = await categories();
    const share = rows.reduce((total, row) => total + (row.hoursPct ?? 0), 0);

    expect(share).toBeCloseTo(1, 6);
  });

  it('marks Tentwenty internal despite it carrying no "FC - " prefix', async () => {
    // The trap in this dataset: prefix-matching would bill 138.7 hours of
    // internal product work and deflate the indirect rate.
    const { rows } = await categories();
    const tentwenty = rows.find((row) => row.category === 'Tentwenty');

    expect(tentwenty?.isBillable).toBe(false);
    expect(tentwenty?.hours).toBeCloseTo(138.7, 1);
  });

  it('marks exactly the three settings categories as billable', async () => {
    const { rows } = await categories();

    expect(
      rows
        .filter((row) => row.isBillable)
        .map((row) => row.category)
        .sort(),
    ).toEqual(['Enhancements', 'Hosting', 'Projects']);
  });

  it('follows the saved settings rather than any name rule', async () => {
    saveSettings({
      billableCategories: ['Projects', 'Enhancements', 'Hosting', 'Tentwenty'],
      monthlyOverhead: {},
    });

    const { rows, billableHours } = await categories();

    expect(rows.find((row) => row.category === 'Tentwenty')?.isBillable).toBe(true);
    expect(billableHours).toBeCloseTo(15_265.6 + 138.7, 1);
  });

  it('narrows to a single month', async () => {
    const january = await categories('year=2025&month=1');

    expect(january.totalHours).toBeCloseTo(1_634.6, 1);
    expect(january.rows.reduce((total, row) => total + row.hours, 0)).toBeCloseTo(
      january.totalHours,
      4,
    );
  });

  it('reports zeroes rather than failing on a period with no hours', async () => {
    const empty = await categories('year=2024');

    expect(empty.rows).toEqual([]);
    expect(empty.totalHours).toBe(0);
    expect(empty.billableHours).toBe(0);
    expect(empty.nonBillableHours).toBe(0);
  });

  it('rejects a year that is not a number', async () => {
    const response = await request(createApp()).get('/api/categories?year=banana').expect(400);

    expect(response.body.message).toMatch(/"year"/);
  });

  it('rejects a month outside 1-12', async () => {
    await request(createApp()).get('/api/categories?year=2025&month=0').expect(400);
  });
});
