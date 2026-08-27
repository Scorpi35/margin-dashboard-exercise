# Margin Dashboard

A local margin-analysis tool that turns a digital agency's three operational
spreadsheets — timesheet, salary sheet, project price list — into a dashboard
answering one question: did we make money on that project?

No cloud account, no API key, no paid service. Everything runs from a clean
checkout.

## Requirements

- Node.js >= 22.12 (`.nvmrc` pins 22 — `nvm use`)
- npm 10+

## Setup Instructions

| Steps                    | Command                                                                                           | Description                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Clone the repository  | `git clone git@github.com:Scorpi35/margin-dashboard-exercise.git && cd margin-dashboard-exercise` | Clones the repository and moves into the project directory.                                   |
| 2. Use Node.js 22        | `nvm install 22 && nvm use`                                                                                         | Switches to the Node.js version specified by `.nvmrc`. The project requires Node.js >= 22.12. |
| 3. Install dependencies  | `npm install`                                                                                     | Installs dependencies for all three workspaces and builds the `shared/` workspace.            |
| 4. Seed the database     | `npm run seed`                                                                                    | Imports the spreadsheets from `sample-data/` into SQLite and creates `data/` if needed.       |
| 5. Verify the cost model | `npm run selfcheck`                                                                               | Checks that the computed monthly cost reconciles with total salaries.                         |
| 6. Start the application | `npm run dev`                                                                                     | Starts the frontend and backend development servers.                                          |

### Application URLs

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`
- Health check: `http://localhost:5173/api/health`

The Vite development server proxies `/api` requests to Express, so the
frontend and API are same-origin during development.

## Assumptions

The brief leaves some things open. Every judgement call made in response is
commented at the point it is made in the code; they are collected here so a
reviewer does not have to find them.

| Decision                                                                                                                     | Why                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Revenue is attributed pro-rata by hours**, not booked in the sales month.                                                  | Otherwise a month view shows a month's cost against all of a project's revenue or none of it. Full-year figures are identical either way.                                                                                                                                          |
| **Revenue share and project margin divide the period's revenue**, not the whole contract price.                              | Keeps the per-employee shares adding up to the revenue on the project row. Identical over a full year. See `docs/cost-model.md`.                                                                                                                                                   |
| **`isSupportStaff` means zero hours logged**, not "absent from the timesheet".                                               | Someone whose rows sum to zero would otherwise have their salary counted in payroll but never enter the pool, breaking the invariant.                                                                                                                                              |
| **Overhead is costed for a month even when no rows have been ingested for it.**                                              | Overhead is usually entered before the spreadsheets are uploaded; dropping it would silently understate cost.                                                                                                                                                                      |
| **A project with a price but no logged hours is absent from the project table.**                                             | Pro-rata attribution is `0/0` for it. Its revenue is `null` rather than `NaN` if one ever appears.                                                                                                                                                                                 |
| **An unreadable sales month leaves `salesYear`/`salesMonth` `null`, and the price is kept.**                                 | The sales month is informational; losing the price over it would be the greater error. `0` is not a month.                                                                                                                                                                         |
| **A two-digit year (`January '25`) reads as `20xx`.**                                                                        | Every sheet the agency keeps is this century. A pivot year would guess a century silently.                                                                                                                                                                                         |
| **Excel serials must resolve to 1970–2199.**                                                                                 | A bare `2025` is a valid serial meaning 1905-07-17. A year carries no month, so accepting it would misfile a whole period.                                                                                                                                                         |
| **A timesheet row with no category is kept and flagged, not skipped.**                                                       | Dropping it would remove real hours and distort the month's rates. Uncategorised time cannot match `billableCategories`, so it stays in the pool.                                                                                                                                  |
| **Re-uploading a shorter price list keeps the projects it omits.**                                                           | Deleting them would strip prices from work the timesheet still references, turning a priced project unpriced on the strength of an omission.                                                                                                                                       |
| **With no `?year=` in the URL, the dashboard adopts the most recent year that has data and writes it into the address bar.** | A period the URL does not show is not linkable, which defeats keeping filter state there. Adopting it replaces the history entry rather than adding one, since the reader did not choose it.                                                                                       |
| **A link naming a year with no data keeps that year, and the filter offers it marked "(no data)".**                          | Silently substituting a different year would leave the control, the period label and the figures disagreeing on screen.                                                                                                                                                            |
| **A department's cost is the salaries of its people, not its hours at a loaded rate.**                                       | Charging each department's hours at `directRate + indirectRate` counts the indirect pool twice — it already holds everyone's non-billable time — and overstates the company by exactly the pool (AED 909,257.32 on the sample). Salaries reconcile to payroll.                     |
| **Overhead is not attributed to a department.**                                                                              | It is a company-level cost and the brief gives no basis for splitting it, so the department rows add up to total salaries rather than to `PeriodSummary.totalCost`.                                                                                                                |
| **Someone who logged no hours is bucketed under `Unassigned`.**                                                              | No timesheet row says which department they are in. A bucket keeps the totals adding up and gives them a URL, instead of an invisible row under an empty name.                                                                                                                     |
| **`GET /api/categories` returns `{ rows, totalHours, billableHours, nonBillableHours }` rather than a bare array of rows.**  | The page shows a total / billable / internal summary, and a figure missing from a response is added to the response rather than summed in a component. It also lets the totals be checked against the dashboard's server-side.                                                     |
| **Bars on the categories page are scaled against the largest category, not against 100%.**                                   | Projects is 63% of the year; on a full-width scale every other category collapses into a sliver, and comparing them is the point of the page.                                                                                                                                      |
| **A project's detail page is costed over all time, ignoring any period filter.**                                             | A price covers the whole engagement, so its margin only means anything against all the work done on it. One month's cost beside a pro-rata slice of the price invites a comparison that does not hold.                                                                             |
| **A priced project with no hours logged against it appears in neither the project list nor the detail, which 404s.**         | Both are built from timesheet rows. The sample has none, and having the list and the detail disagree would be worse than either answer.                                                                                                                                            |
| **A rejected upload leaves no row in the upload history.**                                                                   | A structurally wrong file throws before any row is read, so it has no row or warning count to report — and recording it would write to the database on a request that promised not to.                                                                                             |
| **`selfcheck` reads the database rather than the spreadsheets.**                                                             | So it reports an empty database instead of passing vacuously. Seed before you check.                                                                                                                                                                                               |
| **A month with no overhead is omitted from the stored map rather than saved as `0`.**                                        | The engine reads an absent month as no overhead, so the two are the same figure. Storing zeroes would grow a row per month per year that says nothing.                                                                                                                             |
| **Unchecking every billable category is allowed, with the consequence spelled out on the page.**                             | The engine already guards it — a month with no billable hours takes an indirect rate of `0`, not `Infinity` — and the invariant still holds. Blocking a state the model handles would be a rule the code does not need.                                                            |
| **A billable category with no hours logged still gets a checkbox, marked as such.**                                          | The selection is a stored setting and the names come from the timesheet, so a partial upload parts them — and the defaults name three categories on a database that has none of them. Hiding one would make it invisible and, worse, drop it from the selection on the next click. |
| **The dashboard's empty state needs zero hours, zero cost and zero revenue — not zero hours alone.**                         | Overhead is costed for a month with no rows in it, so a month carrying overhead and nothing else has a real cost figure and keeps its cards. Calling that period empty would hide money the agency spent.                                                                          |
| **The overhead table shows every month that has data, plus any month already carrying overhead.**                            | Overhead is costed for a month even when no rows exist for it, so a month whose timesheet was later replaced still has real cost against it. An invisible row cannot be cleared.                                                                                                   |
| **`PUT /api/settings` replaces both settings whole rather than patching them.**                                              | Unchecking a category _is_ leaving it out of the list; there is no partial update that can express it.                                                                                                                                                                             |
## Notes

### What would I do next?

- Complete the features listed in the **stretch section**.
- Current productivity tracking is based only on billable hours, overlooking valuable non-billable work such as internal tooling, mentoring, process improvements, and client relationship management. A future metric should account for these contributions.
- Polish and refine the UI for a more consistent and polished user experience.
- Integrate **Codex** into the CI/CD pipeline as the final stage for automated code review.

### What would I cut and why?
- I wouldn't cut anything, since every feature seems important. However, I'd improve productivity tracking to account for non-billable hours.

### What I'm not happy about?
- Missing Codex review; I would integrate it into the CI/CD pipeline as the final stage for automated code review.
- I'm not happy about the UI; I would improve it significantly.

## Additional Information

### Verifying the checks the way CI would

Optional, and independent of the database:

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
```

### Layout

```
frontend/      React (Vite) + TypeScript + Tailwind
backend/       Express + TypeScript
shared/        the vocabulary both workspaces speak — types plus a default or two
sample-data/   the three source .xlsx files
data/          SQLite file, created on demand, gitignored
docs/          architecture, cost model, data sources, conventions
```

### Scripts

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

### Troubleshooting

**Every page loads but anything touching data fails.** You are on the wrong Node.
`better-sqlite3` binds its native module lazily, so a mismatch does not stop the
server booting — it fails one request at a time with `ERR_DLOPEN_FAILED` and a
`NODE_MODULE_VERSION` stack trace. The server now refuses to start instead:

```
[api] The database driver could not be loaded. This is Node 20.20.0, and the
      project needs Node 22 (see .nvmrc). Run `nvm use`, then start again.
```

`npm install` refuses too (`engine-strict`). Run `nvm use` first.

### Documentation

See [`AGENTS.md`](AGENTS.md) and [`docs/`](docs) — in particular
[`docs/cost-model.md`](docs/cost-model.md), which is the single source of truth
for every number the application produces.
