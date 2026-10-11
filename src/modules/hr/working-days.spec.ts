import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { countWorkingDays, rangesOverlap } from './working-days';

const d = parseDateOnly;

describe('countWorkingDays', () => {
  it('counts a full Monday–Friday week', () => {
    expect(countWorkingDays(d('2026-10-05'), d('2026-10-09'), new Set())).toBe(5);
  });

  it('skips weekends inside the range', () => {
    // Friday 2026-10-09 → Monday 2026-10-12
    expect(countWorkingDays(d('2026-10-09'), d('2026-10-12'), new Set())).toBe(2);
  });

  it('returns 0 for a range that is only a weekend', () => {
    expect(countWorkingDays(d('2026-10-10'), d('2026-10-11'), new Set())).toBe(0);
  });

  it('skips public holidays', () => {
    // Republic Day 2026-10-29 is a Thursday.
    expect(countWorkingDays(d('2026-10-26'), d('2026-10-30'), new Set(['2026-10-29']))).toBe(4);
  });

  it('counts a single working day', () => {
    expect(countWorkingDays(d('2026-10-07'), d('2026-10-07'), new Set())).toBe(1);
  });

  it('returns 0 when the end is before the start', () => {
    expect(countWorkingDays(d('2026-10-09'), d('2026-10-05'), new Set())).toBe(0);
  });
});

describe('rangesOverlap', () => {
  it('detects shared days, including touching edges', () => {
    expect(rangesOverlap(d('2026-10-05'), d('2026-10-09'), d('2026-10-09'), d('2026-10-12'))).toBe(
      true,
    );
  });

  it('returns false for disjoint ranges', () => {
    expect(rangesOverlap(d('2026-10-05'), d('2026-10-09'), d('2026-10-10'), d('2026-10-12'))).toBe(
      false,
    );
  });
});

describe('date-only helpers', () => {
  it('round-trips without shifting the day', () => {
    expect(toDateOnly(parseDateOnly('2026-03-01'))).toBe('2026-03-01');
  });
});
