import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectFinancials } from '@shared/types';

import ProjectDetailPage from '@/pages/ProjectDetailPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getProject: vi.fn() };
});

const { ApiError, getProject } = await import('@/lib/api');
const project = vi.mocked(getProject);

function financials(overrides: Partial<ProjectFinancials> = {}): ProjectFinancials {
  return {
    refCode: 'Q2025001a',
    projectName: 'Meridian-Website.pdf',
    category: 'Projects',
    status: 'in progress',
    projectPrice: 560_000,
    revenue: 560_000,
    totalHours: 3_025.2,
    totalCost: 468_776.21,
    profit: 91_223.79,
    marginPct: 0.163,
    hoursByDepartment: { Design: 1_200.2, Backend: 1_825 },
    costByDepartment: { Design: 180_000.21, Backend: 288_776 },
    employees: [
      {
        employeeNo: '10201',
        employeeName: 'Ayesha Rahman',
        department: 'Design',
        hours: 1_200.2,
        cost: 180_000.21,
        revenueShare: 222_222,
        profitability: 0.19,
      },
      {
        employeeNo: '10206',
        employeeName: 'Imran Sheikh',
        department: 'Backend',
        hours: 1_825,
        cost: 288_776,
        revenueShare: 337_778,
        profitability: 0.145,
      },
    ],
    ...overrides,
  };
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/projects/:refCode" element={<ProjectDetailPage />} />
        <Route path="/projects" element={<span data-testid="list">the list</span>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  project.mockReset();
  project.mockResolvedValue(financials());
});

describe('the project detail', () => {
  it('names the project and its ref code', async () => {
    renderAt('/projects/Q2025001a');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Meridian-Website.pdf',
    );
    expect(screen.getByText(/Q2025001a · Projects · in progress/)).toBeDefined();
  });

  it('says the figures cover the whole engagement, not a filtered period', async () => {
    renderAt('/projects/Q2025001a?year=2025&month=3');

    expect(await screen.findByText(/all time/)).toBeDefined();
    // The period never reaches the request.
    expect(project).toHaveBeenCalledWith('Q2025001a');
  });

  it('shows the four headline figures', async () => {
    renderAt('/projects/Q2025001a');

    expect(await screen.findByText('AED 560,000')).toBeDefined();
    expect(screen.getByText('3,025.2')).toBeDefined();
    expect(screen.getByText('AED 468,776')).toBeDefined();
    expect(screen.getByText('AED 91,224')).toBeDefined();
    expect(screen.getByText('16.3% margin')).toBeDefined();
  });

  it('breaks the work down by department, largest first', async () => {
    renderAt('/projects/Q2025001a');

    const table = (await screen.findByText('By department')).closest('table')!;
    const departments = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.children[0].textContent);

    expect(departments).toEqual(['Backend', 'Design']);
    expect(within(table).getByText('1,825.0')).toBeDefined();
    expect(within(table).getByText('AED 288,776')).toBeDefined();
    // Scoped, so it cannot be read as the department's whole cost.
    expect(within(table).getByText('Cost on this project')).toBeDefined();
  });

  it('lists each contributor with their hours and cost', async () => {
    renderAt('/projects/Q2025001a');

    const table = (await screen.findByText('By person')).closest('table')!;

    expect(within(table).getByText('Ayesha Rahman')).toBeDefined();
    expect(within(table).getByText('Imran Sheikh')).toBeDefined();
    expect(within(table).getByText('1,200.2')).toBeDefined();
  });

  it('gives every contributor a profitability percentage', async () => {
    renderAt('/projects/Q2025001a');

    const table = (await screen.findByText('By person')).closest('table')!;
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);

    expect(headers).toEqual(['Employee', 'Hours', 'Cost', 'Profitability']);
    expect(within(table).getByText('19.0%')).toBeDefined();
    expect(within(table).getByText('14.5%')).toBeDefined();
  });

  it('colours profitability by sign, so time that lost money reads as a loss', async () => {
    const [profitable, losing] = financials().employees;
    project.mockResolvedValue(
      financials({ employees: [profitable, { ...losing, profitability: -0.312 }] }),
    );

    renderAt('/projects/Q2025001a');

    const table = (await screen.findByText('By person')).closest('table')!;

    expect(within(table).getByText('19.0%').className).toMatch(/text-positive/);
    expect(within(table).getByText('-31.2%').className).toMatch(/text-negative/);
  });

  it('returns to the list with the filter intact', async () => {
    renderAt('/projects/Q2025001a?year=2025&month=3');

    const back = await screen.findByRole('link', { name: /all projects/i });
    expect(back.getAttribute('href')).toBe('/projects?year=2025&month=3');
  });
});

describe('a project with no price', () => {
  it('shows em dashes rather than zeroes, and says why there is no margin', async () => {
    project.mockResolvedValue(
      financials({
        projectName: null,
        projectPrice: null,
        revenue: null,
        profit: null,
        marginPct: null,
        employees: financials().employees.map((employee) => ({
          ...employee,
          revenueShare: null,
          profitability: null,
        })),
      }),
    );

    renderAt('/projects/Q2025999x');

    expect(await screen.findByText(/no price recorded/i)).toBeDefined();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('AED 0')).toBeNull();
  });

  it('leaves every contributor an em dash rather than a break-even 0%', async () => {
    project.mockResolvedValue(
      financials({
        projectPrice: null,
        revenue: null,
        profit: null,
        marginPct: null,
        employees: financials().employees.map((employee) => ({
          ...employee,
          revenueShare: null,
          profitability: null,
        })),
      }),
    );

    renderAt('/projects/Q2025999x');

    const table = (await screen.findByText('By person')).closest('table')!;
    const profitability = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.children[3].textContent);

    expect(profitability).toEqual(['—', '—']);
    expect(within(table).queryByText('0.0%')).toBeNull();
  });
});

describe('an unknown ref code', () => {
  it('renders a not-found state rather than crashing', async () => {
    project.mockRejectedValue(new ApiError(404, 'No project has been costed under "NOPE".'));

    renderAt('/projects/NOPE');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Project not found',
    );
    expect(screen.getByRole('alert').textContent).toMatch(/NOPE/);
    // Still a way back.
    expect(screen.getByRole('link', { name: /all projects/i })).toBeDefined();
  });

  it('does not dress up a server failure as a missing project', async () => {
    project.mockRejectedValue(new ApiError(500, 'Something went wrong. Please try again.'));

    renderAt('/projects/Q2025001a');

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Projects');
    expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i);
  });
});
