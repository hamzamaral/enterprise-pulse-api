import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EmployeeStatus,
  Prisma,
  TrainingCategory,
  TrainingEnrollmentStatus,
  TrainingSessionStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  ComplianceCourseDto,
  ComplianceItemDto,
  ComplianceReportDto,
  MyTrainingDto,
  MyTrainingOverviewDto,
  TrainingSummaryDto,
} from './dto/training.dto';
import { type ComplianceStatus, complianceRate, complianceStatus } from './training-math';
import {
  SEATED,
  baseCurrency,
  fullName,
  myTrainingInclude,
  toMyTrainingDto,
} from './training-support';

const CATEGORY_ORDER = Object.values(TrainingCategory);

/** Self-service training history, the mandatory training compliance report and KPIs. */
@Injectable()
export class TrainingsService {
  constructor(private readonly prisma: PrismaService) {}

  async mine(user: AuthUser): Promise<MyTrainingOverviewDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!employee) {
      return { trainings: [], mandatory: [], courses: [], hoursThisYear: '0.0' };
    }
    const trainings = await this.history(employee.id, true);
    const report = await this.complianceFor(user.companyId, [employee.id]);
    const year = new Date().getUTCFullYear();
    const hours = trainings
      .filter((t) => t.status === 'ATTENDED' && new Date(t.endsAt).getUTCFullYear() === year)
      .reduce((sum, t) => sum + Number(t.durationHours), 0);
    return {
      trainings,
      mandatory: report.employees[0]?.items ?? [],
      courses: report.courses,
      hoursThisYear: hours.toFixed(1),
    };
  }

  /** Training history of one employee, for HR. */
  async forEmployee(companyId: string, employeeId: string): Promise<MyTrainingDto[]> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.history(employeeId, false);
  }

  async compliance(companyId: string): Promise<ComplianceReportDto> {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
      select: { id: true },
    });
    return this.complianceFor(
      companyId,
      employees.map((e) => e.id),
    );
  }

  async summary(companyId: string): Promise<TrainingSummaryDto> {
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const yearEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    const [upcoming, completed, report, currency] = await Promise.all([
      this.prisma.trainingSession.findMany({
        where: { companyId, status: TrainingSessionStatus.PLANNED, endsAt: { gte: now } },
        select: { enrollments: { where: { status: { in: SEATED } }, select: { id: true } } },
      }),
      this.prisma.trainingSession.findMany({
        where: {
          companyId,
          status: TrainingSessionStatus.COMPLETED,
          endsAt: { gte: yearStart, lt: yearEnd },
        },
        select: {
          cost: true,
          course: { select: { category: true, durationHours: true } },
          enrollments: { select: { status: true, feedbackRating: true } },
        },
      }),
      this.compliance(companyId),
      baseCurrency(this.prisma, companyId),
    ]);
    let hours = new Prisma.Decimal(0);
    let cost = new Prisma.Decimal(0);
    let participants = 0;
    const ratings: number[] = [];
    const categories = new Map<TrainingCategory, { hours: Prisma.Decimal; participants: number }>();
    for (const session of completed) {
      cost = cost.plus(session.cost ?? 0);
      const attended = session.enrollments.filter(
        (e) => e.status === TrainingEnrollmentStatus.ATTENDED,
      ).length;
      const sessionHours = session.course.durationHours.times(attended);
      hours = hours.plus(sessionHours);
      participants += attended;
      for (const e of session.enrollments) {
        if (e.feedbackRating !== null) ratings.push(e.feedbackRating);
      }
      const entry = categories.get(session.course.category) ?? {
        hours: new Prisma.Decimal(0),
        participants: 0,
      };
      entry.hours = entry.hours.plus(sessionHours);
      entry.participants += attended;
      categories.set(session.course.category, entry);
    }
    const counts = tally(report);
    return {
      upcomingSessions: upcoming.length,
      upcomingSeats: upcoming.reduce((sum, s) => sum + s.enrollments.length, 0),
      hoursThisYear: hours.toFixed(1),
      participantsThisYear: participants,
      costThisYear: cost.toFixed(2),
      currencyCode: currency,
      averageFeedback: ratings.length
        ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
        : null,
      complianceRate: report.rate,
      expiringCount: counts.EXPIRING,
      overdueCount: counts.EXPIRED + counts.MISSING,
      byCategory: [...categories.entries()]
        .sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]))
        .map(([category, value]) => ({
          category,
          hours: value.hours.toFixed(1),
          participants: value.participants,
        })),
    };
  }

  private async history(employeeId: string, own: boolean): Promise<MyTrainingDto[]> {
    const rows = await this.prisma.trainingEnrollment.findMany({
      where: { employeeId },
      include: myTrainingInclude,
      orderBy: { session: { startsAt: 'desc' } },
    });
    const now = new Date();
    return rows.map((row) => toMyTrainingDto(row, own, now));
  }

  /** Status of every mandatory, active course for the given employees. */
  private async complianceFor(
    companyId: string,
    employeeIds: string[],
  ): Promise<ComplianceReportDto> {
    const courses = await this.prisma.trainingCourse.findMany({
      where: { companyId, isMandatory: true, isActive: true },
      select: { id: true, code: true, title: true, validityMonths: true },
      orderBy: { title: 'asc' },
    });
    const courseIds = courses.map((c) => c.id);
    const now = new Date();
    const [employees, attended, scheduled] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: {
          id: true,
          employeeNo: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.trainingEnrollment.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: TrainingEnrollmentStatus.ATTENDED,
          session: { courseId: { in: courseIds }, status: TrainingSessionStatus.COMPLETED },
        },
        select: {
          employeeId: true,
          certificateExpiresAt: true,
          session: { select: { courseId: true, endsAt: true } },
        },
        orderBy: { session: { endsAt: 'asc' } },
      }),
      this.prisma.trainingEnrollment.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: TrainingEnrollmentStatus.ENROLLED,
          session: {
            courseId: { in: courseIds },
            status: TrainingSessionStatus.PLANNED,
            endsAt: { gte: now },
          },
        },
        select: { employeeId: true, session: { select: { courseId: true, startsAt: true } } },
        orderBy: { session: { startsAt: 'desc' } },
      }),
    ]);
    const key = (employeeId: string, courseId: string) => `${employeeId}:${courseId}`;
    // Ordered so that the latest certificate and the earliest upcoming session win.
    const latest = new Map(
      attended.map((a) => [
        key(a.employeeId, a.session.courseId),
        { completedAt: a.session.endsAt, expiresAt: a.certificateExpiresAt },
      ]),
    );
    const next = new Map(
      scheduled.map((s) => [key(s.employeeId, s.session.courseId), s.session.startsAt]),
    );
    const today = parseDateOnly(toDateOnly(now));
    const courseCounts = new Map(
      courses.map((c) => [c.id, { valid: 0, expiring: 0, expired: 0, missing: 0 }]),
    );
    const totals: Record<ComplianceStatus, number> = {
      VALID: 0,
      EXPIRING: 0,
      EXPIRED: 0,
      MISSING: 0,
    };
    const rows = employees.map((employee) => ({
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      employeeName: fullName(employee),
      departmentName: employee.department?.name ?? null,
      items: courses.map((course): ComplianceItemDto => {
        const certificate = latest.get(key(employee.id, course.id));
        const status = complianceStatus(certificate ? certificate.expiresAt : undefined, today);
        totals[status] += 1;
        const counts = courseCounts.get(course.id)!;
        counts[status.toLowerCase() as keyof typeof counts] += 1;
        return {
          courseId: course.id,
          status,
          completedAt: certificate?.completedAt.toISOString() ?? null,
          expiresAt: toDateOnly(certificate?.expiresAt ?? null),
          scheduledAt: next.get(key(employee.id, course.id))?.toISOString() ?? null,
        };
      }),
    }));
    const courseDtos: ComplianceCourseDto[] = courses.map((course) => ({
      courseId: course.id,
      code: course.code,
      title: course.title,
      validityMonths: course.validityMonths,
      ...courseCounts.get(course.id)!,
    }));
    return { courses: courseDtos, employees: rows, rate: complianceRate(totals) };
  }
}

function tally(report: ComplianceReportDto): Record<ComplianceStatus, number> {
  const counts: Record<ComplianceStatus, number> = {
    VALID: 0,
    EXPIRING: 0,
    EXPIRED: 0,
    MISSING: 0,
  };
  for (const employee of report.employees) {
    for (const item of employee.items) counts[item.status] += 1;
  }
  return counts;
}
