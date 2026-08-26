import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UploadResult } from '@shared/types';

import UploadDropZone from '@/components/UploadDropZone';
import { ApiError } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, uploadSpreadsheet: vi.fn() };
});

const { uploadSpreadsheet } = await import('@/lib/api');
const upload = vi.mocked(uploadSpreadsheet);

const onUploaded = vi.fn();

function renderZone() {
  return render(
    <UploadDropZone
      type="timesheet"
      title="Timesheet"
      helperText="Replaces every month the file contains."
      onUploaded={onUploaded}
    />,
  );
}

function xlsx(name = 'timesheet-2025.xlsx'): File {
  return new File(['fake'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function result(overrides: Partial<UploadResult> = {}): UploadResult {
  return {
    type: 'timesheet',
    fileName: 'timesheet-2025.xlsx',
    rowsWritten: 562,
    monthsAffected: ['2025-01', '2025-02'],
    warnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  upload.mockReset();
  onUploaded.mockReset();
});

describe('choosing a file', () => {
  it('states the re-upload rule before anything is chosen', () => {
    renderZone();

    expect(screen.getByText(/replaces every month the file contains/i)).toBeDefined();
  });

  it('rejects a dropped .txt without making a request at all', async () => {
    // Drag-and-drop bypasses the input's `accept` attribute entirely, which is
    // the whole reason the component checks the extension itself.
    renderZone();

    fireEvent.drop(screen.getByText(/drop the file here/i).parentElement!, {
      dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });

    expect(upload).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a spreadsheet/i);
  });

  it('rejects a .txt chosen through the file picker too', async () => {
    // `accept` filters the picker in a real browser, and userEvent honours it —
    // so bypass it here to exercise the component's own guard.
    const user = userEvent.setup({ applyAccept: false });
    const { container } = renderZone();

    await user.upload(
      container.querySelector('input[type="file"]')!,
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    );

    expect(upload).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a spreadsheet/i);
  });

  it('uploads a spreadsheet that is dropped rather than browsed for', async () => {
    upload.mockResolvedValue(result());
    renderZone();

    fireEvent.drop(screen.getByText(/drop the file here/i).parentElement!, {
      dataTransfer: { files: [xlsx()] },
    });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith('timesheet', expect.any(File));
  });

  it('accepts .xls as well as .xlsx', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(result({ fileName: 'old.xls' }));
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx('old.xls'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });

  it('shows a pending state while the upload is in flight', async () => {
    const user = userEvent.setup();
    let settle: (value: UploadResult) => void = () => {};
    upload.mockReturnValue(
      new Promise<UploadResult>((resolve) => {
        settle = resolve;
      }),
    );
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    const button = await screen.findByRole('button');
    expect(button.textContent).toMatch(/uploading timesheet-2025\.xlsx/i);
    expect(button).toHaveProperty('disabled', true);

    settle(result());
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
  });
});

describe('after a successful upload', () => {
  it('reports the rows saved and the months replaced', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(result());
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    const panel = await screen.findByRole('status');
    expect(panel.textContent).toMatch(/562 rows saved/);
    expect(panel.textContent).toMatch(/2025-01, 2025-02/);
    expect(panel.textContent).toMatch(/every other month is untouched/i);
  });

  it('lists skipped rows with the spreadsheet row number', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(
      result({
        rowsWritten: 1,
        warnings: [
          {
            file: 'corrupt.xlsx',
            sheet: 'Timesheet',
            row: 3,
            message: 'Skipped: "-" is not a number of hours.',
          },
          {
            file: 'corrupt.xlsx',
            sheet: 'Timesheet',
            row: 5,
            message: 'Skipped: hours cannot be negative (-8).',
          },
        ],
      }),
    );
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    const panel = await screen.findByRole('status');
    expect(panel.textContent).toMatch(/2 rows skipped/i);
    expect(panel.textContent).toMatch(/Row 3: Skipped: "-" is not a number of hours/);
    expect(panel.textContent).toMatch(/Row 5: Skipped: hours cannot be negative/);
  });

  it('renders an em dash for a warning with no row number', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(
      result({ warnings: [{ file: 'x.xlsx', sheet: null, row: null, message: 'Something odd.' }] }),
    );
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    expect((await screen.findByRole('status')).textContent).toMatch(/Row —: Something odd\./);
  });

  it('tells the page to refresh its history', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(result());
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  });

  it('omits the months line for prices, which replace no period', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(result({ monthsAffected: [] }));
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    expect((await screen.findByRole('status')).textContent).not.toMatch(/replaced/i);
  });
});

describe('after a rejected upload', () => {
  it("shows the server's message and says nothing was written", async () => {
    const user = userEvent.setup();
    upload.mockRejectedValue(
      new ApiError(400, 'The workbook has no sheet named "Timesheet". It contains: "Salary".'),
    );
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx('salaries-2025.xlsx'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no sheet named "Timesheet"/);
    expect(alert.textContent).toMatch(/nothing was saved/i);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('does not promise that nothing was saved when the request never got an answer', async () => {
    // The server may have committed before the connection dropped. Claiming the
    // data is untouched would be a guess presented as a fact.
    const user = userEvent.setup();
    upload.mockRejectedValue(new TypeError('Failed to fetch'));
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not clear whether anything was saved/i);
    expect(alert.textContent).not.toMatch(/data you had before is untouched/i);
  });

  it('still promises nothing was saved when the server rejected it', async () => {
    const user = userEvent.setup();
    upload.mockRejectedValue(new ApiError(400, 'Not a timesheet.'));
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /data you had before is untouched/i,
    );
  });

  it('does not claim nothing was saved after a 500', async () => {
    const user = userEvent.setup();
    upload.mockRejectedValue(new ApiError(503, 'The database could not be read.'));
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    expect((await screen.findByRole('alert')).textContent).toMatch(/not clear whether/i);
  });

  it('says so plainly when a readable file yielded no rows', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(
      result({
        rowsWritten: 0,
        monthsAffected: [],
        warnings: [{ file: 'x.xlsx', sheet: 'Timesheet', row: 2, message: 'Skipped.' }],
      }),
    );
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    const panel = await screen.findByRole('status');
    expect(panel.textContent).toMatch(/no rows could be read/i);
    expect(panel.textContent).toMatch(/nothing changed/i);
    // Not dressed up as a success.
    expect(panel.className).toMatch(/warning/);
    expect(panel.className).not.toMatch(/positive/);
  });

  it('tells the user when what they dropped was not a file', async () => {
    renderZone();

    fireEvent.drop(screen.getByText(/drop the file here/i).parentElement!, {
      dataTransfer: { files: [] },
    });

    expect(upload).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toMatch(/was not a file/i);
  });

  it('falls back to a plain message when the failure is not an ApiError', async () => {
    const user = userEvent.setup();
    upload.mockRejectedValue(new Error('socket hang up'));
    const { container } = renderZone();

    await user.upload(container.querySelector('input[type="file"]')!, xlsx());

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /the upload could not be completed/i,
    );
  });
});
