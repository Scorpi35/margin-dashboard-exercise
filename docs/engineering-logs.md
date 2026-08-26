# Engineering Log

This document captures significant engineering work, migrations, and implementation notes.

Keep entries concise.

---

## 2026-08-26 — MD-1: monorepo scaffold and tooling

Three npm workspaces (`shared`, `backend`, `frontend`) behind a single root
script set, so `npm install && npm run dev` serves both halves from a clean
clone.

Decisions worth knowing about:

- **Node is pinned to 22** (`.nvmrc`, `engines`). `better-sqlite3` 12.x ships no
  Node 20 prebuild, so Node 20 falls back to compiling from source and needs a
  working C++ toolchain. Node 22 downloads a prebuilt binary instead.
- **`shared/` is the workspace package `@shared/types`**, not a path alias. That
  gives backend and frontend the same import specifier while keeping the backend
  free of the `paths` entry the coding guidelines rule out.
- **`seed` and `selfcheck` are wired up but exit non-zero**, pending the parsers
  and the calculation engine. A self-check that always passes is worse than
  none, so the scripts fail loudly rather than reporting a green no-op.
- **`xlsx` is the npm-registry 0.18.5**, which carries an unfixed prototype
  pollution and ReDoS advisory. The maintained SheetJS releases are distributed
  only from `cdn.sheetjs.com`; switching the install source is still open.
- The backend targets CommonJS so `better-sqlite3` and the `tsc` build output
  need no ESM interop workarounds.

## 2026-08-26 — MD-2: shared domain types

`shared/src/types.ts` now holds the whole vocabulary — input rows, parse results,
engine outputs and the API envelope — with `src/index.ts` reduced to a re-export.
The engine's output types _are_ the API contract, so they are defined here first
and implemented against.

Decisions worth knowing about:

- **`shared/` now ships runtime code and therefore has a build.**
  `DEFAULT_BILLABLE_CATEGORIES` is the first value, not type, the package exports.
  Until now every import was `import type` and erased at compile time, so pointing
  `exports.default` at `src/index.ts` was harmless. A real value breaks the built
  backend — Node resolves the specifier to a `.ts` file and refuses to load
  TypeScript from `node_modules` (`SyntaxError: Unexpected token 'export'`). Only
  `node backend/dist/index.js` fails; typecheck, lint and tests all stay green, so
  it would have gone unnoticed until the production path was run. `exports.default`
  now points at `dist/index.js`, built by `tsconfig.build.json`, while `types`
  stays on `src/index.ts` — typechecking needs no prior build and go-to-definition
  still lands in source. A `prepare` script builds it on `npm install`, and
  `npm run dev` gained a `tsc --watch` alongside the two servers.
- **`SalaryRow.monthlySalary` is non-null.** Absence of a salary is the absence of
  a _row_, surfaced through `PeriodSummary.missingSalaryEmployees`. One
  missing-salary path to test and render instead of two.
- **`ProjectFinancials` carries both `projectPrice` and `revenue`.** The price is
  the whole contract; revenue is the slice attributed to the filtered period
  pro-rata by hours (see § Revenue Recognition). They agree on a full-year view and
  diverge on a month, so profit and margin derive from `revenue` to keep cost and
  revenue in the same period.
- **`missingSalaryEmployees` carries names, not just employee numbers.** The
  warning banner has no other way to say _who_ is missing, and the frontend must
  not re-derive it.
- **`CategoryRow` is hours-only, no cost column.** A billable category carries
  fully-loaded cost while an internal one is valued at direct rate inside the
  indirect pool; one column holding both would mean two different things by row.

## 2026-08-26 — MD-6: calculation engine

`backend/src/calc/engine.ts` implements the cost model from `docs/cost-model.md`
as six pure functions over plain data. `npm run selfcheck` now does real work: it
parses `sample-data/` directly, forces overhead to zero and reconciles 2025 both
annually and month by month, exiting non-zero on any drift.

Decisions worth knowing about:

- **`isSupportStaff` keys off `totalHours === 0`, not off the absence of
  timesheet rows.** Someone whose rows happen to sum to zero hours would
  otherwise have a salary inside `totalSalaries`, a direct rate of `0`, and no
  entry in the indirect pool — their pay would vanish from one side of the
  reconciliation and the invariant would break. Keying off hours covers the
  never-logged and the logged-nothing cases identically.
- **The test that can actually fail is the bucket sum, not `totalCost`.**
  `totalCost` is defined as salaries plus overhead, so `cost == salaries` holds
  by construction. What proves there is no double-counting is
  `Σ(billableHours × directRate) + indirectPool == totalSalaries`, and that is
  what `selfcheck` and `real-data.test.ts` assert per month.
- **Summing project costs is not the trap on its own.** With every billable hour
  belonging to some project, `Σ projectCost` legitimately equals payroll. The
  documented error is adding non-billable cost _on top_ of project costs, which
  charges the pool twice — `engine.test.ts` demonstrates that overshoot directly.
- **`revenueShare` is a share of the period's `revenue`, not of the contract
  price.** Otherwise the per-employee shares sum to the whole price while the
  project row shows only the pro-rata slice — two numbers on one screen that
  disagree. Over a full year the two are identical.
- **Priced projects with no logged hours are absent from `ProjectFinancials`.**
  Pro-rata attribution is `0/0` for them. `revenue` is guarded to `null` rather
  than `NaN` if one ever appears.
- **`engine.ts` imports only `@shared/types` and `parse/dates`** (for
  `yearMonthKey`, a pure string helper). A test asserts that import list
  verbatim, along with the absence of `fs`, `better-sqlite3`, `Date` and
  `process.env`.
- `MonthCostSummary` gained `supportStaffSalaries` and `nonBillableCost`, and
  `ProjectFinancials` gained `hoursByDepartment` and `costByDepartment`. A pool
  that looks wrong is only diagnosable by seeing which component moved.

## 2026-08-26 — MD-7: persistence and ingestion

`backend/src/lib/db.ts` owns the one SQLite connection at `data/app.db`, created
on demand with WAL and foreign keys on. The schema is a single idempotent script
rather than a migration framework: every statement is `IF NOT EXISTS`, so opening
an existing database is a no-op. `npm run seed` now does real work — 562 / 144 /
11 rows from `sample-data/`, as `docs/data-sources.md` documents.

Decisions worth knowing about:

- **Re-upload is month-scoped for hours and salaries, upsert for prices.** An
  uploaded timesheet or salary sheet is authoritative for every `(year, month)` it
  contains and for no others, so those months are deleted and reinserted in one
  transaction while the rest of the year is left alone. Prices carry no period, so
  a project missing from a newer price list is deliberately **kept**: deleting it
  would strip the price from work the timesheet still has hours against, turning a
  priced project unpriced on the strength of an omission.
- **`useDatabase(path)` exists so tests and the seed script never reach past
  `lib/db.ts`.** Swapping the connection's home is the alternative to every test
  opening its own `better-sqlite3` handle, which would defeat the point of a
  single owner.
- **A primary-key collision is rewritten before it reaches the user.** The
  timesheet PK `(employee_no, year, month, category, ref_code)` is unique across
  all 562 sample rows, but a future upload with two rows for one entry would raise
  a bare `SQLITE_CONSTRAINT_PRIMARYKEY`. The transaction rolls back either way;
  the message now names the offending row so someone can find the line in Excel.
- **`ingest.service.ts` is the only module where `snake_case` appears.** Column
  names are mapped both ways at this boundary, so no database spelling reaches the
  engine, the controllers or the UI.
- **Corrupt settings fall back to defaults with a logged warning** rather than
  throwing. A dashboard up on default settings beats a 500 on every page, and the
  log names the key.

### Node 22 is not optional any more

MD-1 pinned Node 22 because `better-sqlite3` 12.x ships no Node 20 prebuild. MD-7
is the first issue that actually loads the native module, and under Node 20 it
fails at import with `NODE_MODULE_VERSION 127 ... requires 115`. Run `nvm use`
before `npm run seed`, `npm test` or `npm run dev`.

## 2026-08-26 — MD-8: seed and self-check scripts

`npm run seed` gained `--fresh`, and `npm run selfcheck` now reconciles what is
in the database rather than re-parsing `sample-data/`.

- **`selfcheck` reads the database, so CI has to seed first.** The previous
  version parsed the spreadsheets directly and was self-sufficient, but it could
  never observe an empty database — and reporting one is the point of the
  "run seed first" path. `docs/coding-guidelines.md` now lists `seed` before
  `selfcheck` in the CI order.
- **"Total computed cost" is the bucket sum, not `salaries + overhead`.**
  `totalCost` is _defined_ as salaries plus overhead, so printing it beside total
  salaries would compare a number with itself. The right-hand side is derived
  through the model instead — every billable hour at its own direct rate, plus
  the pool — which is the figure that moves if double-counting creeps in.
- **Seeding no longer resets by default.** It runs as an ordinary ingest, which
  exercises the same month-scoped replace an upload through the UI would. Two
  runs still leave identical row counts; `--fresh` empties every table first.
- **The root `seed` script needed a trailing `--` to forward arguments.**
  `npm run seed -- --fresh` expands to `npm run seed --workspace backend --fresh`,
  where npm consumes `--fresh` as its own config flag and the script never sees
  it. `"seed": "npm run seed --workspace backend --"` passes it through.
- The FAIL branch cannot be reached from data — the invariant holds by
  construction, which is the whole point — so it was verified by temporarily
  scaling `nonBillableCost` by 0.99 and confirming the drift is reported
  (`total computed cost = 2390907.43 | FAIL`, exit 1) before reverting.
