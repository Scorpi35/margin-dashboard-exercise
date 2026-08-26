import type { WorkSheet } from 'xlsx';

import type { MonthNumber, ParseResult, ParseWarning, SalaryRow } from '@shared/types';

import { parseMonthName } from './dates';
import {
  findHeaderRow,
  isBlankCell,
  loadWorkbook,
  parseNumericCell,
  requireSheet,
  resolveColumns,
  sheetCells,
  sheetHeaderKeys,
  sheetRowsFromHeader,
} from './xlsx-helpers';

/**
 * Reads `salaries-2025.xlsx` and unpivots it — the file is wide, one row per
 * employee and one column per month, and the rest of the system wants one record
 * per employee-month. Twelve rows become 144.
 *
 * Two quirks make this file the awkward one (`docs/data-sources.md`): its header
 * sits in row 2 under a title row, and no row carries a year.
 */

const SHEET_NAME = 'Salary';

const REQUIRED_COLUMNS = {
  employeeNo: 'employee no',
  employeeName: 'employee name',
} as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const YEAR_PATTERN = /20\d\d/;

export function parseSalary(buffer: Buffer, fileName: string): ParseResult<SalaryRow> {
  const sheet = requireSheet(loadWorkbook(buffer), SHEET_NAME);
  const headerRowIndex = findHeaderRow(sheet, [...Object.values(REQUIRED_COLUMNS), ...MONTH_NAMES]);
  const headerKeys = sheetHeaderKeys(sheet, headerRowIndex);

  const columns = resolveColumns(headerKeys, REQUIRED_COLUMNS);
  const monthColumns = findMonthColumns(headerKeys);
  if (monthColumns.length === 0) {
    throw new Error('The salary sheet has no month columns, so there is nothing to unpivot.');
  }

  const year = inferYear(sheet, headerRowIndex, fileName);

  const rows: SalaryRow[] = [];
  const warnings: ParseWarning[] = [];

  for (const { rowNumber, values } of sheetRowsFromHeader(sheet, headerRowIndex)) {
    const warn = (message: string): void => {
      warnings.push({ file: fileName, sheet: SHEET_NAME, row: rowNumber, message });
    };

    const employeeNo = text(values[columns.employeeNo]);
    const employeeName = text(values[columns.employeeName]);
    if (employeeNo === null || employeeName === null) {
      warn('Skipped: the row has no employee number or name to attach a salary to.');
      continue;
    }

    for (const { key, month } of monthColumns) {
      const cell = values[key];
      // A blank month is a month this person was not on payroll, not an error.
      // It is left absent so the engine reports them in `missingSalaryEmployees`.
      if (isBlankCell(cell)) continue;

      const monthlySalary = parseNumericCell(cell);
      if (monthlySalary === null) {
        warn(`Skipped ${key}: "${String(cell)}" is not a salary amount.`);
        continue;
      }

      rows.push({ year, month, employeeNo, employeeName, monthlySalary });
    }
  }

  return { rows, warnings };
}

/** Every header that names a month, paired with the month it names. */
function findMonthColumns(headerKeys: readonly string[]): { key: string; month: MonthNumber }[] {
  return headerKeys
    .map((key) => ({ key, month: parseMonthName(key) }))
    .filter((column): column is { key: string; month: MonthNumber } => column.month !== null);
}

/**
 * The year the sheet is filed under.
 *
 * It appears nowhere on the data rows — only in the `"Salary Overview 2025 (AED)"`
 * title above the header — so it is read from there first and from the file name
 * second. Neither means a throw: a salary sheet filed under the wrong year is
 * worse than a failed import.
 */
function inferYear(sheet: WorkSheet, headerRowIndex: number, fileName: string): number {
  const titleText = sheetCells(sheet)
    .slice(0, headerRowIndex)
    .flat()
    .map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
    .join(' ');

  const fromTitle = YEAR_PATTERN.exec(titleText);
  if (fromTitle) return Number(fromTitle[0]);

  const fromFileName = YEAR_PATTERN.exec(fileName);
  if (fromFileName) return Number(fromFileName[0]);

  throw new Error(
    `Could not determine the salary year: no 20xx appears above the header row, and "${fileName}" ` +
      'does not contain one either.',
  );
}

function text(value: unknown): string | null {
  return isBlankCell(value) ? null : String(value).trim();
}
