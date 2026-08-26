import type {
  ExpenseType,
  ParseResult,
  ProjectRow,
  ProjectStatus,
  SalaryRow,
  TimesheetRow,
  YearMonthKey,
} from '@shared/types';

import { yearMonthKey } from '../parse/dates';
import { getDb } from '../lib/db';

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
  readonly warningCount: number;
}

interface PeriodRow {
  readonly year: number;
  readonly month: number;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

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

  return {
    rowsWritten: result.rows.length,
    monthsReplaced: [],
    warningCount: result.warnings.length,
  };
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
    warningCount: result.warnings.length,
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

  const identity = Object.entries(row)
    .filter(([key]) => key !== 'hours' && key !== 'monthlySalary')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');

  return new Error(`The upload has two rows for the same entry (${identity}). Nothing was saved.`);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
