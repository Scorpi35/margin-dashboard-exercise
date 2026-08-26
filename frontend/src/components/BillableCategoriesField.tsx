/**
 * Which categories count as billable.
 *
 * A checkbox per category the timesheet has ever contained, because billability
 * is a stored setting and never inferred from a name — `Tentwenty` is internal
 * product work and carries no `FC - ` prefix, so prefix-matching would book 138.7
 * hours of it as revenue-generating.
 *
 * A saved category with no hours behind it still gets a row. The two lists come
 * from different places — the selection is a stored setting, the names are
 * `SELECT DISTINCT category FROM timesheet_entries` — so they part company as
 * soon as a partial timesheet is uploaded, and the defaults name three
 * categories on a database that has none of them. Showing only the intersection
 * would hide a billable category, and rebuilding the selection from it would
 * quietly drop that category on the next click.
 */

interface BillableCategoriesFieldProps {
  /** Every category present in the data, from `GET /api/meta`. */
  readonly categories: readonly string[];
  readonly selected: readonly string[];
  readonly onChange: (selected: readonly string[]) => void;
}

export default function BillableCategoriesField({
  categories,
  selected,
  onChange,
}: BillableCategoriesFieldProps) {
  // The data's order first, so the list reads the same before and after a click,
  // with anything billable-but-unlogged appended rather than lost.
  const shown = [...new Set([...categories, ...selected])];
  const present = new Set(categories);
  const chosen = new Set(selected);

  if (shown.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        No categories yet — upload a timesheet and they will appear here.
      </p>
    );
  }

  const toggle = (category: string) => {
    const next = new Set(chosen);
    if (next.has(category)) next.delete(category);
    else next.add(category);

    onChange(shown.filter((name) => next.has(name)));
  };

  return (
    <>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {shown.map((category) => (
          <li key={category}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(category)}
                onChange={() => toggle(category)}
                className="accent-accent size-4"
              />
              <span className="text-ink">{category}</span>
              {/* The space is the separator a screen reader reads: without it the
                  two spans run together as "Hostingno hours logged". A whitespace
                  -only flex item is not rendered, so the layout is unchanged. */}
              {!present.has(category) && (
                <>
                  {' '}
                  <span className="text-ink-faint text-xs">no hours logged</span>
                </>
              )}
            </label>
          </li>
        ))}
      </ul>

      {chosen.size === 0 && (
        <div
          role="status"
          className="border-warning bg-warning-soft mt-4 rounded-md border p-3 text-xs"
        >
          <p className="text-warning font-medium">Nothing is billable.</p>
          <p className="text-ink-muted mt-1">
            Every hour becomes internal time, so the indirect pool absorbs the whole payroll, the
            indirect rate falls to zero for want of billable hours to spread it over, and no project
            can be costed — the projects list will be empty. Total cost still equals total salaries.
            Saving this is allowed; it is unlikely to be what you meant.
          </p>
        </div>
      )}
    </>
  );
}
