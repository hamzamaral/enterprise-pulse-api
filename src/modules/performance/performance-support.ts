import { Prisma } from '@prisma/client';
import { toDateOnly } from '../../common/dates/date-only';
import type { PerformanceReviewDto } from './dto/performance.dto';

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

export function score(value: Prisma.Decimal.Value | null): string | null {
  return value === null ? null : new Prisma.Decimal(value).toFixed(2);
}

export const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

export const reviewListInclude = {
  cycle: {
    select: {
      name: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      selfReviewDue: true,
      managerReviewDue: true,
      goalWeight: true,
    },
  },
  employee: {
    select: {
      employeeNo: true,
      firstName: true,
      lastName: true,
      userId: true,
      departmentId: true,
      department: { select: { name: true } },
      position: { select: { name: true } },
    },
  },
  reviewer: { select: { firstName: true, lastName: true, userId: true } },
  _count: { select: { goals: true } },
} satisfies Prisma.PerformanceReviewInclude;

export type ReviewListRow = Prisma.PerformanceReviewGetPayload<{
  include: typeof reviewListInclude;
}>;

export function toReviewDto(row: ReviewListRow): PerformanceReviewDto {
  return {
    id: row.id,
    cycleId: row.cycleId,
    cycleName: row.cycle.name,
    cycleStatus: row.cycle.status,
    periodStart: toDateOnly(row.cycle.periodStart),
    periodEnd: toDateOnly(row.cycle.periodEnd),
    selfReviewDue: toDateOnly(row.cycle.selfReviewDue),
    managerReviewDue: toDateOnly(row.cycle.managerReviewDue),
    employeeId: row.employeeId,
    employeeNo: row.employee.employeeNo,
    employeeName: fullName(row.employee),
    departmentName: row.employee.department?.name ?? null,
    positionName: row.employee.position?.name ?? null,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewer ? fullName(row.reviewer) : null,
    status: row.status,
    goalCount: row._count.goals,
    overallScore: score(row.overallScore),
    selfSubmittedAt: row.selfSubmittedAt?.toISOString() ?? null,
    managerSubmittedAt: row.managerSubmittedAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  };
}
