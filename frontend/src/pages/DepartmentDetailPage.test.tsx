import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppMeta, DepartmentRow } from '@shared/types';

import DepartmentDetailPage from '@/pages/DepartmentDetailPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getDepartment: vi.fn(), getMeta: vi.fn() };
});

const { ApiError, getDepartment, getMeta } = await import('@/lib/api');
const department = vi.mocked(getDepartment);
const meta = vi.mocked(getMeta);

function row(overrides: Partial<DepartmentRow> = {}): DepartmentRow {
  return {
    department: 'Design',
    headcount: 3,
    totalHours: 6_335.9,
    billableHours: 5_121.2,
    nonBillableHours: 1_214.7,
    productivityPct: 0.8083,
    cost: 633_000,
    employees: [
      {
        employeeNo: '10201',
        employeeName: 'Ayesha Rahman',
        designation: 'Senior UI/UX Designer',
        totalHours: 2_111.9,
        billableHours: 1_702.1,
        nonBillableHours: 409.8,
        productivityPct: 0.806,
        cost: 219_000,
      },
      {
        employeeNo: '10202',
        employeeName: 'Rohit Menon',
        designation: 'UI/UX Designer',
        totalHours: 2_112,
        billableHours: 1_745.8,
        nonBillableHours: 366.2,
        productivityPct: 0.8266,
        cost: 147_000,
      },
    ],
    ...overrides,
  };
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/departments/:department" element={<DepartmentDetailPage />} />
        <Route path="/" element={<span data-testid="dashboard">the dashboard</span>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  department.mockReset();
  meta.mockReset();
  meta.mockResolvedValue({
    years: [2024, 2025],
    categories: [],
    settings: { billableCategories: [], monthlyOverhead: {} },
  } as AppMeta);
  department.mockResolvedValue(row());
});

describe('the department detail', () => {
  it('names the department and the period', async () => {
    renderAt('/departments/Design?year=2025');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Design');
    expect(screen.getByText(/2025 · all months · 3 people/)).toBeDefined();
  });

  it('asks for the department on the period in the URL', async () => {
    renderAt('/departments/Design?year=2025&month=3');

    expect(department).toHaveBeenCalledWith('Design', 2025, 3);
  });

  it('decodes a name that was encoded in the path', async () => {
    // %2F is the case that breaks a router splitting on the raw path.
    department.mockResolvedValue(row({ department: 'R&D / Special' }));

    renderAt('/departments/R%26D%20%2F%20Special?year=2025');

    expect(department).toHaveBeenCalledWith('R&D / Special', 2025, null);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('R&D / Special');
  });

  it('shows the four headline figures', async () => {
    renderAt('/departments/Design?year=2025');

    expect(await screen.findByText('6,335.9')).toBeDefined();
    expect(screen.getByText('5,121.2')).toBeDefined();
    expect(screen.getByText('AED 633,000')).toBeDefined();
    expect(screen.getByText(/80\.8% of hours logged/)).toBeDefined();
  });

  it('says salaries exclude overhead, so nobody reads it as total cost', async () => {
    renderAt('/departments/Design?year=2025');

    expect(await screen.findByText(/overhead is not attributed/i)).toBeDefined();
  });

  it('lists every person with their hours and salary', async () => {
    renderAt('/departments/Design?year=2025');

    const table = (await screen.findByRole('table')).closest('table')!;
    const ayesha = within(table).getByText('Ayesha Rahman').closest('tr')!;

    expect(within(ayesha).getByText('Senior UI/UX Designer')).toBeDefined();
    expect(within(ayesha).getByText('2,111.9')).toBeDefined();
    expect(within(ayesha).getByText('80.6%')).toBeDefined();
    expect(within(ayesha).getByText('AED 219,000')).toBeDefined();
  });

  it('labels the headcount card distinctly from the table', async () => {
    // Two elements reading "People" made the table impossible to address.
    renderAt('/departments/Design?year=2025');

    expect(await screen.findByText('Headcount')).toBeDefined();
    expect(screen.getAllByText('People')).toHaveLength(1);
  });

  it('renders an em dash for someone with no salary, not AED 0', async () => {
    department.mockResolvedValue(row({ employees: [{ ...row().employees[0], cost: null }] }));

    renderAt('/departments/Design?year=2025');

    const person = (await screen.findByText('Ayesha Rahman')).closest('tr')!;
    expect(within(person).getByText('—')).toBeDefined();
    expect(within(person).queryByText('AED 0')).toBeNull();
  });

  it('returns to the dashboard on the same period', async () => {
    renderAt('/departments/Design?year=2025&month=3');

    const back = await screen.findByRole('link', { name: /dashboard/i });
    expect(back.getAttribute('href')).toBe('/?year=2025&month=3');
  });
});

describe('an unknown department', () => {
  it('renders a not-found state rather than crashing', async () => {
    department.mockRejectedValue(new ApiError(404, 'No department named "Marketing".'));

    renderAt('/departments/Marketing?year=2025');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Department not found',
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Marketing/);
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeDefined();
  });

  it('does not dress a server failure up as a missing department', async () => {
    department.mockRejectedValue(new ApiError(503, 'The database could not be read.'));

    renderAt('/departments/Design?year=2025');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Department');
    expect(screen.getByRole('alert').textContent).toMatch(/database could not be read/i);
  });

  it('adopts the latest year when the URL carries no period', async () => {
    // Previously this sat on "Loading…" forever: the page read the period
    // straight from the URL and gave up when there was none.
    renderAt('/departments/Design');

    expect(await screen.findByRole('heading', { level: 1 })).toBeDefined();
    await waitFor(() => expect(department).toHaveBeenCalledWith('Design', 2025, null));
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('reloads when the reader moves to another department', async () => {
    // The fetch watches the period; without the department as a resource key the
    // previous one's figures would stay on screen.
    const { unmount } = renderAt('/departments/Design?year=2025');
    await screen.findByRole('heading', { level: 1 });
    unmount();

    department.mockResolvedValue(row({ department: 'Backend', cost: 579_000 }));
    renderAt('/departments/Backend?year=2025');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Backend');
    expect(department).toHaveBeenLastCalledWith('Backend', 2025, null);
  });
});
