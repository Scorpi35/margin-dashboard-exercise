This file guides Claude Code (and any contributor) when generating or modifying code in this repository. Follow these conventions strictly to keep the codebase consistent.

## Project Overview

- **Frontend**: React + TypeScript
- **Backend**: Express + TypeScript
- **Package manager**: npm
- **Monorepo layout**:
  ```
    /frontend      React (Vite) app
    /backend       Express app
    /shared        cross-cutting types shared by both workspaces
    /sample-data   the three source .xlsx files, committed
    /data          SQLite file — gitignored, created on demand
  ```

## General TypeScript Rules

- `strict: true` in `tsconfig.json` — never disable strict checks to silence an error; fix the underlying type issue.
- Never use `any`. Use `unknown` at parse boundaries and narrow it, or define a proper type/interface.
- Prefer `interface` for object shapes that represent rows, engine outputs, API payloads, or props. Use `type` for unions, intersections, tuples, and mapped/utility types.
- No implicit `enum` unless the values are truly fixed constants; prefer union string literal types (`type ExpenseType = 'DL' | 'IDL'`) over TS enums.
- Always type function return values explicitly for exported functions; inference is fine for small local/private helpers.
- Avoid non-null assertions (`!`). Handle the `null`/`undefined` case explicitly. The exception is a lookup you have just proven exists in the preceding lines — comment it when it isn't obvious.
- **A value that can legitimately be absent is `T | null`, never `T | undefined` and never defaulted to `0`.** A silent zero is a wrong number, and wrong numbers are what this project is graded on. `salary`, `projectPrice`, `profit`, `marginPct`, `revenueShare` and `margin` are all nullable by design, all the way from the parser to the rendered cell.
- Use `readonly` for props, DTOs, and arrays/objects that should not be mutated.
- Named exports preferred over default exports, except React page/component files where a default export is idiomatic.
- One React component per file. Backend modules are grouped by concern rather than
  one-export-per-file: a controller exports every handler for its resource
  (`project.controller.ts` exports the list and detail handlers), and a service
  exports the operations for its domain. Keep the group cohesive instead of
  splitting per function.

## Naming Conventions

| Item                                    | Convention              | Example                                                          |
| --------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Variables, functions                    | camelCase               | `computeIndirectRate`                                            |
| React components                        | PascalCase              | `ProjectMarginTable`                                             |
| Types, interfaces                       | PascalCase              | `TimesheetRow`, `ProjectFinancials`                              |
| Constants (true constants)              | UPPER_SNAKE_CASE        | `DEFAULT_BILLABLE_CATEGORIES`                                    |
| Files: components                       | PascalCase.tsx          | `StatCard.tsx`                                                   |
| Files: hooks                            | camelCase, `use` prefix | `usePeriodFilter.ts`                                             |
| Files: backend layer modules            | kebab-case + dot suffix | `project.controller.ts`, `ingest.service.ts`, `upload.routes.ts` |
| Files: everything else (utils, helpers) | kebab-case              | `format-currency.ts`                                             |
| Folders                                 | kebab-case              | `sample-data/`, `project-detail/`                                |
| Database columns                        | snake_case              | `employee_no`, `monthly_salary`                                  |
| Interfaces                              | No `I` prefix           | `SalaryRow`, not `ISalaryRow`                                    |

Domain language beats implementation language. `directRate`, `indirectPool`,
`billableHours`, `revenueShare` — someone in finance should recognise the variable
names from the brief.

## React (Frontend) Conventions

- Functional components only, with hooks. No class components.
- One component per file. File name matches the component name.
- Component structure order: type/interface definitions → component function → helper functions (if small/local) → styles (if colocated).
- Props always typed via an explicit `interface ComponentNameProps`. Destructure props in the function signature.
- Custom hooks live in `hooks/`, named `useX`, and return an object (not a bare array) once there are more than 2 values.
- **No calculation in a component.** Formatting and sorting are fine; a cost formula is not. Every rate, cost and margin is computed by the backend engine and arrives over the wire. If a number isn't in the API response, add it to the response — do not derive it client-side.
- No inline business logic in JSX — extract to a function, hook, or handler.
- State:
  - Local UI state → `useState`.
  - **Filter state (year, month) → URL search params**, via `useSearchParams`, so a filtered view is linkable and survives a refresh. Never hold the selected period in `useState`.
  - Cross-cutting/shared state → context — do not prop-drill more than 2 levels.
- Data fetching goes through the typed client in `frontend/src/lib/api.ts` (base URL, `ApiError` handling), never `fetch`/`axios` calls directly inside components.
- Co-locate: `ComponentName/ComponentName.tsx`, `ComponentName.test.tsx`, `index.ts` (barrel export) when a component has multiple files.
- Avoid `useEffect` for derived state — compute it directly during render or with `useMemo`.
- Keys in lists must be stable IDs (`refCode`, `employeeNo`), never array index.
- **A `null` from the API renders as an em dash `—`, never `0`.** Flagging why it's absent is the page's job, not the cell's: surface missing salaries and unpriced ref codes in a warning banner.
- Design tokens are CSS custom properties in `index.css`, declared in `@theme static`
  so Tailwind generates a utility for each (`bg-paper`, `text-ink-muted`,
  `border-line`). Use them; never hardcode a hex value in a component.

  | Token                   | Role                                            |
  | ----------------------- | ----------------------------------------------- |
  | `--color-paper`         | Page background                                 |
  | `--color-paper-raised`  | Cards, tables, the sidebar                      |
  | `--color-paper-sunken`  | Hover fills, inset wells                        |
  | `--color-ink`           | Primary text                                    |
  | `--color-ink-muted`     | Secondary text, inactive nav                    |
  | `--color-ink-faint`     | Captions, hints                                 |
  | `--color-line`          | Borders and table gridlines                     |
  | `--color-line-strong`   | Emphasised rules, header separators             |
  | `--color-accent`        | Links, selected nav, the focus ring             |
  | `--color-accent-hover`  | Accent under the pointer                        |
  | `--color-accent-soft`   | Selected-row and selected-nav background        |
  | `--color-positive`      | Profit, healthy margin                          |
  | `--color-positive-soft` | Background wash behind a positive figure        |
  | `--color-negative`      | Loss, negative margin                           |
  | `--color-negative-soft` | Background wash behind a loss                   |
  | `--color-warning`       | Gaps in the data — missing salary, unpriced ref |
  | `--color-warning-soft`  | Warning banner background                       |
  | `--color-bar`           | Inline data-bar fill — never a warning          |

- Numeric table columns are right-aligned with tabular figures (`.tabular`). Columns of numbers that don't line up read as amateur.

## Express (Backend) Conventions

- Layered architecture, strictly separated:
  ```
  routes/       → defines endpoints, wires to controllers
  controllers/  → parses request, calls service, formats response
  services/     → orchestration: load data, invoke engine, assemble payload
  calc/         → the cost model; pure functions only
  parse/        → .xlsx buffers → typed rows + warnings
  middleware/
  lib/          → shared clients, incl. the SQLite connection
  config/       → typed environment access
  ```
- There is **no** `repositories/` layer and no ORM. Services import the shared
  connection from `lib/db.ts` and issue SQL directly.
- **`calc/` is pure.** No database, no `req`/`res`, no `fs`, no `Date.now()`. Plain
  data in, plain data out. This is what makes the cost model testable in isolation
  and verifiable from the CLI without booting Express — it is explicitly part of
  the grade.
- **Services orchestrate; they do not calculate.** A service loads rows and
  settings, hands them to `calc/`, and shapes the result. A cost formula appearing
  in a service is a layering violation.
- Route files are wiring only — router setup, middleware, and a controller
  reference. No business logic and no SQL in a route file.
- Controllers never contain business logic — they only orchestrate.
- Services never touch `req`/`res` — keep them framework-agnostic and testable.
- Validation is hand-rolled, not schema-based — there is no `zod` in this repo.
  Every value read from `req.query`, `req.body` or `req.params` is validated before
  use, throwing `HttpError(400, ...)`. Reuse `requireYear` / `optionalMonth` /
  `requireUploadType` from `controllers/validation.ts` rather than re-parsing input
  in a controller; never trust request input directly. A `year` of `"banana"` must
  produce a 400, not a `NaN` that silently poisons a filter. Note that `Number()`
  alone is not enough — it reads `"2e3"` as 2000 and `"0x7e9"` as 2025, both of
  which pass a range check.
- **Uploads**: `multer` in memory, `.xlsx`/`.xls` only, rejected before parsing.
  The buffer goes to a parser; the parser's rows go to the ingest service. A
  parser exception (structurally wrong file) becomes an `HttpError(400, ...)` and
  **nothing is written**.
- Centralized error handling:
  - `HttpError` class (`statusCode`, `message`) from `middleware/errorHandler`.
  - Services/controllers `throw` errors; never send error responses directly except in the final error-handling middleware.
  - `errorHandler` is registered last and formats every error response.
- Consistent API response shape:
  ```ts
  // success
  { status: 'ok', data: T }
  // error
  { status: 'error', message: string }
  ```
- Async handlers must never leave a dangling promise — wrap the body in `try/catch` and forward failures with `next(err)`.
- Environment variables accessed only through `config/env.ts` — never `process.env.X` scattered across the codebase.
- There is no authentication. This is a single-user local tool with no accounts, no tenancy, and no network exposure; do not add auth middleware or user scoping unless the brief changes.
- A new endpoint needs an integration test in `backend/test/integration/*.integration.test.ts`.

## Data Layer Conventions

- `lib/db.ts` owns the single SQLite connection and the idempotent schema. Nothing else opens a connection.
- `services/ingest.service.ts` is the only place `snake_case` appears in TypeScript. It maps to and from `camelCase` on the way in and out; no `snake_case` escapes it.
- **Re-upload semantics**, in a single transaction: collect the distinct
  `(year, month)` pairs present in the upload, delete existing rows for exactly
  those months, then insert. Months absent from the file are untouched. Projects
  are upserted by ref code. Comment this at the call site — it is behaviour being
  assessed.
- A failure mid-ingest must roll back. A partial month in the database is worse than a rejected upload.
- Period filtering selects **which rows are aggregated**. Cost rates are always derived from the full month they belong to; filtering to March must never recompute March's rates from a subset.

## Parsing Conventions

- Parsers return `ParseResult<T>` — `{ rows, warnings }` — never a bare array.
- **A bad row is skipped with a `ParseWarning`, not an exception.** The warning carries the source file, the 1-indexed spreadsheet row number, and what went wrong.
- **A structurally wrong file throws.** Missing required columns or no recognisable header row is the "file isn't what it claims to be" case, and it must fail loudly and early rather than half-ingesting.
- Locate columns by case-insensitive substring, not exact header text, so `"Project (Billable) / Task (Unbillable) Name"` is found by `"project"`.
- Never parse a date string outside `parse/dates.ts`. Downstream code receives explicit `year` and `month` integers.
- Never infer billability from a string prefix. `Tentwenty` is non-billable and carries no `FC - ` prefix. Billability comes from `settings.billableCategories`.
- `parseNumericCell` returns `null`, never `0`, when there is no number. A dash (`-`, `–`, `—`) is a blank cell, not a value.

## The Cost Model

- Formulas live in `docs/cost-model.md` and are implemented verbatim in `backend/src/calc/engine.ts`. Do not "improve" them.
- **The invariant: with overhead set to zero, company-wide total cost equals total salaries to the dirham.** Verified figure on the sample data: AED 2,400,000.00 for 2025.
- `npm run selfcheck` enforces it and exits non-zero on failure. `calc/engine.test.ts` and `calc/real-data.test.ts` assert it against fixtures and real data, annually and per-month.
- **A change that breaks the invariant is wrong.** Never relax an assertion to make a change pass. Re-derive the arithmetic on paper first.
- Total period cost is computed as salaries-in-period plus overhead-in-period — **not** by summing project costs. That formulation is what makes the invariant hold by construction; summing project costs is where double-counting creeps in.
- Guard every division. Zero hours, zero billable hours, a null salary and a zero project price must never produce `NaN` or `Infinity`.

## Shared Types

- `shared/` holds the types both workspaces need: the domain rows (`TimesheetRow`, `SalaryRow`, `ProjectRow`), the engine output shapes (`ProjectFinancials`, `PeriodSummary`), and the API envelope. Both `tsconfig.json` files reference it.
- **The engine's output types are the API contract.** Define them in `shared/` first, then implement the endpoint and the client call against them. A new endpoint is not done until its types are wired up on both sides.
- `shared/` imports nothing from either workspace. It is the vocabulary, not a utility library.
- Nullability is part of the contract. If the engine can return `null` for a field, the shared type says so and the frontend handles it — never widen it to `number` on the client.

## Error Handling (General)

- Never swallow errors silently (no empty `catch {}`).
- Log errors with context (which file, which row, which ref code) — no bare `console.log(error)`.
- User-facing error messages are friendly and non-technical; parser warnings retain the full detail including row numbers, and are returned to the UI rather than only logged.
- **A missing value must be visible, not silent.** A gap the reader can't account for is worse than no number at all.

## Imports

- Frontend: use the `@/*` alias (`@/components/...`, `@/lib/api`, `@shared/types`),
  configured in `frontend/tsconfig.json` and `vite.config.ts`. Avoid long relative
  `../../../` chains.
- Backend: **no path alias is configured.** `backend/tsconfig.json` has no `paths`
  entry, so backend code uses relative imports (`../lib/db`, `../middleware/errorHandler`).
  Match that; do not introduce `@/` imports in `backend/` without adding the alias
  to both `tsconfig.json` and the `tsx`/`vitest` resolvers first.
- Import order: external packages → shared types → internal aliases → relative imports
  (blank line between groups). Not lint-enforced today — follow it by hand.

## Formatting & Linting

- Formatting is Prettier's job, not yours. The single source of truth is
  `.prettierrc.json` at the repo root — 2-space indent, semicolons, single quotes,
  trailing commas (`all`), 100-char print width, LF endings. Never hand-format
  against it, and never argue about style in review.
- `npm run format` writes; `npm run format:check` verifies. Both run from the root
  across both workspaces and honour `.prettierignore`.
- The post-edit hook (`.claude/hooks/post-edit-hook.sh`)
  runs Prettier, `eslint --fix`, and `tsc --noEmit` on every agent edit to a
  `.js/.jsx/.ts/.tsx` file, so agent-written code is formatted on the way in.
- ESLint handles correctness, not style: `backend/eslint.config.mjs` (flat config)
  and `frontend/eslint.config.mjs`. Both extend `eslint-config-prettier` **last**,
  which disables stylistic rules that would fight Prettier — keep it last when
  editing either config.
- No unused variables/imports (fails lint; `argsIgnorePattern: '^_'` on the backend).
- CI runs `format:check`, `lint`, `typecheck`, `test`, `test:integration`, then
  `seed` and `selfcheck` — in that order, because `selfcheck` reconciles what is
  in the database rather than re-parsing the spreadsheets, and reports an empty
  one rather than passing vacuously. Unformatted or unreconciled code fails the
  build — run `npm run format` before pushing if you edited files outside an
  agent session.

## Comments & Documentation

- Code should be self-explanatory through naming; comments explain **why**, not **what**.
- The valuable comments here explain a decision someone could otherwise reasonably
  reverse: why re-upload deletes by month, why non-billable hours don't get their
  own project cost, why the salary year is inferred from a title row.
- Every non-obvious business rule gets a comment pointing back to the brief.
- Use JSDoc for exported engine functions and services whose formula or purpose isn't obvious from the signature alone.
- No commented-out code left in commits.

## Testing

- The two workspaces use different layouts by design — follow the one you are in:
  - **Backend**: a separate tree, `backend/test/unit/` and `backend/test/integration/`,
    mirroring the source module name (`ingest.service.ts` →
    `test/unit/ingest.service.test.ts`). Run with `npm run test --workspace backend`
    and `npm run test:integration --workspace backend`.
  - **Frontend**: colocated with the source (`format-currency.ts` → `format-currency.test.ts`).
- Tests must earn their keep. Write them for:
  - **The cost model** — every formula, the invariant, and multi-month and support-staff-heavy fixtures. This is the highest-value test surface in the repo.
  - **Date and format parsing** — all three observed month formats plus the failure cases.
  - **Parsers against the real `sample-data/` files**, so a regression against actual data surfaces immediately.
  - **Missing-data paths** — no salary row, no price row, zero hours.
- API endpoints: integration tests hitting the actual Express app, in
  `backend/test/integration/*.integration.test.ts`. A new endpoint is not done
  without one — including the re-upload case, which asserts that uploading one
  corrected month leaves the other eleven untouched.
- React components: test user-visible behavior (React Testing Library), not implementation details. Do not snapshot the UI.
- Use `toBeCloseTo` for money and rates (floating point), `toBe` for counts and integers.
- A change to `calc/`, `parse/`, or `ingest.service.ts` is not done until `npm run selfcheck` passes.

## Git / Commits

- Conventional Commits format: `feat:`, `fix:`, `refactor:`, `chore:`, `test:`, `docs:`.
- Small, focused commits — one logical change per commit. Real incremental history is an explicit deliverable; a single squashed "initial commit" is a negative signal.
- Reference the issue: `feat: add category breakdown endpoint (#16)`.
- Never commit `data/` (the SQLite file and its `-wal`/`-shm` siblings) or `node_modules/`.
- No direct commits to `main`/`master` — feature branches + PRs (adjust if solo project).

## What Claude Should Always Do Here

- Match existing patterns in the surrounding code before introducing a new pattern.
- When adding a new API endpoint: engine function (with unit tests) → service → controller (with hand-rolled input validation) → route → matching type in `shared/` → call in `frontend/src/lib/api.ts` → integration test.
- When adding a new React feature: define props/types → hook (if stateful logic needed) → component. The numbers come from the API; the component renders them.
- Run `npm run selfcheck` after any change to parsing, ingestion, or calculation — before saying the change is done.
- Ask before introducing a new dependency; prefer what's already in `package.json`. A chart library for something a bar-in-a-table-cell can express is not worth it.
- Never bypass validation, null-handling, error handling, or typing "to make it work quickly" — follow the conventions above even for throwaway-looking code.
