# Data Sources

## Overview

Three `.xlsx` files, one year of data, in the exact shape the agency keeps them.
They are committed to `sample-data/` so the app can be seeded in one command.

Read this before touching a parser. The files disagree with each other in small
ways that are easy to miss and expensive to get wrong: the header is not always
in row 1, the same month is written three different ways, and the sheet that
carries salaries has no year on it at all.

| File | Grain | Rows | Join key |
|---|---|---|---|
| `timesheet-2025.xlsx` | One row per person, per task, per month | 562 | `Ref Code` |
| `salaries-2025.xlsx` | One row per person, one column per month | 12 (→ 144 unpivoted) | `Employee No.` |
| `project-prices-2025.xlsx` | One row per project | 11 | `Ref Code` |

`Ref Code` joins a timesheet row to a project price. `Employee No.` joins a
timesheet row to a salary.

---

## Timesheet

`sample-data/timesheet-2025.xlsx` · sheet `Timesheet` · header in **row 1** · 562 data rows

| Column | Notes |
|---|---|
| `Month` | `"January 2025"` — full month name, four-digit year |
| `Employee No.` | String, not a number. Note the leading zeros: `"10201"` for delivery staff, `"00101"` for management |
| `Employee Name` | Includes an apostrophe in one case (`Kevin D'Souza`) |
| `Type of Expense` | `DL` or `IDL` |
| `Department` | `Design`, `Frontend`, `Backend`, `App`, `QA`, `Management` |
| `Designation` | Twelve values, e.g. `Senior UI/UX Designer`, `Team Lead - Design`, `Operations Lead` |
| `Category` | Eleven values — see below |
| `Ref Code` | A project code for billable rows; **the category name repeated** for non-billable rows |
| `Project (Billable) / Task (Unbillable) Name` | Long header — match on substring, not exact text |
| `Company Name (Billable) / Fixed Costs (Unbillable)` | Client name, or the literal `Fixed Costs` |
| `Description` | Free text |
| `Hours` | Mixed `int` and `float` in the source cells |

### Categories

Eleven distinct values. Three are billable; the rest are internal time the agency
absorbs.

| Category | Billable | Hours (2025) |
|---|---|---|
| `Projects` | yes | 12,540.9 |
| `Enhancements` | yes | 2,080.5 |
| `Hosting` | yes | 644.2 |
| `FC - Meetings` | no | 2,180.4 |
| `FC - Leaves` | no | 1,176.0 |
| `FC - Others` | no | 300.8 |
| `FC - SEO/Marketing` | no | 224.3 |
| `FC - Idle` | no | 195.9 |
| `FC - Bug Fixes` | no | 178.5 |
| `FC - Learning` | no | 155.0 |
| `Tentwenty` | no | 138.7 |

**`Tentwenty` is the trap.** It is internal product work — non-billable — but it
carries no `FC - ` prefix. Any code that decides billability by testing for that
prefix will silently treat 138.7 hours of internal time as revenue-generating,
inflating billable hours and deflating the indirect rate. Billability comes from
`settings.billableCategories`, never from a string prefix.

---

## Salary Overview

`sample-data/salaries-2025.xlsx` · sheet `Salary` · header in **row 2** · 12 employees

This file is **wide**: one row per employee, one column per month.

```
Row 1:  [blank] | "Salary Overview 2025 (AED)" | ...
Row 2:  Employee No. | Employee Name | January | February | ... | December
Row 3:  10201 | Ayesha Rahman | 18000 | 18000 | ... | 18500
```

Three things to handle:

**The header is in row 2.** A title row sits above it. This is why
`findHeaderRow` exists — it scores the first N rows by how many expected column
names they contain rather than assuming row 1.

**There is no year on the rows.** The year is inferred from a `20\d\d` match in
the title row, falling back to the filename. If neither yields a year the parser
throws rather than guessing — a salary sheet filed under the wrong year is worse
than a failed import.

**Salaries change mid-year.** Everyone takes a raise in July. Ayesha Rahman goes
from 18,000 to 18,500; Omar Zayed from 25,000 to 25,500. Salary is genuinely
per-month and must never be averaged across the year.

The parser unpivots twelve rows × twelve month columns into 144 `SalaryRow`
records. Total 2025 payroll: **AED 2,400,000.00** — the figure the invariant
reconciles against.

### Employees

| Employee No. | Name | Department | Jan salary |
|---|---|---|---|
| 10201 | Ayesha Rahman | Design | 18,000 |
| 10202 | Rohit Menon | Design | 12,000 |
| 10203 | Lina Haddad | Design | 22,000 |
| 10204 | Tariq Aziz | Frontend | 17,000 |
| 10205 | Grace Fernandes | Frontend | 11,000 |
| 10206 | Imran Sheikh | Backend | 19,000 |
| 10207 | Nadia Kapoor | Backend | 12,500 |
| 10208 | Kevin D'Souza | App | 15,000 |
| 10209 | Sara Al Marzooqi | QA | 9,500 |
| 10210 | Vikram Nair | Backend | 16,000 |
| 00101 | Hana Yousef | Management | 20,000 |
| 00102 | Omar Zayed | Management | 25,000 |

The two management employees are `IDL` and log **only** non-billable time — 0%
productivity for the year. They are not "support staff" in the model's sense,
because they do log hours; their time flows into the indirect pool via the
non-billable branch rather than the zero-hour branch.

---

## Project Prices

`sample-data/project-prices-2025.xlsx` · sheet `Projects` · header in **row 1** · 11 rows

| Column | Notes |
|---|---|
| `Ref Code` | `Q…` projects, `E…` enhancements, `H…` hosting |
| `Project (Billable) Name` | A raw filename, e.g. `Meridian-Website-UIUXdesign-Development-14012025-COMMERCIAL.pdf` |
| `Project Price` | AED |
| `Sales month` | **`"January '25"`** — a different format from the timesheet |
| `Category` | `Projects`, `Enhancements`, `Hosting` |
| `Status` | `in progress` or `completed`, lowercase |

**The sales month format differs from the timesheet's.** `"January '25"` versus
`"January 2025"`. Both must resolve to the same `{ year, month }`, which is why
all date handling funnels through `parse/dates.ts`.

Project names are filenames, not display names. They are long and will overflow a
narrow column — the UI truncates rather than wrapping, with the ref code shown
beneath as a stable identifier.

---

## Date Formats

Three formats appear across the three files. A fourth is handled defensively
because Excel produces it whenever a cell is accidentally formatted as a date.

| Format | Where | Example |
|---|---|---|
| `Month YYYY` | Timesheet | `January 2025` |
| `Month 'YY` | Project prices | `January '25` |
| Bare month name | Salary column headers | `January` (year comes from the title row) |
| Excel serial number | Defensive | `45658` → 2025-01-01 |

`parse/dates.ts` is the only place any of these is interpreted. It throws on
anything unrecognised or empty rather than defaulting, because a silently wrong
month misfiles both cost and revenue.

---

## Known Gaps and Messiness

The brief warns the data is "real-world messy": dashes for blank cells, headers
off row 1, inconsistent dates. **The supplied sample is cleaner than that
description.**

| Expected problem | Present in the sample? |
|---|---|
| Header not in row 1 | Yes — salary sheet, row 2 |
| Inconsistent date formats | Yes — three of them |
| Blank cells written as `-` | **No** — zero occurrences |
| Ref codes with hours but no price | **No** — all 11 match |
| People with hours but no salary row | **No** — all 12 match |
| Negative or non-numeric hours | **No** |
| Duplicate ref codes | **No** |

The parsers handle every row in this sample without a single warning. The
remaining cases are still implemented and tested — with synthetic fixtures rather
than real data, since the sample does not exercise them.

**This is a documented assumption, not an oversight.** The brief explicitly says
how gaps are surfaced is part of what's being assessed, so the missing-salary and
unpriced-ref-code paths are built, tested, and visible in the UI even though the
supplied data never triggers them. Do not delete those paths because "the data is
clean" — the next month's upload may not be.

---

## Verifying an Ingest

```bash
npm run seed        # expect 562 / 144 / 11 rows, 0 warnings
npm run selfcheck   # expect 2025 PASS, cost == salaries == AED 2,400,000.00
```

If row counts differ, a parser is silently skipping rows — check the warnings
output before anything else.