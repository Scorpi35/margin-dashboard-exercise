import type { MonthNumber } from '@shared/types';

import { monthName } from '@/lib/format';

/** The year and month selects. Every filtered page shares this control. */

const MONTHS: readonly MonthNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface PeriodFilterProps {
  readonly years: readonly number[];
  readonly year: number;
  readonly month: MonthNumber | null;
  readonly onChange: (year: number, month: MonthNumber | null) => void;
}

export default function PeriodFilter({ years, year, month, onChange }: PeriodFilterProps) {
  // A link can name a year that has no data. Offering it keeps the control, the
  // period label and the figures on screen agreeing with each other — a select
  // silently showing a different year than the page is reporting on is worse
  // than an option marked as empty.
  const options = years.includes(year) ? years : [...years, year].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">Year</span>
        <select
          value={year}
          onChange={(event) => onChange(Number(event.target.value), month)}
          className="border-line-strong bg-paper-raised text-ink rounded-md border px-3 py-1.5 text-sm"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
              {years.includes(option) ? '' : ' (no data)'}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">Month</span>
        <select
          value={month ?? ''}
          onChange={(event) =>
            onChange(
              year,
              event.target.value === '' ? null : (Number(event.target.value) as MonthNumber),
            )
          }
          className="border-line-strong bg-paper-raised text-ink rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="">All months</option>
          {MONTHS.map((option) => (
            <option key={option} value={option}>
              {monthName(option)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
