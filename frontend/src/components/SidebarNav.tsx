import { NavLink } from 'react-router-dom';

/**
 * The persistent left sidebar.
 *
 * Sticky from `sm` up: the nav is a fixed set of destinations, so scrolling a
 * long projects table must not carry it off the screen. `h-dvh` gives it the
 * viewport to stick within, and it scrolls internally if the list ever outgrows
 * a short window.
 *
 * Below `sm` it becomes a horizontal scrolling bar across the top, so every
 * destination stays reachable at 375px rather than hiding behind a menu button.
 */

interface NavItem {
  readonly to: string;
  readonly label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/projects', label: 'Projects' },
  { to: '/productivity', label: 'Productivity' },
  { to: '/categories', label: 'Categories' },
  { to: '/upload', label: 'Upload' },
  { to: '/settings', label: 'Settings' },
];

export default function SidebarNav() {
  return (
    <nav
      aria-label="Main"
      className="shrink-0 border-line bg-paper-raised border-b sm:sticky sm:top-0 sm:h-dvh sm:w-56 sm:overflow-y-auto sm:border-r sm:border-b-0"
    >
      <div className="border-line hidden border-b px-5 py-4 sm:block">
        <p className="text-ink text-sm font-semibold">Margin Dashboard</p>
        <p className="text-ink-faint mt-0.5 text-xs">Agency profitability</p>
      </div>

      <ul className="flex gap-1 overflow-x-auto px-2 py-2 sm:flex-col sm:gap-0.5 sm:px-3 sm:py-3">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="shrink-0">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-accent-soft text-accent font-medium'
                    : 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
