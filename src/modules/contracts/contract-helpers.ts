import { Prisma } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import type { PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { ContractDto } from './dto/contract.dto';
import { annualValue, contractState, daysBetween, noticeDeadline } from './contract-math';

export const CONTRACT_ENTITY = 'Contract';

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

export const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/** Today in Istanbul as a `@db.Date` value. */
export const today = () =>
  parseDateOnly(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }));

export const contractInclude = {
  type: { select: { name: true, flow: true } },
  partner: { select: { code: true, title: true } },
  employee: { select: { firstName: true, lastName: true } },
  owner: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ContractInclude;

export type ContractRow = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;

export function toContractDto(row: ContractRow, now: Date): ContractDto {
  const employeeName = row.employee ? fullName(row.employee) : null;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    typeId: row.typeId,
    typeName: row.type.name,
    flow: row.type.flow,
    party: row.party,
    partnerId: row.partnerId,
    partnerCode: row.partner?.code ?? null,
    partnerTitle: row.partner?.title ?? null,
    employeeId: row.employeeId,
    employeeName,
    partyName: row.partner?.title ?? employeeName ?? '',
    ownerId: row.ownerId,
    ownerName: fullName(row.owner),
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    signedDate: toDateOnly(row.signedDate),
    amount: row.amount?.toFixed(2) ?? null,
    currencyCode: row.currencyCode,
    billingCycle: row.billingCycle,
    annualValue: annualValue(row)?.toFixed(2) ?? null,
    autoRenew: row.autoRenew,
    renewalMonths: row.renewalMonths,
    noticeDays: row.noticeDays,
    reminderDays: row.reminderDays,
    noticeDeadline: row.autoRenew ? toDateOnly(noticeDeadline(row)) : null,
    status: row.status,
    state: contractState(row, now),
    daysLeft: row.endDate ? daysBetween(now, row.endDate) : null,
    renewalCount: row.renewalCount,
    terminatedOn: toDateOnly(row.terminatedOn),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Serialises changes to one contract, including the daily job. */
export async function lockContract(tx: PrismaTx, id: string) {
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${id}::uuid FOR UPDATE`;
}
