import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { usePeriodFilter } from '@/hooks/usePeriodFilter';

/** Surfaces the hook's reading of the URL, and lets a test drive it. */
function Probe() {
  const { year, month, setPeriod } = usePeriodFilter();
  const location = useLocation();
  // MemoryRouter keeps its own history, so going back has to go through the
  // router rather than through window.history.
  const navigate = useNavigate();

  return (
    <>
      <span data-testid="year">{String(year)}</span>
      <span data-testid="month">{String(month)}</span>
      <span data-testid="url">{location.search}</span>
      <button onClick={() => setPeriod(2024, 3)}>push</button>
      <button onClick={() => setPeriod(2023, null, { replace: true })}>replace</button>
      <button onClick={() => navigate(-1)}>back</button>
    </>
  );
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={['/start', url]} initialIndex={1}>
      <Probe />
    </MemoryRouter>,
  );
}

describe('reading the period from the URL', () => {
  it('reads a year and a month', () => {
    renderAt('/?year=2025&month=7');

    expect(screen.getByTestId('year').textContent).toBe('2025');
    expect(screen.getByTestId('month').textContent).toBe('7');
  });

  it('treats an absent month as the whole year', () => {
    renderAt('/?year=2025');

    expect(screen.getByTestId('month').textContent).toBe('null');
  });

  it('treats anything unreadable as absent rather than coercing it', () => {
    // A NaN reaching the filter renders an empty view that looks like an answer.
    for (const query of ['?year=banana', '?year=', '?year=2e3', '?year=0x7e9', '?year=-2025']) {
      const { unmount } = renderAt(`/${query}`);
      expect(screen.getByTestId('year').textContent).toBe('null');
      unmount();
    }
  });

  it('rejects a year outside the window the API accepts', () => {
    renderAt('/?year=1969');
    expect(screen.getByTestId('year').textContent).toBe('null');
  });

  it('rejects a month outside 1-12', () => {
    for (const query of ['?month=0', '?month=13', '?month=1.5']) {
      const { unmount } = renderAt(`/${query}`);
      expect(screen.getByTestId('month').textContent).toBe('null');
      unmount();
    }
  });
});

describe('writing the period to the URL', () => {
  it('writes both parts', async () => {
    const user = userEvent.setup();
    renderAt('/?year=2025');

    await user.click(screen.getByRole('button', { name: 'push' }));

    expect(screen.getByTestId('url').textContent).toBe('?year=2024&month=3');
  });

  it('drops the month rather than leaving it empty', async () => {
    const user = userEvent.setup();
    renderAt('/?year=2025&month=7');

    await user.click(screen.getByRole('button', { name: 'replace' }));

    expect(screen.getByTestId('url').textContent).toBe('?year=2023');
  });

  it('leaves a chosen period in the history, so Back undoes it', async () => {
    const user = userEvent.setup();
    renderAt('/?year=2025');

    await user.click(screen.getByRole('button', { name: 'push' }));
    expect(screen.getByTestId('url').textContent).toBe('?year=2024&month=3');

    await user.click(screen.getByRole('button', { name: 'back' }));

    expect(screen.getByTestId('url').textContent).toBe('?year=2025');
  });

  it('keeps a replaced period out of the history', async () => {
    const user = userEvent.setup();
    renderAt('/?year=2025');

    await user.click(screen.getByRole('button', { name: 'replace' }));
    expect(screen.getByTestId('url').textContent).toBe('?year=2023');

    await user.click(screen.getByRole('button', { name: 'back' }));

    // Back goes past the replaced entry, to where the reader actually came from.
    expect(screen.getByTestId('url').textContent).not.toBe('?year=2025');
    expect(screen.getByTestId('url').textContent).toBe('');
  });
});
