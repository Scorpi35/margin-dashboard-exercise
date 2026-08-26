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

## 2026-08-26 — MD-9: app shell, error handling, validation and design tokens

The HTTP and visual foundation. Backend entry split into `app.ts` (wiring,
exported for tests) and `server.ts` (listen); `controllers/validation.ts` holds
the hand-rolled request validation; the frontend gained a React Router shell,
a design-token palette and a typed API client.

Decisions worth knowing about:

- **`Number()` is not strict enough to validate a year.** It reads `"2e3"` as
  2000 and `"0x7e9"` as 2025 — both land inside a plausible range, so a range
  check alone lets them through and filters the dashboard to a year nobody typed.
  `integerOrNull` requires plain digits.
- **Validation lives in `controllers/validation.ts`, not `dashboard.controller.ts`.**
  The guidelines pointed at the latter, but the upload controller needs
  `requireUploadType` just as much as the dashboard needs `requireYear`. The
  guidelines now point at the shared module.
- **Tokens are declared in `@theme static`.** Tailwind tree-shakes theme
  variables that no utility references, so `--color-positive`, `--color-negative`
  and `--color-warning` were absent from the built stylesheet until a component
  happened to use them — `var(--color-positive)` would have silently resolved to
  nothing. `static` emits all seventeen, making the palette a real contract. The
  palette is now tabulated in `docs/coding-guidelines.md`, which MD-9 referenced
  as though it were already there.
- **`apiGet` is module-private.** Only named per-endpoint functions are exported,
  so a component cannot assemble a URL or widen a nullable field on the way in.
- **`HealthStatus` is now `{ hasData: boolean }`**, replacing
  `{ service, uptimeSeconds }`. The frontend needs to tell an empty database apart
  from a period with no work in it — one wants an upload prompt, the other a
  "nothing logged" note. Backed by an `EXISTS` query rather than
  `readTimesheet().length`, which would deserialise 562 rows to answer a boolean.
- **The sidebar becomes a horizontal scrolling bar below `sm` (640px)** rather
  than collapsing behind a menu button, so every destination stays one tap away
  at 375px.
- **Testing Library needs an explicit `cleanup`** here: Vitest globals are off, so
  the automatic unmount between tests does not run and every render stacks onto
  the last. `src/test-setup.ts` wires it up.
- New dependencies: `react-router-dom` (named in the issue),
  `@testing-library/react`, `@testing-library/user-event` and `jsdom` — the
  guidelines already named React Testing Library as this project's convention.

## 2026-08-26 — Review findings across the branch

A pass over the whole branch against `docs/review.md` turned up one real
correctness bug and a handful of smaller gaps.

- **Overhead entered for a month with no ingested rows was silently dropped.**
  `computePeriodSummary` took its month list from `computeMonthCostSummaries`,
  which only emitted months that had timesheet or salary rows. Overhead for any
  other month never reached a total and nothing said so — with
  `{ '2025-01': 500, '2025-08': 9999 }` the year reported 500. The workflow that
  triggers it is ordinary: set the year's overhead on the Settings page, then
  upload January. `computeMonthCostSummaries` now emits an empty summary for each
  month that carries overhead, so it is costed whether or not anyone has logged
  hours against it. The invariant is untouched — it is stated at overhead zero.
- **Overhead keys were never validated.** `{"banana": -500, "2025-13": 1}` saved
  and read back intact, and the engine — which looks up by month key — could never
  apply it. The user was told it saved. `saveSettings` now rejects a malformed map
  with a 400 rather than storing something the next read discards, and the engine
  ignores any key that is not `YYYY-MM` as defence in depth.
- **`hasIngestedData()` only looked at `timesheet_entries`**, so a database
  holding salaries reported "no data" and the UI would have asked for an upload
  that had already happened. It now checks all three tables.
- **The revenue-share formula is now documented where it is defined.** The engine
  divides the period's recognised revenue rather than the whole contract price;
  over a full period the two are the same number, but the deviation only lived in
  a code comment. `docs/cost-model.md` states it, and `README.md` gained an
  Assumptions section collecting all eleven judgement calls the branch makes —
  previously only in this log, which the review rules do not accept as the place.
- Smaller: the plausible-year window is one pair of constants in `shared/`
  instead of two in `parse/dates.ts` and `controllers/validation.ts`; grouping
  loops push instead of rebuilding the accumulator array per row; two comments
  claimed behaviour that did not exist (`getHealth` has no caller yet, and
  `getAllKnownCategories` does not decide billability); and `db.test.ts` now
  asserts that no controller, service or route imports `resetDb` — the one
  `DELETE` with no month predicate.

## 2026-08-26 — MD-10: upload

`POST /api/uploads/:type` and `GET /api/uploads`, with a three-slot upload page
behind them. This is the first issue that puts data into the app through the UI
rather than through `npm run seed`.

Decisions worth knowing about:

- **`ingestUpload` orchestrates parse-then-ingest inside the service**, not the
  controller. `docs/coding-guidelines.md` describes the flow as "the buffer goes
  to a parser; the parser's rows go to the ingest service", which reads like
  controller work — but controllers are meant to be thin, and keeping it in the
  service means the whole path is testable without HTTP.
- **A rejected upload leaves no row in the history.** The acceptance criteria ask
  for "each attempt with a warning count", but a structurally wrong file throws
  before a single row is read, so it has no warning count to report — and the
  other criterion requires that nothing be written. Writing an audit row for a
  rejected file would put a row in the database on a request that promised none.
  The user sees the error inline instead.
- **The extension is checked in three places, deliberately.** The `accept`
  attribute filters the file picker, the component checks the name so a _dropped_
  file fails instantly (drag-and-drop bypasses `accept` entirely), and multer
  rejects it server-side before a parser sees the buffer. `loadWorkbook` then
  checks the file signature, because an extension is a claim rather than a fact.
- **`IngestSummary` now carries the warnings, not just a count.** The upload
  response has to list each skipped row with the spreadsheet row number a reader
  can go and fix; a count alone would tell them something is wrong without saying
  where.
- **`Content-Type` is left unset on the upload request.** The browser has to add
  it itself so it can include the multipart boundary — setting it by hand produces
  a body the server cannot split.

### Verified end to end, not just in tests

Against a fresh database with both servers running: all three sample files
uploaded (562 / 144 / 11, no warnings) and reconciled to AED 2,400,000.00; a
re-upload left the totals unchanged; a four-row March file replaced March
(50 → 4 rows) while April kept its 49 rows, 1,264.9 billable hours and its
58.8636 indirect rate to the digit; the salary sheet posted to the timesheet slot
returned a 400 naming the sheets it did contain, with the data still intact; and a
deliberately corrupted file saved its one good row and reported rows 3, 4 and 5
with the reason for each.

A note for anyone doing the same: stale `tsx watch` processes from an earlier
session hold port 4000 and an open handle on `data/app.db`. Deleting the database
underneath one makes `/api/health` return a 500 that looks like a code bug and is
not. Kill them before testing a fresh-database path.

### Review follow-up on MD-10

- **An ingest-time key collision was reported as a 500.** `parse()` wrapped
  parser failures into a 400, but `duplicateRow` returned a plain `Error`, so a
  spreadsheet with two rows sharing a primary key reached the user as
  "Something went wrong. Please try again." — advice that could only ever fail
  again, with the message naming the offending row discarded. It is an
  `HttpError(400)` now, and the message lists just the key columns rather than
  every field the row carries. There was no integration test for the
  ingest-failure branch, which is why it survived; there is now.
- **A broken database connection was undiagnosable.** Every DB-backed route
  answered "Something went wrong. Please try again." with no hint. `errorHandler`
  now recognises a `SQLITE_*` error and answers 503 saying the database could not
  be read and that a server restart is needed — duck-typed on the code so the
  middleware keeps no `better-sqlite3` import.
- **The failure panel promised too much.** It said "nothing was saved" for every
  failure, including a request that never got an answer — where the server may
  well have committed first. It now says that only for a 4xx, and otherwise
  admits the outcome is unknown and points at the history.
- **An upload that saved nothing rendered as a success.** A file whose rows were
  all skipped showed "0 rows saved" in positive green. It reads as a warning now.
- Smaller: an unknown `:type` is rejected before multer buffers up to 10 MB;
  dropping something that is not a file says so instead of doing nothing; the
  history refresh ignores every response but the newest, which doubles as the
  unmount guard; SheetJS's internal messages are logged rather than shown; and
  the README assumptions gained the upload-history decision.

### The real cause of "every upload fails"

Reported as: every `.xlsx` upload returning "Something went wrong. Please try
again." I first put this down to a stale SQLite handle from deleting `data/`
under a running server. **That was wrong.** The server was running on Node 20:

```
ERR_DLOPEN_FAILED — NODE_MODULE_VERSION 127. This version of Node.js requires 115.
```

`better-sqlite3` ships no Node 20 prebuild, and — this is what made it hard to
read — it binds its native module **lazily, on the first `new Database()`, not at
import**. So the server boots cleanly, non-database routes answer normally
(`/api/nope` still 404s correctly), and only requests that touch data fail. It
looks exactly like a bug in the feature you just wrote.

MD-1 predicted the Node 20 problem and MD-7 logged it, and it still cost an
hour, because nothing enforced it. Now three things do:

- **`npm install` refuses** — `engine-strict=true` in `.npmrc`, with `engines` on
  every workspace rather than only the root.
- **The server refuses to start**, printing `This is Node 20.20.0, and the project
needs Node 22 (see .nvmrc). Run \`nvm use\`, then start again.` and exiting 1.
  It opens the database before listening precisely so this cannot be discovered
  one request at a time.
- **`seed` and `selfcheck` do the same**, via `scripts/require-database.ts`,
  rather than dying on an uncaught error with a stack through `node_modules`.

`lib/db.ts` wraps the open in a `DatabaseUnavailableError` naming the fix, and the
error handler shows that message on a 503 instead of replacing it with
"Something went wrong" — the generic text is what turned a setup problem into a
mystery.

**Also worth knowing:** deleting `data/` while `npm run dev` is up leaves the
process holding a stale SQLite handle, with the same symptom of database routes
failing while the app looks healthy. Restart the server.

## 2026-08-26 — MD-11: dashboard

`GET /api/dashboard?year&month` and `GET /api/meta`, behind a page with six stat
cards and a period filter. First use of `usePeriodFilter`, which every filtered
page from here shares.

Decisions worth knowing about:

- **The whole dataset goes to the engine, never a pre-filtered slice.**
  `dashboard.service.ts` loads every row and passes the period alongside it, so
  the period selects which rows are _aggregated_ while rates stay derived from
  the full month they belong to. Filtering to March must not recompute March's
  direct and indirect rates from a subset of March. Commented at the call site.
- **The default period is written into the URL rather than held implicitly.**
  With no `?year=`, the page adopts the most recent year that has data and
  replaces the URL with it. A period the address bar does not show is not
  linkable, which defeats the point of keeping filter state there.
- **An unreadable `?year=` falls back to the default instead of being coerced.**
  `usePeriodFilter` treats anything non-numeric as absent — a `NaN` reaching the
  filter renders an empty dashboard that looks like a real answer.
- **`/api/meta` is separate from the summary** because it changes only on an
  upload or a settings save, while the summary changes with every filter. Its
  `years` also drive the empty state: no years means nothing has been ingested,
  which is a different claim from a year in which the agency did no work.
- **`readAvailableYears()` unions both tables.** A year with salaries but no
  logged hours still has cost in it; offering only years with timesheet rows
  would hide that.
- **A `DataGapsBanner` sits above the cards.** Not in the acceptance criteria, but
  the coding guidelines require unpriced ref codes and missing salaries to be
  surfaced — an em dash the reader cannot account for is worse than no number.

### On "a project's cost is identical whether viewed unfiltered or filtered"

Taken literally this holds only for a project whose hours fall in one month, and
the sample has none — all eleven span several. The meaningful form is that a
project's twelve monthly costs sum to its annual cost, which is what proves rates
are not being recomputed from a filtered subset. Verified exactly, all eleven:

```
Q2025001a   annual 468776.21   sum of months 468776.21
E2025050a   annual 195062.44   sum of months 195062.44
…
```

The same decomposition holds for company-wide cost: the twelve monthly totals sum
to AED 2,400,000.00.

### Review follow-up on MD-11, and what the post-edit hook found

The hook had been configured in `.claude/settings.local.json`, so it never ran.
Running it over all 79 source files surfaced two things worth more than the
review findings did.

- **`shared/` had never been linted.** It has no `eslint.config.mjs` and had no
  `lint` script, and the root `lint` uses `--workspaces --if-present`, so it was
  skipped in silence — 400 lines of the API contract, unchecked. It now has both,
  and passes. `npm run lint` covers three workspaces rather than two.
- **The hook only knew about `frontend` and `backend`.** A file under `shared/`
  fell through to the repo root, where there is no ESLint config, and every edit
  reported `ESLint couldn't find an eslint.config file` as a failure. It now
  derives the workspace from a list, and skips the project tools with no
  complaint for a file that belongs to none of them.

**The barrel in `shared/` was breaking the frontend production build.**
`src/index.ts` re-exported `./types`, which compiles to `__exportStar`. Rollup
cannot see through that for a symlinked workspace package, so any _value_
imported from `@shared/types` failed the build — while type-only imports kept
working, because they are erased. It had gone unnoticed since MD-2 because the
frontend had only ever imported types. Importing `MIN_DATA_YEAR` for review
finding 2 was the first value, and the build broke immediately.

Pointing the package at `types.ts` directly was not enough: a CommonJS emit is
equally opaque to Rollup outside `node_modules`. `shared/` now builds twice —
CommonJS for the backend, which `require`s it, and ESM for the frontend's
bundler — selected by `import`/`require` conditions in `exports`. Verified from
both sides: `require('@shared/types').MIN_DATA_YEAR` is `1970`, and the frontend
bundle contains the literal. MD-13 would have hit this the moment the settings
page imported `DEFAULT_BILLABLE_CATEGORIES`.

Review findings, all seven addressed:

- A link naming a year with no data keeps that year, and the filter offers it
  marked `(no data)` — the select, the period label and the figures now agree
  rather than showing three different years at once.
- The plausible-year window comes from `@shared/types` instead of being written
  out a third time.
- Choosing a period pushes a history entry so Back undoes it; adopting the
  default replaces, because the reader did not choose it.
- A period with no hours reads "No hours logged in this period" rather than
  "— of hours logged".
- The README assumptions gained both dashboard decisions.

## 2026-08-26 — MD-12: project page

`GET /api/projects?year&month` and `GET /api/projects/:refCode`, behind a list
sorted loss-making first and a detail page breaking one project down by
department and by person.

Decisions worth knowing about:

- **`Period.year` is now nullable, and `ALL_TIME` is a period.** The detail
  endpoint reports a project over its whole life, and doing that through the same
  `computeProjectFinancials` rather than a second code path meant teaching
  `inPeriod` that a `null` year matches every year. Two lines in the engine, plus
  widening `PeriodSummary.year` to match. Nothing read that field.
- **The detail ignores any period on the query string.** A price covers the whole
  engagement, so its margin only means anything against all the work done on it.
  Narrowing to March would put March's cost beside a pro-rata slice of the price
  and invite a comparison with the contract value that does not hold.
- **The back link carries the list's filter.** The detail has no period of its
  own, so returning would otherwise drop whatever the reader had selected.
- **Row order comes from the API and is not re-sorted in the component.** Three of
  the eleven sample projects lose money; that order is part of the answer rather
  than a display preference.
- **A ref code with hours but no price sorts above the losses.** A gap is more
  urgent than a bad margin, and it renders `—` for price, profit and margin while
  still reporting its very real cost.
- **A priced project with no logged hours 404s**, because it appears in neither
  the list nor the detail — both are built from timesheet rows. The sample has
  none. Consistency between the two beat inventing a zero-hour row for one.
- **Per-employee profitability is deliberately absent** from the contributor
  table. The engine computes it; surfacing it is its own issue, and a
  half-finished column would have been worse than none.

A small UI fix fell out of testing: with no project name the ref code was
rendered both as the row's heading and as its own sub-line, which reads as a bug.
It now prints once.

### Review follow-up on MD-12

- **The engine changed with no engine test.** `Period.year` became nullable and
  `ALL_TIME` appeared, exercised only indirectly through the project integration
  tests — while `inPeriod` decides which rows every figure in the app is built
  from. A regression making `year: null` match nothing would have left the detail
  page silently empty with every existing test green. `engine.test.ts` now has a
  two-year fixture and seven cases: that all-time decomposes exactly into the
  individual years, that each year is costed at its own rates rather than an
  average, that `{ year: null, month: 1 }` selects that month across every year,
  and that the reconciliation invariant holds across years and not merely within
  one.
- **`DashboardPage` and `ProjectsPage` had grown into near-copies.** The parts
  that matched were the load-meta, resolve-default-year and stale-request
  machinery, with `periodLabel` and `describe` duplicated verbatim. Two more
  filtered pages are planned, which would have made four copies to keep in step.
  That logic now lives in `usePeriodData`, and the surrounding chrome — heading,
  period label, filter, and the four states each page has to handle — in
  `PeriodPage`. The two pages went from 195 and 151 lines to 80 and 38, with all
  102 existing tests passing untouched, which is the evidence the refactor
  changed nothing. The hook has its own tests, including the out-of-order
  response case that was previously only implicit.
- **The detail page defaulted a missing `refCode` to `''`.** Unreachable through
  routing, but an empty code would have requested `/api/projects/`, which matches
  the _list_ endpoint and answers with an array — rendered as a project, that is
  nonsense rather than an error. It now reports not-found explicitly.
- Smaller: `costByDepartment` is read through `??` so a mismatch with
  `hoursByDepartment` shows an em dash rather than crashing; `getProject` carries
  a note on why costing every project to return one is the right trade against a
  second implementation of the same arithmetic; and the README assumptions gained
  the all-time and unpriced-project decisions.

## 2026-08-26 — MD-13: productivity page

`GET /api/productivity?year&month` behind a table of billable share per person,
with an inline bar.

Decisions worth knowing about:

- **The route is `/productivity`, renamed from `/employees`.** That path was my
  own guess in MD-9, when the six routes were documented nowhere; the issue names
  `/productivity`, so the nav label and page file moved with it. Nothing linked to
  the old path, so no redirect was needed.
- **`--color-bar` is a new token rather than reuse of `--color-warning`.** Both
  are amber, but warning means _something is missing_ — a bar showing a healthy
  83% must not borrow that. Added to the palette table in
  `docs/coding-guidelines.md`.
- **The bar is never the only reading of the number.** The percentage sits beside
  it as text and the bar is `aria-hidden`, so the figure survives printing, a
  screen reader, or anyone who cannot separate the fill from the track.
- **The width is clamped in the component even though the engine guards the
  share.** Presentation should not depend on an invariant it does not own; a
  share above 1 would otherwise draw outside its cell. The clamp applies to the
  drawing only — the percentage shown is never clamped, so a wrong number would
  still be visible rather than quietly corrected.
- **The page is 30 lines**, because `usePeriodData` and `PeriodPage` from the
  MD-12 follow-up already handle the filter, the default year, the stale-response
  guard and the four page states. That extraction paid for itself here.

The two management employees log only internal time, so they sit at a visible 0%
with an empty bar rather than being filtered out — 812 hours of real work that
dropping them would hide. An integration test also flips `Tentwenty` to billable
and asserts the figures move, which is what proves billability comes from
settings rather than a name prefix.

### Review follow-up on MD-13

- **`CostInput` splits the engine's inputs by what each answer depends on.**
  Rates, the indirect pool, productivity and the category split are all decided
  before any project is priced, so those four functions take a type without
  `projects` and `EngineInput` extends it. `productivity.service.ts` was reading
  the projects table on every request for a computation that never looked at it —
  cheap, but it stated a dependency that did not exist. `EngineInput` still
  satisfies `CostInput` structurally, so no caller changed.
- **`formatBarWidth` moved the bar's arithmetic out of the component** and into
  `lib/format.ts` beside `formatPct`, where the same rate-to-percentage
  conversion already lived. It rounds to one decimal, so the markup carries
  `82.7%` rather than `82.69999999999999%`.
- **`periodQuery` states the omit-a-null-month rule once** instead of three
  times across `getDashboard`, `getProjects` and `getProductivity`. A fourth
  filtered endpoint arrives with the categories page.

A note for anyone asserting on inline styles: **jsdom normalises CSS values**, so
`width: 83.0%` reads back as `83%`. The rounding is covered directly in
`format.test.ts`; in the DOM it is proved by `82.7%`, which survives
normalisation because it has a significant decimal.

## 2026-08-26 — MD-14: category page

`GET /api/categories?year&month` behind a table of hours per category, with a bar
per row and a summary line.

Decisions worth knowing about:

- **The response is an envelope, not `CategoryRow[]` as the issue specified.**
  The page shows a summary of total / billable / internal hours, and
  `docs/coding-guidelines.md` is explicit that a number missing from a response is
  added to the response rather than derived on the client. Summing hours in a
  component would have broken that, so `computeCategoryBreakdown` returns
  `{ rows, totalHours, billableHours, nonBillableHours }`. It also makes the first
  acceptance criterion — category hours summing to the period total — checkable
  server-side, and an integration test asserts those totals equal the dashboard's.
- **`CategoryRow.billable` became `isBillable`.** The issue names it that, and
  `EmployeeMonthCost.isSupportStaff` had already set the `is` prefix as the
  convention for a boolean on engine output.
- **Bars scale against the largest category rather than against 100%.** Projects
  is 63% of the year; against a full-width scale everything else collapses into a
  sliver, and comparing categories is the point of the page. `formatBarWidth`
  gained an optional maximum, so productivity keeps its 0–1 scale and this passes
  the tallest row.
- **Billable is printed as a word as well as drawn in the accent colour.** Colour
  alone would leave the distinction invisible in print or to anyone who cannot
  separate the two fills.

The sample's longest category name is `"FC - SEO/Marketing"` at 18 characters, so
_"long category names don't break the layout"_ cannot be demonstrated by the real
data. It is handled structurally — a truncating cell with the full name on
`title`, inside a scrolling container — and tested with a 65-character synthetic
name rather than claimed on the strength of data that never exercises it.

### Review follow-up on MD-14

- **The empty state is keyed on total hours, not on the row count.** A period
  whose rows all sit at zero was rendering a table of zeroes with em-dash shares,
  while a period with no rows rendered prose — two presentations of the same
  fact. Both now read "No hours were logged in this period".
- **The bar scale uses `reduce` rather than spreading into `Math.max`.** The
  spread was safe only because the early return above it caught the empty case;
  `reduce` carries its own zero.
- **`billableHours` is derived twice and now says so.** `PeriodSummary` sums it
  per employee-month and `CategoryBreakdown` per category — the same rows and the
  same set, so they agree, and three tests pin them together. Both call sites now
  point at each other, so a change to how billability is applied cannot be made in
  one place while looking complete.
- The README assumptions gained the categories envelope and the bar scaling.

**A recurring pattern worth deciding on:** five reviews running have flagged a
judgement call as missing from the README assumptions while it was already
recorded here. Either the entries should be written in both places as a matter of
course, or `docs/review.md` should accept this log as the home for them and say
so. Right now the rule and the habit disagree.

## 2026-08-26 — MD-15: department drill-down

`computeDepartmentBreakdown` in the engine, `GET /api/departments` and
`/api/departments/:department` behind it, a detail page at
`/departments/:department`, and two ways in — the department rows on a project's
detail page, and a new summary on the dashboard.

**A department's cost is salary, and that is the whole design decision.** The
obvious framing — charge each department's hours at `directRate + indirectRate` —
double-counts, because the indirect pool already holds the value of everyone's
non-billable time. Measured on the sample it overstates the company by
AED 909,257.32, which is exactly the pool:

```
Σ salaries          2,400,000.00   reconciles to payroll
Σ "fully loaded"    3,309,257.32   over by 909,257.32 = the indirect pool
```

Salaries are the one formulation that reconciles: every dirham is paid to exactly
one person in exactly one department. The trade is that overhead has no home —
it is company-level, the brief gives no basis for splitting it, and inventing an
allocation would put a number on screen nobody could defend. So the rows add up
to total salaries, and both the dashboard summary and the detail page say so in
words rather than leaving the reader to notice the shortfall.

Other decisions worth knowing about:

- **Per-employee cost is `number | null`.** `null` when no salary row covers them
  in the period; a silent `0` would read as "this person was free". One paid
  month makes it a number, so a partly-covered person is not reported as costing
  nothing.
- **Someone who logged no hours has no department**, since only timesheet rows
  carry one. They are bucketed under `UNASSIGNED_DEPARTMENT` so the totals still
  add up and they still have a URL. The sample has no such case — all twelve log
  hours — so it is covered by a fixture rather than claimed on real data.
- **The dashboard loads two payloads through one `Promise.all` loader.**
  `usePeriodData` keeps the loader in a ref, so a composed one does not refetch
  on every render — that was the reason for the ref when the hook was extracted.

Department names come from a spreadsheet column and are not guaranteed to be
URL-safe. Verified end to end against the running server with
`R&D / Special Projects` — `%2F` is the case that breaks a router splitting on
the raw path, and both Express and React Router decode it correctly.

### Review follow-up on MD-15

- **`/departments/Design` with no `?year=` sat on "Loading…" forever.** It was the
  only page reading the period straight from the URL rather than through
  `usePeriodData`, so with no year it returned early and never resolved — no
  error, no default, no way out but the back link. A test asserted the request
  was not made and stopped there, which is exactly how it got past: it checked
  the call, not what the reader sees.
- **`usePeriodData` gained a resource key.** Its fetch watches the period, so a
  page keyed on something else — a department name — would keep the previous
  one's figures after navigating. The key joins the effect's dependencies, and
  data is cleared on change so stale rows cannot be read as the new resource's.
- **It also reports `errorStatus`.** The department page needs to tell a 404 from
  a 500 to choose between "not found" and "something broke", and unwrapping an
  `ApiError` in every page is the wrong place for that.
- **Two different "department cost" figures sat one click apart.** The project
  detail page's Cost column is that department's hours on _that project_, fully
  loaded; the drill-down shows its salaries across _all_ work. On the sample,
  Design reads AED 175,113.89 on Q2025001a and AED 633,000.00 company-wide — a
  3.6× jump with nothing on screen reconciling them. The source column is now
  "Cost on this project" and the destination card says "Across all work, not one
  project."
- `DepartmentBreakdownTable` became `ProjectDepartmentsTable`, since
  `DepartmentBreakdown` is the company-wide payload and the two are different
  scopes. `getDepartment` carries the same note as `getProject` about recomputing
  everything to answer for one.

### Editor-only ESLint failure: multiple candidate TSConfigRootDirs

Every TypeScript file opened in the editor reported a parsing error naming
`frontend` and `backend` as competing root directories, while `npm run lint`
stayed green.

The cause is in `typescript-eslint`: reading `tseslint.configs.*` registers the
accessing config's directory as a candidate root, and the candidate list is a
**module-level Set shared by the whole process**. `createParseSettings` then
calls `getInferredTSConfigRootDir()` unconditionally whenever `tsconfigRootDir`
is unset, and that throws as soon as there is more than one candidate. The CLI
never sees it because each `npm run lint` loads exactly one workspace config; an
editor's language server lints files from every workspace in a single process, so
it always ends up with two or three.

All three configs now set `parserOptions.tsconfigRootDir` to
`import.meta.dirname`, which skips the inference. Verified that the option really
reaches the parser rather than sitting inert, by temporarily setting a relative
path and watching it be rejected — `parserOptions.tsconfigRootDir must be an
absolute path` — then restoring it.

Noted in `docs/coding-guidelines.md`, because a fourth workspace would bring the
problem straight back.

### Deprecated tsconfig options

Two settings the editor flags and the compiler does not: `tsc` reports nothing
for either, so these were only ever visible in the editor, which renders
deprecated options struck through.

- **`"moduleResolution": "Node"` → `"node10"`** in `backend/tsconfig.json` and
  `shared/tsconfig.build.json`. TypeScript 5.0 renamed the value; `Node` has been
  the deprecated alias since. A pure rename — `tsc --showConfig` reports the same
  resolution kind, and the backend still resolves `@shared/types` through the
  package's `types`/`main` fields exactly as before.
- **`baseUrl` removed** from `frontend/tsconfig.json`. It is deprecated, and
  since TypeScript 4.4 `paths` resolves relative to the tsconfig's own directory,
  so `"baseUrl": "."` was restating the default. Verified with
  `--traceResolution` that `@/lib/format` still resolves through `paths`.

Deliberately _not_ moved to `node16`/`nodenext` for the backend. That would let
TypeScript honour the `exports` conditions on `@shared/types` rather than falling
back to `main`, which is tidier — but it changes module-detection semantics and
would need `module` moved in step. `node10` preserves today's behaviour exactly,
which is what a deprecation rename should do. Worth doing on its own another day.

## 2026-08-26 — MD-16: per-employee profitability

A Profitability column on the project detail page's contribution table, coloured
by sign. No engine, service, controller or type change: `contributions` in
`calc/engine.ts` has computed `revenueShare` and `profitability` since MD-6 and
both have been on the wire ever since. MD-12 shipped the table with hours and
cost only and said in a comment that surfacing the rest was its own issue; this
is that issue, so the work is presentation plus the hardening the issue asked
for.

Worth knowing about:

- **The hand-verification is against the spreadsheet, not against the engine.**
  Rohit Menon on Q2025001a: `560,000 × 520.9 ÷ 3,025.2 = 96,424.6992` of the
  price, and `(96,424.6992 − 67,222.4559) ÷ 96,424.6992 = 0.302850`. A test that
  recomputes the engine's formula from the engine's own output only proves the
  two fields agree with each other — useful, and kept alongside, but it is not
  the same claim.
- **An unpriced project reads as an em dash on every row.** `formatPct(null)`
  already returns one, so the column needed no null branch of its own — but the
  case is pinned by a frontend test asserting the cells are `—` and that `0.0%`
  appears nowhere, and by an integration test asserting `profitability` is
  `null` for every contributor on a ref code with hours and no price. A
  break-even 0% is a different fact from having no revenue to share out.
- **Revenue shares are asserted to sum back to the price**, in both the unit and
  the integration tests. That is what makes the column trustworthy: ten
  percentages that do not add up to the project's own margin would be worse than
  no column.
- **Row order is untouched** — hours-descending, as the API returns it. Sorting
  by profitability would put the smallest contributors at both ends, since a few
  hours priced against a few hours of cost swings hardest.

Zero profitability is coloured as positive, matching `ProjectsTable`'s existing
`amountClass`. That helper is now duplicated in both tables verbatim; the review
flagged it, and it belongs in `lib/format.ts` beside `formatBarWidth` — left as
its own change rather than folded into this one.
