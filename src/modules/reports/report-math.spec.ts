import { BadRequestException } from '@nestjs/common';
import { parseDateOnly } from '../../common/dates/date-only';
import { monthKey, monthKeys, reportRange } from './report-math';

const d = parseDateOnly;

describe('monthKeys', () => {
  it('lists every month of the range, both ends included', () => {
    expect(monthKeys(d('2025-11-20'), d('2026-02-03'))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('returns a single month for a range inside one month', () => {
    expect(monthKeys(d('2026-03-05'), d('2026-03-31'))).toEqual(['2026-03']);
  });

  it('does not skip short months from a day-31 start', () => {
    expect(monthKeys(d('2026-01-31'), d('2026-03-01'))).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('monthKey', () => {
  it('formats a date-only value', () => {
    expect(monthKey(d('2026-09-30'))).toBe('2026-09');
  });
});

describe('reportRange', () => {
  it('parses a valid range', () => {
    const range = reportRange('2026-01-01', '2026-12-31');
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('rejects a reversed range', () => {
    expect(() => reportRange('2026-02-01', '2026-01-01')).toThrow(BadRequestException);
  });

  it('rejects a range longer than two years', () => {
    expect(() => reportRange('2023-01-01', '2026-01-01')).toThrow(BadRequestException);
  });
});
