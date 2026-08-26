import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

/**
 * The one SQLite connection. Nothing else opens a database.
 *
 * The file is created on demand and lives outside both workspaces, in `data/` at
 * the repo root, which is gitignored — it is derived from the spreadsheets and
 * rebuildable with `npm run seed`.
 *
 * There is no migration framework and no ORM. The schema is a single idempotent
 * script: every statement is `IF NOT EXISTS`, so opening an existing database is
 * a no-op and opening a new one builds it.
 */

/**
 * `src/lib` and `dist/lib` are both three levels below the repo root, so this
 * resolves the same whether the backend runs from `tsx` or from its build.
 */
const DEFAULT_DATABASE_PATH = join(__dirname, '../../../data/app.db');

/** Matches `.nvmrc` and the `engines` field. `better-sqlite3` ships no Node 20 prebuild. */
const REQUIRED_NODE_MAJOR = 22;

/**
 * The database could not be opened at all — as opposed to a query failing.
 *
 * Its own class so the error handler can show the message rather than replacing
 * it with "Something went wrong": these messages are ones we wrote, and they say
 * what to do next.
 */
export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

const SCHEMA = `
  -- One row per person, per task, per month. The primary key is the natural grain
  -- of the timesheet; re-upload deletes by month rather than relying on it.
  CREATE TABLE IF NOT EXISTS timesheet_entries (
    employee_no   TEXT    NOT NULL,
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    employee_name TEXT    NOT NULL,
    expense_type  TEXT    NOT NULL,
    department    TEXT    NOT NULL,
    designation   TEXT    NOT NULL,
    category      TEXT    NOT NULL,
    ref_code      TEXT    NOT NULL,
    task_name     TEXT,
    company_name  TEXT,
    description   TEXT,
    hours         REAL    NOT NULL,
    PRIMARY KEY (employee_no, year, month, category, ref_code)
  );

  CREATE INDEX IF NOT EXISTS idx_timesheet_period ON timesheet_entries (year, month);
  CREATE INDEX IF NOT EXISTS idx_timesheet_ref_code ON timesheet_entries (ref_code);

  -- The salary sheet unpivoted: one row per employee-month. A month a person was
  -- not paid for is an absent row, never a zero.
  CREATE TABLE IF NOT EXISTS salaries (
    employee_no    TEXT    NOT NULL,
    year           INTEGER NOT NULL,
    month          INTEGER NOT NULL,
    employee_name  TEXT    NOT NULL,
    monthly_salary REAL    NOT NULL,
    PRIMARY KEY (employee_no, year, month)
  );

  CREATE INDEX IF NOT EXISTS idx_salaries_period ON salaries (year, month);

  -- Prices are keyed by ref code and carry no period of their own: revenue is
  -- attributed to the months the hours were logged in, not to the sales month.
  CREATE TABLE IF NOT EXISTS projects (
    ref_code      TEXT PRIMARY KEY,
    project_name  TEXT    NOT NULL,
    project_price REAL,
    sales_year    INTEGER,
    sales_month   INTEGER,
    category      TEXT    NOT NULL,
    status        TEXT
  );

  -- Settings are JSON under a key, so adding one needs no migration.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- An audit trail of what was ingested and when, so an unexpected number can be
  -- traced back to the upload that produced it.
  CREATE TABLE IF NOT EXISTS uploads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT    NOT NULL,
    file_name     TEXT    NOT NULL,
    uploaded_at   TEXT    NOT NULL,
    row_count     INTEGER NOT NULL,
    warning_count INTEGER NOT NULL,
    months        TEXT    NOT NULL
  );
`;

const TABLES = ['timesheet_entries', 'salaries', 'projects', 'settings', 'uploads'];

let connection: Database.Database | null = null;
let databasePath = DEFAULT_DATABASE_PATH;

/** The shared connection, opened and migrated on first use. */
export function getDb(): Database.Database {
  if (connection === null) {
    connection = open(databasePath);
  }

  return connection;
}

/**
 * Points the shared connection at another file.
 *
 * The seed script and the tests work against throwaway databases; without this
 * they would have to reach past `lib/db.ts`, which is the one thing this module
 * exists to prevent.
 */
export function useDatabase(filePath: string): Database.Database {
  closeDb();
  databasePath = filePath;

  return getDb();
}

export function closeDb(): void {
  connection?.close();
  connection = null;
}

/**
 * Empties every table, keeping the schema. Used by `npm run seed --fresh` so a
 * re-seed is a clean slate rather than an upsert over whatever was there before.
 *
 * **Scripts only.** This is the one `DELETE` in the codebase with no month
 * predicate, and nothing about a request should ever be able to reach it — an
 * upload replaces the months it contains and no more. `db.test.ts` asserts that
 * no controller or service imports it.
 */
export function resetDb(): void {
  const db = getDb();

  db.transaction(() => {
    for (const table of TABLES) db.exec(`DELETE FROM ${table}`);
    // Restart the uploads audit trail from id 1.
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'uploads'");
  })();
}

function open(filePath: string): Database.Database {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  let db: Database.Database;
  try {
    db = new Database(filePath);
  } catch (err) {
    throw describeOpenFailure(err);
  }

  // WAL lets a read run while a write is in flight — the dashboard stays
  // responsive during an ingest.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  return db;
}

/**
 * Turns a native-module load failure into something a reader can act on.
 *
 * `better-sqlite3` binds its compiled `.node` lazily, on the first `new
 * Database()` rather than at import — so a Node version mismatch does not stop
 * the server booting. It starts, serves anything that avoids the database, and
 * fails every request that touches one with `ERR_DLOPEN_FAILED` and a stack
 * trace about `NODE_MODULE_VERSION`. The cause is almost always the wrong Node.
 */
function describeOpenFailure(err: unknown): Error {
  const isBindingFailure =
    err instanceof Error && 'code' in err && err.code === 'ERR_DLOPEN_FAILED';
  if (!isBindingFailure) return err instanceof Error ? err : new Error(String(err));

  const major = Number(process.versions.node.split('.')[0]);
  const fix =
    major < REQUIRED_NODE_MAJOR
      ? `This is Node ${process.versions.node}, and the project needs Node ${REQUIRED_NODE_MAJOR} ` +
        '(see .nvmrc). Run `nvm use`, then start again.'
      : 'Run `npm rebuild better-sqlite3` to rebuild it for this version of Node.';

  return new DatabaseUnavailableError(`The database driver could not be loaded. ${fix}`);
}
