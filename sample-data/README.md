# sample-data

The three source spreadsheets belong here, committed, so the app can be seeded
in one command. See [`../docs/data-sources.md`](../docs/data-sources.md) for the
shape and quirks of each.

| File                       | Sheet       | Header row | Rows                |
| -------------------------- | ----------- | ---------- | ------------------- |
| `timesheet-2025.xlsx`      | `Timesheet` | 1          | 562                 |
| `salaries-2025.xlsx`       | `Salary`    | 2          | 12 (unpivot to 144) |
| `project-prices-2025.xlsx` | `Projects`  | 1          | 11                  |

These files are the fixture the reconciliation invariant is verified against —
total 2025 payroll of AED 2,400,000.00. Replacing them changes what
`npm run selfcheck` asserts, so treat them as committed test data rather than
scratch input.
