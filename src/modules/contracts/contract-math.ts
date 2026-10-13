import { ContractBillingCycle, ContractStatus, Prisma } from '@prisma/client';

const DAY_MS = 86_400_000;

/** Contract dates are `@db.Date` values at UTC midnight. */
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

export const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);

/** Calendar months later, clamped to the end of shorter months (31 Jan + 1 = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/** Last day of a term that starts on `start` and runs `months` months. */
export const termEnd = (start: Date, months: number) => addDays(addMonths(start, months), -1);

/** Whole months covered by a term, at least 1. */
export function termMonths(start: Date, end: Date): number {
  const next = addDays(end, 1);
  const months =
    (next.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    next.getUTCMonth() -
    start.getUTCMonth() +
    (next.getUTCDate() - start.getUTCDate()) / 30;
  return Math.max(1, Math.round(months));
}

export interface ContractDates {
  status: ContractStatus;
  endDate: Date | null;
  autoRenew: boolean;
  renewalMonths: number | null;
  noticeDays: number;
  reminderDays: number;
  terminatedOn: Date | null;
  remindedFor: Date | null;
}

/** Last day to give notice so an auto-renewing contract does not renew. */
export const noticeDeadline = (c: Pick<ContractDates, 'endDate' | 'noticeDays'>) =>
  c.endDate ? addDays(c.endDate, -c.noticeDays) : null;

/** The date that needs a decision: the notice deadline when it renews itself, otherwise the end. */
export function actionDate(c: ContractDates): Date | null {
  if (!c.endDate) return null;
  return c.autoRenew && !c.terminatedOn ? noticeDeadline(c) : c.endDate;
}

export const CONTRACT_STATES = [
  'DRAFT',
  'ACTIVE',
  'EXPIRING',
  'TERMINATING',
  'EXPIRED',
  'TERMINATED',
] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

/** Status plus the reminder window: `EXPIRING` once the reminder date is reached. */
export function contractState(c: ContractDates, today: Date): ContractState {
  if (c.status !== ContractStatus.ACTIVE) return c.status;
  if (c.terminatedOn) return 'TERMINATING';
  const due = actionDate(c);
  if (due && today >= addDays(due, -c.reminderDays)) return 'EXPIRING';
  return 'ACTIVE';
}

export type Settlement =
  | { kind: 'NONE' }
  | { kind: 'TERMINATE' }
  | { kind: 'EXPIRE' }
  | { kind: 'RENEW'; endDate: Date; times: number };

/** What the daily job does with an active contract whose last day has passed. */
export function settle(c: ContractDates, today: Date): Settlement {
  if (c.status !== ContractStatus.ACTIVE) return { kind: 'NONE' };
  if (c.terminatedOn) return c.terminatedOn < today ? { kind: 'TERMINATE' } : { kind: 'NONE' };
  if (!c.endDate || c.endDate >= today) return { kind: 'NONE' };
  if (!c.autoRenew || !c.renewalMonths) return { kind: 'EXPIRE' };
  let endDate = c.endDate;
  let times = 0;
  while (endDate < today) {
    endDate = termEnd(addDays(endDate, 1), c.renewalMonths);
    times += 1;
  }
  return { kind: 'RENEW', endDate, times };
}

/** A reminder is due once per term, from `reminderDays` before the action date. */
export function reminderDue(c: ContractDates, today: Date): boolean {
  if (c.status !== ContractStatus.ACTIVE || c.terminatedOn || !c.endDate) return false;
  if (c.remindedFor && c.remindedFor.getTime() === c.endDate.getTime()) return false;
  const due = actionDate(c);
  return !!due && today >= addDays(due, -c.reminderDays) && today <= c.endDate;
}

const PER_MONTH: Record<Exclude<ContractBillingCycle, 'ONE_TIME'>, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

/** Yearly value of a contract; one-time amounts are spread over the term (null if open-ended). */
export function annualValue(c: {
  amount: Prisma.Decimal | null;
  billingCycle: ContractBillingCycle;
  startDate: Date;
  endDate: Date | null;
}): Prisma.Decimal | null {
  if (!c.amount) return null;
  if (c.billingCycle === ContractBillingCycle.ONE_TIME) {
    if (!c.endDate) return null;
    const months = termMonths(c.startDate, c.endDate);
    return c.amount.mul(Math.min(months, 12)).div(months).toDecimalPlaces(2);
  }
  return c.amount.mul(12).div(PER_MONTH[c.billingCycle]).toDecimalPlaces(2);
}
