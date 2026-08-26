import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '../../src/lib/db';
import {
  ingestProjects,
  ingestSalaries,
  ingestTimesheet,
  readProjects,
  readSalaries,
  readTimesheet,
} from '../../src/services/ingest.service';
import {
  closeTestDatabase,
  entry,
  openTestDatabase,
  parsed,
  pay,
  project,
  sample,
} from './db-fixtures';

beforeEach(openTestDatabase);
afterEach(closeTestDatabase);

/** A year of one row per month, so a single month can be replaced in isolation. */
function aYearOfEntries() {
  return parsed(
    Array.from({ length: 12 }, (_, index) =>
      entry({ month: index + 1, hours: index + 1, refCode: `Q${index + 1}` }),
    ),
  );
}

describe('re-upload semantics', () => {
  it('yields identical row counts when the same file is ingested twice', () => {
    const first = ingestTimesheet(sample.timesheet(), 'timesheet-2025.xlsx');
    const afterFirst = readTimesheet().length;
    const second = ingestTimesheet(sample.timesheet(), 'timesheet-2025.xlsx');

    expect(afterFirst).toBe(562);
    expect(readTimesheet()).toHaveLength(562);
    expect(second.rowsWritten).toBe(first.rowsWritten);
  });

  it('replaces only the months the upload contains', () => {
    ingestTimesheet(aYearOfEntries(), 'year.xlsx');

    // A corrected March, exported on its own.
    const summary = ingestTimesheet(
      parsed([entry({ month: 3, hours: 99, refCode: 'CORRECTED' })]),
      'march.xlsx',
    );

    const rows = readTimesheet();
    expect(summary.monthsReplaced).toEqual(['2025-03']);
    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => row.month === 3)).toEqual([
      expect.objectContaining({ hours: 99, refCode: 'CORRECTED' }),
    ]);
  });

  it('leaves the other eleven months exactly as they were', () => {
    ingestTimesheet(aYearOfEntries(), 'year.xlsx');
    const before = readTimesheet().filter((row) => row.month !== 3);

    ingestTimesheet(parsed([entry({ month: 3, hours: 99 })]), 'march.xlsx');

    expect(readTimesheet().filter((row) => row.month !== 3)).toEqual(before);
  });

  it('keeps months absent from a subset upload', () => {
    ingestTimesheet(aYearOfEntries(), 'year.xlsx');

    ingestTimesheet(
      parsed([entry({ month: 1, hours: 50 }), entry({ month: 2, hours: 60 })]),
      'q1.xlsx',
    );

    const months = readTimesheet().map((row) => row.month);
    expect(months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(readTimesheet().find((row) => row.month === 1)?.hours).toBe(50);
    expect(readTimesheet().find((row) => row.month === 12)?.hours).toBe(12);
  });

  it('empties a month when a corrected file legitimately has fewer rows', () => {
    ingestTimesheet(
      parsed([entry({ month: 1, refCode: 'A' }), entry({ month: 1, refCode: 'B' })]),
      'year.xlsx',
    );

    ingestTimesheet(parsed([entry({ month: 1, refCode: 'A' })]), 'january.xlsx');

    expect(readTimesheet().map((row) => row.refCode)).toEqual(['A']);
  });

  it('applies the same rule to salaries', () => {
    ingestSalaries(parsed([pay({ month: 1 }), pay({ month: 2 })]), 'salaries.xlsx');
    ingestSalaries(parsed([pay({ month: 2, monthlySalary: 18_500 })]), 'february.xlsx');

    expect(readSalaries()).toEqual([
      expect.objectContaining({ month: 1, monthlySalary: 18_000 }),
      expect.objectContaining({ month: 2, monthlySalary: 18_500 }),
    ]);
  });

  it('scopes deletion by year as well as month', () => {
    ingestTimesheet(
      parsed([entry({ year: 2024, month: 1, hours: 5 }), entry({ year: 2025, month: 1 })]),
      'both.xlsx',
    );

    ingestTimesheet(parsed([entry({ year: 2025, month: 1, hours: 77 })]), 'jan-2025.xlsx');

    expect(readTimesheet()).toEqual([
      expect.objectContaining({ year: 2024, hours: 5 }),
      expect.objectContaining({ year: 2025, hours: 77 }),
    ]);
  });
});

describe('projects upsert rather than replacing a period', () => {
  it('updates a project in place', () => {
    ingestProjects(parsed([project({ projectPrice: 560_000 })]), 'prices.xlsx');
    ingestProjects(parsed([project({ projectPrice: 600_000, status: 'completed' })]), 'v2.xlsx');

    expect(readProjects()).toEqual([
      expect.objectContaining({ projectPrice: 600_000, status: 'completed' }),
    ]);
  });

  it('keeps a project missing from a newer price list', () => {
    // Deleting it would strip the price from work the timesheet still references,
    // turning a priced project unpriced on the strength of an omission.
    ingestProjects(parsed([project({ refCode: 'A' }), project({ refCode: 'B' })]), 'prices.xlsx');

    ingestProjects(parsed([project({ refCode: 'A', projectPrice: 1 })]), 'partial.xlsx');

    expect(readProjects().map((row) => row.refCode)).toEqual(['A', 'B']);
  });

  it('reports no months replaced, because prices are not month-scoped', () => {
    const summary = ingestProjects(parsed([project()]), 'prices.xlsx');

    expect(summary.monthsReplaced).toEqual([]);
    expect(summary.rowsWritten).toBe(1);
  });
});

describe('a failure mid-ingest', () => {
  it('rolls back entirely, leaving no partial month', () => {
    ingestTimesheet(parsed([entry({ month: 1, hours: 8, refCode: 'GOOD' })]), 'first.xlsx');

    // Two rows sharing the primary key. The month has already been deleted by the
    // time the second insert fails, so without a transaction January would be lost.
    const duplicated = parsed([
      entry({ month: 1, refCode: 'X', hours: 1 }),
      entry({ month: 1, refCode: 'X', hours: 2 }),
    ]);

    expect(() => ingestTimesheet(duplicated, 'broken.xlsx')).toThrow(
      /two rows for the same entry/i,
    );
    expect(readTimesheet()).toEqual([expect.objectContaining({ refCode: 'GOOD', hours: 8 })]);
  });

  it('names the row a user has to go and fix', () => {
    const duplicated = parsed([entry({ refCode: 'X' }), entry({ refCode: 'X' })]);

    expect(() => ingestTimesheet(duplicated, 'broken.xlsx')).toThrow(/employeeNo=10201/);
  });

  it('writes no audit row for an upload that failed', () => {
    expect(() =>
      ingestTimesheet(parsed([entry({ refCode: 'X' }), entry({ refCode: 'X' })]), 'broken.xlsx'),
    ).toThrow();

    expect(getDb().prepare('SELECT COUNT(*) AS count FROM uploads').get()).toEqual({ count: 0 });
  });
});

describe('round-tripping through the database', () => {
  it('preserves every timesheet field', () => {
    const rows = sample.timesheet().rows;
    ingestTimesheet(parsed([...rows]), 'timesheet-2025.xlsx');

    const order = (list: typeof rows) =>
      [...list].sort(
        (a, b) =>
          a.year - b.year ||
          a.month - b.month ||
          a.employeeNo.localeCompare(b.employeeNo) ||
          a.refCode.localeCompare(b.refCode),
      );

    expect(order(readTimesheet())).toEqual(order(rows));
  });

  it('preserves every salary field', () => {
    const rows = sample.salaries().rows;
    ingestSalaries(parsed([...rows]), 'salaries-2025.xlsx');

    expect(readSalaries()).toHaveLength(144);
    expect(readSalaries()).toEqual(expect.arrayContaining([...rows]));
  });

  it('preserves every project field', () => {
    const rows = sample.projects().rows;
    ingestProjects(parsed([...rows]), 'project-prices-2025.xlsx');

    expect(readProjects()).toEqual([...rows].sort((a, b) => a.refCode.localeCompare(b.refCode)));
  });

  it('keeps nulls null rather than turning them into zeros or empty strings', () => {
    ingestTimesheet(
      parsed([entry({ taskName: null, companyName: null, description: null })]),
      'nulls.xlsx',
    );
    ingestProjects(
      parsed([project({ projectPrice: null, salesYear: null, salesMonth: null, status: null })]),
      'nulls.xlsx',
    );

    expect(readTimesheet()[0]).toMatchObject({
      taskName: null,
      companyName: null,
      description: null,
    });
    expect(readProjects()[0]).toMatchObject({
      projectPrice: null,
      salesYear: null,
      salesMonth: null,
      status: null,
    });
  });

  it('keeps the leading zeros on an employee number', () => {
    ingestTimesheet(parsed([entry({ employeeNo: '00101' })]), 'management.xlsx');

    expect(readTimesheet()[0].employeeNo).toBe('00101');
  });
});

describe('the upload audit trail', () => {
  it('records what was ingested, from where, and which months it replaced', () => {
    ingestTimesheet(
      parsed([entry({ month: 1 }), entry({ month: 2, refCode: 'B' })]),
      'timesheet-2025.xlsx',
    );

    const [upload] = getDb().prepare('SELECT * FROM uploads').all() as Record<string, unknown>[];

    expect(upload).toMatchObject({
      kind: 'timesheet',
      file_name: 'timesheet-2025.xlsx',
      row_count: 2,
      warning_count: 0,
      months: '2025-01,2025-02',
    });
    expect(String(upload.uploaded_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('counts the warnings a parser reported', () => {
    ingestTimesheet(
      {
        rows: [entry()],
        warnings: [{ file: 'x.xlsx', sheet: 'Timesheet', row: 9, message: 'Skipped' }],
      },
      'x.xlsx',
    );

    const [upload] = getDb().prepare('SELECT * FROM uploads').all() as Record<string, unknown>[];
    expect(upload.warning_count).toBe(1);
  });
});
