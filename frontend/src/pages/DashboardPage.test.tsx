import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppMeta, DepartmentBreakdown, PeriodSummary } from '@shared/types';

import DashboardPage from '@/pages/DashboardPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getMeta: vi.fn(), getDashboard: vi.fn(), getDepartments: vi.fn() };
});

const { getDashboard, getDepartments, getMeta } = await import('@/lib/api');
const meta = vi.mocked(getMeta);
const dashboard = vi.mocked(getDashboard);
const departments = vi.mocked(getDepartments);

function appMeta(overrides: Partial<AppMeta> = {}): AppMeta {
  return {
    years: [2024, 2025],
    months: ['2024-12', '2025-01'],
    categories: ['Projects', 'FC - Meetings'],
    settings: { billableCategories: ['Projects'], monthlyOverhead: {} },
    ...overrides,
  };
}

function summary(overrides: Partial<PeriodSummary> = {}): PeriodSummary {
  return {
    year: 2025,
    month: null,
    totalSalaries: 2_400_000,
    totalOverhead: 0,
    totalCost: 2_400_000,
    totalRevenue: 5_012_000,
    totalProfit: 2_612_000,
    marginPct: 0.5211,
    totalHours: 19_815.2,
    billableHours: 15_265.6,
    nonBillableHours: 4_549.6,
    productivityPct: 0.7704,
    unpricedRefCodes: [],
    missingSalaryEmployees: [],
    months: [],
    ...overrides,
  };
}

/** Surfaces the address bar so a test can assert what a link would carry. */
function LocationProbe() {
  const location = useLocation();

  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <DashboardPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const card = (label: string): HTMLElement => screen.getByText(label).parentElement!;

function breakdown(overrides: Partial<DepartmentBreakdown> = {}): DepartmentBreakdown {
  return {
    rows: [
      {
        department: 'Design',
        headcount: 3,
        totalHours: 6_335.9,
        billableHours: 5_121.2,
        nonBillableHours: 1_214.7,
        productivityPct: 0.8083,
        cost: 633_000,
        employees: [],
      },
    ],
    totalHours: 19_815.2,
    totalCost: 2_400_000,
    ...overrides,
  };
}

beforeEach(() => {
  meta.mockReset();
  dashboard.mockReset();
  departments.mockReset();
  meta.mockResolvedValue(appMeta());
  dashboard.mockResolvedValue(summary());
  departments.mockResolvedValue(breakdown());
});

describe('with no data at all', () => {
  it('points at the upload page instead of showing zeroes', async () => {
    meta.mockResolvedValue(appMeta({ years: [], months: [], categories: [] }));

    renderAt('/');

    expect(await screen.findByText(/nothing to report yet/i)).toBeDefined();
    expect(screen.getByRole('link', { name: /go to upload/i }).getAttribute('href')).toBe(
      '/upload',
    );
    // Never asks the server for a period that cannot exist.
    expect(dashboard).not.toHaveBeenCalled();
    expect(departments).not.toHaveBeenCalled();
  });
});

describe('the six cards', () => {
  it('shows every headline figure for the year', async () => {
    renderAt('/');

    expect(await screen.findByText('19,815.2')).toBeDefined();
    expect(within(card('Billable hours')).getByText('15,265.6')).toBeDefined();
    expect(within(card('Non-billable hours')).getByText('4,549.6')).toBeDefined();
    expect(within(card('Cost')).getByText('AED 2,400,000')).toBeDefined();
    expect(within(card('Revenue')).getByText('AED 5,012,000')).toBeDefined();
    expect(within(card('Margin')).getByText('52.1%')).toBeDefined();
  });

  it('gives billable hours their share of the total as context', async () => {
    renderAt('/');

    expect(await screen.findByText(/77\.0% of hours logged/)).toBeDefined();
  });

  it('breaks cost into salaries and overhead', async () => {
    dashboard.mockResolvedValue(
      summary({ totalSalaries: 2_400_000, totalOverhead: 50_000, totalCost: 2_450_000 }),
    );

    renderAt('/');

    expect(await screen.findByText(/2,400,000.*salaries.*50,000.*overhead/)).toBeDefined();
  });
});

describe('the margin', () => {
  it('is green when the period made money', async () => {
    dashboard.mockResolvedValue(summary({ marginPct: 0.163, totalProfit: 10_000 }));

    renderAt('/');

    const value = await screen.findByText('16.3%');
    expect(value.className).toMatch(/text-positive/);
    expect(within(card('Margin')).getByText('AED 10,000 profit')).toBeDefined();
  });

  it('is red when the period lost money', async () => {
    dashboard.mockResolvedValue(summary({ marginPct: -1.12, totalProfit: -103_062 }));

    renderAt('/');

    const value = await screen.findByText('-112.0%');
    expect(value.className).toMatch(/text-negative/);
  });

  it('renders an em dash when there was no revenue, not 0% and not NaN', async () => {
    dashboard.mockResolvedValue(summary({ totalRevenue: 0, totalProfit: -100, marginPct: null }));

    renderAt('/');

    await screen.findByText('Margin');
    const margin = card('Margin');
    expect(within(margin).getByText('—')).toBeDefined();
    expect(within(margin).queryByText('0.0%')).toBeNull();
    expect(within(margin).queryByText(/NaN/)).toBeNull();
    expect(within(margin).getByText(/no revenue in this period/i)).toBeDefined();
    // An absent margin is neither good nor bad.
    expect(within(margin).getByText('—').className).toMatch(/text-ink/);
  });
});

describe('the period filter', () => {
  it('adopts the most recent year with data and puts it in the URL', async () => {
    renderAt('/');

    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/?year=2025'));
    expect(dashboard).toHaveBeenCalledWith(2025, null);
    expect(await screen.findByText('2025 · all months')).toBeDefined();
  });

  it('reproduces the same view from a pasted URL', async () => {
    dashboard.mockResolvedValue(summary({ month: 3, totalCost: 197_000 }));

    renderAt('/?year=2025&month=3');

    expect(await screen.findByText('March 2025')).toBeDefined();
    expect(dashboard).toHaveBeenCalledWith(2025, 3);
    expect(within(card('Cost')).getByText('AED 197,000')).toBeDefined();
  });

  it('refetches and relabels when a month is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/');

    await screen.findByText('2025 · all months');
    dashboard.mockResolvedValue(summary({ month: 1, totalCost: 197_000, totalHours: 1_634.6 }));

    await user.selectOptions(screen.getByLabelText('Month'), '1');

    expect(await screen.findByText('January 2025')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/?year=2025&month=1'));
    expect(dashboard).toHaveBeenLastCalledWith(2025, 1);
    expect(await screen.findByText('1,634.6')).toBeDefined();
  });

  it('drops the month from the URL when all months are chosen', async () => {
    const user = userEvent.setup();
    renderAt('/?year=2025&month=1');

    await screen.findByText('January 2025');
    await user.selectOptions(screen.getByLabelText('Month'), '');

    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/?year=2025'));
  });

  it('switches year without losing the selected month', async () => {
    const user = userEvent.setup();
    renderAt('/?year=2025&month=3');

    await screen.findByText('March 2025');
    await user.selectOptions(screen.getByLabelText('Year'), '2024');

    await waitFor(() => expect(dashboard).toHaveBeenLastCalledWith(2024, 3));
    expect(await screen.findByText('March 2024')).toBeDefined();
  });

  it('keeps a year with no data and says so in the filter', async () => {
    // Substituting a different year silently would leave the select, the period
    // label and the figures on screen disagreeing with each other.
    dashboard.mockResolvedValue(summary({ year: 2019, totalCost: 0, totalRevenue: 0 }));

    renderAt('/?year=2019');

    expect(await screen.findByText('2019 · all months')).toBeDefined();
    expect(dashboard).toHaveBeenCalledWith(2019, null);

    const select = screen.getByLabelText('Year') as HTMLSelectElement;
    expect(select.value).toBe('2019');
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      '2019 (no data)',
      '2024',
      '2025',
    ]);
  });

  it('does not mark an available year as empty', async () => {
    renderAt('/?year=2024');

    await screen.findByText('2024 · all months');
    const select = screen.getByLabelText('Year') as HTMLSelectElement;

    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      '2024',
      '2025',
    ]);
  });

  it('says so plainly when a period has no hours at all', async () => {
    dashboard.mockResolvedValue(
      summary({ totalHours: 0, billableHours: 0, productivityPct: null }),
    );

    renderAt('/');

    expect(await screen.findByText(/no hours logged in this period/i)).toBeDefined();
    expect(screen.queryByText(/— of hours logged/)).toBeNull();
  });

  it('falls back to the default rather than filtering on a hand-edited year', async () => {
    // A NaN reaching the filter would render an empty dashboard that looks real.
    renderAt('/?year=banana');

    await waitFor(() => expect(dashboard).toHaveBeenCalledWith(2025, null));
  });
});

describe('a period with nothing in it', () => {
  it('says so rather than printing six cards of zeroes', async () => {
    dashboard.mockResolvedValue(
      summary({
        totalSalaries: 0,
        totalOverhead: 0,
        totalCost: 0,
        totalRevenue: 0,
        totalProfit: 0,
        marginPct: null,
        totalHours: 0,
        billableHours: 0,
        nonBillableHours: 0,
        productivityPct: null,
      }),
    );

    renderAt('/?year=2025&month=6');

    expect(await screen.findByText(/no hours were logged in this period/i)).toBeDefined();
    expect(screen.queryByText('AED 0')).toBeNull();
  });

  it('keeps the cards for a month that carries overhead and nothing else', async () => {
    // Overhead is costed for a month with no rows in it, so this period has a
    // real cost figure. Calling it empty would hide money the agency spent.
    dashboard.mockResolvedValue(
      summary({
        totalSalaries: 0,
        totalOverhead: 5_000,
        totalCost: 5_000,
        totalRevenue: 0,
        totalProfit: -5_000,
        marginPct: null,
        totalHours: 0,
        billableHours: 0,
        nonBillableHours: 0,
        productivityPct: null,
      }),
    );

    renderAt('/?year=2025&month=6');

    expect(await screen.findByText('AED 5,000')).toBeDefined();
    expect(screen.queryByText(/no hours were logged in this period/i)).toBeNull();
  });
});

describe('gaps in the data', () => {
  it('names unpriced ref codes and employees with no salary', async () => {
    dashboard.mockResolvedValue(
      summary({
        unpricedRefCodes: ['Q2025099z'],
        missingSalaryEmployees: [
          { employeeNo: '10201', employeeName: 'Ayesha Rahman', year: 2025, month: 3 },
        ],
      }),
    );

    renderAt('/');

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toMatch(/Q2025099z/);
    expect(banner.textContent).toMatch(/Ayesha Rahman/);
    expect(banner.textContent).toMatch(/March 2025/);
  });

  it('stays out of the way when the data is complete', async () => {
    renderAt('/');

    await screen.findByText('19,815.2');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('when the API fails', () => {
  it('says so instead of rendering zeroes', async () => {
    dashboard.mockRejectedValue(new Error('network down'));

    renderAt('/');

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load the dashboard/i);
  });
});

describe('the department summary', () => {
  it('links each department through to its drill-down, keeping the period', async () => {
    renderAt('/?year=2025&month=3');

    const link = await screen.findByRole('link', { name: 'Design' });
    expect(link.getAttribute('href')).toBe('/departments/Design?year=2025&month=3');
  });

  it('encodes a name that is not URL-safe', async () => {
    departments.mockResolvedValue(
      breakdown({
        rows: [
          {
            department: 'R&D / Special',
            headcount: 1,
            totalHours: 12,
            billableHours: 12,
            nonBillableHours: 0,
            productivityPct: 1,
            cost: 1_000,
            employees: [],
          },
        ],
      }),
    );

    renderAt('/?year=2025');

    const link = await screen.findByRole('link', { name: 'R&D / Special' });
    expect(link.getAttribute('href')).toBe('/departments/R%26D%20%2F%20Special?year=2025');
  });

  it('says plainly that overhead is not part of these figures', async () => {
    renderAt('/');

    expect(await screen.findByText(/overhead is company-wide and is not split/i)).toBeDefined();
  });

  it('shows headcount, hours and salaries for each department', async () => {
    renderAt('/');

    const row = (await screen.findByRole('link', { name: 'Design' })).closest('tr')!;
    expect(within(row).getByText('3')).toBeDefined();
    expect(within(row).getByText('6,335.9')).toBeDefined();
    expect(within(row).getByText('AED 633,000')).toBeDefined();
  });
});
