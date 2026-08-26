import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb, resetDb, useDatabase } from '../../src/lib/db';
import { closeTestDatabase, entry, openTestDatabase, parsed } from './db-fixtures';
import { ingestTimesheet } from '../../src/services/ingest.service';

let path = '';

beforeEach(() => {
  path = openTestDatabase();
});

afterEach(closeTestDatabase);

describe('the schema', () => {
  it('creates every table on a fresh file', () => {
    const tables = (
      getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining(['timesheet_entries', 'salaries', 'projects', 'settings', 'uploads']),
    );
  });

  it('is idempotent — reopening an existing database keeps its data', () => {
    ingestTimesheet(parsed([entry()]), 'first.xlsx');
    const before = getDb().prepare('SELECT COUNT(*) AS count FROM timesheet_entries').get();

    // Every statement is IF NOT EXISTS, so opening again re-runs the whole script.
    useDatabase(path);
    useDatabase(path);

    expect(getDb().prepare('SELECT COUNT(*) AS count FROM timesheet_entries').get()).toEqual(
      before,
    );
  });

  it('runs in WAL mode with foreign keys on', () => {
    expect(getDb().pragma('journal_mode', { simple: true })).toBe('wal');
    expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('resetDb', () => {
  it('empties every table but keeps the schema', () => {
    ingestTimesheet(parsed([entry()]), 'first.xlsx');

    resetDb();

    expect(getDb().prepare('SELECT COUNT(*) AS count FROM timesheet_entries').get()).toEqual({
      count: 0,
    });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM uploads').get()).toEqual({ count: 0 });
    // Still usable straight afterwards.
    expect(() => ingestTimesheet(parsed([entry()]), 'second.xlsx')).not.toThrow();
  });
});

describe('the database file', () => {
  it('is gitignored — it is derived from the spreadsheets and rebuildable', () => {
    const gitignore = readFileSync(join(__dirname, '../../../.gitignore'), 'utf8');

    expect(gitignore).toMatch(/^data\/$/m);
  });
});
