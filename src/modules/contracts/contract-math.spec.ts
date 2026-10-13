import { Prisma } from '@prisma/client';
import {
  addMonths,
  annualValue,
  contractState,
  noticeDeadline,
  reminderDue,
  settle,
  termEnd,
  termMonths,
  type ContractDates,
} from './contract-math';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

const contract = (extra: Partial<ContractDates> = {}): ContractDates => ({
  status: 'ACTIVE',
  endDate: d('2026-12-31'),
  autoRenew: false,
  renewalMonths: null,
  noticeDays: 30,
  reminderDays: 30,
  terminatedOn: null,
  remindedFor: null,
  ...extra,
});

describe('contract-math', () => {
  it('adds calendar months and computes term ends', () => {
    expect(iso(addMonths(d('2026-01-31'), 1))).toBe('2026-02-28');
    expect(iso(addMonths(d('2028-01-31'), 1))).toBe('2028-02-29');
    expect(iso(termEnd(d('2026-01-01'), 12))).toBe('2026-12-31');
    expect(iso(termEnd(d('2026-03-15'), 6))).toBe('2026-09-14');
    expect(termMonths(d('2026-01-01'), d('2026-12-31'))).toBe(12);
    expect(termMonths(d('2026-03-15'), d('2026-09-14'))).toBe(6);
  });

  it('reminds before the end, or before the notice deadline when it renews itself', () => {
    const plain = contract();
    expect(contractState(plain, d('2026-11-30'))).toBe('ACTIVE');
    expect(contractState(plain, d('2026-12-01'))).toBe('EXPIRING');
    expect(reminderDue(plain, d('2026-11-30'))).toBe(false);
    expect(reminderDue(plain, d('2026-12-01'))).toBe(true);
    expect(reminderDue({ ...plain, remindedFor: d('2026-12-31') }, d('2026-12-10'))).toBe(false);

    const renewing = contract({ autoRenew: true, renewalMonths: 12 });
    expect(iso(noticeDeadline(renewing))).toBe('2026-12-01');
    expect(contractState(renewing, d('2026-11-01'))).toBe('EXPIRING');
    expect(reminderDue(renewing, d('2026-10-31'))).toBe(false);
    expect(reminderDue(renewing, d('2026-11-01'))).toBe(true);

    expect(contractState(contract({ terminatedOn: d('2026-06-30') }), d('2026-06-01'))).toBe(
      'TERMINATING',
    );
    expect(reminderDue(contract({ endDate: null }), d('2026-12-01'))).toBe(false);
  });

  it('settles contracts whose last day has passed', () => {
    expect(settle(contract(), d('2026-12-31'))).toEqual({ kind: 'NONE' });
    expect(settle(contract(), d('2027-01-01'))).toEqual({ kind: 'EXPIRE' });
    expect(settle(contract({ terminatedOn: d('2026-06-30') }), d('2026-07-01'))).toEqual({
      kind: 'TERMINATE',
    });
    expect(settle(contract({ status: 'DRAFT' }), d('2027-06-01'))).toEqual({ kind: 'NONE' });
    const renewed = settle(contract({ autoRenew: true, renewalMonths: 12 }), d('2027-01-01'));
    expect(renewed).toMatchObject({ kind: 'RENEW', times: 1 });
    expect(renewed.kind === 'RENEW' && iso(renewed.endDate)).toBe('2027-12-31');
    const missed = settle(contract({ autoRenew: true, renewalMonths: 6 }), d('2027-08-15'));
    expect(missed).toMatchObject({ kind: 'RENEW', times: 2 });
    expect(missed.kind === 'RENEW' && iso(missed.endDate)).toBe('2027-12-31');
  });

  it('annualises the contract value', () => {
    const base = { startDate: d('2026-01-01'), endDate: d('2027-12-31') };
    const value = (amount: number, billingCycle: 'ONE_TIME' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY') =>
      annualValue({ ...base, amount: new Prisma.Decimal(amount), billingCycle })?.toFixed(2);
    expect(value(1000, 'MONTHLY')).toBe('12000.00');
    expect(value(3000, 'QUARTERLY')).toBe('12000.00');
    expect(value(50000, 'YEARLY')).toBe('50000.00');
    expect(value(24000, 'ONE_TIME')).toBe('12000.00');
    expect(
      annualValue({
        ...base,
        endDate: d('2026-06-30'),
        amount: new Prisma.Decimal(6000),
        billingCycle: 'ONE_TIME',
      })?.toFixed(2),
    ).toBe('6000.00');
    expect(
      annualValue({
        ...base,
        endDate: null,
        amount: new Prisma.Decimal(10),
        billingCycle: 'ONE_TIME',
      }),
    ).toBeNull();
  });
});
