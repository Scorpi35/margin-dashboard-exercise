import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProjects } from '../../src/parse/projects';
import { workbookBuffer } from './parse-fixtures';

const SAMPLE = join(__dirname, '../../../sample-data/project-prices-2025.xlsx');

const HEADER = [
  'Ref Code',
  'Project (Billable) Name',
  'Project Price',
  'Sales month',
  'Category',
  'Status',
];

function projectRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    'Ref Code': 'Q2025001a',
    'Project (Billable) Name': 'Meridian-Website.pdf',
    'Project Price': 560000,
    'Sales month': "January '25",
    Category: 'Projects',
    Status: 'in progress',
  };

  return HEADER.map((column) => (column in overrides ? overrides[column] : base[column]));
}

function parseSample() {
  return parseProjects(readFileSync(SAMPLE), 'project-prices-2025.xlsx');
}

function parseFixture(rows: unknown[][], sheetName = 'Projects') {
  return parseProjects(workbookBuffer(sheetName, rows), 'fixture.xlsx');
}

describe('parseProjects on the sample file', () => {
  it('reads every project without a warning', () => {
    const { rows, warnings } = parseSample();

    expect(rows).toHaveLength(11);
    expect(warnings).toEqual([]);
  });

  it("resolves the price list's own month format", () => {
    // "January '25" here versus "January 2025" in the timesheet — both must land
    // on the same period.
    const [first] = parseSample().rows;

    expect(first.salesYear).toBe(2025);
    expect(first.salesMonth).toBe(1);
  });

  it('gives every project a finite price and a known category', () => {
    const { rows } = parseSample();

    expect(rows.every((row) => row.projectPrice !== null && Number.isFinite(row.projectPrice)));
    expect(new Set(rows.map((row) => row.category))).toEqual(
      new Set(['Projects', 'Enhancements', 'Hosting']),
    );
  });

  it('reads every status as one of the two the file uses', () => {
    const { rows } = parseSample();

    expect(rows.every((row) => row.status === 'in progress' || row.status === 'completed')).toBe(
      true,
    );
  });

  it('has no duplicate ref codes', () => {
    const { rows } = parseSample();

    expect(new Set(rows.map((row) => row.refCode)).size).toBe(rows.length);
  });
});

describe('parseProjects row-level recovery', () => {
  it('skips a row with no ref code', () => {
    const { rows, warnings } = parseFixture([HEADER, projectRow({ 'Ref Code': '  ' })]);

    expect(rows).toEqual([]);
    expect(warnings[0].message).toMatch(/no ref code/i);
  });

  it('skips a row whose price is not a number, rather than pricing it at zero', () => {
    // The ref code then surfaces in unpricedRefCodes if the timesheet has hours
    // against it, which is a visible gap rather than a silent free project.
    const { rows, warnings } = parseFixture([
      HEADER,
      projectRow({ 'Project Price': '-' }),
      projectRow({ 'Ref Code': 'Q2025004c', 'Project Price': 'TBC' }),
    ]);

    expect(rows).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0].message).toMatch(/is not a price/i);
  });

  it('reads a price written with thousands separators', () => {
    const { rows } = parseFixture([HEADER, projectRow({ 'Project Price': '560,000' })]);

    expect(rows[0].projectPrice).toBe(560000);
  });

  it('keeps the first of a duplicated ref code and warns', () => {
    const { rows, warnings } = parseFixture([
      HEADER,
      projectRow({ 'Project Price': 560000 }),
      projectRow({ 'Project Price': 999999 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].projectPrice).toBe(560000);
    expect(warnings[0].message).toMatch(/already appeared on row 2/i);
  });

  it('leaves an unreadable sales month null and keeps the price', () => {
    // Absent is null, never 0 — 0 is not a month, and revenue is attributed by
    // hours logged rather than by sales month anyway.
    const { rows, warnings } = parseFixture([HEADER, projectRow({ 'Sales month': 'Q1 2025' })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].projectPrice).toBe(560000);
    expect(rows[0].salesYear).toBeNull();
    expect(rows[0].salesMonth).toBeNull();
    expect(warnings[0].message).toMatch(/without a sales month/i);
  });

  it('leaves a blank sales month null without a warning', () => {
    const { rows, warnings } = parseFixture([HEADER, projectRow({ 'Sales month': '-' })]);

    expect(rows[0].salesYear).toBeNull();
    expect(rows[0].salesMonth).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('normalises status spelling and rejects anything else', () => {
    const { rows, warnings } = parseFixture([
      HEADER,
      projectRow({ Status: 'In Progress' }),
      projectRow({ 'Ref Code': 'Q2025004c', Status: 'COMPLETED' }),
      projectRow({ 'Ref Code': 'Q2025009b', Status: 'on hold' }),
      projectRow({ 'Ref Code': 'Q2025014d', Status: '' }),
    ]);

    expect(rows.map((row) => row.status)).toEqual(['in progress', 'completed', null, null]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/without a status/i);
  });

  it('does not confuse the two columns whose names contain "project"', () => {
    const { rows } = parseFixture([HEADER, projectRow()]);

    expect(rows[0].projectName).toBe('Meridian-Website.pdf');
    expect(rows[0].projectPrice).toBe(560000);
  });
});

describe('parseProjects structural failures', () => {
  it('throws naming a required column that is missing entirely', () => {
    const header = HEADER.filter((column) => column !== 'Project Price');

    expect(() => parseFixture([header, header.map(() => 'x')])).toThrow(/"price"/i);
  });

  it('throws when the sheet is named something else', () => {
    expect(() => parseFixture([HEADER, projectRow()], 'Sheet1')).toThrow(
      /no sheet named "Projects"/i,
    );
  });
});
