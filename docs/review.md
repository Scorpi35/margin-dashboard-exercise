# Review

Single source for AI code review in this repo. Four thin pointers reference it —
edit this file, not them:

- `.claude/commands/review.md` (Claude Code `/review`)
- `.agents/skills/source-command-review/SKILL.md` (migrated skill)
- `REVIEW.md` (repo root)
- `AGENTS.md` (Codex, via the Documentation table)

## Procedure

You are reviewing code changes with no knowledge of how or why they were
written. Do not assume good intent — look for bugs, incorrect arithmetic, and
violations of project conventions.

1. Run `git diff` (or `git diff main...HEAD` if reviewing a branch) to see the changes.
2. Apply every rule in the Rules section below.
3. Also check for general issues: logic errors, missing error handling, broken
   edge cases, unguarded division, and silent data loss.
4. Report findings grouped by severity: 🔴 critical, 🟡 warning, 🔵 suggestion.
   For each finding: file, line, what's wrong, how to fix it.
5. If you find nothing, say so plainly — don't invent issues to seem useful.

Do not modify any files. Do not approve/reject — just report.

## Rules

Project-specific checks. Correctness lint runs in CI (`npm run lint`, alongside
`typecheck`, `test`, `test:integration`, and `selfcheck`) and formatting belongs
to Prettier (`.prettierrc.json`, applied by the post-edit hook) — never raise
either as a review finding. This section is for things a generic reviewer
wouldn't know to look for.

### Calculation engine (`backend/src/calc/`)

- `calc/` is pure. Flag any import of `lib/db`, a service, `express`, `fs`, or
  any use of `Date.now()`/`new Date()` inside it — it must take plain data in and
  return plain data out, or the cost model stops being verifiable without booting
  the server.
- Formulas are fixed by `docs/cost-model.md` and implemented verbatim. Flag any
  altered formula, reordered term, or "simplification" of direct rate, indirect
  pool, indirect rate, revenue share, or profitability.
- **Total period cost is salaries-in-period plus overhead-in-period — never the
  sum of project costs.** Summing project costs double-counts, because
  non-billable time is already redistributed through the indirect rate. Flag any
  diff that re-derives total cost from project or employee project costs.
- Every division must be guarded. Zero total hours, zero billable hours, a null
  salary, and a zero project price must never produce `NaN` or `Infinity`. Flag
  an unguarded `/`.
- A diff touching `calc/`, `parse/`, or `ingest.service.ts` must keep
  `npm run selfcheck` passing (overhead 0 ⇒ total cost equals total salaries, AED
  2,400,000.00 on the sample data). Flag if the diff can't plausibly hold the
  invariant, and **flag any change that relaxes an assertion in
  `calc/engine.test.ts` or `calc/real-data.test.ts` rather than fixing the code.**
- Cost arithmetic belongs here, not in a service. Flag a rate, cost or margin
  calculated inside `services/`.

### Backend (Express + SQLite, `backend/src/`)

- Route files (`routes/*.routes.ts`) are wiring only — router setup, middleware,
  and a controller reference. Flag business logic or any SQL that appears in a
  route file instead of a controller or service.
- There is no repository layer and no ORM. Services issue SQL directly against
  the shared connection from `lib/db.ts`. Flag any module opening its own
  connection, and flag `snake_case` column names leaking out of
  `services/ingest.service.ts` into the engine, another service, or a response
  payload.
- **Re-upload replaces only the months the file contains**, in a single
  transaction: delete the distinct `(year, month)` pairs present in the upload,
  then insert. Flag a bare `DELETE FROM` with no month predicate, an insert
  outside a transaction, or any change that would let a partial month persist
  after a mid-ingest failure — that's silent data loss across the rest of the year.
- Validation is hand-rolled, not schema-based (no zod in this repo). Every value
  read from `req.query`, `req.body` or `req.params` must be validated before use,
  throwing `HttpError(400, ...)` from `middleware/errorHandler`. See the
  `requireYear` / `optionalMonth` / `requireUploadType` helpers in
  `controllers/dashboard.controller.ts` for the established shape. Flag handlers
  that trust request input directly — a `year` of `"banana"` reaching a filter as
  `NaN` produces a plausible-looking empty dashboard rather than an error.
- Uploads accept `.xlsx`/`.xls` only, rejected before parsing, and a parser
  exception must become a 400 with **nothing written**. Flag an upload path that
  can half-ingest a wrong file.
- Period filtering selects which rows are aggregated; cost rates are always
  derived from the full month. Flag a diff that recomputes rates from a filtered
  subset — filtering to March must not change March's rates.
- `process.env` is read only in `config/env.ts` — add new settings there rather
  than reading the environment inline. Flag `process.env` usage elsewhere.
- There is no authentication and no user scoping. This is a single-user local
  tool. Flag auth middleware, session handling, or `userId` columns introduced
  without the brief changing — they are scope creep, not a security improvement.
- New endpoints need an accompanying integration test in
  `backend/test/integration/*.integration.test.ts`. Flag if missing.

### Parsing (`backend/src/parse/`)

- A bad row is skipped with a `ParseWarning` carrying file, 1-indexed row number,
  and cause. A structurally wrong file throws. Flag a parser that throws on one
  bad row, or one that silently drops a row with no warning.
- Date strings are parsed only in `parse/dates.ts`. Flag `new Date(...)`, a regex
  on a month string, or manual date slicing anywhere else.
- Billability comes from `settings.billableCategories`. Flag any inference from a
  string prefix — `Tentwenty` is non-billable and carries no `FC - ` prefix, so
  prefix-matching silently miscosts it.
- A dash (`-`, `–`, `—`) is a blank cell. Flag numeric coercion that would turn
  one into `0` or `NaN` instead of `null`.

### Frontend (React + Vite, `frontend/src/`)

- No inline `fetch`/`axios` in components. All server calls go through the typed
  client in `lib/api.ts`, which centralises base URL and `ApiError` handling.
  Flag raw `fetch` in `components/` or `pages/`.
- **No calculation in a component.** Formatting and sorting are fine; a cost
  formula is not. Flag arithmetic on rates, salaries or hours in JSX or a hook —
  if a number isn't in the API response, the fix is to add it to the response.
- **A `null` renders as `—`, never `0`, and the reason must be visible.** Flag a
  `?? 0`, `|| 0`, or `.toFixed()` on a nullable money or rate field, and flag a
  page that drops unpriced ref codes or missing-salary employees without
  surfacing them in a warning banner.
- Filter state lives in URL search params, not React state. Flag `useState` used
  to hold the selected year or month.
- Numeric table columns are right-aligned with `.tabular`. Flag a new numeric
  column without it — misaligned figures are the most visible craft failure in a
  finance table.
- Colours come from the CSS custom properties in `index.css`. Flag a hardcoded
  hex value in a component.

### Cross-cutting

- `shared/` is the API contract, and nullability is part of it. When a diff
  changes an engine output shape or an endpoint payload, flag the other side if
  it wasn't updated to match — and flag a frontend type that widens a nullable
  field to `number`.
- A judgement call made where the brief is ambiguous must be commented at the
  call site **and** listed in the README assumptions. When a diff introduces one,
  flag the missing documentation.
- New engine functions and new parser rules need tests. Flag an engine change with
  no accompanying test; do not flag missing tests for presentational components.
- `data/` (the SQLite file and its `-wal`/`-shm` siblings) is never committed.
  Flag it in the diff.
- Do not comment on general code style, naming bikeshedding, or formatting —
  that's handled by lint in CI. Focus only on correctness, data integrity, and the
  project patterns above.
- Do not approve or merge — only report findings by severity. A human makes the
  merge decision.