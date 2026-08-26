import { describe, expect, it } from 'vitest';

import { optionalMonth, requireUploadType, requireYear } from '../../src/controllers/validation';
import { HttpError } from '../../src/middleware/errorHandler';

describe('requireYear', () => {
  it('accepts a year as Express delivers it, a string', () => {
    expect(requireYear('2025')).toBe(2025);
    expect(requireYear(' 2025 ')).toBe(2025);
    expect(requireYear(2025)).toBe(2025);
  });

  it('rejects a year that is not a number with a 400', () => {
    // The case the guidelines call out: a NaN here filters every row out and
    // renders an empty dashboard that looks like a real answer.
    expect(() => requireYear('banana')).toThrow(HttpError);
    expect(() => requireYear('banana')).toThrow(/"year"/);

    try {
      requireYear('banana');
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(400);
    }
  });

  it('rejects a missing or blank year', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(() => requireYear(value)).toThrow(HttpError);
    }
  });

  it('rejects a value that is only partly a number', () => {
    expect(() => requireYear('2025abc')).toThrow(HttpError);
    expect(() => requireYear('20.25')).toThrow(HttpError);
    expect(() => requireYear(Infinity)).toThrow(HttpError);
    expect(() => requireYear(Number.NaN)).toThrow(HttpError);
  });

  it('rejects notations Number() would happily accept', () => {
    // Number('2e3') is 2000 and Number('0x7e9') is 2025 — both inside the
    // plausible range, so a range check alone would let them through and filter
    // the dashboard to a year nobody typed.
    expect(() => requireYear('2e3')).toThrow(HttpError);
    expect(() => requireYear('0x7e9')).toThrow(HttpError);
    expect(() => requireYear('+2025')).toThrow(HttpError);
  });

  it('rejects a repeated query parameter, which Express gives as an array', () => {
    expect(() => requireYear(['2025', '2026'])).toThrow(HttpError);
  });

  it('rejects a year outside the plausible range', () => {
    expect(() => requireYear('1969')).toThrow(HttpError);
    expect(() => requireYear('2200')).toThrow(HttpError);
    expect(requireYear('1970')).toBe(1970);
    expect(requireYear('2199')).toBe(2199);
  });
});

describe('optionalMonth', () => {
  it('treats an absent month as no filter', () => {
    expect(optionalMonth(undefined)).toBeNull();
    expect(optionalMonth(null)).toBeNull();
    expect(optionalMonth('')).toBeNull();
  });

  it('accepts every month of the year', () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(optionalMonth(String(month))).toBe(month);
    }
  });

  it('rejects a month that is present but unreadable', () => {
    // Widening it back to the whole year would answer a question nobody asked.
    for (const value of ['banana', '0', '13', '-1', '1.5', ['1', '2']]) {
      expect(() => optionalMonth(value)).toThrow(HttpError);
    }
  });

  it('reports a 400, naming the parameter', () => {
    try {
      optionalMonth('13');
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(400);
      expect((err as HttpError).message).toMatch(/"month"/);
    }
  });
});

describe('requireUploadType', () => {
  it('accepts the three source files', () => {
    expect(requireUploadType('timesheet')).toBe('timesheet');
    expect(requireUploadType('salary')).toBe('salary');
    expect(requireUploadType('projects')).toBe('projects');
  });

  it('rejects anything else with a 400 that lists the valid types', () => {
    expect(() => requireUploadType('salaries')).toThrow(/"timesheet", "salary", "projects"/);
    expect(() => requireUploadType('Timesheet')).toThrow(HttpError);
    expect(() => requireUploadType(undefined)).toThrow(HttpError);
  });
});
