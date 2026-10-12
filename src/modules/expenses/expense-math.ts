import { ExpenseCategoryKind, ExpenseReportStatus, Prisma } from '@prisma/client';
import { toBase } from '../../common/money/document-totals';

type Numeric = Prisma.Decimal | number | string;

const dec = (value: Numeric) => new Prisma.Decimal(value);

/** The employee can still change (and resubmit) the report. */
export const EDITABLE_STATUSES: ExpenseReportStatus[] = [
  ExpenseReportStatus.DRAFT,
  ExpenseReportStatus.REJECTED,
];

/** Not yet paid or closed, so the report can still be cancelled. */
export const CANCELLABLE_STATUSES: ExpenseReportStatus[] = [
  ExpenseReportStatus.DRAFT,
  ExpenseReportStatus.PENDING,
  ExpenseReportStatus.REJECTED,
  ExpenseReportStatus.APPROVED,
];

export interface LineCategory {
  kind: ExpenseCategoryKind;
  /** Allowance per day / km, company currency. */
  rate: Numeric | null;
}

export interface LineInput {
  quantity?: Numeric;
  amount?: Numeric;
  exchangeRate: Numeric;
}

export interface LineAmounts {
  quantity: Prisma.Decimal;
  amount: Prisma.Decimal;
  amountBase: Prisma.Decimal;
}

/**
 * Receipts keep the entered amount (converted at the line rate); per diem and mileage lines are
 * always quantity × category rate in the company currency.
 */
export function lineAmounts(category: LineCategory, input: LineInput): LineAmounts {
  if (category.kind === ExpenseCategoryKind.RECEIPT) {
    const amount = dec(input.amount ?? 0);
    return { quantity: dec(1), amount, amountBase: toBase(amount, input.exchangeRate) };
  }
  const quantity = dec(input.quantity ?? 0);
  const amount = toBase(quantity, category.rate ?? 0);
  return { quantity, amount, amountBase: amount };
}

/** Lines above the category's soft limit are flagged for approvers, not rejected. */
export function isOverLimit(amountBase: Numeric, limitAmount: Numeric | null): boolean {
  return limitAmount !== null && dec(amountBase).greaterThan(limitAmount);
}

export interface ReceiptCheck {
  kind: ExpenseCategoryKind;
  requiresReceipt: boolean;
  receiptFileId: string | null;
}

export function isMissingReceipt(line: ReceiptCheck): boolean {
  return line.kind === ExpenseCategoryKind.RECEIPT && line.requiresReceipt && !line.receiptFileId;
}

export function reportTotal(lines: { amountBase: Numeric }[]): Prisma.Decimal {
  return lines.reduce<Prisma.Decimal>((sum, line) => sum.plus(line.amountBase), dec(0));
}
