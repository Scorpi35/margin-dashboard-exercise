import type { ExpenseType, ParseResult, ParseWarning, TimesheetRow } from '@shared/types';

import { parseYearMonth } from './dates';
import {
  findColumn,
  findHeaderRow,
  isBlankCell,
  loadWorkbook,
  parseNumericCell,
  requireSheet,
  resolveColumns,
  sheetHeaderKeys,
  sheetRowsFromHeader,
} from './xlsx-helpers';

/**
 * Reads `timesheet-2025.xlsx` — one row per person, per task, per month.
 *
 * A bad row is skipped with a warning; only a missing required column throws.
 * Losing one malformed row costs a few hours of attribution, while rejecting the
 * file costs the whole year.
 */

export const TIMESHEET_SHEET = 'Timesheet';

/** Substrings, not exact names — see `findColumn`. Each is unique in this header. */
const REQUIRED_COLUMNS = {
  month: 'month',
  employeeNo: 'employee no',
  employeeName: 'employee name',
  category: 'category',
  refCode: 'ref code',
  hours: 'hours',
} as const;

const OPTIONAL_COLUMNS = {
  expenseType: 'type of expense',
  department: 'department',
  designation: 'designation',
  taskName: 'project',
  companyName: 'company name',
  description: 'description',
} as const;

type OptionalColumn = keyof typeof OPTIONAL_COLUMNS;

export function parseTimesheet(buffer: Buffer, fileName: string): ParseResult<TimesheetRow> {
  const sheet = requireSheet(loadWorkbook(buffer), TIMESHEET_SHEET);
  const headerRowIndex = findHeaderRow(sheet, Object.values(REQUIRED_COLUMNS));
  const headerKeys = sheetHeaderKeys(sheet, headerRowIndex);

  const columns = resolveColumns(headerKeys, REQUIRED_COLUMNS);
  const optional = resolveOptionalColumns(headerKeys);

  const rows: TimesheetRow[] = [];
  const warnings: ParseWarning[] = [];

  for (const { rowNumber, values } of sheetRowsFromHeader(sheet, headerRowIndex)) {
    const warn = (message: string): void => {
      warnings.push({ file: fileName, sheet: TIMESHEET_SHEET, row: rowNumber, message });
    };
    const optionalText = (column: OptionalColumn): string | null => {
      const key = optional[column];
      return key === null ? null : text(values[key]);
    };

    const employeeNo = text(values[columns.employeeNo]);
    const employeeName = text(values[columns.employeeName]);
    if (employeeNo === null || employeeName === null) {
      warn('Skipped: the row has no employee number or name to attribute the hours to.');
      continue;
    }

    let period;
    try {
      period = parseYearMonth(values[columns.month]);
    } catch (err) {
      warn(`Skipped: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const rawHours = values[columns.hours];
    const hours = parseNumericCell(rawHours);
    if (hours === null) {
      warn(`Skipped: "${String(rawHours)}" is not a number of hours.`);
      continue;
    }
    if (hours < 0) {
      warn(`Skipped: hours cannot be negative (${hours}).`);
      continue;
    }

    // A non-billable row repeats its category name in the Ref Code column, so a
    // blank ref code falls back to the category. With both blank there is nothing
    // to attribute the hours to at all.
    const category = text(values[columns.category]);
    const refCode = text(values[columns.refCode]) ?? category;
    if (refCode === null) {
      warn('Skipped: the row has neither a ref code nor a category.');
      continue;
    }

    if (category === null) {
      // Kept rather than skipped: dropping the row would distort the month's
      // rates, while an uncategorised row is simply absent from
      // `billableCategories` and lands in the indirect pool.
      warn(`Kept without a category, so its ${hours} hours count as non-billable.`);
    }

    rows.push({
      year: period.year,
      month: period.month,
      employeeNo,
      employeeName,
      expenseType: expenseTypeOf(optionalText('expenseType')),
      department: optionalText('department') ?? '',
      designation: optionalText('designation') ?? '',
      category: category ?? '',
      refCode,
      taskName: optionalText('taskName'),
      companyName: optionalText('companyName'),
      description: optionalText('description'),
      hours,
    });
  }

  return { rows, warnings };
}

function resolveOptionalColumns(
  headerKeys: readonly string[],
): Record<OptionalColumn, string | null> {
  const entries = Object.entries(OPTIONAL_COLUMNS) as [OptionalColumn, string][];

  return Object.fromEntries(
    entries.map(([field, needle]) => [field, findColumn(headerKeys, needle)]),
  ) as Record<OptionalColumn, string | null>;
}

/**
 * Indirect labour is only ever an explicit `IDL`. A blank cell or a missing
 * column defaults to direct, which is the safer reading: an hour wrongly marked
 * indirect would leave the project it was actually worked on.
 */
function expenseTypeOf(value: string | null): ExpenseType {
  return value?.toUpperCase() === 'IDL' ? 'IDL' : 'DL';
}

/** A trimmed cell, or `null` when it holds nothing a reader would call a value. */
function text(value: unknown): string | null {
  return isBlankCell(value) ? null : String(value).trim();
}
