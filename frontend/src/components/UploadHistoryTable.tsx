import type { UploadHistoryEntry } from '@shared/types';

/** Every upload that was written, newest first. Rejected files leave no trace. */

const TYPE_LABELS: Record<UploadHistoryEntry['type'], string> = {
  timesheet: 'Timesheet',
  salary: 'Salary sheet',
  projects: 'Project prices',
};

interface UploadHistoryTableProps {
  readonly entries: readonly UploadHistoryEntry[];
}

export default function UploadHistoryTable({ entries }: UploadHistoryTableProps) {
  if (entries.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        Nothing uploaded yet. Files you upload will be listed here.
      </p>
    );
  }

  return (
    <div className="border-line bg-paper-raised overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-line text-ink-muted border-b text-left">
            <th scope="col" className="px-4 py-2 font-medium">
              When
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              File
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Rows
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Skipped
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Months replaced
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-line border-b last:border-b-0">
              <td className="text-ink-muted px-4 py-2 whitespace-nowrap">
                {formatTimestamp(entry.uploadedAt)}
              </td>
              <td className="text-ink max-w-[16rem] truncate px-4 py-2" title={entry.fileName}>
                {entry.fileName}
              </td>
              <td className="text-ink-muted px-4 py-2 whitespace-nowrap">
                {TYPE_LABELS[entry.type]}
              </td>
              <td className="tabular text-ink px-4 py-2 text-right">
                {entry.rowCount.toLocaleString()}
              </td>
              <td
                className={[
                  'tabular px-4 py-2 text-right',
                  entry.warningCount > 0 ? 'text-warning font-medium' : 'text-ink-muted',
                ].join(' ')}
              >
                {entry.warningCount.toLocaleString()}
              </td>
              <td className="text-ink-muted px-4 py-2">
                {/* Prices are keyed by ref code, so they replace no period. */}
                {entry.months.length === 0 ? '—' : entry.months.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The server sends UTC; show it in the reader's own zone.
 *
 * Not a date being *parsed* out of a spreadsheet — that belongs in
 * `parse/dates.ts` and nowhere else. This is an ISO timestamp the API produced,
 * formatted for display.
 */
function formatTimestamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return '—';

  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
