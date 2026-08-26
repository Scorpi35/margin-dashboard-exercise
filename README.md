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
shared/        types shared by both workspaces — no runtime code
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
| `npm run selfcheck`        | Enforces the cost reconciliation invariant |

`seed` and `selfcheck` are wired up but not yet implemented — they exit
non-zero until the parsers and the calculation engine land.

## Documentation

See [`AGENTS.md`](AGENTS.md) and [`docs/`](docs) — in particular
[`docs/cost-model.md`](docs/cost-model.md), which is the single source of truth
for every number the application produces.
