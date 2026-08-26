# Margin Dashboard

## Overview

Before making changes, understand the existing implementation and follow the documented architecture and engineering conventions.

The cost model reconciles exactly: with overhead set to zero, company-wide total
cost equals total salaries to the dirham. `npm run selfcheck` enforces this. A
change that breaks it is wrong — never adjust the assertion to make it pass.

---

## Documentation

Read the relevant documentation before implementing features.

| Document                  | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| docs/architecture.md      | Overall system architecture                    |
| docs/cost-model.md        | Cost formulas and the reconciliation invariant |
| docs/data-sources.md      | Shape and quirks of the three source spreadsheets |
| docs/coding-guidelines.md | Coding guidelines                              |
| docs/engineering-logs.md  | Engineering logs                               |
| docs/roadmap.md           | Product roadmap                                |

`docs/review.md` holds the code review procedure and rules. Read it when asked
to review changes — not as part of ordinary feature work.

---

## Implementation Workflow

When implementing a feature:

1. Read the GitHub Issue.
2. Search the existing codebase.
3. Produce an implementation plan.
4. Wait for approval before implementation.
5. Run `npm run typecheck`, `npm run lint`, the relevant tests, and `npm run selfcheck` before finishing.

---

## General Rules

- Reuse existing code whenever possible.
- Formatting is Prettier's (`.prettierrc.json`); the post-edit hook applies it
  automatically. Never hand-format, and never reformat files a change doesn't touch.
- Follow existing project conventions.
- Keep changes focused and minimal.
- Keep `backend/src/calc/` pure — no database, no `req`/`res`, no I/O. Services orchestrate and invoke the engine; they never contain cost arithmetic.
- Missing values are `null`, never `0`, from the parser through `shared/` to the rendered cell — and the UI must say why a value is absent.
- There is no authentication and no user scoping. This is a single-user local tool; do not add auth middleware or `userId` columns unless the brief changes.
- Do not commit, push, or create a PR unless explicitly asked.
- Ask questions if requirements are unclear.
- After a change has been committed, update `docs/engineering-logs.md` if the change introduces a significant feature, architectural change, migration, or engineering decision.