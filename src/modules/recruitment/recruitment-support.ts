import { ApplicationActivityType, ApplicationStage, Prisma } from '@prisma/client';
import type { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { InterviewDto } from './dto/recruitment.dto';

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

export function money(value: Prisma.Decimal.Value): string;
export function money(value: Prisma.Decimal.Value | null): string | null;
export function money(value: Prisma.Decimal.Value | null): string | null {
  return value === null ? null : new Prisma.Decimal(value).toFixed(2);
}

export const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

export const emptyStageCounts = (): Record<ApplicationStage, number> => ({
  APPLIED: 0,
  SCREENING: 0,
  INTERVIEW: 0,
  OFFER: 0,
  HIRED: 0,
  REJECTED: 0,
  WITHDRAWN: 0,
});

export async function baseCurrency(
  client: PrismaService | PrismaTx,
  companyId: string,
): Promise<string> {
  const company = await client.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { baseCurrency: true },
  });
  return company.baseCurrency;
}

/** Serialises pipeline changes of one posting (board order, hires against openings). */
export async function lockPosting(tx: PrismaTx, postingId: string) {
  await tx.$queryRaw`SELECT id FROM job_postings WHERE id = ${postingId}::uuid FOR UPDATE`;
}

/**
 * Adds a timeline entry. NOTE carries the text, STAGE an optional reason; OFFER and INTERVIEW
 * entries carry the status the event set (e.g. `ACCEPTED`, `SCHEDULED`), HIRED the employee no.
 */
export function addActivity(
  tx: PrismaTx,
  data: {
    applicationId: string;
    type: ApplicationActivityType;
    createdById: string;
    fromStage?: ApplicationStage | null;
    toStage?: ApplicationStage | null;
    body?: string | null;
  },
) {
  return tx.applicationActivity.create({ data });
}

export const interviewInclude = {
  createdBy: { select: { firstName: true, lastName: true } },
  participants: {
    include: {
      employee: {
        select: {
          firstName: true,
          lastName: true,
          userId: true,
          position: { select: { name: true } },
        },
      },
    },
    orderBy: { employee: { firstName: 'asc' } },
  },
} satisfies Prisma.InterviewInclude;

export type InterviewRow = Prisma.InterviewGetPayload<{ include: typeof interviewInclude }>;

export function toInterviewDto(row: InterviewRow): InterviewDto {
  return {
    id: row.id,
    applicationId: row.applicationId,
    type: row.type,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMinutes: row.durationMinutes,
    location: row.location,
    notes: row.notes,
    participants: row.participants.map((p) => ({
      id: p.id,
      employeeId: p.employeeId,
      employeeName: fullName(p.employee),
      positionName: p.employee.position?.name ?? null,
      rating: p.rating,
      recommendation: p.recommendation,
      feedback: p.feedback,
      submittedAt: p.submittedAt?.toISOString() ?? null,
    })),
    createdByName: fullName(row.createdBy),
  };
}
