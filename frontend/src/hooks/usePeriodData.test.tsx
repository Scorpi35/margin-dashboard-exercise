import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppMeta } from '@shared/types';

import { usePeriodData } from '@/hooks/usePeriodData';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getMeta: vi.fn() };
});

const { ApiError, getMeta } = await import('@/lib/api');
const meta = vi.mocked(getMeta);

const load = vi.fn<(year: number, month: number | null) => Promise<string>>();

function Probe() {
  const period = usePeriodData(load, 'Could not load it.');
  const location = useLocation();

  return (
    <>
      <span data-testid="url">{location.search}</span>
      <span data-testid="year">{String(period.year)}</span>
      <span data-testid="data">{period.data ?? 'none'}</span>
      <span data-testid="error">{period.error ?? 'none'}</span>
      <span data-testid="years">{period.years.join(',')}</span>
      <button onClick={() => period.setPeriod(2024, 5)}>choose</button>
    </>
  );
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  meta.mockReset();
  load.mockReset();
  meta.mockResolvedValue({
    years: [2024, 2025],
    categories: [],
    settings: { billableCategories: [], monthlyOverhead: {} },
  } as AppMeta);
  load.mockResolvedValue('loaded');
});

describe('resolving the period', () => {
  it('adopts the most recent year with data and writes it to the URL', async () => {
    renderAt('/');

    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('?year=2025'));
    expect(load).toHaveBeenCalledWith(2025, null);
  });

  it('uses the period the URL already carries', async () => {
    renderAt('/?year=2024&month=5');

    await waitFor(() => expect(load).toHaveBeenCalledWith(2024, 5));
  });

  it('asks for nothing until the years are known', () => {
    renderAt('/');

    expect(load).not.toHaveBeenCalled();
  });

  it('asks for nothing when the database is empty', async () => {
    meta.mockResolvedValue({
      years: [],
      categories: [],
      settings: { billableCategories: [], monthlyOverhead: {} },
    } as AppMeta);

    renderAt('/');

    await waitFor(() => expect(screen.getByTestId('years').textContent).toBe(''));
    expect(load).not.toHaveBeenCalled();
  });

  it('refetches when the reader chooses another period', async () => {
    const user = userEvent.setup();
    renderAt('/?year=2025');

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'choose' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith(2024, 5));
  });
});

describe('out-of-order responses', () => {
  it('ignores a slow response that a newer request has superseded', async () => {
    const user = userEvent.setup();
    let settleFirst: (value: string) => void = () => {};
    load.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        settleFirst = resolve;
      }),
    );
    load.mockResolvedValueOnce('second');

    renderAt('/?year=2025');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'choose' }));
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('second'));

    // The first request finishes last; its answer is for a period nobody is on.
    settleFirst('first');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId('data').textContent).toBe('second');
  });
});

describe('failures', () => {
  it("shows the API's own message", async () => {
    load.mockRejectedValue(new ApiError(400, 'The "year" parameter is required.'));

    renderAt('/?year=2025');

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('The "year" parameter is required.'),
    );
  });

  it('falls back to the caller message for anything that is not an ApiError', async () => {
    load.mockRejectedValue(new TypeError('Failed to fetch'));

    renderAt('/?year=2025');

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('Could not load it.'));
  });

  it('reports a failure to load the filters separately', async () => {
    meta.mockRejectedValue(new ApiError(503, 'The database could not be read.'));

    renderAt('/');

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('The database could not be read.'),
    );
  });
});
