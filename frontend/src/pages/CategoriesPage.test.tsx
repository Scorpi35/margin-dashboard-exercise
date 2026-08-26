import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppMeta, CategoryBreakdown } from '@shared/types';

import CategoriesPage from '@/pages/CategoriesPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getMeta: vi.fn(), getCategories: vi.fn() };
});

const { getCategories, getMeta } = await import('@/lib/api');
const meta = vi.mocked(getMeta);
const categories = vi.mocked(getCategories);

/** The shape of the real year, trimmed to the rows a test needs. */
const SAMPLE: CategoryBreakdown = {
  rows: [
    { category: 'Projects', isBillable: true, hours: 12_540.9, hoursPct: 0.6329 },
    { category: 'FC - Meetings', isBillable: false, hours: 2_180.4, hoursPct: 0.11 },
    { category: 'Enhancements', isBillable: true, hours: 2_080.5, hoursPct: 0.105 },
    { category: 'Tentwenty', isBillable: false, hours: 138.7, hoursPct: 0.007 },
  ],
  totalHours: 19_815.2,
  billableHours: 15_265.6,
  nonBillableHours: 4_549.6,
};

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CategoriesPage />
    </MemoryRouter>,
  );
}

const fill = (rowEl: HTMLElement): HTMLElement =>
  rowEl.querySelector('[aria-hidden="true"]')!.firstElementChild as HTMLElement;

beforeEach(() => {
  meta.mockReset();
  categories.mockReset();
  meta.mockResolvedValue({
    years: [2025],
    months: ['2025-01'],
    categories: [],
    settings: { billableCategories: [], monthlyOverhead: {} },
  } as AppMeta);
  categories.mockResolvedValue(SAMPLE);
});

describe('the category table', () => {
  it('lists every category in the order the API gave', async () => {
    renderAt('/categories');

    await screen.findByText('Projects');
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.children[0].textContent);

    expect(names).toEqual(['Projects', 'FC - Meetings', 'Enhancements', 'Tentwenty']);
  });

  it('shows hours and share for each row', async () => {
    renderAt('/categories');

    const projects = (await screen.findByText('Projects')).closest('tr')!;
    expect(within(projects).getByText('12,540.9')).toBeDefined();
    expect(within(projects).getByText('63.3%')).toBeDefined();
  });

  it('summarises the period above the table', async () => {
    renderAt('/categories');

    // Straight from the response — the page never adds hours up itself.
    const summary = await screen.findByText(/hours logged/);
    expect(summary.textContent).toMatch(/19,815\.2/);
    expect(summary.textContent).toMatch(/15,265\.6/);
    expect(summary.textContent).toMatch(/4,549\.6/);
  });

  it('marks Tentwenty internal despite the missing FC prefix', async () => {
    renderAt('/categories');

    const tentwenty = (await screen.findByText('Tentwenty')).closest('tr')!;
    expect(within(tentwenty).getByText('Internal')).toBeDefined();
  });

  it('says billable in words, not only in colour', async () => {
    renderAt('/categories');

    const projects = (await screen.findByText('Projects')).closest('tr')!;
    expect(within(projects).getByText('Billable')).toBeDefined();
  });

  it('colours billable and internal bars differently', async () => {
    renderAt('/categories');

    const projects = (await screen.findByText('Projects')).closest('tr')!;
    const meetings = screen.getByText('FC - Meetings').closest('tr')!;

    expect(fill(projects).className).toMatch(/bg-accent/);
    expect(fill(meetings).className).toMatch(/bg-ink-faint/);
  });
});

describe('the bars', () => {
  it('scales against the largest category, not against 100%', async () => {
    // Projects is 63% of the year; scaled to 100% everything else would be a
    // sliver, and the point of the page is the comparison.
    renderAt('/categories');

    const projects = (await screen.findByText('Projects')).closest('tr')!;
    const meetings = screen.getByText('FC - Meetings').closest('tr')!;

    expect(fill(projects).style.width).toBe('100%');
    // 2,180.4 / 12,540.9 = 17.4%
    expect(fill(meetings).style.width).toBe('17.4%');
  });

  it('never draws past its cell', async () => {
    renderAt('/categories');

    await screen.findByText('Projects');
    for (const row of screen.getAllByRole('row').slice(1)) {
      const width = Number.parseFloat(fill(row).style.width);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
  });

  it('reads the same whether the rows are all zero or absent', async () => {
    // Both mean "no hours were logged". Rendering a table of zeroes for one and
    // prose for the other would imply a difference that is not there.
    categories.mockResolvedValue({
      rows: [{ category: 'Projects', isBillable: true, hours: 0, hoursPct: null }],
      totalHours: 0,
      billableHours: 0,
      nonBillableHours: 0,
    });

    renderAt('/categories');

    expect(await screen.findByText(/no hours were logged/i)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a long category name', () => {
  it('is truncated rather than stretching the table', async () => {
    // The sample's longest is 18 characters, so this is the case the real data
    // cannot exercise.
    const long = 'FC - Internal Tooling, Research and Very Long Category Name Indeed';
    categories.mockResolvedValue({
      ...SAMPLE,
      rows: [{ category: long, isBillable: false, hours: 10, hoursPct: 0.001 }],
    });

    renderAt('/categories');

    const cell = await screen.findByText(long);
    expect(cell.className).toMatch(/truncate/);
    expect(cell.className).toMatch(/max-w-/);
    // The full name stays reachable.
    expect(cell.getAttribute('title')).toBe(long);
  });
});

describe('an empty period', () => {
  it('says no hours were logged rather than showing a bare table', async () => {
    categories.mockResolvedValue({
      rows: [],
      totalHours: 0,
      billableHours: 0,
      nonBillableHours: 0,
    });

    renderAt('/categories');

    expect(await screen.findByText(/no hours were logged/i)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the period filter', () => {
  it('refetches when a month is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/categories');

    await screen.findByText('Projects');
    await user.selectOptions(screen.getByLabelText('Month'), '2');

    await waitFor(() => expect(categories).toHaveBeenLastCalledWith(2025, 2));
    expect(await screen.findByText(/February 2025/)).toBeDefined();
  });
});
