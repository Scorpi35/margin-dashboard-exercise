import { useCallback, useEffect, useRef, useState } from 'react';

import type { UploadHistoryEntry, UploadType } from '@shared/types';

import UploadDropZone from '@/components/UploadDropZone';
import UploadHistoryTable from '@/components/UploadHistoryTable';
import { ApiError, getUploadHistory } from '@/lib/api';

interface Slot {
  readonly type: UploadType;
  readonly title: string;
  readonly helperText: string;
}

const SLOTS: readonly Slot[] = [
  {
    type: 'timesheet',
    title: 'Timesheet',
    helperText:
      'Hours per person, per task, per month. Replaces every month the file contains and leaves the rest of the year alone.',
  },
  {
    type: 'salary',
    title: 'Salary sheet',
    helperText:
      'One row per employee, one column per month. Replaces every month the file contains — a mid-year raise stays where it belongs.',
  },
  {
    type: 'projects',
    title: 'Project prices',
    helperText:
      'One row per project. Matched by ref code and updated in place; projects missing from the file are kept, not deleted.',
  },
];

export default function UploadPage() {
  const [history, setHistory] = useState<readonly UploadHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  /**
   * Only the newest request is allowed to write to state.
   *
   * Two uploads finishing close together each trigger a refresh, and there is no
   * guarantee they resolve in the order they were sent — without this the older
   * response can land last and put stale rows on screen. It doubles as the
   * unmount guard.
   */
  const latestRequest = useRef(0);

  const refreshHistory = useCallback(() => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    getUploadHistory()
      .then((entries) => {
        if (latestRequest.current !== requestId) return;
        setHistory(entries);
        setHistoryError(null);
      })
      .catch((err: unknown) => {
        if (latestRequest.current !== requestId) return;
        setHistoryError(
          err instanceof ApiError ? err.message : 'Could not load the upload history.',
        );
      });
  }, []);

  useEffect(() => {
    refreshHistory();

    // Stop a response that arrives after unmount from writing to state.
    return () => {
      latestRequest.current += 1;
    };
  }, [refreshHistory]);

  return (
    <section>
      <h1 className="text-ink text-xl font-semibold">Upload</h1>
      <p className="text-ink-muted mt-1 text-sm">
        The three source spreadsheets. A file is authoritative for the months it contains and for no
        others, so a corrected month can be re-uploaded on its own.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {SLOTS.map((slot) => (
          <UploadDropZone
            key={slot.type}
            type={slot.type}
            title={slot.title}
            helperText={slot.helperText}
            onUploaded={refreshHistory}
          />
        ))}
      </div>

      <h2 className="text-ink mt-10 text-sm font-semibold">Upload history</h2>
      <p className="text-ink-muted mt-1 mb-3 text-xs">
        Files that were saved. A rejected file leaves no trace, because nothing was written.
      </p>

      {historyError === null ? (
        <UploadHistoryTable entries={history} />
      ) : (
        <p role="alert" className="text-negative text-sm">
          {historyError}
        </p>
      )}
    </section>
  );
}
