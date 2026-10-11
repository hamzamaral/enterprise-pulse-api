import { documentAmounts, lineAmounts, toBase } from './document-totals';

const fixed = (amounts: Record<string, { toFixed(n: number): string }>) =>
  Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v.toFixed(2)]));

describe('lineAmounts', () => {
  it('applies discount before VAT', () => {
    const line = lineAmounts({ quantity: 3, unitPrice: '100', discountRate: 10, vatRate: 20 });
    expect(fixed({ ...line })).toEqual({
      gross: '300.00',
      discount: '30.00',
      net: '270.00',
      vat: '54.00',
      total: '324.00',
    });
  });

  it('rounds each part half up to 2 decimals', () => {
    const line = lineAmounts({ quantity: '1.5', unitPrice: '33.335', vatRate: 18 });
    // 1.5 × 33.335 = 50.0025 → 50.00; VAT 9.00
    expect(line.gross.toFixed(2)).toBe('50.00');
    expect(line.vat.toFixed(2)).toBe('9.00');
    expect(line.total.toFixed(2)).toBe('59.00');
  });

  it('treats missing discount and VAT as zero', () => {
    const line = lineAmounts({ quantity: 2, unitPrice: 12.5 });
    expect(line.total.toFixed(2)).toBe('25.00');
    expect(line.vat.isZero()).toBe(true);
  });
});

describe('documentAmounts', () => {
  it('sums lines and groups VAT by rate', () => {
    const totals = documentAmounts([
      { quantity: 1, unitPrice: 1000, vatRate: 20 },
      { quantity: 2, unitPrice: 50, discountRate: 50, vatRate: 10 },
      { quantity: 1, unitPrice: 200, vatRate: 20 },
    ]);
    expect(totals.subtotal.toFixed(2)).toBe('1300.00');
    expect(totals.discountTotal.toFixed(2)).toBe('50.00');
    expect(totals.netTotal.toFixed(2)).toBe('1250.00');
    expect(totals.vatTotal.toFixed(2)).toBe('245.00');
    expect(totals.grandTotal.toFixed(2)).toBe('1495.00');
    expect(
      totals.vatBreakdown.map((b) => [b.rate.toFixed(0), b.base.toFixed(2), b.vat.toFixed(2)]),
    ).toEqual([
      ['10', '50.00', '5.00'],
      ['20', '1200.00', '240.00'],
    ]);
  });

  it('returns zeros for an empty document', () => {
    const totals = documentAmounts([]);
    expect(totals.grandTotal.toFixed(2)).toBe('0.00');
    expect(totals.vatBreakdown).toEqual([]);
  });
});

describe('toBase', () => {
  it('converts with the exchange rate and rounds', () => {
    expect(toBase('100.00', '34.123456').toFixed(2)).toBe('3412.35');
  });
});
