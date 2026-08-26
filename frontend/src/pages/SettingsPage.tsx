import { useEffect, useMemo, useRef, useState } from 'react';

import type { AppMeta, Settings, YearMonthKey } from '@shared/types';

import BillableCategoriesField from '@/components/BillableCategoriesField';
import MonthlyOverheadTable from '@/components/MonthlyOverheadTable';
import { ApiError, getMeta, saveSettings } from '@/lib/api';
import {
  draftFromOverhead,
  invalidOverheadMonths,
  overheadFromDraft,
  overheadMonths,
} from '@/lib/overhead';

/**
 * The two assumptions the cost model takes from the user rather than from a
 * spreadsheet: which categories are billable, and the overhead for each month.
 *
 * Both change every number in the app, so the page is deliberately explicit about
 * what a change does — including that non-zero overhead breaks the self-check on
 * purpose.
 */

type Draft = Record<YearMonthKey, string>;

export default function SettingsPage() {
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [overhead, setOverhead] = useState<Draft>({});
  const [months, setMonths] = useState<readonly YearMonthKey[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether this page is still on screen.
   *
   * The load has its own `cancelled` flag; the save needs one too, or navigating
   * away mid-request writes four setters on an unmounted page. Assigned in the
   * effect body rather than only in its cleanup, so StrictMode's remount does not
   * leave it stuck at `false`.
   */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getMeta()
      .then((loaded) => {
        if (cancelled) return;

        const rows = overheadMonths(loaded.months, loaded.settings.monthlyOverhead);
        setMeta(loaded);
        setSaved(loaded.settings);
        setCategories(loaded.settings.billableCategories);
        setMonths(rows);
        setOverhead(draftFromOverhead(rows, loaded.settings.monthlyOverhead));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describe(err, 'Could not load the settings.'));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const invalidMonths = useMemo(() => invalidOverheadMonths(overhead), [overhead]);
  const changed = useMemo(
    () => saved !== null && differs(saved, categories, overhead),
    [saved, categories, overhead],
  );

  if (error !== null && meta === null) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">Settings</h1>
        <p role="alert" className="text-negative mt-2 text-sm">
          {error}
        </p>
      </section>
    );
  }

  if (meta === null) {
    return (
      <section>
        <h1 className="text-ink text-xl font-semibold">Settings</h1>
        <p className="text-ink-muted mt-4 text-sm">Loading…</p>
      </section>
    );
  }

  const save = () => {
    setStatus('saving');
    setError(null);

    saveSettings({
      billableCategories: categories,
      monthlyOverhead: overheadFromDraft(overhead),
    })
      .then((stored) => {
        if (!mounted.current) return;
        setSaved(stored);
        setCategories(stored.billableCategories);
        setOverhead(draftFromOverhead(months, stored.monthlyOverhead));
        setStatus('saved');
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setStatus('idle');
        setError(describe(err, 'Could not save the settings.'));
      });
  };

  return (
    <section>
      <h1 className="text-ink text-xl font-semibold">Settings</h1>
      <p className="text-ink-muted mt-1 text-sm">
        What the cost model assumes. Both settings apply everywhere at once — changing them changes
        every figure in the dashboard.
      </p>

      <h2 className="text-ink mt-8 text-sm font-semibold">Billable categories</h2>
      <p className="text-ink-muted mt-1 mb-3 text-xs">
        Hours in these categories are charged to projects. Everything else is internal time, valued
        at the person&apos;s own rate and absorbed into the indirect pool.
      </p>
      <BillableCategoriesField
        categories={meta.categories}
        selected={categories}
        onChange={(next) => {
          setCategories(next);
          setStatus('idle');
        }}
      />

      <h2 className="text-ink mt-10 text-sm font-semibold">Monthly overhead</h2>
      <p className="text-ink-muted mt-1 mb-3 text-xs">
        Rent, software, and everything else that is cost but not salary. Entered per month because
        it genuinely varies; a blank field means no overhead for that month.
      </p>
      <MonthlyOverheadTable
        months={months}
        values={overhead}
        onChange={(next) => {
          setOverhead(next);
          setStatus('idle');
        }}
      />
      <p className="text-ink-muted mt-3 text-xs">
        Non-zero overhead deliberately breaks the <code>cost == salaries</code> self-check, because
        overhead is real cost that is not salary. <code>npm run selfcheck</code> forces overhead to
        zero for that reason, so the invariant stays testable whatever is saved here.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!changed || invalidMonths.length > 0 || status === 'saving'}
          onClick={save}
          className="bg-accent hover:bg-accent-hover rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : 'Save settings'}
        </button>

        {status === 'saved' && !changed && (
          <p role="status" className="text-positive text-sm">
            Settings saved. Every page now uses them.
          </p>
        )}

        {invalidMonths.length > 0 && (
          <p role="alert" className="text-negative text-sm">
            Fix the {invalidMonths.length === 1 ? 'overhead amount' : 'overhead amounts'} above
            before saving.
          </p>
        )}

        {error !== null && (
          <p role="alert" className="text-negative text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/** An ApiError carries a message written for a reader; anything else does not. */
function describe(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Whether the form says anything different from what was last saved.
 *
 * Compared against the stored settings rather than tracked with a dirty flag, so
 * typing a figure and typing it back leaves Save disabled — the button offers to
 * change something, and there would be nothing to change.
 */
function differs(saved: Settings, categories: readonly string[], overhead: Draft): boolean {
  const sameCategories =
    saved.billableCategories.length === categories.length &&
    saved.billableCategories.every((category) => categories.includes(category));

  const draft = overheadFromDraft(overhead);
  const sameOverhead =
    Object.keys(saved.monthlyOverhead).length === Object.keys(draft).length &&
    Object.entries(draft).every(([month, amount]) => saved.monthlyOverhead[month] === amount);

  return !sameCategories || !sameOverhead;
}
