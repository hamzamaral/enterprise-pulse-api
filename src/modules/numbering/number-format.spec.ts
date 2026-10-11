import { formatNumber } from './number-format';

describe('formatNumber', () => {
  it('includes the year and pads the sequence', () => {
    expect(formatNumber({ prefix: 'ZMT', padding: 6, includeYear: true }, 2026, 42)).toBe(
      'ZMT-2026-000042',
    );
  });

  it('omits the year when configured', () => {
    expect(formatNumber({ prefix: 'FTR', padding: 4, includeYear: false }, 2026, 7)).toBe(
      'FTR-0007',
    );
  });

  it('never truncates sequences longer than the padding', () => {
    expect(formatNumber({ prefix: 'STA', padding: 3, includeYear: false }, 2026, 12345)).toBe(
      'STA-12345',
    );
  });
});
