import { ExpenseCategoryKind } from '@prisma/client';
import { isMissingReceipt, isOverLimit, lineAmounts, reportTotal } from './expense-math';

describe('expense math', () => {
  it('converts receipt lines at the line rate and keeps quantity 1', () => {
    const result = lineAmounts(
      { kind: ExpenseCategoryKind.RECEIPT, rate: null },
      { quantity: 5, amount: '120.50', exchangeRate: '34.125' },
    );
    expect(result.quantity.toString()).toBe('1');
    expect(result.amount.toFixed(2)).toBe('120.50');
    expect(result.amountBase.toFixed(2)).toBe('4112.06');
  });

  it('prices per diem and mileage from the category rate in the company currency', () => {
    const perDiem = lineAmounts(
      { kind: ExpenseCategoryKind.PER_DIEM, rate: '850.00' },
      { quantity: 3, amount: 1, exchangeRate: 1 },
    );
    expect(perDiem.amount.toFixed(2)).toBe('2550.00');
    expect(perDiem.amountBase.toFixed(2)).toBe('2550.00');

    const mileage = lineAmounts(
      { kind: ExpenseCategoryKind.MILEAGE, rate: '7.35' },
      { quantity: '182.5', exchangeRate: 1 },
    );
    expect(mileage.amount.toFixed(2)).toBe('1341.38');
  });

  it('flags lines above the soft limit only when a limit is set', () => {
    expect(isOverLimit('1500.01', '1500')).toBe(true);
    expect(isOverLimit('1500', '1500')).toBe(false);
    expect(isOverLimit('99999', null)).toBe(false);
  });

  it('requires receipts only for receipt categories that ask for one', () => {
    const base = { requiresReceipt: true, receiptFileId: null };
    expect(isMissingReceipt({ ...base, kind: ExpenseCategoryKind.RECEIPT })).toBe(true);
    expect(isMissingReceipt({ ...base, kind: ExpenseCategoryKind.PER_DIEM })).toBe(false);
    expect(
      isMissingReceipt({ ...base, kind: ExpenseCategoryKind.RECEIPT, requiresReceipt: false }),
    ).toBe(false);
    expect(
      isMissingReceipt({ ...base, kind: ExpenseCategoryKind.RECEIPT, receiptFileId: 'file' }),
    ).toBe(false);
  });

  it('sums line amounts in the company currency', () => {
    expect(reportTotal([{ amountBase: '10.10' }, { amountBase: 5 }]).toFixed(2)).toBe('15.10');
    expect(reportTotal([]).toFixed(2)).toBe('0.00');
  });
});
