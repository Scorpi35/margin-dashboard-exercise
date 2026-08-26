import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { UploadHistoryEntry } from '@shared/types';

import UploadHistoryTable from '@/components/UploadHistoryTable';

function entry(overrides: Partial<UploadHistoryEntry> = {}): UploadHistoryEntry {
  return {
    id: 1,
    type: 'timesheet',
    fileName: 'timesheet-2025.xlsx',
    uploadedAt: '2026-08-26T10:15:00.000Z',
    rowCount: 562,
    warningCount: 0,
    months: ['2025-01', '2025-02'],
    ...overrides,
  };
}

describe('UploadHistoryTable', () => {
  it('explains the empty state rather than showing an empty table', () => {
    render(<UploadHistoryTable entries={[]} />);

    expect(screen.getByText(/nothing uploaded yet/i)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a row per upload with its counts', () => {
    render(<UploadHistoryTable entries={[entry()]} />);

    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('timesheet-2025.xlsx')).toBeDefined();
    expect(within(row).getByText('Timesheet')).toBeDefined();
    expect(within(row).getByText('562')).toBeDefined();
    expect(within(row).getByText('2025-01, 2025-02')).toBeDefined();
  });

  it('keeps the order it is given, which is newest first', () => {
    render(
      <UploadHistoryTable
        entries={[
          entry({ id: 3, fileName: 'newest.xlsx' }),
          entry({ id: 2, fileName: 'middle.xlsx' }),
          entry({ id: 1, fileName: 'oldest.xlsx' }),
        ]}
      />,
    );

    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.children[1].textContent);
    expect(names).toEqual(['newest.xlsx', 'middle.xlsx', 'oldest.xlsx']);
  });

  it('draws attention to an upload that skipped rows', () => {
    render(<UploadHistoryTable entries={[entry({ warningCount: 3 })]} />);

    const skipped = screen.getByText('3');
    expect(skipped.className).toMatch(/text-warning/);
  });

  it('renders an em dash for prices, which replace no period', () => {
    render(<UploadHistoryTable entries={[entry({ type: 'projects', months: [] })]} />);

    expect(screen.getByText('—')).toBeDefined();
    expect(screen.getByText('Project prices')).toBeDefined();
  });

  it('right-aligns the numeric columns with tabular figures', () => {
    // Columns of numbers that do not line up read as amateur.
    render(<UploadHistoryTable entries={[entry()]} />);

    const row = screen.getAllByRole('row')[1];
    for (const cell of [row.children[3], row.children[4]]) {
      expect(cell.className).toMatch(/tabular/);
      expect(cell.className).toMatch(/text-right/);
    }
  });

  it('survives a timestamp it cannot read', () => {
    render(<UploadHistoryTable entries={[entry({ uploadedAt: 'not a date' })]} />);

    expect(screen.getAllByRole('row')[1].children[0].textContent).toBe('—');
  });
});
