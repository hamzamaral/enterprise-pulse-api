import { crossedBelowMinimum, isWholeNumber, money, qty, weightedAverageCost } from './stock-math';

describe('stock math', () => {
  it('formats quantities without trailing zeros and money with two decimals', () => {
    expect(qty('12.000')).toBe('12');
    expect(qty(1.5)).toBe('1.5');
    expect(qty(null)).toBe('0');
    expect(money('1234.5')).toBe('1234.50');
  });

  it('computes the moving weighted average cost', () => {
    // 10 units at 100 + 30 units at 140 → (1000 + 4200) / 40 = 130
    expect(weightedAverageCost(10, 100, 30, 140).toFixed(4)).toBe('130.0000');
    // Rounds to 4 decimals: (1 × 10 + 2 × 11) / 3 = 10.6667
    expect(weightedAverageCost(1, 10, 2, 11).toFixed(4)).toBe('10.6667');
  });

  it('takes the receipt cost when nothing valued is on hand', () => {
    expect(weightedAverageCost(0, 50, 5, 80).toFixed(2)).toBe('80.00');
    expect(weightedAverageCost(-2, 50, 5, 80).toFixed(2)).toBe('80.00');
  });

  it('detects crossing below the reorder point only once', () => {
    expect(crossedBelowMinimum(12, 8, 10)).toBe(true);
    expect(crossedBelowMinimum(10, 9, 10)).toBe(true);
    expect(crossedBelowMinimum(9, 5, 10)).toBe(false);
    expect(crossedBelowMinimum(12, 10, 10)).toBe(false);
    expect(crossedBelowMinimum(5, 0, 0)).toBe(false);
  });

  it('recognises whole quantities for serial-tracked items', () => {
    expect(isWholeNumber('3.000')).toBe(true);
    expect(isWholeNumber(2.5)).toBe(false);
  });
});
