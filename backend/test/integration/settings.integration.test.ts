import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CategoryBreakdown, PeriodSummary, Settings } from '@shared/types';

import { createApp } from '../../src/app';
import { closeDb, useDatabase } from '../../src/lib/db';
import { parseProjects } from '../../src/parse/projects';
import { parseSalary } from '../../src/parse/salary';
import { parseTimesheet } from '../../src/parse/timesheet';
import { ingestProjects, ingestSalaries, ingestTimesheet } from '../../src/services/ingest.service';

/**
 * The settings endpoints and what changing them does to the numbers.
 *
 * The second half is the point: a settings page that saves without moving the
 * figures downstream would satisfy a round-trip test and none of the issue.
 */

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

const DEFAULTS: Settings = {
  billableCategories: ['Projects', 'Enhancements', 'Hosting'],
  monthlyOverhead: {},
};

let directory = '';
let databaseFile = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-settings-'));
  databaseFile = join(directory, 'test.db');
  useDatabase(databaseFile);
  ingestTimesheet(parseTimesheet(read('timesheet-2025.xlsx'), 't.xlsx'), 't.xlsx');
  ingestSalaries(parseSalary(read('salaries-2025.xlsx'), 's.xlsx'), 's.xlsx');
  ingestProjects(parseProjects(read('project-prices-2025.xlsx'), 'p.xlsx'), 'p.xlsx');
});

afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

async function getSettings(): Promise<Settings> {
  const response = await request(createApp()).get('/api/settings').expect(200);

  return response.body.data as Settings;
}

/** `object` rather than `unknown`: supertest's own signature for a JSON body. */
async function putSettings(body: object, status = 200): Promise<request.Response> {
  return request(createApp()).put('/api/settings').send(body).expect(status);
}

async function dashboard(query = 'year=2025'): Promise<PeriodSummary> {
  const response = await request(createApp()).get(`/api/dashboard?${query}`).expect(200);

  return response.body.data as PeriodSummary;
}

async function categories(query = 'year=2025'): Promise<CategoryBreakdown> {
  const response = await request(createApp()).get(`/api/categories?${query}`).expect(200);

  return response.body.data as CategoryBreakdown;
}

describe('GET /api/settings', () => {
  it('answers with the defaults before anything has been saved', async () => {
    expect(await getSettings()).toEqual(DEFAULTS);
  });
});

describe('PUT /api/settings', () => {
  it('round-trips both settings and answers with what was stored', async () => {
    const response = await putSettings({
      billableCategories: ['Projects', 'Enhancements'],
      monthlyOverhead: { '2025-01': 12_000, '2025-07': 15_500.5 },
    });

    expect(response.body.data).toEqual({
      billableCategories: ['Projects', 'Enhancements'],
      monthlyOverhead: { '2025-01': 12_000, '2025-07': 15_500.5 },
    });
    expect(await getSettings()).toEqual(response.body.data);
  });

  it('survives a restart, because it is in the database rather than in memory', async () => {
    await putSettings({
      billableCategories: ['Projects'],
      monthlyOverhead: { '2025-03': 9_000 },
    });

    // What a restart amounts to: the connection goes, the file stays.
    closeDb();
    useDatabase(databaseFile);

    expect(await getSettings()).toEqual({
      billableCategories: ['Projects'],
      monthlyOverhead: { '2025-03': 9_000 },
    });
  });

  it('trims and de-duplicates the category list rather than storing it twice', async () => {
    const response = await putSettings({
      billableCategories: ['Projects', ' Projects ', 'Hosting'],
      monthlyOverhead: {},
    });

    expect(response.body.data.billableCategories).toEqual(['Projects', 'Hosting']);
  });

  it('accepts an empty billable list — every hour then counts as internal', async () => {
    const response = await putSettings({ billableCategories: [], monthlyOverhead: {} });

    expect(response.body.data.billableCategories).toEqual([]);
  });
});

describe('a settings save that cannot be understood', () => {
  it('rejects non-numeric overhead with a 400 naming the month', async () => {
    const response = await putSettings(
      { billableCategories: ['Projects'], monthlyOverhead: { '2025-01': '12,000' } },
      400,
    );

    expect(response.body.status).toBe('error');
    expect(response.body.message).toMatch(/2025-01/);
    // Nothing was written: a rejected save leaves the previous settings standing.
    expect(await getSettings()).toEqual(DEFAULTS);
  });

  it('rejects a key that is not a month, which would be stored and never applied', async () => {
    const response = await putSettings(
      { billableCategories: ['Projects'], monthlyOverhead: { '2025-13': 1_000 } },
      400,
    );

    expect(response.body.message).toMatch(/2025-13/);
  });

  it('rejects negative overhead', async () => {
    await putSettings(
      { billableCategories: ['Projects'], monthlyOverhead: { '2025-01': -1 } },
      400,
    );
  });

  it('rejects a category list that is not a list of names', async () => {
    await putSettings({ billableCategories: 'Projects', monthlyOverhead: {} }, 400);
    await putSettings({ billableCategories: [''], monthlyOverhead: {} }, 400);
    await putSettings({ billableCategories: [42], monthlyOverhead: {} }, 400);
  });

  it('rejects a body that is not JSON at all, without calling it a server fault', async () => {
    const response = await request(createApp())
      .put('/api/settings')
      .set('Content-Type', 'application/json')
      .send('{"billableCategories": [')
      .expect(400);

    expect(response.body.message).toMatch(/could not be read as JSON/i);
    expect(await getSettings()).toEqual(DEFAULTS);
  });

  it('rejects a body that is not a settings object', async () => {
    await putSettings([], 400);
    await putSettings({ monthlyOverhead: {} }, 400);
  });
});

describe('what changing the settings does to the figures', () => {
  it('moves an unchecked category to internal, hours and all', async () => {
    const before = await categories();
    const hosting = before.rows.find((row) => row.category === 'Hosting');

    expect(hosting?.isBillable).toBe(true);
    expect(hosting?.hours).toBeCloseTo(644.2, 1);

    await putSettings({
      billableCategories: ['Projects', 'Enhancements'],
      monthlyOverhead: {},
    });

    const after = await categories();

    expect(after.rows.find((row) => row.category === 'Hosting')?.isBillable).toBe(false);
    // The same hours, on the other side of the line.
    expect(after.billableHours).toBeCloseTo(before.billableHours - 644.2, 1);
    expect(after.nonBillableHours).toBeCloseTo(before.nonBillableHours + 644.2, 1);
    expect(after.totalHours).toBeCloseTo(before.totalHours, 4);
  });

  it('changes the cost downstream of it, not just the hours', async () => {
    const before = await dashboard();

    await putSettings({
      billableCategories: ['Projects', 'Enhancements'],
      monthlyOverhead: {},
    });

    const after = await dashboard();

    // Hosting hours now value themselves into the pool instead of carrying it,
    // so every month with Hosting work in it charges a higher indirect rate and
    // no month charges a lower one.
    const rates = after.months.map((month, index) => [
      month.indirectRate,
      before.months[index].indirectRate,
    ]);

    expect(rates.some(([now, was]) => now > was)).toBe(true);
    expect(rates.every(([now, was]) => now >= was)).toBe(true);
    // Total cost is salaries plus overhead, so it does not move with billability.
    expect(after.totalCost).toBeCloseTo(before.totalCost, 2);
    expect(after.totalCost).toBeCloseTo(after.totalSalaries, 2);
  });

  it('drops a project whose category is no longer billable', async () => {
    // Its hours are internal time now, and internal time is never costed to a
    // project — the indirect pool already carries it.
    const before = await request(createApp()).get('/api/projects?year=2025').expect(200);
    expect(before.body.data.map((row: { refCode: string }) => row.refCode)).toContain('H2025060c');

    await putSettings({
      billableCategories: ['Projects', 'Enhancements'],
      monthlyOverhead: {},
    });

    const after = await request(createApp()).get('/api/projects?year=2025').expect(200);

    expect(after.body.data.map((row: { refCode: string }) => row.refCode)).not.toContain(
      'H2025060c',
    );
  });

  it('raises a month total cost by exactly the overhead entered for it', async () => {
    const before = await dashboard('year=2025&month=1');

    await putSettings({
      billableCategories: [...DEFAULTS.billableCategories],
      monthlyOverhead: { '2025-01': 100_000 },
    });

    const january = await dashboard('year=2025&month=1');
    const february = await dashboard('year=2025&month=2');

    expect(january.totalCost).toBeCloseTo(before.totalCost + 100_000, 2);
    expect(january.totalOverhead).toBeCloseTo(100_000, 2);
    // A figure entered for January is not spread over the year.
    expect(february.totalOverhead).toBe(0);
  });

  it('restores cost equal to salaries when the overhead goes back to zero', async () => {
    await putSettings({
      billableCategories: [...DEFAULTS.billableCategories],
      monthlyOverhead: { '2025-01': 100_000 },
    });

    const withOverhead = await dashboard();
    expect(withOverhead.totalCost).toBeCloseTo(withOverhead.totalSalaries + 100_000, 2);

    await putSettings({
      billableCategories: [...DEFAULTS.billableCategories],
      monthlyOverhead: {},
    });

    const cleared = await dashboard();

    expect(cleared.totalOverhead).toBe(0);
    expect(cleared.totalCost).toBeCloseTo(cleared.totalSalaries, 2);
    expect(cleared.totalCost).toBeCloseTo(2_400_000, 2);
  });

  it('costs a month with nothing billable in it without dividing by zero', async () => {
    await putSettings({ billableCategories: [], monthlyOverhead: {} });

    const summary = await dashboard();

    expect(summary.months).toHaveLength(12);
    // `pool / 0` would be Infinity, and every figure downstream of it NaN.
    expect(summary.months.every((month) => Number.isFinite(month.indirectRate))).toBe(true);
    expect(summary.months.every((month) => month.indirectRate === 0)).toBe(true);
    expect(summary.billableHours).toBe(0);
    // The pool still carries every dirham of salary, so the invariant holds.
    expect(summary.totalCost).toBeCloseTo(summary.totalSalaries, 2);
    expect(summary.totalCost).toBeCloseTo(2_400_000, 2);
  });
});
