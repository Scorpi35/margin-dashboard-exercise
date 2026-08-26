import type { YearMonthKey } from '@shared/types';

import { formatMonthKey } from '@/lib/format';
import { parseOverheadAmount } from '@/lib/overhead';

/**
 * Overhead per month, entered as text.
 *
 * Per month rather than as one annual figure because overhead genuinely varies —
 * and because a year-shaped input would have to be divided by twelve somewhere,
 * which is arithmetic this page has no business doing.
 */

interface MonthlyOverheadTableProps {
  /** Fixed for the life of the page, so clearing a field cannot remove its row. */
  readonly months: readonly YearMonthKey[];
  /** The raw text of each field, keyed by month. */
  readonly values: Readonly<Record<YearMonthKey, string>>;
  readonly onChange: (values: Record<YearMonthKey, string>) => void;
}

export default function MonthlyOverheadTable({
  months,
  values,
  onChange,
}: MonthlyOverheadTableProps) {
  if (months.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        No months yet — upload a timesheet or a salary sheet and they will appear here.
      </p>
    );
  }

  const [firstMonth] = months;

  const copyFirstToAll = () => {
    onChange(Object.fromEntries(months.map((month) => [month, values[firstMonth] ?? ''])));
  };

  return (
    <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-line text-ink-muted border-b text-left">
            <th scope="col" className="px-4 py-2 font-medium">
              Month
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Overhead (AED)
            </th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => {
            const text = values[month] ?? '';
            const invalid = parseOverheadAmount(text) === null;

            return (
              <tr key={month} className="border-line border-b last:border-b-0 align-top">
                <td className="text-ink px-4 py-2 whitespace-nowrap">{formatMonthKey(month)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={text}
                      aria-label={`Overhead for ${formatMonthKey(month)}`}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? `${month}-error` : undefined}
                      placeholder="0"
                      onChange={(event) => onChange({ ...values, [month]: event.target.value })}
                      className={[
                        'tabular bg-paper text-ink w-32 rounded-md border px-2 py-1 text-right text-sm',
                        invalid ? 'border-negative' : 'border-line-strong',
                      ].join(' ')}
                    />
                    {month === firstMonth && months.length > 1 && (
                      <button
                        type="button"
                        onClick={copyFirstToAll}
                        className="border-line-strong bg-paper-raised text-ink hover:bg-paper-sunken rounded-md border px-2 py-1 text-xs whitespace-nowrap"
                      >
                        Copy to all months
                      </button>
                    )}
                  </div>

                  {invalid && (
                    <p
                      id={`${month}-error`}
                      role="alert"
                      className="text-negative mt-1 text-right text-xs"
                    >
                      Enter an amount in dirhams, such as 12000 or 12,000.50. Leave it blank for no
                      overhead.
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
