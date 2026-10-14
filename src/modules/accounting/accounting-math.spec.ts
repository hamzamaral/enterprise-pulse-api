import { Prisma } from '@prisma/client';
import {
  balanceSheet,
  compareCodes,
  fingerprint,
  incomeStatement,
  isBalanced,
  normalizeLines,
  reverseLines,
  toBase,
  trialBalance,
} from './accounting-math';

const d = (value: number | string) => new Prisma.Decimal(value);
const ZERO = d(0);

describe('normalizeLines', () => {
  it('drops zero lines, flips negative amounts and puts debits first', () => {
    const lines = normalizeLines([
      { code: '600', credit: 100 },
      { code: '770', debit: 0 },
      { code: '120', debit: -20 },
      { code: '100', debit: 120 },
    ]);
    expect(lines.map((l) => [l.code, l.debit.toNumber(), l.credit.toNumber()])).toEqual([
      ['100', 120, 0],
      ['600', 0, 100],
      ['120', 0, 20],
    ]);
  });

  it('merges lines with the same account, dimension and side', () => {
    const lines = normalizeLines([
      { code: '770', debit: 10 },
      { code: '770', debit: 5 },
      { code: '120', credit: 7, partnerId: 'a' },
      { code: '120', credit: 8, partnerId: 'b' },
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[0].debit.toNumber()).toBe(15);
  });
});

describe('balance helpers', () => {
  it('requires equal, non-zero sides', () => {
    expect(
      isBalanced([
        { debit: d(10), credit: ZERO },
        { debit: ZERO, credit: d(10) },
      ]),
    ).toBe(true);
    expect(
      isBalanced([
        { debit: d(10), credit: ZERO },
        { debit: ZERO, credit: d(9) },
      ]),
    ).toBe(false);
    expect(isBalanced([])).toBe(false);
  });

  it('swaps sides when reversing', () => {
    const [line] = reverseLines([{ code: '100', debit: d(5), credit: ZERO }]);
    expect([line.debit.toNumber(), line.credit.toNumber()]).toEqual([0, 5]);
  });

  it('converts to the base currency with half-up rounding', () => {
    expect(toBase(10.01, '34.125').toFixed(2)).toBe('341.59');
  });

  it('builds an order independent fingerprint', () => {
    const a = { code: '100', debit: 5, credit: 0 };
    const b = { code: '600', debit: 0, credit: 5 };
    expect(fingerprint([a, b])).toBe(fingerprint([b, a]));
    expect(fingerprint([a, b])).not.toBe(fingerprint([a, { ...b, credit: 6 }]));
  });

  it('orders account codes numerically by segment', () => {
    expect(['101', '100.10', '100', '100.2'].sort(compareCodes)).toEqual([
      '100',
      '100.2',
      '100.10',
      '101',
    ]);
  });
});

describe('trialBalance', () => {
  const accounts = [
    { code: '102', name: 'Bankalar' },
    { code: '102.01', name: 'Garanti' },
    { code: '102.02', name: 'İş Bankası' },
    { code: '500', name: 'Sermaye' },
  ];
  const movements = [
    {
      code: '102.01',
      openingDebit: d(100),
      openingCredit: ZERO,
      periodDebit: d(50),
      periodCredit: d(30),
    },
    {
      code: '102.02',
      openingDebit: ZERO,
      openingCredit: ZERO,
      periodDebit: d(20),
      periodCredit: ZERO,
    },
    {
      code: '500',
      openingDebit: ZERO,
      openingCredit: d(100),
      periodDebit: d(30),
      periodCredit: d(70),
    },
  ];

  it('rolls sub-accounts into their main account', () => {
    const { rows, totals } = trialBalance(accounts, movements, false);
    expect(rows.map((r) => r.code)).toEqual(['102', '500']);
    const bank = rows[0];
    expect(bank.periodDebit.toNumber()).toBe(70);
    expect(bank.totalDebit.toNumber()).toBe(170);
    expect(bank.balanceDebit.toNumber()).toBe(140);
    expect(rows[1].balanceCredit.toNumber()).toBe(140);
    expect(totals.balanceDebit.eq(totals.balanceCredit)).toBe(true);
  });

  it('lists sub-accounts when detailed without double counting the totals', () => {
    const { rows, totals } = trialBalance(accounts, movements, true);
    expect(rows.map((r) => [r.code, r.level])).toEqual([
      ['102', 0],
      ['102.01', 1],
      ['102.02', 1],
      ['500', 0],
    ]);
    expect(totals.totalDebit.toNumber()).toBe(200);
  });
});

describe('balanceSheet', () => {
  it('balances assets with liabilities, equity and the unclosed result', () => {
    const sheet = balanceSheet(
      [
        { code: '100', name: 'Kasa', balance: d(1_000) },
        { code: '103', name: 'Verilen Çekler (-)', balance: d(-200) },
        { code: '320', name: 'Satıcılar', balance: d(-300) },
        { code: '500', name: 'Sermaye', balance: d(-400) },
        { code: '600', name: 'Satışlar', balance: d(-100) },
      ],
      d(100),
      ZERO,
    );
    expect(sheet.assets[0].groups[0].accounts.map((a) => a.amount.toNumber())).toEqual([
      1_000, -200,
    ]);
    expect(sheet.totalAssets.toNumber()).toBe(800);
    expect(sheet.totalLiabilities.toNumber()).toBe(800);
    const equity = sheet.liabilities.find((c) => c.code === '5')!;
    expect(equity.groups.map((g) => g.code)).toEqual(['50', '59']);
  });
});

describe('incomeStatement', () => {
  it('builds the subtotals of the Tekdüzen income statement', () => {
    const s = incomeStatement([
      { code: '600', name: 'Yurt İçi Satışlar', amount: d(1_000) },
      { code: '610', name: 'Satıştan İadeler', amount: d(-100) },
      { code: '621', name: 'SMM', amount: d(-500) },
      { code: '770', name: 'GYG', amount: d(-200) },
      { code: '642', name: 'Faiz Gelirleri', amount: d(50) },
      { code: '780', name: 'Finansman Giderleri', amount: d(-30) },
      { code: '689', name: 'Olağandışı Gider', amount: d(-20) },
    ]);
    expect(s.netSales.toNumber()).toBe(900);
    expect(s.grossProfit.toNumber()).toBe(400);
    expect(s.operatingProfit.toNumber()).toBe(200);
    expect(s.ordinaryProfit.toNumber()).toBe(220);
    expect(s.netProfit.toNumber()).toBe(200);
    expect(s.sections.find((x) => x.key === 'financeExpenses')!.accounts[0].code).toBe('780');
  });
});
