# Architecture

## Overview

Margin Dashboard is a local margin-analysis tool that turns a digital agency's three operational spreadsheets — timesheet, salary sheet, project price list — into a dashboard answering one question: did we make money on that project?

Margin Dashboard is a local margin-analysis tool built with React, Express, SQLite, and SheetJS.

The frontend is responsible for user experience, while the backend owns all business logic. Spreadsheet ingestion is isolated behind parsers, and the entire cost model lives in a pure calculation layer that can be exercised without a database, an HTTP request, or a browser.

---

## Tech Stack

### Frontend

- React (Vite)
- TypeScript
- Tailwind CSS

### Backend

- Express
- TypeScript

### Database

- SQLite
- better-sqlite3 (synchronous, no ORM)

### Infrastructure

- None. Both workspaces run locally from a clean checkout with `npm install && npm run dev`. No cloud account, no API key, no paid service — a hard requirement of the brief.

Planned, not yet implemented: CSV export, an employee × category pivot, a cost-rate
audit view, and multi-year comparison. Nothing in `package.json` depends on them today.

---

## High-Level Architecture

```
React
   │
   ▼
Express API
   │
   ├── Controllers
   ├── Services
   ├── Calculation engine (pure)
   ├── Parsers
   └── SQLite (via better-sqlite3)
```

Ingestion is synchronous — one agency-year is a few thousand rows.

---

## Backend Structure

```
Routes
    │
Controllers
    │
Services
    │
    ├── Calculation engine (calc/)
    ├── Parsers (parse/)
    └── SQLite client (lib/db.ts)
            │
        Database
```

Responsibilities

- Routes wire endpoints to controllers — no logic.
- Controllers handle HTTP requests: validate input, call services, shape responses.
- Services orchestrate: read from the database, load settings, invoke the engine, and assemble the response payload. They stay framework-agnostic (no `req`/`res`).
- The calculation engine holds the entire cost model and is **pure** — no database, no HTTP, no I/O, no clock. Plain data in, plain data out.
- Parsers turn uploaded `.xlsx` buffers into typed rows plus warnings. They never write to the database themselves.
- Database access goes through the shared connection in `lib/db.ts`.

There is no repository layer and no ORM. Services issue SQL directly against the shared connection, and `services/ingest.service.ts` is the only place `snake_case` column names appear.

---

## Frontend Structure

```
Pages (pages/)
    │
Components (components/)
    │
Typed API client (lib/api.ts)
    │
Express API
```

Responsibilities

- Pages compose components and read filter state from the URL.
- Components render. They may format and sort — never calculate.
- All server calls go through the typed client in `lib/api.ts`, which centralises the base URL and `ApiError` handling. No raw `fetch` in a component.
- Every number displayed is computed by the backend engine. The frontend never re-derives a rate, a cost, or a margin.

---

## Data Flow

```
Upload (.xlsx)
    │
    ▼
POST /api/uploads/:type ──► Parser ──► Ingest service ──► SQLite
                                            │
                                    warnings returned to UI

GET /api/dashboard?year&month
    │
    ▼
Controller ──► Service ──► load rows + settings ──► Engine ──► JSON
```

Re-upload is transactional and month-scoped: an uploaded file is authoritative for
every `(year, month)` it contains, so those months are deleted and reinserted while
the rest of the year is left untouched.

---

## Design Principles

- Keep controllers thin.
- Business logic belongs in services; cost arithmetic belongs in the engine, not in services.
- Database access goes through the shared connection (`lib/db.ts`), not a
  repository layer.
- Because the engine takes plain data rather than reading storage itself, every
  calculation is reproducible from a fixture and testable in isolation. This is
  the seam that keeps the cost model reviewable.
- Missing data is `null`, never `0`, and propagates through the API to the UI
  rather than being silently defaulted.
- Filter state lives in the URL, so any view is reproducible from a link.
- Reuse existing implementations.
- Prefer composition over inheritance.
- Keep changes focused and maintainable.

---

## Correctness

The platform is designed around:

- A single source of truth for every cost formula
- An invariant that proves no double-counting: with overhead at zero, total cost equals total salaries exactly
- Parsers that degrade to warnings rather than exceptions on bad rows
- Re-upload that replaces only the months an upload contains
- A pure engine that can be verified from the command line without starting a server