import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  findColumn,
  findHeaderRow,
  isBlankCell,
  loadWorkbook,
  parseNumericCell,
  requireSheet,
  resolveColumns,
  sheetCells,
  sheetHeaderKeys,
  sheetRowsFromHeader,
} from '../../src/parse/xlsx-helpers';

const SAMPLE_DATA = join(__dirname, '../../../sample-data');

function firstSheet(fileName: string): XLSX.WorkSheet {
  const workbook = loadWorkbook(readFileSync(join(SAMPLE_DATA, fileName)));
  return workbook.Sheets[workbook.SheetNames[0]];
}

function sheetOf(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

describe('loadWorkbook', () => {
  it('reads each committed sample file', () => {
    const files = ['timesheet-2025.xlsx', 'salaries-2025.xlsx', 'project-prices-2025.xlsx'];
    const sheetNames = files.map(
      (file) => loadWorkbook(readFileSync(join(SAMPLE_DATA, file))).SheetNames[0],
    );

    expect(sheetNames).toEqual(['Timesheet', 'Salary', 'Projects']);
  });

  it('rejects a file that is not a workbook, however it is named', () => {
    // SheetJS sniffs formats and would otherwise read this as a one-cell CSV,
    // half-ingesting a .txt someone renamed to .xlsx.
    expect(() => loadWorkbook(Buffer.from('this is not a workbook'))).toThrow(
      /not an \.xlsx or \.xls workbook/i,
    );
    expect(() => loadWorkbook(Buffer.from(''))).toThrow(/not an \.xlsx or \.xls workbook/i);
    expect(() => loadWorkbook(Buffer.from('Ref Code,Hours\nQ2025001a,12.5'))).toThrow(
      /not an \.xlsx or \.xls workbook/i,
    );
  });
});

describe('findHeaderRow', () => {
  it('finds the header in row 1 of the timesheet', () => {
    const headers = ['Month', 'Employee No.', 'Employee Name', 'Category', 'Ref Code', 'Hours'];

    expect(findHeaderRow(firstSheet('timesheet-2025.xlsx'), headers)).toBe(0);
  });

  it('finds the header in row 2 of the salary sheet, under its title row', () => {
    const headers = ['Employee No.', 'Employee Name', 'January', 'December'];

    expect(findHeaderRow(firstSheet('salaries-2025.xlsx'), headers)).toBe(1);
  });

  it('finds the header in row 1 of the price list', () => {
    const headers = ['Ref Code', 'Project Price', 'Sales month', 'Category', 'Status'];

    expect(findHeaderRow(firstSheet('project-prices-2025.xlsx'), headers)).toBe(0);
  });

  it('matches a long column name by substring', () => {
    // The real header is "Company Name (Billable)/ Fixed Costs (Unbillable)" — spaced
    // differently from how docs/data-sources.md quotes it. Exact matching would miss it.
    const sheet = firstSheet('timesheet-2025.xlsx');

    expect(findHeaderRow(sheet, ['project', 'company name'])).toBe(0);
  });

  it('picks the row with the most matches, not the first with any', () => {
    const sheet = sheetOf([
      ['Category', 'unrelated'],
      ['Ref Code', 'Category', 'Hours'],
      ['data', 'data', 'data'],
    ]);

    expect(findHeaderRow(sheet, ['Ref Code', 'Category', 'Hours'])).toBe(1);
  });

  it('keeps the earliest row when two score equally', () => {
    const sheet = sheetOf([
      ['Ref Code', 'Hours'],
      ['Ref Code', 'Hours'],
    ]);

    expect(findHeaderRow(sheet, ['Ref Code', 'Hours'])).toBe(0);
  });

  it('throws when no scanned row contains any expected header', () => {
    const sheet = firstSheet('timesheet-2025.xlsx');

    expect(() => findHeaderRow(sheet, ['Invoice Number', 'Tax Code'])).toThrow(
      /could not find a header row/i,
    );
  });

  it('names the headers it was looking for when it throws', () => {
    expect(() => findHeaderRow(sheetOf([['a', 'b']]), ['Invoice Number'])).toThrow(
      /"Invoice Number"/,
    );
  });

  it('only scans maxRowsToScan rows', () => {
    const sheet = sheetOf([['noise'], ['noise'], ['noise'], ['Ref Code', 'Hours']]);

    expect(findHeaderRow(sheet, ['Ref Code', 'Hours'])).toBe(3);
    expect(() => findHeaderRow(sheet, ['Ref Code', 'Hours'], 2)).toThrow(
      /could not find a header row/i,
    );
  });
});

describe('isBlankCell', () => {
  it('is true for empty values and the dashes people type into blank cells', () => {
    expect(isBlankCell(null)).toBe(true);
    expect(isBlankCell(undefined)).toBe(true);
    expect(isBlankCell('')).toBe(true);
    expect(isBlankCell('  ')).toBe(true);
    expect(isBlankCell('-')).toBe(true);
    expect(isBlankCell(' - ')).toBe(true);
    expect(isBlankCell('–')).toBe(true); // en dash
    expect(isBlankCell('—')).toBe(true); // em dash
  });

  it('is false for a real value, including zero', () => {
    // A genuine 0 is a number, not a gap. Treating it as blank is how a real
    // zero silently becomes a missing value.
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell('0')).toBe(false);
    expect(isBlankCell(176)).toBe(false);
    expect(isBlankCell('January 2025')).toBe(false);
    expect(isBlankCell('--')).toBe(false);
    expect(isBlankCell(false)).toBe(false);
  });
});

describe('parseNumericCell', () => {
  it('reads plain numbers', () => {
    expect(parseNumericCell(18000)).toBe(18000);
    expect(parseNumericCell(135.9)).toBe(135.9);
    expect(parseNumericCell(0)).toBe(0);
    expect(parseNumericCell(-8)).toBe(-8);
  });

  it('reads numeric strings, including thousands separators', () => {
    expect(parseNumericCell('1,234.5')).toBe(1234.5);
    expect(parseNumericCell('18000')).toBe(18000);
    expect(parseNumericCell(' 2,400,000.00 ')).toBe(2400000);
    expect(parseNumericCell('-1,234.5')).toBe(-1234.5);
    // Excel exports non-breaking spaces as separators often enough to matter.
    expect(parseNumericCell('1\u00a0234,5'.replace(',', '.'))).toBe(1234.5);
  });

  it('returns null for a blank cell rather than zero', () => {
    expect(parseNumericCell('-')).toBeNull();
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('   ')).toBeNull();
    expect(parseNumericCell(null)).toBeNull();
    expect(parseNumericCell(undefined)).toBeNull();
  });

  it('returns null for anything that is not a number', () => {
    expect(parseNumericCell('n/a')).toBeNull();
    expect(parseNumericCell('12 hours')).toBeNull();
    expect(parseNumericCell(true)).toBeNull();
    expect(parseNumericCell({})).toBeNull();
    expect(parseNumericCell(Number.NaN)).toBeNull();
    expect(parseNumericCell(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('returns null for a string of separators alone', () => {
    // Number('') is 0, so this would otherwise read as a genuine zero.
    expect(parseNumericCell(',')).toBeNull();
    expect(parseNumericCell(', ,')).toBeNull();
  });
});

describe('sheetRowsFromHeader', () => {
  it('keys each row by its trimmed header', () => {
    const sheet = sheetOf([
      ['  Ref Code  ', 'Hours'],
      ['Q2025001a', 12.5],
    ]);

    expect(sheetRowsFromHeader(sheet, 0)).toEqual([
      { rowNumber: 2, values: { 'Ref Code': 'Q2025001a', Hours: 12.5 } },
    ]);
  });

  it('skips fully-blank rows but keeps the row numbers Excel shows', () => {
    const sheet = sheetOf([['Ref Code'], ['first'], [null], ['   '], ['second']]);

    expect(sheetRowsFromHeader(sheet, 0).map((row) => row.rowNumber)).toEqual([2, 5]);
  });

  it('keeps a row that is blank in some columns but not all', () => {
    const sheet = sheetOf([
      ['Ref Code', 'Hours'],
      ['Q2025001a', '-'],
    ]);
    const [row] = sheetRowsFromHeader(sheet, 0);

    expect(row.values.Hours).toBe('-');
    expect(parseNumericCell(row.values.Hours)).toBeNull();
  });

  it('ignores columns with a blank header', () => {
    const sheet = sheetOf([
      ['Ref Code', null, 'Hours'],
      ['Q2025001a', 'orphan', 12.5],
    ]);

    expect(Object.keys(sheetRowsFromHeader(sheet, 0)[0].values)).toEqual(['Ref Code', 'Hours']);
  });

  it('fills a short row with nulls rather than leaving keys undefined', () => {
    const sheet = sheetOf([['Ref Code', 'Hours'], ['Q2025001a']]);

    expect(sheetRowsFromHeader(sheet, 0)[0].values).toEqual({
      'Ref Code': 'Q2025001a',
      Hours: null,
    });
  });

  it('reads the salary sheet from its row-2 header', () => {
    const sheet = firstSheet('salaries-2025.xlsx');
    const rows = sheetRowsFromHeader(sheet, 1);

    expect(rows).toHaveLength(12);
    // Data starts on spreadsheet row 3, under the title row and the header.
    expect(rows[0].rowNumber).toBe(3);
    expect(rows[0].values['Employee No.']).toBe('10201');
    expect(rows[0].values['Employee Name']).toBe('Ayesha Rahman');
    expect(parseNumericCell(rows[0].values.January)).toBe(18000);
    // Everyone takes a raise in July — the reason salary is never averaged.
    expect(parseNumericCell(rows[0].values.July)).toBe(18500);
  });

  it('reads every timesheet row', () => {
    const sheet = firstSheet('timesheet-2025.xlsx');
    const rows = sheetRowsFromHeader(sheet, 0);

    expect(rows).toHaveLength(562);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[561].rowNumber).toBe(563);
    expect(rows[0].values['Employee No.']).toBe('10201');
  });

  it('accounts for a sheet whose range does not start at row 1', () => {
    // sheet_to_json drops the leading offset, so the row numbers would otherwise
    // be reported two rows too early.
    const sheet: XLSX.WorkSheet = {
      '!ref': 'A3:B4',
      A3: { t: 's', v: 'Ref Code' },
      B3: { t: 's', v: 'Hours' },
      A4: { t: 's', v: 'Q2025001a' },
      B4: { t: 'n', v: 12.5 },
    };

    expect(sheetRowsFromHeader(sheet, 0)).toEqual([
      { rowNumber: 4, values: { 'Ref Code': 'Q2025001a', Hours: 12.5 } },
    ]);
  });

  it('throws when the header row is outside the sheet', () => {
    expect(() => sheetRowsFromHeader(sheetOf([['Ref Code']]), 5)).toThrow(/outside the sheet/i);
  });
});

describe('requireSheet', () => {
  it('returns the first sheet when no name is given', () => {
    const workbook = loadWorkbook(readFileSync(join(SAMPLE_DATA, 'salaries-2025.xlsx')));

    expect(requireSheet(workbook)).toBe(workbook.Sheets.Salary);
  });

  it('returns the named sheet', () => {
    const workbook = loadWorkbook(readFileSync(join(SAMPLE_DATA, 'timesheet-2025.xlsx')));

    expect(requireSheet(workbook, 'Timesheet')).toBe(workbook.Sheets.Timesheet);
  });

  it('throws listing what the workbook actually contains', () => {
    const workbook = loadWorkbook(readFileSync(join(SAMPLE_DATA, 'timesheet-2025.xlsx')));

    expect(() => requireSheet(workbook, 'Salary')).toThrow(/no sheet named "Salary".*"Timesheet"/s);
  });
});

describe('sheetHeaderKeys', () => {
  it('trims the names and drops blank columns', () => {
    const sheet = sheetOf([
      ['  Ref Code  ', null, 'Hours', '-'],
      ['Q2025001a', 'x', 12.5, 'y'],
    ]);

    expect(sheetHeaderKeys(sheet, 0)).toEqual(['Ref Code', 'Hours']);
  });

  it('matches the keys sheetRowsFromHeader produces', () => {
    const sheet = firstSheet('salaries-2025.xlsx');
    const keys = sheetHeaderKeys(sheet, 1);

    expect(Object.keys(sheetRowsFromHeader(sheet, 1)[0].values)).toEqual(keys);
  });

  it('is empty for a row outside the sheet', () => {
    expect(sheetHeaderKeys(sheetOf([['Ref Code']]), 5)).toEqual([]);
  });
});

describe('sheetCells', () => {
  it('exposes the rows above a header, where the salary year lives', () => {
    const sheet = firstSheet('salaries-2025.xlsx');

    expect(String(sheetCells(sheet)[0][1])).toMatch(/20\d\d/);
  });
});

describe('findColumn', () => {
  const headers = [
    'Ref Code',
    'Project (Billable) / Task (Unbillable) Name',
    'Company Name (Billable)/ Fixed Costs (Unbillable)',
    'Hours',
  ];

  it('locates a long column by a short case-insensitive substring', () => {
    expect(findColumn(headers, 'company name')).toBe(headers[2]);
    expect(findColumn(headers, 'HOURS')).toBe('Hours');
  });

  it('returns null when nothing matches', () => {
    expect(findColumn(headers, 'invoice')).toBeNull();
    expect(findColumn(headers, '   ')).toBeNull();
  });

  it('takes the first match when a needle fits more than one column', () => {
    // Why projects.ts uses 'name' and 'price' rather than the ambiguous 'project'.
    expect(findColumn(['Project (Billable) Name', 'Project Price'], 'project')).toBe(
      'Project (Billable) Name',
    );
  });
});

describe('resolveColumns', () => {
  const headers = ['Ref Code', 'Project Price', 'Sales month'];

  it('maps a parser vocabulary onto the header text a sheet actually uses', () => {
    expect(resolveColumns(headers, { refCode: 'ref code', price: 'price' })).toEqual({
      refCode: 'Ref Code',
      price: 'Project Price',
    });
  });

  it('throws naming every column it could not find', () => {
    expect(() =>
      resolveColumns(headers, { hours: 'hours', employeeNo: 'employee no', refCode: 'ref code' }),
    ).toThrow(/"hours", "employee no"/);
  });

  it('lists the headers it did see, so the mismatch is diagnosable', () => {
    expect(() => resolveColumns(headers, { hours: 'hours' })).toThrow(/"Sales month"/);
  });
});
