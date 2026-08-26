# Cost Model

## Overview

This document is the single source of truth for every number the application
produces. The formulas come from the brief and are implemented verbatim in
`backend/src/calc/engine.ts`. Do not "improve" them.

The model answers one question — did a project make money — by working out what
an hour of a given person's time actually costs once the agency's unbillable
time and support staff are accounted for. A designer-hour is not
`salary ÷ hours`; it also carries a share of every meeting, every leave day, and
every colleague who never touches a client project.

---

## Formulas

```
direct cost rate / hour        salary(person, month)
  (per person, per month)  =   ─────────────────────────────
                               total hours logged(person, month)

indirect cost pool         =   Σ salaries of people who logged no hours that month
  (per month)                + Σ (non-billable hours × that person's direct rate)
                             + monthly overhead entered by the user

indirect cost rate / hour      indirect cost pool(month)
  (per month)              =   ─────────────────────────
                               billable hours(month)

employee cost on a project =   hours × (direct rate + indirect rate)

employee revenue share     =   project price × (employee hours ÷ total project hours)

                               revenue share − employee cost
employee profitability     =   ─────────────────────────────
                               revenue share

                               project price − total project cost
project profitability      =   ──────────────────────────────────
                               project price

                               billable hours
productivity               =   ──────────────
                               total hours logged
```

Rates are computed **per person, per month**. Salaries change mid-year — several
employees take a raise in July — so a rate must never be averaged across the
year, and a project spanning several months is costed with each month's own rates.

---

## The Invariant

> With overhead set to zero, company-wide total cost equals total salaries — to
> the dirham.

This is the brief's own self-check and the guardrail against double-counting.
`npm run selfcheck` enforces it and exits non-zero on failure.

**Verified figure on the sample data: AED 2,400,000.00 for 2025.** It holds for
each individual month as well as the annual total.

### Why it holds

Every dirham of salary lands in exactly one bucket:

| Bucket                                      | Where it goes                                              |
| ------------------------------------------- | ---------------------------------------------------------- |
| Billable hours of a person who logged hours | Carried by their direct rate, charged to a project         |
| Non-billable hours of that same person      | Valued at their direct rate, pushed into the indirect pool |
| Whole salary of a person who logged nothing | Pushed into the indirect pool                              |

The pool is then redistributed across billable hours as the indirect rate.
Nothing is counted twice and nothing is dropped, so the three buckets sum back to
total salaries.

If you change how any bucket is populated, re-derive this on paper before
writing code.

### The trap

**Total period cost is salaries-in-period plus overhead-in-period — never the sum
of project costs.**

Summing project costs double-counts. A project's cost already includes a share of
the indirect pool through the indirect rate, and the indirect pool already
contains the value of non-billable time. Adding project costs to non-billable
costs charges the same hours twice, and the totals drift away from payroll in a
way that is difficult to spot because the number still looks plausible.

The implementation computes the period total directly from salaries, which makes
the invariant hold by construction rather than by luck.

---

## Worked Example — January 2025

Real figures from `sample-data/`, reproducible with `npm run selfcheck`.

**Inputs for the month**

| Quantity                   | Value          |
| -------------------------- | -------------- |
| Total salaries             | AED 197,000.00 |
| Total hours logged         | 1,634.6        |
| Billable hours             | 1,283.5        |
| Non-billable hours         | 351.1          |
| People who logged no hours | none           |
| Overhead                   | 0              |

**One person's direct rate — Ayesha Rahman**

```
salary                18,000.00
total hours logged    176.0        (135.9 billable + 40.1 non-billable)

direct rate = 18,000.00 ÷ 176.0 = 102.2727 / hour
```

**The month's indirect rate**

```
support staff salaries                      0.00
non-billable time valued at direct rate    72,612.93
overhead                                    0.00
                                          ──────────
indirect pool                              72,612.93

indirect rate = 72,612.93 ÷ 1,283.5 = 56.5742 / hour
```

**Ayesha's fully-loaded cost on project work in January**

```
135.9 hours × (102.2727 + 56.5742) = 135.9 × 158.8469 = 21,587.29
```

**Reconciliation**

Every person's billable hours × direct rate, plus the indirect pool, equals
AED 197,000.00 — January's payroll exactly.

The indirect rate varies month to month with the mix of billable and internal
work. Across 2025 it ranges from **48.44** (November) to **66.87** (June), which
is why rates are never averaged.

---

## What the Model Reveals

Running the full year over the sample data produces a result worth knowing about
before building the UI: **three of the eleven projects lose money**, and all three
are the small non-project engagements.

| Ref code  | Category     | Price   | Hours   | Cost    | Margin  |
| --------- | ------------ | ------- | ------- | ------- | ------- |
| E2025050a | Enhancements | 92,000  | 1,225.2 | 195,062 | −112.0% |
| H2025060c | Hosting      | 46,000  | 644.2   | 96,080  | −108.9% |
| E2025055b | Enhancements | 104,000 | 855.3   | 129,854 | −24.9%  |
| Q2025021e | Projects     | 250,000 | 1,325.5 | 218,659 | +12.5%  |
| Q2025009b | Projects     | 330,000 | 1,842.6 | 283,113 | +14.2%  |
| Q2025001a | Projects     | 560,000 | 3,025.2 | 468,776 | +16.3%  |
| Q2025033g | Projects     | 300,000 | 1,148.3 | 177,242 | +40.9%  |
| Q2025004c | Projects     | 900,000 | 1,808.7 | 294,322 | +67.3%  |
| Q2025014d | Projects     | 690,000 | 1,304.3 | 203,009 | +70.6%  |
| Q2025041h | Projects     | 760,000 | 1,096.8 | 176,503 | +76.8%  |
| Q2025027f | Projects     | 980,000 | 989.5   | 157,380 | +83.9%  |

This is the answer the tool exists to give, so the Projects page sorts
loss-making work first by default. A dashboard that buries these three below
eight profitable rows has failed at its job.

---

## Edge Cases

| Situation                                 | Behaviour                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Person logs hours but has no salary row   | `salary` is `null`, direct rate is `0`, and the person is surfaced in `missingSalaryEmployees`. Never costed at zero silently. |
| Person has a salary but logged zero hours | Flagged `isSupportStaff`; their whole salary enters that month's indirect pool.                                                |
| Ref code has hours but no price row       | `projectPrice`, `profit`, `marginPct` and every `revenueShare` are `null`, and the ref code is surfaced in `unpricedRefCodes`. |
| Month has zero billable hours             | Indirect rate is `0` rather than `Infinity`. The pool still counts toward total cost.                                          |
| Person logs zero total hours in a month   | Direct rate is `0` rather than `NaN`.                                                                                          |
| Project price is zero                     | Margin is `null`, not a division by zero.                                                                                      |

Every division in the engine is guarded. No path may produce `NaN` or `Infinity`.

**A note on test coverage:** the sample data contains no support-staff months —
all twelve employees log hours in all twelve months. Two of them (Hana Yousef
and Omar Zayed, both Management/IDL) log only non-billable time, giving 0%
productivity, but that is a different branch from the zero-hour case. The
support-staff path is therefore exercised only by synthetic fixtures in
`calc/engine.test.ts`. Keep those fixtures — real data does not cover this.

---

## Configuration

Two things are user-configurable without a code change, via the Settings page:

- **Billable categories.** Default `Projects`, `Enhancements`, `Hosting`. Everything
  else is internal time absorbed into the indirect pool. Billability is never
  inferred from a name prefix — `Tentwenty` is internal product work and carries no
  `FC - ` prefix.
- **Monthly overhead.** Entered per `YYYY-MM` rather than as one annual figure,
  because overhead genuinely varies month to month. Default `0`.

Non-zero overhead intentionally breaks the `cost == salaries` check, because
overhead is real cost that isn't salary. `npm run selfcheck` forces overhead to
zero regardless of saved settings so the invariant remains testable.

---

## Revenue Recognition

The brief specifies how to cost a project but not when to recognise its revenue.
This is a documented judgement call.

A project's price is attributed to the periods in which its billable hours were
logged, **pro-rata by hours**, rather than booked entirely in its sales month:

```
revenue in period = price × (billable hours in period ÷ billable hours all-time)
```

Booking the whole price in the sales month would make any month filter show a
month's full cost against either all of a project's revenue or none of it — a
January view would report a large profit and February a large loss on the same
piece of work. Pro-rata attribution keeps cost and revenue in the same period.

Full-year and all-time figures are identical under either approach; only the
month view differs.
