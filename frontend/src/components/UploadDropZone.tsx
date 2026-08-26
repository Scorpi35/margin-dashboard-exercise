import { useId, useRef, useState } from 'react';

import type { UploadResult, UploadType } from '@shared/types';

import { ApiError, uploadSpreadsheet } from '@/lib/api';

/**
 * One labelled target per source spreadsheet.
 *
 * The extension is checked here as well as on the server. Not for security — the
 * server rejects on the file's own signature — but so that dropping the wrong
 * thing answers instantly instead of after a round trip.
 */

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];

interface UploadDropZoneProps {
  readonly type: UploadType;
  readonly title: string;
  /** What this file is authoritative for, in the user's terms. */
  readonly helperText: string;
  readonly onUploaded: () => void;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading'; readonly fileName: string }
  | { readonly kind: 'done'; readonly result: UploadResult }
  | {
      readonly kind: 'failed';
      readonly message: string;
      /**
       * Whether the server is known to have rejected this before writing.
       * A request that never got an answer proves nothing either way.
       */
      readonly rejected: boolean;
    };

export default function UploadDropZone({
  type,
  title,
  helperText,
  onUploaded,
}: UploadDropZoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [isDragging, setIsDragging] = useState(false);

  const busy = status.kind === 'uploading';

  async function send(file: File) {
    if (!hasAcceptedExtension(file.name)) {
      setStatus({
        kind: 'failed',
        rejected: true,
        message: `"${file.name}" is not a spreadsheet. Choose an .xlsx or .xls file.`,
      });
      return;
    }

    setStatus({ kind: 'uploading', fileName: file.name });

    try {
      const result = await uploadSpreadsheet(type, file);
      setStatus({ kind: 'done', result });
      onUploaded();
    } catch (err) {
      // Only a 4xx proves the server rejected this before writing. A request that
      // never got an answer proves nothing either way.
      const rejected = err instanceof ApiError && err.statusCode >= 400 && err.statusCode < 500;

      setStatus({
        kind: 'failed',
        rejected,
        message: err instanceof ApiError ? err.message : 'The upload could not be completed.',
      });
    }
  }

  return (
    <section className="border-line bg-paper-raised rounded-lg border p-5">
      <h2 className="text-ink text-sm font-semibold">{title}</h2>
      <p className="text-ink-muted mt-1 text-xs">{helperText}</p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (busy) return;

          const [file] = Array.from(event.dataTransfer.files);
          if (file === undefined) {
            setStatus({
              kind: 'failed',
              rejected: true,
              message: 'That was not a file. Drop a single .xlsx or .xls spreadsheet.',
            });
            return;
          }

          void send(file);
        }}
        className={[
          'mt-4 rounded-md border border-dashed p-6 text-center transition-colors',
          isDragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-paper',
        ].join(' ')}
      >
        <label htmlFor={inputId} className="text-ink-muted block text-xs">
          Drop the file here, or
        </label>

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            const [file] = Array.from(event.target.files ?? []);
            if (file !== undefined) void send(file);
            // Let the same file be chosen twice in a row after a correction.
            event.target.value = '';
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="border-line-strong bg-paper-raised text-ink hover:bg-paper-sunken mt-2 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? `Uploading ${status.fileName}…` : 'Browse'}
        </button>
      </div>

      <UploadOutcome status={status} />
    </section>
  );
}

function UploadOutcome({ status }: { readonly status: Status }) {
  if (status.kind === 'failed') {
    return (
      <div
        role="alert"
        className="border-negative bg-negative-soft mt-4 rounded-md border p-3 text-xs"
      >
        <p className="text-negative font-medium">{status.message}</p>
        <p className="text-ink-muted mt-1">
          {status.rejected
            ? 'Nothing was saved — the data you had before is untouched.'
            : 'It is not clear whether anything was saved. Check the upload history below.'}
        </p>
      </div>
    );
  }

  if (status.kind !== 'done') return null;

  const { result } = status;
  // Every row was skipped. The file was readable, so this is not an error — but
  // it is not a success either, and green would say the opposite of what happened.
  const savedNothing = result.rowsWritten === 0;

  return (
    <div
      role="status"
      className={[
        'mt-4 rounded-md border p-3 text-xs',
        savedNothing ? 'border-warning bg-warning-soft' : 'border-positive bg-positive-soft',
      ].join(' ')}
    >
      <p className={savedNothing ? 'text-warning font-medium' : 'text-positive font-medium'}>
        {savedNothing
          ? `No rows could be read from ${result.fileName}, so nothing changed.`
          : `${result.rowsWritten.toLocaleString()} rows saved from ${result.fileName}.`}
      </p>

      {result.monthsAffected.length > 0 && (
        <p className="text-ink-muted mt-1">
          Replaced {result.monthsAffected.length === 1 ? 'month' : 'months'}:{' '}
          {result.monthsAffected.join(', ')}. Every other month is untouched.
        </p>
      )}

      {result.warnings.length > 0 && (
        <details className="mt-2" open>
          <summary className="text-warning cursor-pointer font-medium">
            {result.warnings.length} row{result.warnings.length === 1 ? '' : 's'} skipped
          </summary>
          <ul className="text-ink-muted mt-1 space-y-0.5">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.row ?? 'x'}-${index}`}>
                Row {warning.row ?? '—'}: {warning.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function hasAcceptedExtension(fileName: string): boolean {
  const name = fileName.toLowerCase();

  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}
