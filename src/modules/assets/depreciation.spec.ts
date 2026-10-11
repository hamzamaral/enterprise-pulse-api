import { parseDateOnly } from '../../common/dates/date-only';
import { calculateDepreciation, monthsBetween } from './depreciation';

const d = parseDateOnly;

describe('monthsBetween', () => {
  it('counts whole months only', () => {
    expect(monthsBetween(d('2026-01-15'), d('2026-03-14'))).toBe(1);
    expect(monthsBetween(d('2026-01-15'), d('2026-03-15'))).toBe(2);
    expect(monthsBetween(d('2025-11-01'), d('2026-02-01'))).toBe(3);
  });
});

describe('calculateDepreciation', () => {
  const laptop = {
    cost: 36000,
    salvageValue: 0,
    usefulLifeMonths: 36,
    purchaseDate: d('2025-01-01'),
  };

  it('depreciates linearly per month', () => {
    const result = calculateDepreciation({ ...laptop, asOf: d('2026-01-01') });
    expect(result.monthlyAmount).toBe('1000.00');
    expect(result.elapsedMonths).toBe(12);
    expect(result.accumulated).toBe('12000.00');
    expect(result.bookValue).toBe('24000.00');
    expect(result.fullyDepreciated).toBe(false);
  });

  it('stops at the salvage value after the useful life', () => {
    const result = calculateDepreciation({
      ...laptop,
      salvageValue: 6000,
      asOf: d('2030-06-01'),
    });
    expect(result.elapsedMonths).toBe(36);
    expect(result.bookValue).toBe('6000.00');
    expect(result.fullyDepreciated).toBe(true);
  });

  it('is zero before the purchase date', () => {
    const result = calculateDepreciation({ ...laptop, asOf: d('2024-06-01') });
    expect(result.accumulated).toBe('0.00');
    expect(result.bookValue).toBe('36000.00');
  });

  it('splits the schedule across calendar years and sums to the base', () => {
    const result = calculateDepreciation({
      cost: 10000,
      salvageValue: 0,
      usefulLifeMonths: 24,
      purchaseDate: d('2025-10-01'),
      asOf: d('2026-01-01'),
    });
    expect(result.schedule.map((y) => [y.year, y.months])).toEqual([
      [2025, 3],
      [2026, 12],
      [2027, 9],
    ]);
    const total = result.schedule.reduce((sum, y) => sum + Number(y.depreciation), 0);
    expect(total).toBeCloseTo(10000, 2);
    expect(result.schedule.at(-1)?.bookValueEnd).toBe('0.00');
  });

  it('absorbs rounding in the last month', () => {
    const result = calculateDepreciation({
      cost: 1000,
      salvageValue: 0,
      usefulLifeMonths: 3,
      purchaseDate: d('2025-01-01'),
      asOf: d('2026-01-01'),
    });
    expect(result.monthlyAmount).toBe('333.33');
    expect(result.bookValue).toBe('0.00');
  });
});
