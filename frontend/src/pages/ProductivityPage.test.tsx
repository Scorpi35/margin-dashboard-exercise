import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppMeta, ProductivityRow } from '@shared/types';

import ProductivityPage from '@/pages/ProductivityPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getMeta: vi.fn(), getProductivity: vi.fn() };
});

const { getMeta, getProductivity } = await import('@/lib/api');
const meta = vi.mocked(getMeta);
const productivity = vi.mocked(getProductivity);

function row(overrides: Partial<ProductivityRow> = {}): ProductivityRow {
  return {
    employeeNo: '10208',
    employeeName: "Kevin D'Souza",
    department: 'App',
    designation: 'App Developer',
    totalHours: 1_558.4,
    billableHours: 1_292.7,
    nonBillableHours: 265.7,
    productivityPct: 0.83,
    ...overrides,
  };
}

/** The top of the list and the two who log only internal time. */
const SAMPLE: ProductivityRow[] = [
  row(),
  row({
    employeeNo: '10202',
    employeeName: 'Rohit Menon',
    department: 'Design',
    productivityPct: 0.827,
  }),
  row({
    employeeNo: '00101',
    employeeName: 'Hana Yousef',
    department: 'Management',
    designation: 'Operations Lead',
    totalHours: 394.8,
    billableHours: 0,
    nonBillableHours: 394.8,
    productivityPct: 0,
  }),
  row({
    employeeNo: '00102',
    employeeName: 'Omar Zayed',
    department: 'Management',
    designation: 'Managing Director',
    totalHours: 417.8,
    billableHours: 0,
    nonBillableHours: 417.8,
    productivityPct: 0,
  }),
];

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ProductivityPage />
    </MemoryRouter>,
  );
}

/** The fill sits inside the track; the track is the bar's outer element. */
const fillWidth = (rowEl: HTMLElement): string | undefined => {
  const track = rowEl.querySelector('[aria-hidden="true"]');

  return (track?.firstElementChild as HTMLElement | null)?.style.width;
};

beforeEach(() => {
  meta.mockReset();
  productivity.mockReset();
  meta.mockResolvedValue({
    years: [2025],
    months: ['2025-01'],
    categories: [],
    settings: { billableCategories: [], monthlyOverhead: {} },
  } as AppMeta);
  productivity.mockResolvedValue(SAMPLE);
});

describe('the productivity table', () => {
  it('lists everyone the period covers', async () => {
    renderAt('/productivity');

    await screen.findByText("Kevin D'Souza");
    expect(screen.getAllByRole('row')).toHaveLength(SAMPLE.length + 1);
  });

  it('keeps the order the API gave, most billable first', async () => {
    renderAt('/productivity');

    await screen.findByText("Kevin D'Souza");
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((tr) => tr.children[0].textContent);

    expect(names[0]).toMatch(/Kevin D'Souza/);
    expect(names[1]).toMatch(/Rohit Menon/);
  });

  it('shows hours and the share for each person', async () => {
    renderAt('/productivity');

    const kevin = (await screen.findByText("Kevin D'Souza")).closest('tr')!;
    expect(within(kevin).getByText('1,558.4')).toBeDefined();
    expect(within(kevin).getByText('1,292.7')).toBeDefined();
    expect(within(kevin).getByText('83.0%')).toBeDefined();
    expect(within(kevin).getByText('App')).toBeDefined();
  });

  it('renders a visible zero and an empty bar for internal-only time', async () => {
    // Not filtered out and not blank: they logged real hours, none of them
    // billable, and hiding them would hide the work.
    renderAt('/productivity');

    for (const name of ['Hana Yousef', 'Omar Zayed']) {
      const tr = (await screen.findByText(name)).closest('tr')!;

      expect(within(tr).getByText('0.0%')).toBeDefined();
      expect(fillWidth(tr)).toBe('0%');
      // The hours are still reported.
      expect(within(tr).getByText(/39[45]\.8|417\.8/)).toBeDefined();
    }
  });

  it('draws the bar in proportion to the share', async () => {
    renderAt('/productivity');

    const kevin = (await screen.findByText("Kevin D'Souza")).closest('tr')!;
    expect(fillWidth(kevin)).toBe('83%');

    // Rounded: 0.827 * 100 is 82.69999999999999, which would land in the DOM
    // verbatim without it. (jsdom drops a trailing .0, hence 83% above.)
    const rohit = screen.getByText('Rohit Menon').closest('tr')!;
    expect(fillWidth(rohit)).toBe('82.7%');
  });

  it('clamps a bar so it can never overflow its cell', async () => {
    // The engine guards this, but the drawing must not depend on that guard.
    productivity.mockResolvedValue([
      row({ employeeNo: '1', employeeName: 'Over', productivityPct: 1.4 }),
      row({ employeeNo: '2', employeeName: 'Under', productivityPct: -0.2 }),
      row({ employeeNo: '3', employeeName: 'Broken', productivityPct: Number.NaN }),
    ]);

    renderAt('/productivity');

    expect(fillWidth((await screen.findByText('Over')).closest('tr')!)).toBe('100%');
    expect(fillWidth(screen.getByText('Under').closest('tr')!)).toBe('0%');
    expect(fillWidth(screen.getByText('Broken').closest('tr')!)).toBe('0%');
  });

  it('keeps the percentage as text, so the bar is never the only reading', async () => {
    renderAt('/productivity');

    const kevin = (await screen.findByText("Kevin D'Souza")).closest('tr')!;
    const track = kevin.querySelector('[aria-hidden="true"]');

    expect(track).not.toBeNull();
    expect(within(kevin).getByText('83.0%')).toBeDefined();
  });

  it('omits the bar entirely when there is no share to draw', async () => {
    productivity.mockResolvedValue([
      row({ productivityPct: null, totalHours: 0, billableHours: 0 }),
    ]);

    renderAt('/productivity');

    const tr = (await screen.findByText("Kevin D'Souza")).closest('tr')!;
    expect(within(tr).getByText('—')).toBeDefined();
    expect(tr.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('an empty period', () => {
  it('says nobody logged hours rather than showing a bare table', async () => {
    productivity.mockResolvedValue([]);

    renderAt('/productivity');

    expect(await screen.findByText(/nobody logged any hours/i)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the period filter', () => {
  it('refetches when a month is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/productivity');

    await screen.findByText("Kevin D'Souza");
    await user.selectOptions(screen.getByLabelText('Month'), '7');

    await waitFor(() => expect(productivity).toHaveBeenLastCalledWith(2025, 7));
    expect(await screen.findByText(/July 2025/)).toBeDefined();
  });
});

describe('with no data at all', () => {
  it('points at the upload page', async () => {
    meta.mockResolvedValue({
      years: [],
      months: [],
      categories: [],
      settings: { billableCategories: [], monthlyOverhead: {} },
    } as AppMeta);

    renderAt('/productivity');

    expect(await screen.findByText(/nothing to report yet/i)).toBeDefined();
    expect(productivity).not.toHaveBeenCalled();
  });
});
