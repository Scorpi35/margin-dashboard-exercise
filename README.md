# Margin Dashboard

A local margin-analysis tool that turns a digital agency's three operational
spreadsheets — timesheet, salary sheet, project price list — into a dashboard
answering one question: did we make money on that project?

No cloud account, no API key, no paid service. Everything runs from a clean
checkout.

## Requirements

- Node.js >= 22.12 (`.nvmrc` pins 22 — `nvm use`)
- npm 10+

## Getting started

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000
- Health check through the dev proxy: http://localhost:5173/api/health

The Vite dev server proxies `/api` to Express, so the frontend and the API are
same-origin in development.

## Layout

```
frontend/      React (Vite) + TypeScript + Tailwind
backend/       Express + TypeScript
shared/        the vocabulary both workspaces speak — types plus a default or two
sample-data/   the three source .xlsx files
data/          SQLite file, created on demand, gitignored
docs/          architecture, cost model, data sources, conventions
```

## Scripts

Run from the repo root.

| Script                     | What it does                               |
| -------------------------- | ------------------------------------------ |
| `npm run dev`              | Backend and frontend together              |
| `npm run build`            | Type-checks and builds both workspaces     |
| `npm run typecheck`        | `tsc --noEmit` across all workspaces       |
| `npm run lint`             | ESLint across both app workspaces          |
| `npm run format`           | Prettier, writes                           |
| `npm run format:check`     | Prettier, verifies                         |
| `npm test`                 | Unit tests in both workspaces              |
| `npm run test:integration` | Backend API integration tests              |
| `npm run seed`             | Ingests `sample-data/` into SQLite         |
| `npm run seed -- --fresh`  | Empties every table first, then ingests    |
| `npm run selfcheck`        | Enforces the cost reconciliation invariant |

`selfcheck` reads whatever is in the database, so **seed before you check**:

```bash
npm run seed
npm run selfcheck
```

It honours your saved billable categories but forces overhead to `{}` — overhead
is real cost that isn't salary, so it legitimately breaks `cost == salaries` and
would make the check untestable. Expect:

```
2025: total salaries = 2400000.00 | total computed cost = 2400000.00 | PASS
```

Both scripts run through `tsx` without starting Express, and both exit non-zero
on failure.

## Troubleshooting

**Every page loads but anything touching data fails.** You are on the wrong Node.
`better-sqlite3` binds its native module lazily, so a mismatch does not stop the
server booting — it fails one request at a time with `ERR_DLOPEN_FAILED` and a
`NODE_MODULE_VERSION` stack trace. The server now refuses to start instead:

```
[api] The database driver could not be loaded. This is Node 20.20.0, and the
      project needs Node 22 (see .nvmrc). Run `nvm use`, then start again.
```

`npm install` refuses too (`engine-strict`). Run `nvm use` first.

## Assumptions

The brief leaves some things open. Every judgement call made in response is
commented at the point it is made in the code; they are collected here so a
reviewer does not have to find them.

| Decision                                                                                        | Why                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Revenue is attributed pro-rata by hours**, not booked in the sales month.                     | Otherwise a month view shows a month's cost against all of a project's revenue or none of it. Full-year figures are identical either way.                                              |
| **Revenue share and project margin divide the period's revenue**, not the whole contract price. | Keeps the per-employee shares adding up to the revenue on the project row. Identical over a full year. See `docs/cost-model.md`.                                                       |
| **`isSupportStaff` means zero hours logged**, not "absent from the timesheet".                  | Someone whose rows sum to zero would otherwise have their salary counted in payroll but never enter the pool, breaking the invariant.                                                  |
| **Overhead is costed for a month even when no rows have been ingested for it.**                 | Overhead is usually entered before the spreadsheets are uploaded; dropping it would silently understate cost.                                                                          |
| **A project with a price but no logged hours is absent from the project table.**                | Pro-rata attribution is `0/0` for it. Its revenue is `null` rather than `NaN` if one ever appears.                                                                                     |
| **An unreadable sales month leaves `salesYear`/`salesMonth` `null`, and the price is kept.**    | The sales month is informational; losing the price over it would be the greater error. `0` is not a month.                                                                             |
| **A two-digit year (`January '25`) reads as `20xx`.**                                           | Every sheet the agency keeps is this century. A pivot year would guess a century silently.                                                                                             |
| **Excel serials must resolve to 1970–2199.**                                                    | A bare `2025` is a valid serial meaning 1905-07-17. A year carries no month, so accepting it would misfile a whole period.                                                             |
| **A timesheet row with no category is kept and flagged, not skipped.**                          | Dropping it would remove real hours and distort the month's rates. Uncategorised time cannot match `billableCategories`, so it stays in the pool.                                      |
| **Re-uploading a shorter price list keeps the projects it omits.**                              | Deleting them would strip prices from work the timesheet still references, turning a priced project unpriced on the strength of an omission.                                           |
| **A rejected upload leaves no row in the upload history.**                                      | A structurally wrong file throws before any row is read, so it has no row or warning count to report — and recording it would write to the database on a request that promised not to. |
| **`selfcheck` reads the database rather than the spreadsheets.**                                | So it reports an empty database instead of passing vacuously. Seed before you check.                                                                                                   |

## Documentation

See [`AGENTS.md`](AGENTS.md) and [`docs/`](docs) — in particular
[`docs/cost-model.md`](docs/cost-model.md), which is the single source of truth
for every number the application produces.
