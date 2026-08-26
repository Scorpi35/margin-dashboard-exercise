import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseTimesheet } from '../../src/parse/timesheet';
import { TIMESHEET_HEADER, timesheetRow, workbookBuffer } from './parse-fixtures';

const SAMPLE = join(__dirname, '../../../sample-data/timesheet-2025.xlsx');

function parseSample() {
  return parseTimesheet(readFileSync(SAMPLE), 'timesheet-2025.xlsx');
}

function parseFixture(rows: unknown[][], sheetName = 'Timesheet') {
  return parseTimesheet(workbookBuffer(sheetName, rows), 'fixture.xlsx');
}

describe('parseTimesheet on the sample file', () => {
  it('reads every row without a warning', () => {
    const { rows, warnings } = parseSample();

    expect(rows).toHaveLength(562);
    expect(warnings).toEqual([]);
  });

  it('gives every row finite, non-negative hours', () => {
    const { rows } = parseSample();

    expect(rows.every((row) => Number.isFinite(row.hours) && row.hours >= 0)).toBe(true);
  });

  it('carries an explicit year and month rather than a date string', () => {
    const { rows } = parseSample();
    const months = new Set(rows.map((row) => row.month));

    expect(rows.every((row) => row.year === 2025)).toBe(true);
    expect([...months].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('keeps the leading zeros on management employee numbers', () => {
    const { rows } = parseSample();

    expect(rows.some((row) => row.employeeNo === '00101')).toBe(true);
    expect(rows.every((row) => typeof row.employeeNo === 'string')).toBe(true);
  });

  it('reads the long task and company columns by substring', () => {
    const [first] = parseSample().rows;

    expect(first.taskName).toBe('Annual, Casual, Sick Leaves, Holiday');
    expect(first.companyName).toBe('Fixed Costs');
  });

  it('preserves Tentwenty as its own category rather than an FC prefix', () => {
    // Tentwenty is internal work carrying no "FC - " prefix. Billability is decided
    // from settings.billableCategories, so the parser must not normalise it away.
    const { rows } = parseSample();

    expect(rows.some((row) => row.category === 'Tentwenty')).toBe(true);
  });
});

describe('parseTimesheet row-level recovery', () => {
  it('warns and skips exactly the bad rows, without throwing', () => {
    const { rows, warnings } = parseFixture([
      TIMESHEET_HEADER,
      timesheetRow(),
      timesheetRow({ Hours: '-' }),
      timesheetRow({ Month: 'Q1 2025' }),
      timesheetRow({ Hours: -8 }),
      timesheetRow({ 'Employee No.': null, 'Employee Name': null }),
      timesheetRow({ 'Ref Code': '  ', Category: '  ' }),
      timesheetRow({ Hours: 12.5 }),
    ]);

    expect(rows.map((row) => row.hours)).toEqual([8, 12.5]);
    expect(warnings).toHaveLength(5);
  });

  it('cites the spreadsheet row number a reader can find in Excel', () => {
    const { warnings } = parseFixture([
      TIMESHEET_HEADER,
      timesheetRow(),
      timesheetRow({ Hours: -8 }),
    ]);

    expect(warnings[0].row).toBe(3);
    expect(warnings[0].file).toBe('fixture.xlsx');
    expect(warnings[0].sheet).toBe('Timesheet');
    expect(warnings[0].message).toMatch(/negative/i);
  });

  it('names the reason each row was dropped', () => {
    const { warnings } = parseFixture([
      TIMESHEET_HEADER,
      timesheetRow({ Hours: 'eight' }),
      timesheetRow({ Month: '' }),
    ]);

    expect(warnings[0].message).toMatch(/not a number of hours/i);
    expect(warnings[1].message).toMatch(/empty/i);
  });

  it('keeps a zero-hour row, which is a real entry rather than a gap', () => {
    const { rows, warnings } = parseFixture([TIMESHEET_HEADER, timesheetRow({ Hours: 0 })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].hours).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('falls back to the category when the ref code is blank', () => {
    const { rows } = parseFixture([
      TIMESHEET_HEADER,
      timesheetRow({ 'Ref Code': '', Category: 'FC - Meetings' }),
    ]);

    expect(rows[0].refCode).toBe('FC - Meetings');
  });

  it('keeps an uncategorised row but says so, rather than losing its hours', () => {
    const { rows, warnings } = parseFixture([
      TIMESHEET_HEADER,
      timesheetRow({ Category: '', 'Ref Code': 'Q2025001a' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('');
    expect(warnings[0].message).toMatch(/non-billable/i);
  });

  it('defaults the expense type to DL and takes IDL only on an explicit match', () => {
    const { rows } = parseFixture([
      TIMESHEET_HEADER,
      timesheetRow({ 'Type of Expense': 'IDL' }),
      timesheetRow({ 'Type of Expense': 'idl' }),
      timesheetRow({ 'Type of Expense': '' }),
      timesheetRow({ 'Type of Expense': 'something else' }),
    ]);

    expect(rows.map((row) => row.expenseType)).toEqual(['IDL', 'IDL', 'DL', 'DL']);
  });

  it('leaves absent descriptive columns null rather than empty strings', () => {
    const { rows } = parseFixture([
      TIMESHEET_HEADER,
      timesheetRow({
        'Project (Billable) / Task (Unbillable) Name': '-',
        'Company Name (Billable)/ Fixed Costs (Unbillable)': '',
        Description: null,
      }),
    ]);

    expect(rows[0].taskName).toBeNull();
    expect(rows[0].companyName).toBeNull();
    expect(rows[0].description).toBeNull();
  });
});

describe('parseTimesheet structural failures', () => {
  it('throws naming a required column that is missing entirely', () => {
    const header = TIMESHEET_HEADER.filter((column) => column !== 'Hours');

    expect(() => parseFixture([header, header.map(() => 'x')])).toThrow(/"hours"/i);
  });

  it('throws when the sheet is named something else', () => {
    expect(() => parseFixture([TIMESHEET_HEADER, timesheetRow()], 'Sheet1')).toThrow(
      /no sheet named "Timesheet"/i,
    );
  });

  it('throws when no row looks like a header', () => {
    expect(() =>
      parseFixture([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toThrow(/could not find a header row/i);
  });
});
