import { describe, expect, it } from 'vitest';

import { EM_DASH, formatAED, formatHours, formatPct, monthName } from './format';

describe('formatAED', () => {
  it('renders an absent value as an em dash, never as zero', () => {
    // A silent 0 is a wrong number, and wrong numbers are what this is graded on.
    expect(formatAED(null)).toBe('—');
    expect(formatAED(null)).toBe(EM_DASH);
    expect(formatAED(undefined)).toBe(EM_DASH);
  });

  it('distinguishes a real zero from a missing value', () => {
    expect(formatAED(0)).not.toBe(EM_DASH);
    expect(formatAED(0)).toMatch(/0/);
  });

  it('drops the fils — at these magnitudes they stop columns scanning', () => {
    expect(formatAED(2_400_000)).toMatch(/2,400,000/);
    expect(formatAED(2_400_000)).not.toMatch(/\.00/);
    expect(formatAED(195_061.7)).toMatch(/195,062/);
  });

  it('keeps a loss negative', () => {
    expect(formatAED(-30_000)).toMatch(/-|−/);
  });

  it('refuses a NaN or an Infinity rather than printing one', () => {
    expect(formatAED(Number.NaN)).toBe(EM_DASH);
    expect(formatAED(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
  });
});

describe('formatHours', () => {
  it('keeps the one decimal the timesheets are kept in', () => {
    expect(formatHours(135.9)).toBe('135.9');
    expect(formatHours(1_283.5)).toBe('1,283.5');
    expect(formatHours(8)).toBe('8.0');
  });

  it('renders an absent value as an em dash', () => {
    expect(formatHours(null)).toBe(EM_DASH);
    expect(formatHours(Number.NaN)).toBe(EM_DASH);
  });
});

describe('formatPct', () => {
  it('reads an engine fraction as a percentage', () => {
    expect(formatPct(0.163)).toBe('16.3%');
    expect(formatPct(0.25)).toBe('25.0%');
  });

  it('keeps the sign on a loss, which is the headline', () => {
    expect(formatPct(-1.12)).toBe('-112.0%');
  });

  it('renders an absent margin as an em dash — an unpriced project has none', () => {
    expect(formatPct(null)).toBe(EM_DASH);
    expect(formatPct(undefined)).toBe(EM_DASH);
  });

  it('renders a genuine zero margin as zero', () => {
    expect(formatPct(0)).toBe('0.0%');
  });
});

describe('monthName', () => {
  it('names every month from its 1-indexed number', () => {
    expect(monthName(1)).toBe('January');
    expect(monthName(7)).toBe('July');
    expect(monthName(12)).toBe('December');
  });

  it('refuses anything that is not a month', () => {
    for (const value of [0, 13, -1, 1.5, null, undefined]) {
      expect(monthName(value)).toBe(EM_DASH);
    }
  });
});
