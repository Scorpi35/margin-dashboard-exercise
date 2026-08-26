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
