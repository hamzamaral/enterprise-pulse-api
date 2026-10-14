import {
  ChequeKind,
  LedgerAccountType,
  PaymentMethod,
  Prisma,
  StockMovementType,
  TreasuryAccountType,
} from '@prisma/client';
import { accountType, defaultChart } from './accounting-chart';
import { isBalanced, normalizeLines, type DraftLine } from './accounting-math';
import {
  chequeCollectionLines,
  chequePaymentLines,
  collectionLines,
  expenseReportLines,
  partnerOpeningLines,
  paymentLines,
  payrollLines,
  productionLines,
  purchaseInvoiceLines,
  salesInvoiceLines,
  salesReturnLines,
  stockMovementLines,
  treasuryOpeningLines,
} from './accounting-rules';

const d = (value: number) => new Prisma.Decimal(value);
const ZERO = d(0);

/** "code D/C amount" per normalized line. */
const view = (lines: DraftLine[]) =>
  normalizeLines(lines).map((l) =>
    l.debit.gt(0) ? `${l.code} D ${l.debit.toNumber()}` : `${l.code} C ${l.credit.toNumber()}`,
  );

const balanced = (lines: DraftLine[]) => isBalanced(normalizeLines(lines));

describe('posting rules', () => {
  it('posts a sales invoice to 120 / 600 + 391', () => {
    const lines = salesInvoiceLines({ partnerId: 'p', total: d(1_200), vat: d(200) });
    expect(view(lines)).toEqual(['120 D 1200', '600 C 1000', '391 C 200']);
  });

  it('credits the customer for a return and puts the goods back at cost', () => {
    const lines = salesReturnLines({ partnerId: 'p', total: d(120), vat: d(20), cost: d(60) });
    expect(view(lines)).toEqual(['610 D 100', '391 D 20', '153 D 60', '120 C 120', '621 C 60']);
  });

  it('splits a purchase invoice into goods and expenses', () => {
    const lines = purchaseInvoiceLines({
      partnerId: 's',
      total: d(1_800),
      vat: d(300),
      goods: d(1_000),
    });
    expect(view(lines)).toEqual(['153 D 1000', '770 D 500', '191 D 300', '320 C 1800']);
  });

  it('moves money through the account of the payment method', () => {
    expect(
      view(collectionLines({ partnerId: 'p', method: PaymentMethod.CHEQUE, amount: d(50) })),
    ).toEqual(['101 D 50', '120 C 50']);
    expect(
      view(collectionLines({ partnerId: 'p', method: PaymentMethod.NOTE, amount: d(50) })),
    ).toEqual(['121 D 50', '120 C 50']);
    const own = paymentLines({
      partnerId: 's',
      method: PaymentMethod.CHEQUE,
      amount: d(70),
      endorsed: false,
    });
    const endorsed = paymentLines({
      partnerId: 's',
      method: PaymentMethod.CHEQUE,
      amount: d(70),
      endorsed: true,
    });
    expect(view(own)).toEqual(['320 D 70', '103 C 70']);
    expect(view(endorsed)).toEqual(['320 D 70', '101 C 70']);
    expect(
      view(
        paymentLines({ partnerId: 's', method: PaymentMethod.NOTE, amount: d(9), endorsed: false }),
      ),
    ).toEqual(['320 D 9', '321 C 9']);
  });

  it('settles cheques and notes through cash or bank', () => {
    const collected = chequeCollectionLines({
      kind: ChequeKind.NOTE,
      treasuryType: TreasuryAccountType.CASH,
      amount: d(40),
      partnerId: 'p',
    });
    const paid = chequePaymentLines({
      kind: ChequeKind.CHEQUE,
      treasuryType: TreasuryAccountType.BANK,
      amount: d(40),
      partnerId: 's',
    });
    expect(view(collected)).toEqual(['100 D 40', '121 C 40']);
    expect(view(paid)).toEqual(['103 D 40', '102 C 40']);
  });

  it('values stock movements outside documents', () => {
    expect(
      view(stockMovementLines(StockMovementType.RECEIPT, { increase: d(10), decrease: ZERO })),
    ).toEqual(['153 D 10', '329 C 10']);
    expect(
      view(stockMovementLines(StockMovementType.ISSUE, { increase: ZERO, decrease: d(8) })),
    ).toEqual(['770 D 8', '153 C 8']);
    expect(
      view(stockMovementLines(StockMovementType.ADJUSTMENT, { increase: d(3), decrease: d(5) })),
    ).toEqual(['153 D 3', '689 D 5', '679 C 3', '153 C 5']);
    expect(
      stockMovementLines(StockMovementType.TRANSFER, { increase: d(1), decrease: d(1) }),
    ).toEqual([]);
  });

  it('moves materials into the product at full production cost', () => {
    const lines = productionLines({ material: d(900), labor: d(80), overhead: d(20) });
    expect(view(lines)).toEqual([
      '710 D 900',
      '153 D 1000',
      '153 C 900',
      '711 C 900',
      '721 C 80',
      '731 C 20',
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('accrues payroll so that the employer cost equals the liabilities', () => {
    const lines = payrollLines({ net: d(700), tax: d(100), sgk: d(250), deductions: d(50) });
    expect(view(lines)).toEqual(['770 D 1100', '335 C 700', '360 C 100', '361 C 250', '336 C 50']);
  });

  it('keeps every rule balanced, including signed openings', () => {
    expect(balanced(treasuryOpeningLines(TreasuryAccountType.BANK, d(-25)))).toBe(true);
    expect(view(treasuryOpeningLines(TreasuryAccountType.BANK, d(-25)))).toEqual([
      '500 D 25',
      '102 C 25',
    ]);
    expect(balanced(partnerOpeningLines({ partnerId: 'p', debit: d(10), credit: ZERO }))).toBe(
      true,
    );
    expect(view(partnerOpeningLines({ partnerId: 's', debit: ZERO, credit: d(10) }))).toEqual([
      '500 D 10',
      '320 C 10',
    ]);
    expect(balanced(expenseReportLines({ employeeId: 'e', total: d(118), vat: d(18) }))).toBe(true);
  });
});

describe('chart of accounts', () => {
  it('derives the account type from the code', () => {
    expect(accountType('103')).toBe(LedgerAccountType.ASSET);
    expect(accountType('391')).toBe(LedgerAccountType.LIABILITY);
    expect(accountType('500')).toBe(LedgerAccountType.EQUITY);
    expect(accountType('642')).toBe(LedgerAccountType.INCOME);
    expect(accountType('610')).toBe(LedgerAccountType.EXPENSE);
    expect(accountType('770')).toBe(LedgerAccountType.EXPENSE);
  });

  it('marks the accounts used by automatic postings as system accounts', () => {
    const chart = defaultChart();
    const system = chart.filter((a) => a.isSystem).map((a) => a.code);
    expect(system).toEqual(
      expect.arrayContaining(['100', '120', '153', '320', '391', '600', '770']),
    );
    expect(new Set(chart.map((a) => a.code)).size).toBe(chart.length);
  });
});
