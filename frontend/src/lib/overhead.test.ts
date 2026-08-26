import { describe, expect, it } from 'vitest';

import {
  draftFromOverhead,
  invalidOverheadMonths,
  overheadFromDraft,
  overheadMonths,
  parseOverheadAmount,
} from '@/lib/overhead';

describe('parseOverheadAmount', () => {
  it('reads a plain amount, with or without thousands separators', () => {
    expect(parseOverheadAmount('12000')).toBe(12_000);
    expect(parseOverheadAmount('12,000')).toBe(12_000);
    expect(parseOverheadAmount(' 12,000.50 ')).toBe(12_000.5);
  });

  it('reads a blank field as no overhead rather than as unreadable', () => {
    expect(parseOverheadAmount('')).toBe(0);
    expect(parseOverheadAmount('   ')).toBe(0);
  });

  it('refuses anything that is not an amount, rather than coercing it', () => {
    // `Number('12k')` is NaN, and a NaN in the indirect pool makes every figure
    // on the dashboard NaN.
    for (const text of ['12k', 'banana', '-500', '1e3', '0x10', '12.345', '1,2,3']) {
      expect(parseOverheadAmount(text)).toBeNull();
    }
  });
});

describe('the draft and the map it becomes', () => {
  it('names the months that cannot be read', () => {
    expect(invalidOverheadMonths({ '2025-01': '1000', '2025-02': 'nope', '2025-03': '' })).toEqual([
      '2025-02',
    ]);
  });

  it('omits a month at zero rather than storing it', () => {
    // An absent month is no overhead, so the two say the same thing and the
    // stored map stays down to the months that carry a cost.
    expect(overheadFromDraft({ '2025-01': '12000', '2025-02': '', '2025-03': '0' })).toEqual({
      '2025-01': 12_000,
    });
  });

  it('seeds a field per month, blank where nothing was saved', () => {
    expect(draftFromOverhead(['2025-01', '2025-02'], { '2025-02': 900 })).toEqual({
      '2025-01': '',
      '2025-02': '900',
    });
  });

  it('keeps a row for a month that only exists in the saved overhead', () => {
    // Its overhead is still costed by the engine, and an invisible row cannot be
    // cleared.
    expect(overheadMonths(['2025-02', '2025-01'], { '2024-12': 500 })).toEqual([
      '2024-12',
      '2025-01',
      '2025-02',
    ]);
  });
});
