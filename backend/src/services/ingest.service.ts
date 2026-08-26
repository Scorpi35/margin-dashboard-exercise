import type {
  ExpenseType,
  MonthNumber,
  ParseResult,
  ParseWarning,
  ProjectRow,
  ProjectStatus,
  SalaryRow,
  TimesheetRow,
  UploadHistoryEntry,
  UploadResult,
  UploadType,
  YearMonthKey,
} from '@shared/types';

import { yearMonthKey } from '../parse/dates';
import { parseProjects } from '../parse/projects';
import { parseSalary } from '../parse/salary';
import { parseTimesheet } from '../parse/timesheet';
import { getDb } from '../lib/db';
import { HttpError } from '../middleware/errorHandler';

/**
 * Reads and writes the parsed spreadsheets.
 *
 * This is the only module where `snake_case` appears in TypeScript. Column names
 * are mapped to and from `camelCase` on the way in and out, so no database
 * spelling escapes into the engine, the controllers or the UI.
 */

/** What one upload changed, for the response the UI shows. */
export interface IngestSummary {
  readonly rowsWritten: number;
  /** The `YYYY-MM` months this upload was authoritative for, and therefore replaced. */
  readonly monthsReplaced: readonly YearMonthKey[];
  readonly warnings: readonly ParseWarning[];
}

/** The columns the primary keys are built from, in the order a reader scans them. */
const KEY_FIELDS = ['employeeNo', 'year', 'month', 'category', 'refCode'];

interface PeriodRow {
  readonly year: number;
  readonly month: number;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Parses an uploaded spreadsheet and writes it, in that order and all or nothing.
 *
 * A structurally wrong file — the salary sheet dropped into the timesheet slot,
 * say — throws before a single row is read, so there is nothing to roll back. A
 * file that is the right shape but has bad rows in it succeeds: those rows are
 * skipped and returned as warnings rather than costing the user the whole upload.
 *
 * @throws `HttpError(400)` when the file is not the one it claims to be.
 */
export function ingestUpload(type: UploadType, buffer: Buffer, fileName: string): UploadResult {
  switch (type) {
    case 'timesheet':
      return toResult(
        type,
        fileName,
        ingestTimesheet(parse(parseTimesheet, buffer, fileName), fileName),
      );
    case 'salary':
      return toResult(
        type,
        fileName,
        ingestSalaries(parse(parseSalary, buffer, fileName), fileName),
      );
    case 'projects':
      return toResult(
        type,
        fileName,
        ingestProjects(parse(parseProjects, buffer, fileName), fileName),
      );
  }
}

/**
 * Runs a parser, turning its structural failure into the 400 the caller deserves.
 *
 * The parser messages already name what was wrong — a missing sheet lists the
 * ones the workbook does contain — so they are passed through rather than
 * replaced with something vaguer.
 */
function parse<T>(
  parser: (buffer: Buffer, fileName: string) => ParseResult<T>,
  buffer: Buffer,
  fileName: string,
): ParseResult<T> {
  try {
    return parser(buffer, fileName);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new HttpError(400, `${detail} Nothing was saved.`);
  }
}

function toResult(type: UploadType, fileName: string, summary: IngestSummary): UploadResult {
  return {
    type,
    fileName,
    rowsWritten: summary.rowsWritten,
    monthsAffected: summary.monthsReplaced,
    warnings: summary.warnings,
  };
}

/** The audit trail, newest first. Only uploads that were actually written appear. */
export function readUploads(): UploadHistoryEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, kind, file_name, uploaded_at, row_count, warning_count, months
       FROM uploads
       ORDER BY id DESC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: Number(row.id),
    type: String(row.kind) as UploadType,
    fileName: String(row.file_name),
    uploadedAt: String(row.uploaded_at),
    rowCount: Number(row.row_count),
    warningCount: Number(row.warning_count),
    months: String(row.months) === '' ? [] : String(row.months).split(','),
  }));
}

export function ingestTimesheet(
  result: ParseResult<TimesheetRow>,
  fileName: string,
): IngestSummary {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO timesheet_entries (
      employee_no, year, month, employee_name, expense_type, department, designation,
      category, ref_code, task_name, company_name, description, hours
    ) VALUES (
      @employeeNo, @year, @month, @employeeName, @expenseType, @department, @designation,
      @category, @refCode, @taskName, @companyName, @description, @hours
    )
  `);

  return replaceMonths(db, 'timesheet', 'timesheet_entries', result, fileName, (row) => {
    try {
      insert.run(row);
    } catch (err) {
      throw duplicateRow(err, row);
    }
  });
}

export function ingestSalaries(result: ParseResult<SalaryRow>, fileName: string): IngestSummary {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO salaries (employee_no, year, month, employee_name, monthly_salary)
    VALUES (@employeeNo, @year, @month, @employeeName, @monthlySalary)
  `);

  return replaceMonths(db, 'salary', 'salaries', result, fileName, (row) => {
    try {
      insert.run(row);
    } catch (err) {
      throw duplicateRow(err, row);
    }
  });
}

/**
 * Prices are keyed by ref code alone, so this upserts rather than replacing a
 * period.
 *
 * A project missing from a newer price list is deliberately left in place:
 * deleting it would strip the price from work the timesheet still has hours
 * against, turning a priced project into an unpriced one on the strength of an
 * omission.
 */
export function ingestProjects(result: ParseResult<ProjectRow>, fileName: string): IngestSummary {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO projects (
      ref_code, project_name, project_price, sales_year, sales_month, category, status
    ) VALUES (
      @refCode, @projectName, @projectPrice, @salesYear, @salesMonth, @category, @status
    )
    ON CONFLICT (ref_code) DO UPDATE SET
      project_name  = excluded.project_name,
      project_price = excluded.project_price,
      sales_year    = excluded.sales_year,
      sales_month   = excluded.sales_month,
      category      = excluded.category,
      status        = excluded.status
  `);

  db.transaction(() => {
    for (const row of result.rows) upsert.run(row);
    recordUpload(db, 'projects', fileName, result.rows.length, result.warnings.length, []);
  })();

  return { rowsWritten: result.rows.length, monthsReplaced: [], warnings: result.warnings };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether anything has been ingested at all — any of the three files, not just
 * the timesheet. A database holding only salaries has been uploaded to, and
 * telling the user otherwise would invite them to repeat work they have done.
 *
 * An `EXISTS` rather than `readTimesheet().length` — the caller wants a boolean,
 * not 562 rows deserialised to find out the answer is `true`.
 */
export function hasIngestedData(): boolean {
  const row = getDb()
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM timesheet_entries)
            + EXISTS (SELECT 1 FROM salaries)
            + EXISTS (SELECT 1 FROM projects) AS present`,
    )
    .get() as { present: number };

  return row.present > 0;
}

/**
 * Every year that has data, ascending.
 *
 * Both tables are consulted: a year with salaries but no hours still has cost in
 * it, and offering only years with timesheet rows would hide that.
 */
export function readAvailableYears(): number[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT year FROM timesheet_entries
       UNION
       SELECT DISTINCT year FROM salaries
       ORDER BY year`,
    )
    .all() as { year: number }[];

  return rows.map((row) => Number(row.year));
}

/**
 * Every `YYYY-MM` that has data, ascending.
 *
 * The month-level counterpart to {@link readAvailableYears}, and consulted the
 * same way for the same reason: a month with salaries but no hours still has
 * cost in it, and the settings page has to be able to put overhead against it.
 */
export function readAvailableMonths(): YearMonthKey[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT year, month FROM timesheet_entries
       UNION
       SELECT DISTINCT year, month FROM salaries
       ORDER BY year, month`,
    )
    .all() as { year: number; month: MonthNumber }[];

  return rows.map((row) => yearMonthKey(Number(row.year), row.month));
}

export function readTimesheet(): TimesheetRow[] {
  const rows = getDb()
    .prepare(
      `SELECT employee_no, year, month, employee_name, expense_type, department, designation,
              category, ref_code, task_name, company_name, description, hours
       FROM timesheet_entries
       ORDER BY year, month, employee_no, ref_code`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    year: Number(row.year),
    month: Number(row.month),
    employeeNo: String(row.employee_no),
    employeeName: String(row.employee_name),
    expenseType: String(row.expense_type) as ExpenseType,
    department: String(row.department),
    designation: String(row.designation),
    category: String(row.category),
    refCode: String(row.ref_code),
    taskName: nullableText(row.task_name),
    companyName: nullableText(row.company_name),
    description: nullableText(row.description),
    hours: Number(row.hours),
  }));
}

export function readSalaries(): SalaryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT employee_no, year, month, employee_name, monthly_salary
       FROM salaries
       ORDER BY year, month, employee_no`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    year: Number(row.year),
    month: Number(row.month),
    employeeNo: String(row.employee_no),
    employeeName: String(row.employee_name),
    monthlySalary: Number(row.monthly_salary),
  }));
}

export function readProjects(): ProjectRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ref_code, project_name, project_price, sales_year, sales_month, category, status
       FROM projects
       ORDER BY ref_code`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    refCode: String(row.ref_code),
    projectName: String(row.project_name),
    projectPrice: nullableNumber(row.project_price),
    salesYear: nullableNumber(row.sales_year),
    salesMonth: nullableNumber(row.sales_month),
    category: String(row.category),
    status:
      row.status === null || row.status === undefined
        ? null
        : (String(row.status) as ProjectStatus),
  }));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The re-upload rule, and the reason it is written this way.
 *
 * An uploaded file is authoritative for every `(year, month)` it contains and for
 * no others. So: collect the distinct months present in the upload, delete
 * exactly those months, then insert. A file covering only March replaces March
 * and leaves the other eleven months untouched, which is what lets someone fix
 * one month without re-exporting the year.
 *
 * It all happens in one transaction. A failure part-way through rolls back
 * entirely — a half-written month is worse than a rejected upload, because the
 * numbers still render and nothing looks wrong.
 */
function replaceMonths<T extends PeriodRow>(
  db: ReturnType<typeof getDb>,
  kind: string,
  table: string,
  result: ParseResult<T>,
  fileName: string,
  insert: (row: T) => void,
): IngestSummary {
  const months = distinctMonths(result.rows);
  const remove = db.prepare(`DELETE FROM ${table} WHERE year = ? AND month = ?`);

  db.transaction(() => {
    for (const { year, month } of months) remove.run(year, month);
    for (const row of result.rows) insert(row);

    recordUpload(
      db,
      kind,
      fileName,
      result.rows.length,
      result.warnings.length,
      months.map(({ year, month }) => yearMonthKey(year, month)),
    );
  })();

  return {
    rowsWritten: result.rows.length,
    monthsReplaced: months.map(({ year, month }) => yearMonthKey(year, month)),
    warnings: result.warnings,
  };
}

function distinctMonths(rows: readonly PeriodRow[]): PeriodRow[] {
  const months = new Map<string, PeriodRow>();
  for (const { year, month } of rows) {
    months.set(yearMonthKey(year, month), { year, month });
  }

  return [...months.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

function recordUpload(
  db: ReturnType<typeof getDb>,
  kind: string,
  fileName: string,
  rowCount: number,
  warningCount: number,
  months: readonly YearMonthKey[],
): void {
  db.prepare(
    `INSERT INTO uploads (kind, file_name, uploaded_at, row_count, warning_count, months)
     VALUES (?, ?, ?, ?, ?, ?)`,
    // Generating a timestamp, not parsing one — `parse/dates.ts` owns reading
    // dates out of spreadsheets, and a clock is only forbidden inside `calc/`.
  ).run(kind, fileName, new Date().toISOString(), rowCount, warningCount, months.join(','));
}

/**
 * Turns SQLite's primary-key message into one that names the row, since the
 * caller has to tell a user which line of their spreadsheet to fix.
 */
function duplicateRow(err: unknown, row: PeriodRow): Error {
  const isConflict =
    err instanceof Error && 'code' in err && String(err.code).startsWith('SQLITE_CONSTRAINT');
  if (!isConflict) return err instanceof Error ? err : new Error(String(err));

  // An HttpError so this reaches the user as the 400 it is. A plain Error would
  // surface as "Something went wrong", discarding the row identity below — which
  // is the only part of the message worth having.

  // Only the columns that make up the primary key. Listing every field buries the
  // four that identify the offending row under a wall of nulls.
  const values = new Map(Object.entries(row));
  const identity = KEY_FIELDS.filter((field) => values.has(field))
    .map((field) => `${field}=${String(values.get(field))}`)
    .join(', ');

  return new HttpError(
    400,
    `The upload has two rows for the same entry (${identity}). Nothing was saved.`,
  );
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
