import {
  Prisma,
  TrainingEnrollmentStatus,
  TrainingSessionStatus,
  type TrainingSession,
} from '@prisma/client';
import { toDateOnly } from '../../common/dates/date-only';
import type { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { MyTrainingDto, TrainingSessionDto } from './dto/training.dto';
import { seatsLeft } from './training-math';

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

export const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/** Enrollments that hold a seat. */
export const SEATED: TrainingEnrollmentStatus[] = [
  TrainingEnrollmentStatus.ENROLLED,
  TrainingEnrollmentStatus.ATTENDED,
  TrainingEnrollmentStatus.NO_SHOW,
];

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

/** Serialises enrollments of one session so capacity holds. */
export async function lockSession(tx: PrismaTx, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM training_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
}

export const sessionInclude = {
  course: {
    select: {
      code: true,
      title: true,
      category: true,
      format: true,
      durationHours: true,
      isMandatory: true,
      validityMonths: true,
      description: true,
      provider: true,
    },
  },
  enrollments: {
    select: { status: true, feedbackRating: true, employeeId: true },
  },
} satisfies Prisma.TrainingSessionInclude;

export type SessionRow = Prisma.TrainingSessionGetPayload<{ include: typeof sessionInclude }>;

export function toSessionDto(row: SessionRow, currencyCode: string): TrainingSessionDto {
  const seated = row.enrollments.filter((e) => SEATED.includes(e.status));
  const ratings = row.enrollments
    .map((e) => e.feedbackRating)
    .filter((r): r is number => r !== null);
  return {
    id: row.id,
    courseId: row.courseId,
    courseCode: row.course.code,
    courseTitle: row.course.title,
    category: row.course.category,
    format: row.course.format,
    durationHours: row.course.durationHours.toFixed(1),
    isMandatory: row.course.isMandatory,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    location: row.location,
    instructor: row.instructor,
    capacity: row.capacity,
    cost: row.cost?.toFixed(2) ?? null,
    currencyCode,
    selfEnrollment: row.selfEnrollment,
    status: row.status,
    enrolledCount: seated.length,
    attendedCount: row.enrollments.filter((e) => e.status === TrainingEnrollmentStatus.ATTENDED)
      .length,
    seatsLeft: seatsLeft(row.capacity, seated.length),
    averageFeedback: ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : null,
    feedbackCount: ratings.length,
  };
}

export const myTrainingInclude = {
  session: {
    include: {
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          category: true,
          format: true,
          durationHours: true,
          isMandatory: true,
        },
      },
    },
  },
} satisfies Prisma.TrainingEnrollmentInclude;

export type MyTrainingRow = Prisma.TrainingEnrollmentGetPayload<{
  include: typeof myTrainingInclude;
}>;

/** `own` enables the participant's actions (feedback, cancelling a self-enrolled seat). */
export function toMyTrainingDto(row: MyTrainingRow, own: boolean, now: Date): MyTrainingDto {
  const session: TrainingSession = row.session;
  const course = row.session.course;
  return {
    id: row.id,
    sessionId: row.sessionId,
    courseId: course.id,
    courseCode: course.code,
    courseTitle: course.title,
    category: course.category,
    format: course.format,
    durationHours: course.durationHours.toFixed(1),
    isMandatory: course.isMandatory,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    location: session.location,
    instructor: session.instructor,
    sessionStatus: session.status,
    status: row.status,
    score: row.score,
    certificateExpiresAt: toDateOnly(row.certificateExpiresAt),
    feedbackRating: row.feedbackRating,
    feedbackComment: row.feedbackComment,
    canGiveFeedback:
      own &&
      row.status === TrainingEnrollmentStatus.ATTENDED &&
      session.status === TrainingSessionStatus.COMPLETED,
    canCancel:
      own &&
      session.selfEnrollment &&
      row.status === TrainingEnrollmentStatus.ENROLLED &&
      session.status === TrainingSessionStatus.PLANNED &&
      session.startsAt > now,
  };
}
