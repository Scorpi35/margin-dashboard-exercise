import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppMeta, ProjectFinancials } from '@shared/types';

import ProjectsPage from '@/pages/ProjectsPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getMeta: vi.fn(), getProjects: vi.fn() };
});

const { getMeta, getProjects } = await import('@/lib/api');
const meta = vi.mocked(getMeta);
const projects = vi.mocked(getProjects);

function project(overrides: Partial<ProjectFinancials> = {}): ProjectFinancials {
  return {
    refCode: 'Q2025001a',
    projectName: 'Meridian-Website-UIUXdesign-Development-14012025-COMMERCIAL.pdf',
    category: 'Projects',
    status: 'in progress',
    projectPrice: 560_000,
    revenue: 560_000,
    totalHours: 3_025.2,
    totalCost: 468_776.21,
    profit: 91_223.79,
    marginPct: 0.163,
    hoursByDepartment: {},
    costByDepartment: {},
    employees: [],
    ...overrides,
  };
}

/** The three loss-makers ahead of a profitable one, as the API returns them. */
const SAMPLE: ProjectFinancials[] = [
  project({
    refCode: 'E2025050a',
    projectName: 'Enh-A.pdf',
    projectPrice: 92_000,
    totalCost: 195_062,
    profit: -103_062,
    marginPct: -1.12,
  }),
  project({
    refCode: 'H2025060c',
    projectName: 'Host-C.pdf',
    projectPrice: 46_000,
    totalCost: 96_080,
    profit: -50_080,
    marginPct: -1.089,
  }),
  project({
    refCode: 'E2025055b',
    projectName: 'Enh-B.pdf',
    projectPrice: 104_000,
    totalCost: 129_854,
    profit: -25_854,
    marginPct: -0.249,
  }),
  project(),
];

/** Stands in for the detail route so a click can be followed. */
function DetailProbe() {
  const { refCode } = useParams();
  const location = useLocation();

  return <span data-testid="detail">{`${refCode}${location.search}`}</span>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:refCode" element={<DetailProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  meta.mockReset();
  projects.mockReset();
  meta.mockResolvedValue({
    years: [2025],
    months: ['2025-01'],
    categories: [],
    settings: { billableCategories: [], monthlyOverhead: {} },
  } as AppMeta);
  projects.mockResolvedValue(SAMPLE);
});

describe('the project list', () => {
  it('lists every project the period contains', async () => {
    renderAt('/projects');

    await screen.findByText('E2025050a');
    // One header row plus one per project.
    expect(screen.getAllByRole('row')).toHaveLength(SAMPLE.length + 1);
  });

  it('keeps loss-making work at the top, in the order the API gave', async () => {
    renderAt('/projects');

    await screen.findByText('E2025050a');
    const refCodes = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getByText(/^[EHQ]\d{7}[a-z]$/).textContent);

    expect(refCodes).toEqual(['E2025050a', 'H2025060c', 'E2025055b', 'Q2025001a']);
  });

  it('colours a loss and a profit differently', async () => {
    renderAt('/projects');

    expect((await screen.findByText('-112.0%')).className).toMatch(/text-negative/);
    expect(screen.getByText('16.3%').className).toMatch(/text-positive/);
  });

  it('shows the ref code beneath the name, since names are filenames', async () => {
    renderAt('/projects');

    const row = (await screen.findByText('E2025050a')).closest('tr')!;
    expect(within(row).getByText('Enh-A.pdf')).toBeDefined();
  });

  it('opens the matching detail page when a row is clicked', async () => {
    const user = userEvent.setup();
    renderAt('/projects?year=2025&month=3');

    await user.click(await screen.findByText('Host-C.pdf'));

    // The filter travels with the link, so Back returns to the same list.
    expect(screen.getByTestId('detail').textContent).toBe('H2025060c?year=2025&month=3');
  });
});

describe('a project with no price', () => {
  it('shows an em dash rather than AED 0, and no profit or margin', async () => {
    projects.mockResolvedValue([
      project({
        refCode: 'Q2025999x',
        projectName: null,
        projectPrice: null,
        revenue: null,
        profit: null,
        marginPct: null,
        totalCost: 1_500,
      }),
    ]);

    renderAt('/projects');

    const row = (await screen.findByRole('link', { name: /Q2025999x/ })).closest('tr')!;
    const cells = within(row).getAllByRole('cell');

    // Price, profit and margin are all absent; the cost is real.
    expect(cells[3].textContent).toBe('—');
    expect(cells[5].textContent).toBe('—');
    expect(cells[6].textContent).toBe('—');
    expect(cells[4].textContent).toMatch(/1,500/);
    expect(within(row).queryByText('AED 0')).toBeNull();
  });

  it('falls back to the ref code when there is no name, and prints it once', async () => {
    projects.mockResolvedValue([project({ refCode: 'Q2025999x', projectName: null })]);

    renderAt('/projects');

    expect(await screen.findByRole('link', { name: /Q2025999x/ })).toBeDefined();
    // Repeating it as a sub-line under itself reads as a bug.
    expect(screen.getAllByText('Q2025999x')).toHaveLength(1);
  });
});

describe('the period filter', () => {
  it('refetches when a month is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/projects');

    await screen.findByText('E2025050a');
    await user.selectOptions(screen.getByLabelText('Month'), '3');

    await waitFor(() => expect(projects).toHaveBeenLastCalledWith(2025, 3));
    expect(await screen.findByText(/March 2025/)).toBeDefined();
  });

  it('says so when nothing was worked on in the period', async () => {
    projects.mockResolvedValue([]);

    renderAt('/projects');

    expect(await screen.findByText(/no project work was logged/i)).toBeDefined();
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

    renderAt('/projects');

    expect(await screen.findByText(/nothing to report yet/i)).toBeDefined();
    expect(projects).not.toHaveBeenCalled();
  });
});
