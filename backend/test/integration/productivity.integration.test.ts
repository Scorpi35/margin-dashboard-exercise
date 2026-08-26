import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProductivityRow } from '@shared/types';

import { createApp } from '../../src/app';
import { closeDb, useDatabase } from '../../src/lib/db';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';
import { ingestSalaries, ingestTimesheet } from '../../src/services/ingest.service';
import { saveSettings } from '../../src/services/settings.service';

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-productivity-'));
  useDatabase(join(directory, 'test.db'));
  ingestTimesheet(parseTimesheet(read('timesheet-2025.xlsx'), 't.xlsx'), 't.xlsx');
  ingestSalaries(parseSalary(read('salaries-2025.xlsx'), 's.xlsx'), 's.xlsx');
});

afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

async function productivity(query = 'year=2025'): Promise<ProductivityRow[]> {
  const response = await request(createApp()).get(`/api/productivity?${query}`).expect(200);

  return response.body.data as ProductivityRow[];
}

describe('GET /api/productivity', () => {
  it('lists all twelve employees when unfiltered', async () => {
    expect(await productivity()).toHaveLength(12);
  });

  it('sorts by billable share, descending', async () => {
    const rows = await productivity();
    const shares = rows.map((row) => row.productivityPct ?? -1);

    expect(rows[0].employeeName).toBe("Kevin D'Souza");
    expect(rows[0].productivityPct).toBeCloseTo(0.83, 3);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
  });

  it('keeps the two management employees at a visible zero, not filtered out', async () => {
    // They log only internal time. A different branch from logging nothing at
    // all, and dropping them would hide 812 hours of real work.
    const rows = await productivity();
    const management = rows.filter((row) =>
      ['Hana Yousef', 'Omar Zayed'].includes(row.employeeName),
    );

    expect(management).toHaveLength(2);
    for (const row of management) {
      expect(row.productivityPct).toBe(0);
      expect(row.billableHours).toBe(0);
      expect(row.totalHours).toBeGreaterThan(0);
    }
  });

  it('keeps every share inside 0 to 1, with no NaN', async () => {
    for (const row of await productivity()) {
      expect(row.productivityPct).not.toBeNull();
      expect(Number.isNaN(row.productivityPct)).toBe(false);
      expect(row.productivityPct!).toBeGreaterThanOrEqual(0);
      expect(row.productivityPct!).toBeLessThanOrEqual(1);
    }
  });

  it('reports hours that add up', async () => {
    for (const row of await productivity()) {
      expect(row.billableHours + row.nonBillableHours).toBeCloseTo(row.totalHours, 4);
    }
  });

  it('carries the department and designation a table needs', async () => {
    const [top] = await productivity();

    expect(top.department).toBe('App');
    expect(top.designation).not.toBe('');
    expect(top.employeeNo).toBe('10208');
  });

  it('narrows to a single month', async () => {
    const january = await productivity('year=2025&month=1');
    const year = await productivity();

    expect(january).toHaveLength(12);
    expect(january[0].totalHours).toBeLessThan(year[0].totalHours);
  });

  it('is empty for a period with no hours at all', async () => {
    expect(await productivity('year=2024')).toEqual([]);
  });

  it('follows the saved billable categories rather than a name prefix', async () => {
    // Tentwenty is internal work carrying no "FC - " prefix. Making it billable
    // has to move the numbers, or billability is being inferred somewhere.
    const before = await productivity();
    saveSettings({
      billableCategories: ['Projects', 'Enhancements', 'Hosting', 'Tentwenty'],
      monthlyOverhead: {},
    });
    const after = await productivity();

    const share = (rows: ProductivityRow[], name: string) =>
      rows.find((row) => row.employeeName === name)!.productivityPct!;

    expect(share(after, "Kevin D'Souza")).toBeGreaterThan(share(before, "Kevin D'Souza"));
  });

  it('rejects a year that is not a number', async () => {
    const response = await request(createApp()).get('/api/productivity?year=banana').expect(400);

    expect(response.body.message).toMatch(/"year"/);
  });

  it('rejects a month outside 1-12', async () => {
    await request(createApp()).get('/api/productivity?year=2025&month=13').expect(400);
  });
});
