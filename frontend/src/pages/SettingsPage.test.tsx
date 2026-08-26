import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppMeta, Settings } from '@shared/types';

import SettingsPage from '@/pages/SettingsPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

  return { ...actual, getMeta: vi.fn(), saveSettings: vi.fn() };
});

const { ApiError, getMeta, saveSettings } = await import('@/lib/api');
const meta = vi.mocked(getMeta);
const save = vi.mocked(saveSettings);

const SETTINGS: Settings = {
  billableCategories: ['Projects', 'Hosting'],
  monthlyOverhead: { '2025-02': 5_000 },
};

function appMeta(overrides: Partial<AppMeta> = {}): AppMeta {
  return {
    years: [2025],
    months: ['2025-01', '2025-02'],
    categories: ['Projects', 'Hosting', 'Tentwenty'],
    settings: SETTINGS,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /save settings/i }) as HTMLButtonElement;

const overheadFor = (label: string): HTMLInputElement =>
  screen.getByLabelText(`Overhead for ${label}`) as HTMLInputElement;

const checkbox = (name: string): HTMLInputElement =>
  screen.getByRole('checkbox', { name }) as HTMLInputElement;

beforeEach(() => {
  meta.mockReset();
  save.mockReset();
  meta.mockResolvedValue(appMeta());
  save.mockImplementation((settings) => Promise.resolve(settings));
});

describe('the settings form', () => {
  it('checks the categories that are billable and leaves the rest clear', async () => {
    renderPage();

    expect(
      (await screen.findByRole('checkbox', { name: 'Projects' })) as HTMLInputElement,
    ).toHaveProperty('checked', true);
    expect(checkbox('Hosting').checked).toBe(true);
    expect(checkbox('Tentwenty').checked).toBe(false);
  });

  it('gives every month with data a row, showing what was saved', async () => {
    renderPage();

    expect(await screen.findByText('January 2025')).toBeDefined();
    expect(overheadFor('January 2025').value).toBe('');
    expect(overheadFor('February 2025').value).toBe('5000');
  });

  it('adds a row for a month that only carries overhead, so it can be cleared', async () => {
    meta.mockResolvedValue(
      appMeta({
        settings: { billableCategories: ['Projects'], monthlyOverhead: { '2024-11': 900 } },
      }),
    );

    renderPage();

    expect(await screen.findByText('November 2024')).toBeDefined();
    expect(overheadFor('November 2024').value).toBe('900');
  });

  it('keeps a billable category that has no hours behind it, and says so', async () => {
    // The selection is a stored setting; the names come from the timesheet. A
    // partial upload parts them, and the defaults name three categories on a
    // database that has none of them.
    meta.mockResolvedValue(
      appMeta({
        categories: ['Projects', 'Tentwenty'],
        settings: { billableCategories: ['Projects', 'Hosting'], monthlyOverhead: {} },
      }),
    );

    renderPage();

    // Its label carries the reason, so a box with no hours behind it is not read
    // as an ordinary one.
    const hosting = (await screen.findByRole('checkbox', {
      name: /Hosting no hours logged/,
    })) as HTMLInputElement;

    expect(hosting.checked).toBe(true);
    expect(checkbox('Projects').checked).toBe(true);
    expect(checkbox('Tentwenty').checked).toBe(false);
  });

  it('does not drop that category when another box is clicked', async () => {
    const user = userEvent.setup();
    meta.mockResolvedValue(
      appMeta({
        categories: ['Projects', 'Tentwenty'],
        settings: { billableCategories: ['Projects', 'Hosting'], monthlyOverhead: {} },
      }),
    );

    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: 'Tentwenty' }));
    await user.click(saveButton());

    // Hosting was never touched and is still billable. Losing it would make its
    // hours internal and take every Hosting project out of the costing.
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        billableCategories: ['Projects', 'Tentwenty', 'Hosting'],
        monthlyOverhead: {},
      }),
    );
  });

  it('says that overhead breaks the self-check on purpose', async () => {
    renderPage();

    expect(await screen.findByText(/deliberately breaks/i)).toBeDefined();
  });
});

describe('saving', () => {
  it('leaves Save disabled until something actually changes', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(saveButton().disabled).toBe(true));

    await user.click(screen.getByRole('checkbox', { name: 'Tentwenty' }));
    expect(saveButton().disabled).toBe(false);

    // Undoing the change is not a change.
    await user.click(screen.getByRole('checkbox', { name: 'Tentwenty' }));
    expect(saveButton().disabled).toBe(true);
  });

  it('sends the unchecked category as an absence and confirms the save', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: 'Hosting' }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        billableCategories: ['Projects'],
        monthlyOverhead: { '2025-02': 5_000 },
      }),
    );
    expect(await screen.findByText(/settings saved/i)).toBeDefined();
    expect(saveButton().disabled).toBe(true);
  });

  it('reads a blank field as no overhead rather than sending a zero', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.clear(await screen.findByLabelText('Overhead for February 2025'));
    await user.click(saveButton());

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        billableCategories: ['Projects', 'Hosting'],
        monthlyOverhead: {},
      }),
    );
  });

  it('copies the first month figure to every month', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Overhead for January 2025'), '7500');
    await user.click(screen.getByRole('button', { name: /copy to all months/i }));

    expect(overheadFor('January 2025').value).toBe('7500');
    expect(overheadFor('February 2025').value).toBe('7500');

    await user.click(saveButton());

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        billableCategories: ['Projects', 'Hosting'],
        monthlyOverhead: { '2025-01': 7_500, '2025-02': 7_500 },
      }),
    );
  });

  it('surfaces a rejected save rather than claiming it worked', async () => {
    const user = userEvent.setup();
    save.mockRejectedValue(new ApiError(400, 'The overhead for 2025-01 must be a number.'));
    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: 'Tentwenty' }));
    await user.click(saveButton());

    expect(await screen.findByText(/must be a number/i)).toBeDefined();
    expect(screen.queryByText(/settings saved/i)).toBeNull();
  });
});

describe('overhead that cannot be read', () => {
  it('says so on the row and refuses to save it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Overhead for January 2025'), '12k');

    const message = await screen.findByText(/enter an amount in dirhams/i);

    expect(message).toBeDefined();
    expect(overheadFor('January 2025').getAttribute('aria-invalid')).toBe('true');
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/fix the overhead amount above/i)).toBeDefined();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('unchecking every category', () => {
  it('explains what that does instead of silently allowing it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: 'Projects' }));
    await user.click(screen.getByRole('checkbox', { name: 'Hosting' }));

    const warning = screen.getByRole('status');

    expect(within(warning).getByText(/nothing is billable/i)).toBeDefined();
    expect(within(warning).getByText(/no project can be costed/i)).toBeDefined();
    // Allowed, as the engine handles it — the point is that the reader knows.
    expect(saveButton().disabled).toBe(false);
  });
});
