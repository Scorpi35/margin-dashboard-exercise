import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from '@/App';

const ROUTES = [
  { path: '/', label: 'Dashboard' },
  { path: '/projects', label: 'Projects' },
  { path: '/productivity', label: 'Productivity' },
  { path: '/categories', label: 'Categories' },
  { path: '/upload', label: 'Upload' },
  { path: '/settings', label: 'Settings' },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('the application shell', () => {
  it.each(ROUTES)('keeps the nav visible on $path', ({ path }) => {
    renderAt(path);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const route of ROUTES) {
      expect(within(nav).getByRole('link', { name: route.label })).toBeDefined();
    }
  });

  it.each(ROUTES)('renders the $label page at $path', ({ path, label }) => {
    renderAt(path);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(label);
  });

  it('marks the current page in the nav', () => {
    renderAt('/projects');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    const current = within(nav).getByRole('link', { name: 'Projects' });

    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('does not mark Dashboard as current on another route', () => {
    // `end` on the "/" link — without it every route would match it.
    renderAt('/settings');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe(
      null,
    );
  });

  it('reaches every nav link by keyboard, in order', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const route of ROUTES) {
      await user.tab();
      expect(document.activeElement).toBe(within(nav).getByRole('link', { name: route.label }));
    }
  });

  it('sends an unknown address to a page that says so', () => {
    renderAt('/nope');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeDefined();
  });
});
