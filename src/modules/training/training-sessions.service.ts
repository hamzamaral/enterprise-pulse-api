import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  Prisma,
  TrainingEnrollmentStatus,
  TrainingSessionStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import type { PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CompleteTrainingSessionDto,
  CreateTrainingSessionDto,
  EnrollEmployeesDto,
  MyTrainingDto,
  OpenTrainingSessionDto,
  TrainingFeedbackDto,
  TrainingSessionDetailDto,
  TrainingSessionQueryDto,
  UpdateTrainingSessionDto,
} from './dto/training.dto';
import { certificateExpiry } from './training-math';
import {
  SEATED,
  baseCurrency,
  fullName,
  lockSession,
  myTrainingInclude,
  sessionInclude,
  toMyTrainingDto,
  toSessionDto,
  trimOrNull,
} from './training-support';

const SORTABLE = ['startsAt', 'createdAt'] as const;

const detailInclude = {
  ...sessionInclude,
  createdBy: { select: { firstName: true, lastName: true } },
  enrollments: {
    include: {
      employee: {
        select: {
          employeeNo: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
          position: { select: { name: true } },
        },
      },
    },
    orderBy: [{ employee: { firstName: 'asc' } }, { employee: { lastName: 'asc' } }],
  },
} satisfies Prisma.TrainingSessionInclude;

/** Eğitim oturumları, katılımcılar ve yoklama. */
@Injectable()
export class TrainingSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(companyId: string, query: TrainingSessionQueryDto) {
    const search = query.search?.trim();
    const upcoming = query.upcoming === 'true';
    const where: Prisma.TrainingSessionWhereInput = {
      companyId,
      courseId: query.courseId,
      status: query.status ?? (upcoming ? TrainingSessionStatus.PLANNED : undefined),
      ...(upcoming ? { endsAt: { gte: new Date() } } : {}),
      ...(search
        ? {
            OR: [
              { course: { code: { contains: search, mode: 'insensitive' } } },
              { course: { title: { contains: search, mode: 'insensitive' } } },
              { instructor: { contains: search, mode: 'insensitive' } },
              { location: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total, currency] = await Promise.all([
      this.prisma.trainingSession.findMany({
        where,
        include: sessionInclude,
        orderBy: [
          toOrderBy({ ...query, sortOrder: query.sortOrder }, SORTABLE, 'startsAt'),
          { createdAt: 'desc' },
        ],
        ...toPageArgs(query),
      }),
      this.prisma.trainingSession.count({ where }),
      baseCurrency(this.prisma, companyId),
    ]);
    return paginated(
      rows.map((row) => toSessionDto(row, currency)),
      total,
      query,
    );
  }

  async findOne(user: AuthUser, id: string): Promise<TrainingSessionDetailDto> {
    const row = await this.prisma.trainingSession.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Training session not found');
    const currency = await baseCurrency(this.prisma, user.companyId);
    const planned = row.status === TrainingSessionStatus.PLANNED;
    const canUpdate = hasPermission(user, 'training:update');
    return {
      ...toSessionDto(row, currency),
      notes: row.notes,
      validityMonths: row.course.validityMonths,
      description: row.course.description,
      provider: row.course.provider,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdByName: fullName(row.createdBy),
      enrollments: row.enrollments.map((e) => ({
        id: e.id,
        employeeId: e.employeeId,
        employeeNo: e.employee.employeeNo,
        employeeName: fullName(e.employee),
        departmentName: e.employee.department?.name ?? null,
        positionName: e.employee.position?.name ?? null,
        status: e.status,
        score: e.score,
        certificateExpiresAt: toDateOnly(e.certificateExpiresAt),
        feedbackRating: e.feedbackRating,
        feedbackComment: e.feedbackComment,
        enrolledAt: e.createdAt.toISOString(),
      })),
      canEdit: canUpdate && planned,
      canComplete: canUpdate && planned && row.startsAt <= new Date(),
      canCancel: canUpdate && planned,
      canDelete:
        hasPermission(user, 'training:delete') && row.status !== TrainingSessionStatus.COMPLETED,
    };
  }

  async create(user: AuthUser, dto: CreateTrainingSessionDto): Promise<TrainingSessionDetailDto> {
    const course = await this.prisma.trainingCourse.findFirst({
      where: { id: dto.courseId, companyId: user.companyId },
    });
    if (!course) throw new BadRequestException('Training course not found');
    if (!course.isActive) throw new BadRequestException('The course is not active');
    assertTimes(dto.startsAt, dto.endsAt);
    const employeeIds = dto.employeeIds ?? [];
    if (dto.capacity && employeeIds.length > dto.capacity) {
      throw new BadRequestException('More participants than seats');
    }
    const employees = await this.activeEmployees(user.companyId, employeeIds);
    const row = await this.prisma.trainingSession.create({
      data: {
        companyId: user.companyId,
        courseId: course.id,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        location: trimOrNull(dto.location),
        instructor: trimOrNull(dto.instructor),
        capacity: dto.capacity ?? null,
        cost: dto.cost ?? null,
        selfEnrollment: dto.selfEnrollment ?? false,
        notes: trimOrNull(dto.notes),
        createdById: user.id,
        enrollments: { create: employees.map((e) => ({ employeeId: e.id })) },
      },
    });
    await this.notifyEnrolled(user, row.id, employees);
    return this.findOne(user, row.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateTrainingSessionDto,
  ): Promise<TrainingSessionDetailDto> {
    const current = await this.get(user.companyId, id);
    if (current.status !== TrainingSessionStatus.PLANNED) {
      throw new ConflictException('Only planned sessions can be changed');
    }
    assertTimes(
      dto.startsAt ?? current.startsAt.toISOString(),
      dto.endsAt ?? current.endsAt.toISOString(),
    );
    await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, id);
      if (dto.capacity) {
        const seated = await seatedCount(tx, id);
        if (seated > dto.capacity) {
          throw new ConflictException(`${seated} people are already enrolled`);
        }
      }
      await tx.trainingSession.update({
        where: { id },
        data: {
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
          location: trimOrNull(dto.location),
          instructor: trimOrNull(dto.instructor),
          capacity: dto.capacity,
          cost: dto.cost,
          selfEnrollment: dto.selfEnrollment,
          notes: trimOrNull(dto.notes),
        },
      });
    });
    return this.findOne(user, id);
  }

  async enroll(
    user: AuthUser,
    id: string,
    dto: EnrollEmployeesDto,
  ): Promise<TrainingSessionDetailDto> {
    const current = await this.get(user.companyId, id);
    if (current.status !== TrainingSessionStatus.PLANNED) {
      throw new ConflictException('Only planned sessions take participants');
    }
    const employees = await this.activeEmployees(user.companyId, dto.employeeIds);
    const added = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, id);
      const existing = await tx.trainingEnrollment.findMany({
        where: { sessionId: id },
        select: { employeeId: true, status: true },
      });
      const seated = new Set(
        existing.filter((e) => SEATED.includes(e.status)).map((e) => e.employeeId),
      );
      const cancelled = new Set(
        existing
          .filter((e) => e.status === TrainingEnrollmentStatus.CANCELLED)
          .map((e) => e.employeeId),
      );
      const fresh = employees.filter((e) => !seated.has(e.id));
      if (current.capacity !== null && seated.size + fresh.length > current.capacity) {
        throw new ConflictException('Not enough seats left');
      }
      for (const employee of fresh) {
        if (cancelled.has(employee.id)) {
          await tx.trainingEnrollment.update({
            where: { sessionId_employeeId: { sessionId: id, employeeId: employee.id } },
            data: { status: TrainingEnrollmentStatus.ENROLLED },
          });
        } else {
          await tx.trainingEnrollment.create({ data: { sessionId: id, employeeId: employee.id } });
        }
      }
      return fresh;
    });
    await this.notifyEnrolled(user, id, added);
    return this.findOne(user, id);
  }

  /** Takes a participant off a planned session. */
  async removeEnrollment(user: AuthUser, enrollmentId: string): Promise<TrainingSessionDetailDto> {
    const enrollment = await this.prisma.trainingEnrollment.findFirst({
      where: { id: enrollmentId, session: { companyId: user.companyId } },
      include: { session: { select: { status: true } } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.session.status !== TrainingSessionStatus.PLANNED) {
      throw new ConflictException('Participants of a finished session cannot be removed');
    }
    await this.prisma.trainingEnrollment.delete({ where: { id: enrollmentId } });
    return this.findOne(user, enrollment.sessionId);
  }

  /** Records attendance; attendees get a certificate valid for the course's validity. */
  async complete(
    user: AuthUser,
    id: string,
    dto: CompleteTrainingSessionDto,
  ): Promise<TrainingSessionDetailDto> {
    const current = await this.prisma.trainingSession.findFirst({
      where: { id, companyId: user.companyId },
      include: { course: { select: { validityMonths: true } }, enrollments: true },
    });
    if (!current) throw new NotFoundException('Training session not found');
    if (current.status !== TrainingSessionStatus.PLANNED) {
      throw new ConflictException('Only planned sessions can be completed');
    }
    if (current.startsAt > new Date()) {
      throw new ConflictException('The session has not started yet');
    }
    const active = current.enrollments.filter(
      (e) => e.status === TrainingEnrollmentStatus.ENROLLED,
    );
    const input = new Map(dto.attendance.map((a) => [a.enrollmentId, a]));
    for (const enrollmentId of input.keys()) {
      if (!active.some((e) => e.id === enrollmentId)) {
        throw new BadRequestException(`Unknown enrollment ${enrollmentId}`);
      }
    }
    const expiresAt = certificateExpiry(
      parseDateOnly(toDateOnly(current.endsAt)),
      current.course.validityMonths,
    );
    await this.prisma.$transaction(async (tx) => {
      for (const enrollment of active) {
        const entry = input.get(enrollment.id);
        const attended = entry?.attended ?? false;
        await tx.trainingEnrollment.update({
          where: { id: enrollment.id },
          data: attended
            ? {
                status: TrainingEnrollmentStatus.ATTENDED,
                score: entry?.score ?? null,
                certificateExpiresAt: expiresAt,
              }
            : { status: TrainingEnrollmentStatus.NO_SHOW, score: null },
        });
      }
      const updated = await tx.trainingSession.updateMany({
        where: { id, status: TrainingSessionStatus.PLANNED },
        data: { status: TrainingSessionStatus.COMPLETED, completedAt: new Date() },
      });
      if (!updated.count) throw new ConflictException('Only planned sessions can be completed');
    });
    return this.findOne(user, id);
  }

  async cancel(user: AuthUser, id: string): Promise<TrainingSessionDetailDto> {
    const current = await this.prisma.trainingSession.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        course: { select: { title: true } },
        enrollments: {
          where: { status: TrainingEnrollmentStatus.ENROLLED },
          select: { employee: { select: { userId: true } } },
        },
      },
    });
    if (!current) throw new NotFoundException('Training session not found');
    if (current.status !== TrainingSessionStatus.PLANNED) {
      throw new ConflictException('Only planned sessions can be cancelled');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.trainingSession.update({
        where: { id },
        data: { status: TrainingSessionStatus.CANCELLED },
      });
      await tx.trainingEnrollment.updateMany({
        where: { sessionId: id, status: TrainingEnrollmentStatus.ENROLLED },
        data: { status: TrainingEnrollmentStatus.CANCELLED },
      });
    });
    await this.notifications.notify({
      companyId: user.companyId,
      userIds: current.enrollments
        .map((e) => e.employee.userId)
        .filter((userId): userId is string => !!userId && userId !== user.id),
      type: 'training.cancelled',
      title: `Eğitim iptal edildi: ${current.course.title}`,
      body: `${formatWhen(current.startsAt)} tarihli oturum iptal edildi.`,
      link: '/training/my',
    });
    return this.findOne(user, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const current = await this.get(companyId, id);
    if (current.status === TrainingSessionStatus.COMPLETED) {
      throw new ConflictException('Completed sessions are kept as training history');
    }
    await this.prisma.trainingSession.delete({ where: { id } });
  }

  /** Planned sessions open to self-enrollment that have not started. */
  async open(user: AuthUser): Promise<OpenTrainingSessionDto[]> {
    const employeeId = await this.ownEmployeeId(user, false);
    const [rows, currency] = await Promise.all([
      this.prisma.trainingSession.findMany({
        where: {
          companyId: user.companyId,
          status: TrainingSessionStatus.PLANNED,
          selfEnrollment: true,
          startsAt: { gt: new Date() },
        },
        include: sessionInclude,
        orderBy: { startsAt: 'asc' },
      }),
      baseCurrency(this.prisma, user.companyId),
    ]);
    return rows.map((row) => ({
      ...toSessionDto(row, currency),
      description: row.course.description,
      enrolled: row.enrollments.some(
        (e) => e.employeeId === employeeId && SEATED.includes(e.status),
      ),
    }));
  }

  async enrollSelf(user: AuthUser, id: string): Promise<MyTrainingDto> {
    const employeeId = await this.ownEmployeeId(user);
    const current = await this.get(user.companyId, id);
    if (
      !current.selfEnrollment ||
      current.status !== TrainingSessionStatus.PLANNED ||
      current.startsAt <= new Date()
    ) {
      throw new ConflictException('This session is not open for enrollment');
    }
    const enrollmentId = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, id);
      const existing = await tx.trainingEnrollment.findUnique({
        where: { sessionId_employeeId: { sessionId: id, employeeId } },
      });
      if (existing && SEATED.includes(existing.status)) {
        throw new ConflictException('You are already enrolled');
      }
      if (current.capacity !== null && (await seatedCount(tx, id)) >= current.capacity) {
        throw new ConflictException('Not enough seats left');
      }
      const row = existing
        ? await tx.trainingEnrollment.update({
            where: { id: existing.id },
            data: { status: TrainingEnrollmentStatus.ENROLLED },
          })
        : await tx.trainingEnrollment.create({ data: { sessionId: id, employeeId } });
      return row.id;
    });
    return this.myEnrollment(enrollmentId);
  }

  async cancelSelf(user: AuthUser, id: string): Promise<MyTrainingDto> {
    const employeeId = await this.ownEmployeeId(user);
    const enrollment = await this.prisma.trainingEnrollment.findFirst({
      where: { sessionId: id, employeeId, session: { companyId: user.companyId } },
      include: myTrainingInclude,
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (!toMyTrainingDto(enrollment, true, new Date()).canCancel) {
      throw new ConflictException('This enrollment cannot be cancelled');
    }
    await this.prisma.trainingEnrollment.update({
      where: { id: enrollment.id },
      data: { status: TrainingEnrollmentStatus.CANCELLED },
    });
    return this.myEnrollment(enrollment.id);
  }

  async feedback(
    user: AuthUser,
    enrollmentId: string,
    dto: TrainingFeedbackDto,
  ): Promise<MyTrainingDto> {
    const employeeId = await this.ownEmployeeId(user);
    const enrollment = await this.prisma.trainingEnrollment.findFirst({
      where: { id: enrollmentId, session: { companyId: user.companyId } },
      include: myTrainingInclude,
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.employeeId !== employeeId) {
      throw new ForbiddenException('Only the participant rates a training');
    }
    if (!toMyTrainingDto(enrollment, true, new Date()).canGiveFeedback) {
      throw new ConflictException('Only attended, completed trainings can be rated');
    }
    await this.prisma.trainingEnrollment.update({
      where: { id: enrollmentId },
      data: {
        feedbackRating: dto.rating,
        feedbackComment: trimOrNull(dto.comment) ?? null,
        feedbackAt: new Date(),
      },
    });
    return this.myEnrollment(enrollmentId);
  }

  private async myEnrollment(id: string): Promise<MyTrainingDto> {
    const row = await this.prisma.trainingEnrollment.findUniqueOrThrow({
      where: { id },
      include: myTrainingInclude,
    });
    return toMyTrainingDto(row, true, new Date());
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.trainingSession.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Training session not found');
    return row;
  }

  private async activeEmployees(companyId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
      select: { id: true, userId: true },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException('Participants must be active employees');
    }
    return rows;
  }

  private async ownEmployeeId(user: AuthUser): Promise<string>;
  private async ownEmployeeId(user: AuthUser, required: false): Promise<string | null>;
  private async ownEmployeeId(user: AuthUser, required = true): Promise<string | null> {
    const row = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!row && required) {
      throw new NotFoundException('No employee record is linked to your account');
    }
    return row?.id ?? null;
  }

  private async notifyEnrolled(
    user: AuthUser,
    sessionId: string,
    employees: { userId: string | null }[],
  ) {
    const userIds = employees
      .map((e) => e.userId)
      .filter((userId): userId is string => !!userId && userId !== user.id);
    if (!userIds.length) return;
    const session = await this.prisma.trainingSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { startsAt: true, location: true, course: { select: { title: true } } },
    });
    await this.notifications.notify({
      companyId: user.companyId,
      userIds,
      type: 'training.enrolled',
      title: `Eğitime kaydedildiniz: ${session.course.title}`,
      body: `${formatWhen(session.startsAt)}${session.location ? ` · ${session.location}` : ''}`,
      link: '/training/my',
    });
  }
}

function assertTimes(startsAt: string, endsAt: string) {
  if (new Date(endsAt) <= new Date(startsAt)) {
    throw new BadRequestException('The session must end after it starts');
  }
}

function seatedCount(tx: PrismaTx, sessionId: string) {
  return tx.trainingEnrollment.count({ where: { sessionId, status: { in: SEATED } } });
}

function formatWhen(value: Date) {
  return value.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
