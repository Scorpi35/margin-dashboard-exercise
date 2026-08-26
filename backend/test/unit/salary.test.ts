import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSalary } from '../../src/parse/salary';
import { workbookBuffer } from './parse-fixtures';

const SAMPLE = join(__dirname, '../../../sample-data/salaries-2025.xlsx');

const TITLE_ROW = [null, 'Salary Overview 2025 (AED)'];
const HEADER_ROW = ['Employee No.', 'Employee Name', 'January', 'February', 'March'];

function parseSample() {
  return parseSalary(readFileSync(SAMPLE), 'salaries-2025.xlsx');
}

function parseFixture(rows: unknown[][], fileName = 'fixture-2025.xlsx', sheetName = 'Salary') {
  return parseSalary(workbookBuffer(sheetName, rows), fileName);
}

describe('parseSalary on the sample file', () => {
  it('unpivots twelve employees across twelve months without a warning', () => {
    const { rows, warnings } = parseSample();

    expect(rows).toHaveLength(144);
    expect(warnings).toEqual([]);
  });

  it('files every row under the year from the title row', () => {
    const { rows } = parseSample();

    expect(rows.every((row) => row.year === 2025)).toBe(true);
  });

  it('preserves the July raise rather than averaging the year', () => {
    // Salary is genuinely per-month; averaging it would smear a mid-year raise
    // across every rate the engine derives.
    const ayesha = parseSample().rows.filter((row) => row.employeeName === 'Ayesha Rahman');

    expect(ayesha.find((row) => row.month === 6)?.monthlySalary).toBe(18000);
    expect(ayesha.find((row) => row.month === 7)?.monthlySalary).toBe(18500);
  });

  it('totals the payroll the invariant reconciles against', () => {
    const total = parseSample().rows.reduce((sum, row) => sum + row.monthlySalary, 0);

    expect(total).toBeCloseTo(2_400_000, 2);
  });

  it('covers all twelve months for all twelve employees', () => {
    const { rows } = parseSample();

    expect(new Set(rows.map((row) => row.employeeNo)).size).toBe(12);
    expect(new Set(rows.map((row) => row.month)).size).toBe(12);
  });
});

describe('parseSalary year inference', () => {
  it('reads the year from a title row above the header', () => {
    const { rows } = parseFixture(
      [TITLE_ROW, HEADER_ROW, ['10201', 'Ayesha Rahman', 18000, 18000, 18000]],
      'no-year-in-this-name.xlsx',
    );

    expect(rows.every((row) => row.year === 2025)).toBe(true);
  });

  it('falls back to the file name when no title row carries a year', () => {
    const { rows } = parseFixture(
      [HEADER_ROW, ['10201', 'Ayesha Rahman', 18000, 18000, 18000]],
      'salaries-2024.xlsx',
    );

    expect(rows.every((row) => row.year === 2024)).toBe(true);
  });

  it('throws rather than guessing when neither yields a year', () => {
    expect(() =>
      parseFixture([HEADER_ROW, ['10201', 'Ayesha Rahman', 18000, 18000, 18000]], 'salaries.xlsx'),
    ).toThrow(/could not determine the salary year/i);
  });
});

describe('parseSalary cell handling', () => {
  it('skips a blank month silently — an unpaid month is not an error', () => {
    const { rows, warnings } = parseFixture([
      TITLE_ROW,
      HEADER_ROW,
      ['10201', 'Ayesha Rahman', 18000, null, '-'],
    ]);

    expect(rows.map((row) => row.month)).toEqual([1]);
    expect(warnings).toEqual([]);
  });

  it('warns on a month that holds something other than a number', () => {
    const { rows, warnings } = parseFixture([
      TITLE_ROW,
      HEADER_ROW,
      ['10201', 'Ayesha Rahman', 18000, 'on leave', 18000],
    ]);

    expect(rows.map((row) => row.month)).toEqual([1, 3]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/not a salary amount/i);
    expect(warnings[0].row).toBe(3);
  });

  it('reads thousands separators written into a cell', () => {
    const { rows } = parseFixture([
      TITLE_ROW,
      HEADER_ROW,
      ['10201', 'Ayesha Rahman', '18,000', 18000, 18000],
    ]);

    expect(rows[0].monthlySalary).toBe(18000);
  });

  it('skips a row with no employee identity', () => {
    const { rows, warnings } = parseFixture([
      TITLE_ROW,
      HEADER_ROW,
      [null, null, 18000, 18000, 18000],
    ]);

    expect(rows).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/employee number or name/i);
  });
});

describe('parseSalary structural failures', () => {
  it('throws naming a required column that is missing entirely', () => {
    expect(() =>
      parseFixture([TITLE_ROW, ['Employee Name', 'January'], ['Ayesha Rahman', 18000]]),
    ).toThrow(/"employee no"/i);
  });

  it('throws when there are no month columns to unpivot', () => {
    expect(() =>
      parseFixture([
        TITLE_ROW,
        ['Employee No.', 'Employee Name', 'Annual'],
        ['10201', 'Ayesha Rahman', 216000],
      ]),
    ).toThrow(/no month columns/i);
  });

  it('throws when the sheet is named something else', () => {
    expect(() => parseFixture([TITLE_ROW, HEADER_ROW], 'salaries-2025.xlsx', 'Sheet1')).toThrow(
      /no sheet named "Salary"/i,
    );
  });
});
