import { Prisma } from '@prisma/client';

type Numeric = Prisma.Decimal.Value;
const dec = (value: Numeric) => new Prisma.Decimal(value);
const DAY_MS = 86_400_000;

export interface OpenInvoice {
  id: string;
  dueDate: Date;
  /** Grand total minus what is already settled, document currency. */
  remaining: Numeric;
}

export interface Allocation {
  invoiceId: string;
  amount: Prisma.Decimal;
}

/**
 * Spreads a payment over open invoices, oldest due date first; whatever is left stays
 * unallocated on the partner account (advance / overpayment).
 */
export function allocateFifo(amount: Numeric, invoices: OpenInvoice[]): Allocation[] {
  let left = dec(amount);
  const result: Allocation[] = [];
  const ordered = [...invoices].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  for (const invoice of ordered) {
    if (!left.greaterThan(0)) break;
    const remaining = dec(invoice.remaining);
    if (!remaining.greaterThan(0)) continue;
    const take = Prisma.Decimal.min(left, remaining);
    result.push({ invoiceId: invoice.id, amount: take });
    left = left.minus(take);
  }
  return result;
}

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Days past due as of `asOf` (both date-only, UTC midnight); negative when not yet due. */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  return Math.round((asOf.getTime() - dueDate.getTime()) / DAY_MS);
}

/** Aging bucket by days past the due date: not due, 1–30, 31–60, 61–90, over 90. */
export function agingBucket(dueDate: Date, asOf: Date): AgingBucket {
  const days = daysOverdue(dueDate, asOf);
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90plus';
}
