import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_BILLABLE_CATEGORIES } from '@shared/types';

import { computePeriodSummary } from '../../src/calc/engine';
import { createApp } from '../../src/app';
import { closeDb, getDb, useDatabase } from '../../src/lib/db';
import { readProjects, readSalaries, readTimesheet } from '../../src/services/ingest.service';

const SAMPLE_DATA = join(__dirname, '../../../sample-data');
const sample = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

const TIMESHEET = 'timesheet-2025.xlsx';
const SALARIES = 'salaries-2025.xlsx';
const PRICES = 'project-prices-2025.xlsx';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-upload-'));
  useDatabase(join(directory, 'test.db'));
});

afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

function post(type: string, fileName: string, buffer: Buffer) {
  return request(createApp()).post(`/api/uploads/${type}`).attach('file', buffer, fileName);
}

function uploadAll() {
  return Promise.all([
    post('timesheet', TIMESHEET, sample(TIMESHEET)),
    post('salary', SALARIES, sample(SALARIES)),
    post('projects', PRICES, sample(PRICES)),
  ]);
}

/** A workbook shaped like a timesheet, with rows that will be skipped. */
function corruptTimesheet(): Buffer {
  const header = [
    'Month',
    'Employee No.',
    'Employee Name',
    'Type of Expense',
    'Department',
    'Designation',
    'Category',
    'Ref Code',
    'Project (Billable) / Task (Unbillable) Name',
    'Company Name (Billable)/ Fixed Costs (Unbillable)',
    'Description',
    'Hours',
  ];
  const good = [
    'January 2025',
    '10201',
    'Ayesha Rahman',
    'DL',
    'Design',
    'Designer',
    'Projects',
    'Q2025001a',
    'Meridian',
    'Meridian',
    'design',
    8,
  ];
  const rows = [
    header,
    good,
    [...good.slice(0, 11), '-'], // row 3: a dash where the hours should be
    ['Q1 2025', ...good.slice(1, 11), 4], // row 4: an unreadable month
    [...good.slice(0, 7), 'NEG', 'x', 'y', 'z', -8], // row 5: negative hours
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Timesheet');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('POST /api/uploads/:type — the happy path', () => {
  it('populates the app end to end from the three sample files', async () => {
    const [timesheet, salary, projects] = await uploadAll();

    expect(timesheet.status).toBe(201);
    expect(timesheet.body.data).toMatchObject({
      type: 'timesheet',
      fileName: TIMESHEET,
      rowsWritten: 562,
      warnings: [],
    });
    expect(salary.body.data.rowsWritten).toBe(144);
    expect(projects.body.data.rowsWritten).toBe(11);

    expect(readTimesheet()).toHaveLength(562);
    expect(readSalaries()).toHaveLength(144);
    expect(readProjects()).toHaveLength(11);
  });

  it('reports the months a file was authoritative for', async () => {
    const [timesheet, , projects] = await uploadAll();

    expect(timesheet.body.data.monthsAffected).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
    // Prices are keyed by ref code and carry no period of their own.
    expect(projects.body.data.monthsAffected).toEqual([]);
  });

  it('reconciles once all three are in', async () => {
    await uploadAll();

    const summary = computePeriodSummary(
      {
        timesheet: readTimesheet(),
        salaries: readSalaries(),
        projects: readProjects(),
        settings: { billableCategories: DEFAULT_BILLABLE_CATEGORIES, monthlyOverhead: {} },
      },
      { year: 2025, month: null },
    );

    expect(summary.totalCost).toBeCloseTo(2_400_000, 2);
    expect(summary.totalCost).toBeCloseTo(summary.totalSalaries, 2);
  });

  it('leaves row counts unchanged when the same file is uploaded again', async () => {
    await uploadAll();
    const before = readTimesheet();

    const again = await post('timesheet', TIMESHEET, sample(TIMESHEET));

    expect(again.status).toBe(201);
    expect(readTimesheet()).toHaveLength(562);
    expect(readTimesheet()).toEqual(before);
  });
});

describe('re-uploading a single month', () => {
  it('replaces that month and leaves the other eleven intact', async () => {
    await uploadAll();

    const input = () => ({
      timesheet: readTimesheet(),
      salaries: readSalaries(),
      projects: readProjects(),
      settings: { billableCategories: DEFAULT_BILLABLE_CATEGORIES, monthlyOverhead: {} },
    });
    const april = () => computePeriodSummary(input(), { year: 2025, month: 4 });

    const aprilBefore = april();
    const marchRowsBefore = readTimesheet().filter((row) => row.month === 3).length;

    // A corrected March, exported on its own.
    const marchOnly = readTimesheet()
      .filter((row) => row.month === 3)
      .slice(0, 5);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        marchOnly.map((row) => ({
          Month: 'March 2025',
          'Employee No.': row.employeeNo,
          'Employee Name': row.employeeName,
          'Type of Expense': row.expenseType,
          Department: row.department,
          Designation: row.designation,
          Category: row.category,
          'Ref Code': row.refCode,
          Hours: row.hours,
        })),
      ),
      'Timesheet',
    );

    const response = await post(
      'timesheet',
      'march.xlsx',
      XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    );

    expect(response.status).toBe(201);
    expect(response.body.data.monthsAffected).toEqual(['2025-03']);

    // March shrank; April is untouched, to the dirham.
    expect(readTimesheet().filter((row) => row.month === 3)).toHaveLength(5);
    expect(marchRowsBefore).toBeGreaterThan(5);
    expect(april().totalCost).toBeCloseTo(aprilBefore.totalCost, 2);
    expect(april().billableHours).toBeCloseTo(aprilBefore.billableHours, 4);
    expect(readTimesheet().filter((row) => row.month !== 3)).toHaveLength(562 - marchRowsBefore);
  });
});

describe('a file that is not what it claims to be', () => {
  it('rejects the salary sheet in the timesheet slot with a 400 and writes nothing', async () => {
    const response = await post('timesheet', SALARIES, sample(SALARIES));

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
    expect(response.body.message).toMatch(/no sheet named "Timesheet"/i);
    expect(response.body.message).toMatch(/nothing was saved/i);

    expect(readTimesheet()).toEqual([]);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM uploads').get()).toEqual({ count: 0 });
  });

  it('leaves an earlier good upload alone when a later one is rejected', async () => {
    await post('timesheet', TIMESHEET, sample(TIMESHEET));

    await post('timesheet', PRICES, sample(PRICES)).expect(400);

    expect(readTimesheet()).toHaveLength(562);
  });

  it('rejects a .txt before it reaches a parser', async () => {
    const response = await post('timesheet', 'notes.txt', Buffer.from('not a spreadsheet'));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not a spreadsheet/i);
    expect(readTimesheet()).toEqual([]);
  });

  it('rejects an unknown upload type', async () => {
    const response = await post('salaries', SALARIES, sample(SALARIES));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/"timesheet", "salary", "projects"/);
  });

  it('rejects a request with no file attached', async () => {
    const response = await request(createApp()).post('/api/uploads/timesheet');

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/no file/i);
  });
});

describe('a file the parser accepts but the database rejects', () => {
  /** Two rows sharing (employee_no, year, month, category, ref_code) — the primary key. */
  function duplicatedRows(): Buffer {
    const header = [
      'Month',
      'Employee No.',
      'Employee Name',
      'Type of Expense',
      'Department',
      'Designation',
      'Category',
      'Ref Code',
      'Hours',
    ];
    const row = [
      'January 2025',
      '10201',
      'Ayesha Rahman',
      'DL',
      'Design',
      'Designer',
      'Projects',
      'Q2025001a',
      8,
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([header, row, row]),
      'Timesheet',
    );

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  it('reports a 400 naming the row to fix, not a 500', async () => {
    // The caller's mistake, so it must not be reported as our server error — and
    // the message identifying the row is the only part worth having.
    const response = await post('timesheet', 'dupes.xlsx', duplicatedRows());

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/two rows for the same entry/i);
    expect(response.body.message).toMatch(
      /employeeNo=10201, year=2025, month=1, category=Projects, refCode=Q2025001a/,
    );
    expect(response.body.message).not.toMatch(/something went wrong/i);
    // Only the key columns — not every field the row happens to carry.
    expect(response.body.message).not.toMatch(/taskName|description/);
  });

  it('rolls back completely and writes no audit row', async () => {
    await post('timesheet', TIMESHEET, sample(TIMESHEET));

    await post('timesheet', 'dupes.xlsx', duplicatedRows()).expect(400);

    // January was deleted before the failing insert; the transaction put it back.
    expect(readTimesheet()).toHaveLength(562);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM uploads').get()).toEqual({ count: 1 });
  });
});

describe('an unknown upload type', () => {
  it('is rejected on the path, before the file is buffered', async () => {
    const response = await post('salaries', TIMESHEET, sample(TIMESHEET));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/"timesheet", "salary", "projects"/);
  });
});

describe('warnings from a file with bad rows', () => {
  it('ingests the good rows and reports the skipped ones with row numbers', async () => {
    const response = await post('timesheet', 'corrupt.xlsx', corruptTimesheet());

    expect(response.status).toBe(201);
    expect(response.body.data.rowsWritten).toBe(1);

    const warnings = response.body.data.warnings as {
      row: number;
      message: string;
      file: string;
    }[];

    expect(warnings).toHaveLength(3);
    expect(warnings.map((warning) => warning.row)).toEqual([3, 4, 5]);
    expect(warnings[0].message).toMatch(/not a number of hours/i);
    expect(warnings[1].message).toMatch(/Q1 2025/);
    expect(warnings[2].message).toMatch(/negative/i);
    expect(warnings.every((warning) => warning.file === 'corrupt.xlsx')).toBe(true);
  });
});

describe('GET /api/uploads', () => {
  it('lists each written upload, newest first, with its warning count', async () => {
    await post('timesheet', TIMESHEET, sample(TIMESHEET));
    await post('salary', SALARIES, sample(SALARIES));
    await post('timesheet', 'corrupt.xlsx', corruptTimesheet());

    const response = await request(createApp()).get('/api/uploads').expect(200);
    const history = response.body.data as {
      type: string;
      fileName: string;
      rowCount: number;
      warningCount: number;
      months: string[];
      uploadedAt: string;
    }[];

    expect(history).toHaveLength(3);
    expect(history[0]).toMatchObject({
      type: 'timesheet',
      fileName: 'corrupt.xlsx',
      rowCount: 1,
      warningCount: 3,
      months: ['2025-01'],
    });
    expect(history[1]).toMatchObject({ type: 'salary', fileName: SALARIES, warningCount: 0 });
    expect(history[2].fileName).toBe(TIMESHEET);
    expect(history[0].uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records nothing for an upload that was rejected', async () => {
    await post('timesheet', SALARIES, sample(SALARIES)).expect(400);

    const response = await request(createApp()).get('/api/uploads').expect(200);

    expect(response.body.data).toEqual([]);
  });

  it('is empty on a fresh database', async () => {
    const response = await request(createApp()).get('/api/uploads').expect(200);

    expect(response.body).toEqual({ status: 'ok', data: [] });
  });
});
