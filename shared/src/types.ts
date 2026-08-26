/**
 * The vocabulary both workspaces speak.
 *
 * `shared/` imports nothing from `backend/` or `frontend/` — it is the contract,
 * not a utility library. The engine's output types double as the API payloads,
 * so a change here is a change to the wire format.
 *
 * Two rules run through every type below, both from `docs/coding-guidelines.md`:
 *
 * - A value that can legitimately be absent is `T | null` — never `T | undefined`
 *   and never defaulted to `0`. A silent zero is a wrong number, and wrong numbers
 *   are what this project is graded on.
 * - A period is always an explicit `year` plus a `month` integer, never a date
 *   string. The three source spreadsheets write the same month three different
 *   ways; `parse/dates.ts` is the only place that is ever untangled.
 */

/* -------------------------------------------------------------------------- */
/* Period                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Calendar month, `1`–`12`. Named so a reader knows a `month` field is never
 * zero-indexed and never a `Date`.
 */
export type MonthNumber = number;

/**
 * A month key in `YYYY-MM` form, e.g. `"2025-07"`. Used for the overhead map,
 * where an object key has to be a string.
 */
export type YearMonthKey = string;

/* -------------------------------------------------------------------------- */
/* Source spreadsheet vocabulary                                               */
/* -------------------------------------------------------------------------- */

/** `Type of Expense` in the timesheet: direct or indirect labour. */
export type ExpenseType = 'DL' | 'IDL';

/** `Status` in the price list. Lowercase in the source file. */
export type ProjectStatus = 'in progress' | 'completed';

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Billable by default. Everything else — including `Tentwenty`, which carries no
 * `FC - ` prefix — is internal time absorbed into the indirect pool.
 *
 * Billability is always looked up in `Settings.billableCategories`. Deciding it
 * from a name prefix silently books 138.7 hours of internal product work as
 * revenue-generating (see `docs/data-sources.md`).
 */
export const DEFAULT_BILLABLE_CATEGORIES: readonly string[] = [
  'Projects',
  'Enhancements',
  'Hosting',
];

/** User-configurable inputs to the cost model. */
export interface Settings {
  /** Categories treated as billable. Everything else feeds the indirect pool. */
  readonly billableCategories: readonly string[];
  /**
   * Overhead in AED per month, keyed `YYYY-MM`. Per-month rather than one annual
   * figure because overhead genuinely varies. A month absent from the map is `0`.
   *
   * Non-zero overhead intentionally breaks the `cost == salaries` invariant —
   * overhead is real cost that isn't salary — which is why `npm run selfcheck`
   * forces it to zero.
   */
  readonly monthlyOverhead: Readonly<Record<YearMonthKey, number>>;
}

/* -------------------------------------------------------------------------- */
/* Input rows — what the parsers produce and the database stores               */
/* -------------------------------------------------------------------------- */

/** One person, one task, one month. The grain of `timesheet-2025.xlsx`. */
export interface TimesheetRow {
  readonly year: number;
  readonly month: MonthNumber;
  /** String, not a number — the leading zeros in `"00101"` are significant. */
  readonly employeeNo: string;
  readonly employeeName: string;
  readonly expenseType: ExpenseType;
  readonly department: string;
  readonly designation: string;
  /** Free text from the sheet, matched against `billableCategories`. */
  readonly category: string;
  /** A project code on billable rows; the category name repeated on internal ones. */
  readonly refCode: string;
  /** `Project (Billable) / Task (Unbillable) Name` — descriptive, often blank. */
  readonly taskName: string | null;
  /** Client name, or the literal `Fixed Costs` on internal rows. */
  readonly companyName: string | null;
  readonly description: string | null;
  readonly hours: number;
}

/**
 * One person, one month. The salary sheet is wide — one row per employee, one
 * column per month — and the parser unpivots it into these.
 *
 * `monthlySalary` is deliberately non-null: a `SalaryRow` asserts that this
 * person earned this much in this month. A person with no salary is represented
 * by the *absence* of a row and surfaced in `PeriodSummary.missingSalaryEmployees`,
 * so there is one missing-salary path rather than two.
 */
export interface SalaryRow {
  readonly year: number;
  readonly month: MonthNumber;
  readonly employeeNo: string;
  readonly employeeName: string;
  readonly monthlySalary: number;
}

/** One project. The grain of `project-prices-2025.xlsx`. */
export interface ProjectRow {
  readonly refCode: string;
  /** A raw filename in the source data, not a display name. The UI truncates it. */
  readonly projectName: string;
  /** `null` when the price cell is blank — never `0`, which would read as free work. */
  readonly projectPrice: number | null;
  /**
   * Informational only. Revenue is attributed to the periods where the hours were
   * logged, not to the sales month (`docs/cost-model.md` § Revenue Recognition),
   * so an unparseable sales month must not cost us the price.
   */
  readonly salesYear: number | null;
  readonly salesMonth: MonthNumber | null;
  readonly category: string;
  readonly status: ProjectStatus | null;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A row the parser skipped, and why. Warnings are returned to the UI rather than
 * only logged — a gap the reader can't account for is worse than no number.
 */
export interface ParseWarning {
  /** The uploaded file name, so a warning is traceable to its source. */
  readonly file: string;
  readonly sheet: string | null;
  /** 1-indexed spreadsheet row, matching what the user sees in Excel. */
  readonly row: number | null;
  readonly message: string;
}

/**
 * Every parser returns this, never a bare array. A bad row is skipped with a
 * warning; only a structurally wrong file throws.
 */
export interface ParseResult<T> {
  readonly rows: readonly T[];
  readonly warnings: readonly ParseWarning[];
}

/* -------------------------------------------------------------------------- */
/* Engine output — these are the API payloads                                  */
/* -------------------------------------------------------------------------- */

/** One person's rate and hours for one month. Rates are never averaged across months. */
export interface EmployeeMonthCost {
  readonly year: number;
  readonly month: MonthNumber;
  readonly employeeNo: string;
  readonly employeeName: string;
  readonly department: string;
  /** `null` when no salary row exists for this person and month. */
  readonly salary: number | null;
  readonly totalHours: number;
  readonly billableHours: number;
  readonly nonBillableHours: number;
  /** `salary ÷ totalHours`. `0` — not `NaN` — when either is absent or zero. */
  readonly directRate: number;
  /**
   * Logged no hours this month, so the whole salary enters the indirect pool.
   * Distinct from logging only non-billable time, which flows in via the other branch.
   */
  readonly isSupportStaff: boolean;
}

/** One month's rates and reconciliation. */
export interface MonthCostSummary {
  readonly year: number;
  readonly month: MonthNumber;
  readonly totalSalaries: number;
  readonly totalHours: number;
  readonly billableHours: number;
  readonly nonBillableHours: number;
  readonly overhead: number;
  /** Whole salaries of everyone who logged no hours this month. First pool component. */
  readonly supportStaffSalaries: number;
  /** Non-billable hours valued at each person's own direct rate. Second pool component. */
  readonly nonBillableCost: number;
  /**
   * `supportStaffSalaries + nonBillableCost + overhead`. The three components are
   * reported alongside it because a pool that looks wrong is only diagnosable by
   * seeing which part of it moved.
   */
  readonly indirectPool: number;
  /** `indirectPool ÷ billableHours`. `0` — not `Infinity` — when there are none. */
  readonly indirectRate: number;
  /**
   * `totalSalaries + overhead`, computed directly rather than by summing project
   * costs. That formulation is what makes the invariant hold by construction;
   * summing project costs double-counts the indirect pool.
   */
  readonly totalCost: number;
  readonly employees: readonly EmployeeMonthCost[];
}

/** One person's share of one project, within the filtered period. */
export interface EmployeeProjectContribution {
  readonly employeeNo: string;
  readonly employeeName: string;
  readonly department: string;
  readonly hours: number;
  /** `hours × (directRate + indirectRate)`, summed over the months worked. */
  readonly cost: number;
  /** `price × (their hours ÷ total project hours)`. `null` when the project is unpriced. */
  readonly revenueShare: number | null;
  /** `(revenueShare − cost) ÷ revenueShare`. `null` when unpriced or the share is zero. */
  readonly profitability: number | null;
}

/**
 * Did this project make money — the question the tool exists to answer.
 *
 * `projectPrice` is the whole contract; `revenue` is the slice attributed to the
 * filtered period, pro-rata by billable hours. They are equal for a full year or
 * all-time view and differ for a single month, which is why both are on the wire.
 * Profit and margin are always derived from `revenue`, so cost and revenue stay
 * in the same period.
 */
export interface ProjectFinancials {
  readonly refCode: string;
  /** `null` when hours exist under a ref code with no matching price row. */
  readonly projectName: string | null;
  readonly category: string;
  readonly status: ProjectStatus | null;
  /** The full contract price. `null` for an unpriced ref code. */
  readonly projectPrice: number | null;
  /** Price attributed to the filtered period. `null` for an unpriced ref code. */
  readonly revenue: number | null;
  readonly totalHours: number;
  readonly totalCost: number;
  /** `revenue − totalCost`. `null` when unpriced. */
  readonly profit: number | null;
  /** `profit ÷ revenue`. `null` when unpriced or the price is zero. */
  readonly marginPct: number | null;
  /** In-period billable hours per department, for the mix behind the margin. */
  readonly hoursByDepartment: Readonly<Record<string, number>>;
  /** In-period fully-loaded cost per department. Sums to `totalCost`. */
  readonly costByDepartment: Readonly<Record<string, number>>;
  readonly employees: readonly EmployeeProjectContribution[];
}

/** A person whose logged hours have no salary behind them. Never costed at zero silently. */
export interface MissingSalaryEmployee {
  readonly employeeNo: string;
  /** Carried so the warning banner can name the person rather than a payroll number. */
  readonly employeeName: string;
  readonly year: number;
  readonly month: MonthNumber;
}

/** Company-wide totals for the filtered period, plus the gaps in the data behind them. */
export interface PeriodSummary {
  readonly year: number;
  /** `null` for a whole-year view. */
  readonly month: MonthNumber | null;
  readonly totalSalaries: number;
  readonly totalOverhead: number;
  /** `totalSalaries + totalOverhead`. Equals salaries exactly when overhead is zero. */
  readonly totalCost: number;
  readonly totalRevenue: number;
  readonly totalProfit: number;
  /** `totalProfit ÷ totalRevenue`. `null` when there is no revenue to divide by. */
  readonly marginPct: number | null;
  readonly totalHours: number;
  readonly billableHours: number;
  readonly nonBillableHours: number;
  /** `billableHours ÷ totalHours`. `null` when nothing was logged. */
  readonly productivityPct: number | null;
  /** Ref codes with hours but no price row. Their revenue and margin are `null`. */
  readonly unpricedRefCodes: readonly string[];
  readonly missingSalaryEmployees: readonly MissingSalaryEmployee[];
  /** Per-month breakdown, so the rates behind the totals are auditable. */
  readonly months: readonly MonthCostSummary[];
}

/** One person's billable-vs-total split for the filtered period. */
export interface ProductivityRow {
  readonly employeeNo: string;
  readonly employeeName: string;
  readonly department: string;
  readonly designation: string;
  readonly totalHours: number;
  readonly billableHours: number;
  readonly nonBillableHours: number;
  /** `billableHours ÷ totalHours`. `null` when they logged nothing at all. */
  readonly productivityPct: number | null;
}

/**
 * Where the hours went, by category.
 *
 * Deliberately hours-only: a billable category carries fully-loaded cost while an
 * internal one is valued at direct rate inside the pool, so a single `cost` column
 * here would mix two different meanings.
 */
export interface CategoryRow {
  readonly category: string;
  /** Resolved against `Settings.billableCategories`, never from a name prefix. */
  readonly billable: boolean;
  readonly hours: number;
  /** Share of hours in the period. `null` when nothing was logged. */
  readonly hoursPct: number | null;
}

/* -------------------------------------------------------------------------- */
/* API envelope                                                                */
/* -------------------------------------------------------------------------- */

/** Every successful response is wrapped in this envelope. */
export interface ApiSuccess<T> {
  readonly status: 'ok';
  readonly data: T;
}

/** Every failed response is wrapped in this envelope by `errorHandler`. */
export interface ApiFailure {
  readonly status: 'error';
  readonly message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Payload of `GET /api/health`. */
export interface HealthStatus {
  readonly service: string;
  readonly uptimeSeconds: number;
}
