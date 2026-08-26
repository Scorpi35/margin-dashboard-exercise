/**
 * Seeds the SQLite database from the committed `sample-data/` spreadsheets, so a
 * clean checkout has something to look at in one command.
 *
 * Expected output is documented in `docs/data-sources.md` — 562 / 144 / 11 rows
 * and no warnings. Runs through `tsx` without starting Express.
 *
 * By default this is an ordinary ingest, so it follows the same re-upload rules
 * an upload through the UI would: each file replaces exactly the months it
 * contains, and prices upsert by ref code. Running it twice therefore leaves the
 * same row counts. Pass `--fresh` to empty every table first, which is what you
 * want after experimenting with uploads of your own.
 *
 * Exits non-zero if a parser reports a warning, because on this data a warning
 * means a parser started skipping rows it used to read.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ParseWarning } from '@shared/types';

import { closeDb, resetDb } from '../src/lib/db';
import { requireDatabase } from './require-database';
import { parseProjects } from '../src/parse/projects';
import { parseSalary } from '../src/parse/salary';
import { parseTimesheet } from '../src/parse/timesheet';
import {
  ingestProjects,
  ingestSalaries,
  ingestTimesheet,
  readProjects,
  readSalaries,
  readTimesheet,
} from '../src/services/ingest.service';

requireDatabase();

const SAMPLE_DATA = join(__dirname, '../../sample-data');
const read = (file: string): Buffer => readFileSync(join(SAMPLE_DATA, file));

const TIMESHEET_FILE = 'timesheet-2025.xlsx';
const SALARY_FILE = 'salaries-2025.xlsx';
const PROJECTS_FILE = 'project-prices-2025.xlsx';

const fresh = process.argv.includes('--fresh');

const timesheet = parseTimesheet(read(TIMESHEET_FILE), TIMESHEET_FILE);
const salaries = parseSalary(read(SALARY_FILE), SALARY_FILE);
const projects = parseProjects(read(PROJECTS_FILE), PROJECTS_FILE);

if (fresh) resetDb();

ingestTimesheet(timesheet, TIMESHEET_FILE);
ingestSalaries(salaries, SALARY_FILE);
ingestProjects(projects, PROJECTS_FILE);

console.log(`seed complete${fresh ? ' (--fresh: every table was emptied first)' : ''}\n`);
console.log(`  timesheet_entries  ${String(readTimesheet().length).padStart(4)} rows`);
console.log(`  salaries           ${String(readSalaries().length).padStart(4)} rows`);
console.log(`  projects           ${String(readProjects().length).padStart(4)} rows`);

const warnings: ParseWarning[] = [
  ...timesheet.warnings,
  ...salaries.warnings,
  ...projects.warnings,
];

closeDb();

if (warnings.length > 0) {
  console.error(`\n${warnings.length} parser warning(s) — rows were skipped:`);
  for (const warning of warnings) {
    console.error(`  ${warning.file} row ${warning.row ?? '?'}: ${warning.message}`);
  }
  process.exit(1);
}

console.log('\n  0 warnings. Run `npm run selfcheck` to verify the cost model reconciles.');
