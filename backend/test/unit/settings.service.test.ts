import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_BILLABLE_CATEGORIES } from '@shared/types';

import { getDb } from '../../src/lib/db';
import { HttpError } from '../../src/middleware/errorHandler';
import { ingestTimesheet } from '../../src/services/ingest.service';
import {
  getAllKnownCategories,
  getSettings,
  saveSettings,
} from '../../src/services/settings.service';
import { closeTestDatabase, entry, openTestDatabase, parsed, sample } from './db-fixtures';

beforeEach(openTestDatabase);
afterEach(closeTestDatabase);

describe('getSettings on a fresh database', () => {
  it('returns the three default billable categories and no overhead', () => {
    expect(getSettings()).toEqual({
      billableCategories: ['Projects', 'Enhancements', 'Hosting'],
      monthlyOverhead: {},
    });
  });

  it('matches the shared default rather than a second copy of the list', () => {
    expect(getSettings().billableCategories).toEqual([...DEFAULT_BILLABLE_CATEGORIES]);
  });
});

describe('saveSettings', () => {
  it('round-trips both settings', () => {
    const saved = saveSettings({
      billableCategories: ['Projects', 'Retainers'],
      monthlyOverhead: { '2025-01': 12_000, '2025-07': 15_500.5 },
    });

    expect(saved).toEqual({
      billableCategories: ['Projects', 'Retainers'],
      monthlyOverhead: { '2025-01': 12_000, '2025-07': 15_500.5 },
    });
    expect(getSettings()).toEqual(saved);
  });

  it('overwrites rather than appending on a second save', () => {
    saveSettings({ billableCategories: ['A'], monthlyOverhead: { '2025-01': 1 } });
    saveSettings({ billableCategories: ['B'], monthlyOverhead: {} });

    expect(getSettings()).toEqual({ billableCategories: ['B'], monthlyOverhead: {} });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM settings').get()).toEqual({ count: 2 });
  });

  it('accepts an empty billable list — every hour then counts as internal', () => {
    saveSettings({ billableCategories: [], monthlyOverhead: {} });

    expect(getSettings().billableCategories).toEqual([]);
  });
});

describe('overhead validation', () => {
  it('rejects a key that is not a YYYY-MM month', () => {
    // Storing it would report "saved" for an amount the engine can never apply.
    for (const key of ['banana', '2025-13', '2025-00', '25-01', '2025-1']) {
      expect(() =>
        saveSettings({ billableCategories: ['Projects'], monthlyOverhead: { [key]: 100 } }),
      ).toThrow(/YYYY-MM/);
    }
  });

  it('rejects a negative or non-finite amount', () => {
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        saveSettings({ billableCategories: ['Projects'], monthlyOverhead: { '2025-01': amount } }),
      ).toThrow(/non-negative/);
    }
  });

  it('reports the rejection as a 400', () => {
    try {
      saveSettings({ billableCategories: [], monthlyOverhead: { banana: 1 } });
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(400);
    }
  });

  it('leaves the stored settings untouched when a save is rejected', () => {
    saveSettings({ billableCategories: ['Projects'], monthlyOverhead: { '2025-01': 100 } });

    expect(() =>
      saveSettings({ billableCategories: ['Changed'], monthlyOverhead: { banana: 1 } }),
    ).toThrow();

    expect(getSettings()).toEqual({
      billableCategories: ['Projects'],
      monthlyOverhead: { '2025-01': 100 },
    });
  });

  it('accepts zero, which is a real overhead figure', () => {
    expect(saveSettings({ billableCategories: [], monthlyOverhead: { '2025-01': 0 } })).toEqual({
      billableCategories: [],
      monthlyOverhead: { '2025-01': 0 },
    });
  });
});

describe('a corrupt settings row', () => {
  it('falls back to the default rather than taking the dashboard down', () => {
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('billableCategories', 'not json at all');

    expect(getSettings().billableCategories).toEqual([...DEFAULT_BILLABLE_CATEGORIES]);
  });

  it('rejects valid JSON of the wrong shape', () => {
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('monthlyOverhead', '{"2025-01":"twelve thousand"}');

    expect(getSettings().monthlyOverhead).toEqual({});
  });
});

describe('getAllKnownCategories', () => {
  it('is empty before anything is ingested', () => {
    expect(getAllKnownCategories()).toEqual([]);
  });

  it('lists each category once, sorted', () => {
    ingestTimesheet(
      parsed([
        entry({ category: 'Projects', refCode: 'A' }),
        entry({ category: 'Projects', refCode: 'B' }),
        entry({ category: 'FC - Meetings', refCode: 'FC - Meetings' }),
      ]),
      'x.xlsx',
    );

    expect(getAllKnownCategories()).toEqual(['FC - Meetings', 'Projects']);
  });

  it('offers every category the real timesheet contains', () => {
    ingestTimesheet(sample.timesheet(), 'timesheet-2025.xlsx');
    const categories = getAllKnownCategories();

    expect(categories).toHaveLength(11);
    // Tentwenty is internal work with no "FC - " prefix, so it has to be
    // selectable rather than inferred.
    expect(categories).toContain('Tentwenty');
    expect(categories).toEqual(expect.arrayContaining([...DEFAULT_BILLABLE_CATEGORIES]));
  });
});
