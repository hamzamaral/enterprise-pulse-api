import { parseDateOnly } from '../../common/dates/date-only';
import { agingBucket, allocateFifo, daysOverdue } from './finance-math';

const d = parseDateOnly;
const plain = (allocations: ReturnType<typeof allocateFifo>) =>
  allocations.map((a) => [a.invoiceId, a.amount.toFixed(2)]);

describe('allocateFifo', () => {
  const invoices = [
    { id: 'late', dueDate: d('2026-03-01'), remaining: '300' },
    { id: 'early', dueDate: d('2026-01-15'), remaining: '100.50' },
    { id: 'settled', dueDate: d('2025-12-01'), remaining: '0' },
  ];

  it('settles the oldest due invoice first', () => {
    expect(plain(allocateFifo('250', invoices))).toEqual([
      ['early', '100.50'],
      ['late', '149.50'],
    ]);
  });

  it('leaves the excess unallocated', () => {
    expect(plain(allocateFifo('1000', invoices))).toEqual([
      ['early', '100.50'],
      ['late', '300.00'],
    ]);
  });

  it('skips settled invoices and returns nothing for a zero amount', () => {
    expect(allocateFifo('0', invoices)).toEqual([]);
    expect(plain(allocateFifo('50', invoices))).toEqual([['early', '50.00']]);
  });
});

describe('agingBucket', () => {
  const asOf = d('2026-10-11');

  it('counts whole days past the due date', () => {
    expect(daysOverdue(d('2026-10-01'), asOf)).toBe(10);
    expect(daysOverdue(d('2026-10-20'), asOf)).toBe(-9);
  });

  it.each([
    ['2026-10-30', 'current'],
    ['2026-10-11', 'current'],
    ['2026-10-10', 'd1_30'],
    ['2026-09-11', 'd1_30'],
    ['2026-09-10', 'd31_60'],
    ['2026-08-12', 'd31_60'],
    ['2026-08-11', 'd61_90'],
    ['2026-07-13', 'd61_90'],
    ['2026-07-12', 'd90plus'],
  ])('due %s → %s', (due, bucket) => {
    expect(agingBucket(d(due), asOf)).toBe(bucket);
  });
});
