import type {
  MonthNumber,
  ParseResult,
  ParseWarning,
  ProjectRow,
  ProjectStatus,
} from '@shared/types';

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
 * Reads `project-prices-2025.xlsx` — one row per project, and the only place a
 * ref code acquires a price.
 *
 * A row without a usable price is skipped rather than priced at zero. Its ref code
 * then shows up in `PeriodSummary.unpricedRefCodes` if the timesheet has hours
 * against it, which is the visible outcome the reader can act on.
 */

const SHEET_NAME = 'Projects';

/**
 * `'project'` would be ambiguous here — it matches both `"Project (Billable)
 * Name"` and `"Project Price"`. Each needle below is unique in this header.
 */
const REQUIRED_COLUMNS = {
  refCode: 'ref code',
  projectPrice: 'price',
} as const;

const OPTIONAL_COLUMNS = {
  projectName: 'name',
  salesMonth: 'sales',
  category: 'category',
  status: 'status',
} as const;

type OptionalColumn = keyof typeof OPTIONAL_COLUMNS;

const STATUSES: readonly ProjectStatus[] = ['in progress', 'completed'];

export function parseProjects(buffer: Buffer, fileName: string): ParseResult<ProjectRow> {
  const sheet = requireSheet(loadWorkbook(buffer), SHEET_NAME);
  const headerRowIndex = findHeaderRow(sheet, [
    ...Object.values(REQUIRED_COLUMNS),
    ...Object.values(OPTIONAL_COLUMNS),
  ]);
  const headerKeys = sheetHeaderKeys(sheet, headerRowIndex);

  const columns = resolveColumns(headerKeys, REQUIRED_COLUMNS);
  const optional = resolveOptionalColumns(headerKeys);

  const rows: ProjectRow[] = [];
  const warnings: ParseWarning[] = [];
  const seen = new Map<string, number>();

  for (const { rowNumber, values } of sheetRowsFromHeader(sheet, headerRowIndex)) {
    const warn = (message: string): void => {
      warnings.push({ file: fileName, sheet: SHEET_NAME, row: rowNumber, message });
    };
    const optionalCell = (column: OptionalColumn): unknown => {
      const key = optional[column];
      return key === null ? null : values[key];
    };

    const refCode = text(values[columns.refCode]);
    if (refCode === null) {
      warn('Skipped: the row has no ref code, so its price cannot be matched to any work.');
      continue;
    }

    const firstSeenOn = seen.get(refCode);
    if (firstSeenOn !== undefined) {
      // The first price wins. Silently taking the last would make the totals
      // depend on row order, which nobody would think to check.
      warn(`Skipped: "${refCode}" already appeared on row ${firstSeenOn}; keeping that price.`);
      continue;
    }

    const rawPrice = values[columns.projectPrice];
    const projectPrice = parseNumericCell(rawPrice);
    if (projectPrice === null) {
      warn(`Skipped "${refCode}": "${String(rawPrice)}" is not a price.`);
      continue;
    }

    seen.set(refCode, rowNumber);
    rows.push({
      refCode,
      projectName: text(optionalCell('projectName')) ?? '',
      projectPrice,
      ...salesPeriod(optionalCell('salesMonth'), refCode, warn),
      category: text(optionalCell('category')) ?? '',
      status: statusOf(optionalCell('status'), refCode, warn),
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
 * The sales month, which this file writes as `"January '25"` — a different format
 * from the timesheet's `"January 2025"`.
 *
 * It is informational: revenue is attributed to the periods the hours were logged
 * in, not to the sales month, so an unreadable one costs a warning rather than the
 * price. Absent is `null`, never `0` — `0` is not a month, and every layer
 * downstream would have to guess what it meant.
 */
function salesPeriod(
  cell: unknown,
  refCode: string,
  warn: (message: string) => void,
): { salesYear: number | null; salesMonth: MonthNumber | null } {
  if (isBlankCell(cell)) return { salesYear: null, salesMonth: null };

  try {
    const { year, month } = parseYearMonth(cell);
    return { salesYear: year, salesMonth: month };
  } catch (err) {
    warn(
      `Kept "${refCode}" without a sales month: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return { salesYear: null, salesMonth: null };
  }
}

function statusOf(
  cell: unknown,
  refCode: string,
  warn: (message: string) => void,
): ProjectStatus | null {
  const raw = text(cell);
  if (raw === null) return null;

  // Collapse the spacing so "In  Progress" reads the same as "in progress".
  const normalised = raw.toLowerCase().replace(/\s+/g, ' ');
  const match = STATUSES.find((status) => status === normalised);
  if (match === undefined) {
    warn(`Kept "${refCode}" without a status: "${raw}" is not one of ${STATUSES.join(' or ')}.`);
    return null;
  }

  return match;
}

function text(value: unknown): string | null {
  return isBlankCell(value) ? null : String(value).trim();
}
