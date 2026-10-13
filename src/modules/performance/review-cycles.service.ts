import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, PerformanceReviewStatus, Prisma, ReviewCycleStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateReviewCycleDto,
  CycleReviewQueryDto,
  PerformanceReviewDto,
  ReviewCycleDetailDto,
  ReviewCycleDto,
  ReviewCycleQueryDto,
  UpdateReviewCycleDto,
} from './dto/performance.dto';
import { scoreDistribution } from './performance-math';
import { fullName, reviewListInclude, score, toReviewDto } from './performance-support';

const detailInclude = {
  createdBy: { select: { firstName: true, lastName: true } },
  competencies: {
    include: { competency: { select: { id: true, name: true, description: true } } },
    orderBy: [{ competency: { sortOrder: 'asc' } }, { competency: { name: 'asc' } }],
  },
} satisfies Prisma.ReviewCycleInclude;

type CycleRow = Prisma.ReviewCycleGetPayload<object>;

/** Değerlendirme dönemleri. */
@Injectable()
export class ReviewCyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(companyId: string, query: ReviewCycleQueryDto): Promise<ReviewCycleDto[]> {
    const rows = await this.prisma.reviewCycle.findMany({
      where: { companyId, status: query.status },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    const stats = await this.stats(rows.map((r) => r.id));
    return rows.map((row) => toDto(row, stats.get(row.id)));
  }

  async findOne(user: AuthUser, id: string): Promise<ReviewCycleDetailDto> {
    const row = await this.prisma.reviewCycle.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Review cycle not found');
    const reviews = await this.prisma.performanceReview.findMany({
      where: { cycleId: id },
      select: {
        status: true,
        overallScore: true,
        acknowledgedAt: true,
        employee: { select: { departmentId: true, department: { select: { name: true } } } },
      },
    });
    const statusCounts = { SELF_REVIEW: 0, MANAGER_REVIEW: 0, COMPLETED: 0 };
    const departments = new Map<
      string,
      { name: string | null; id: string | null; total: number; scores: number[] }
    >();
    const scores: number[] = [];
    for (const review of reviews) {
      statusCounts[review.status] += 1;
      const key = review.employee.departmentId ?? '';
      const dept = departments.get(key) ?? {
        id: review.employee.departmentId,
        name: review.employee.department?.name ?? null,
        total: 0,
        scores: [],
      };
      dept.total += 1;
      if (review.overallScore !== null) {
        dept.scores.push(review.overallScore.toNumber());
        scores.push(review.overallScore.toNumber());
      }
      departments.set(key, dept);
    }
    const canUpdate = hasPermission(user, 'performance:update');
    const stats = await this.stats([id]);
    return {
      ...toDto(row, stats.get(id)),
      competencies: row.competencies.map((c) => c.competency),
      statusCounts,
      distribution: scoreDistribution(scores),
      departments: [...departments.values()]
        .map((d) => ({
          departmentId: d.id,
          departmentName: d.name,
          reviewCount: d.total,
          completedCount: d.scores.length,
          averageScore: mean(d.scores),
        }))
        .sort((a, b) => (a.departmentName ?? '').localeCompare(b.departmentName ?? '', 'tr')),
      acknowledgedCount: reviews.filter((r) => r.acknowledgedAt).length,
      createdByName: fullName(row.createdBy),
      canEdit: canUpdate && row.status !== ReviewCycleStatus.CLOSED,
      canLaunch: canUpdate && row.status === ReviewCycleStatus.DRAFT,
      canClose: canUpdate && row.status === ReviewCycleStatus.ACTIVE,
      canDelete:
        hasPermission(user, 'performance:delete') && row.status === ReviewCycleStatus.DRAFT,
    };
  }

  async reviews(
    companyId: string,
    id: string,
    query: CycleReviewQueryDto,
  ): Promise<PerformanceReviewDto[]> {
    await this.get(companyId, id);
    const search = query.search?.trim();
    const rows = await this.prisma.performanceReview.findMany({
      where: {
        cycleId: id,
        status: query.status,
        employee: {
          departmentId: query.departmentId,
          ...(search
            ? {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                  { employeeNo: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: reviewListInclude,
      orderBy: [{ employee: { firstName: 'asc' } }, { employee: { lastName: 'asc' } }],
    });
    return rows.map(toReviewDto);
  }

  async create(user: AuthUser, dto: CreateReviewCycleDto): Promise<ReviewCycleDetailDto> {
    assertDates(dto);
    await this.assertCompetencies(user.companyId, dto.competencyIds);
    const row = await this.prisma.reviewCycle.create({
      data: {
        companyId: user.companyId,
        name: dto.name.trim(),
        periodStart: parseDateOnly(dto.periodStart),
        periodEnd: parseDateOnly(dto.periodEnd),
        selfReviewDue: parseDateOnly(dto.selfReviewDue),
        managerReviewDue: parseDateOnly(dto.managerReviewDue),
        goalWeight: dto.goalWeight,
        createdById: user.id,
        competencies: { create: dto.competencyIds.map((competencyId) => ({ competencyId })) },
      },
    });
    return this.findOne(user, row.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateReviewCycleDto,
  ): Promise<ReviewCycleDetailDto> {
    const current = await this.get(user.companyId, id);
    if (current.status === ReviewCycleStatus.CLOSED) {
      throw new ConflictException('A closed review cycle cannot be changed');
    }
    if (
      current.status !== ReviewCycleStatus.DRAFT &&
      (dto.periodStart !== undefined ||
        dto.periodEnd !== undefined ||
        dto.goalWeight !== undefined ||
        dto.competencyIds !== undefined)
    ) {
      throw new ConflictException('Only the name and the due dates can change after launch');
    }
    assertDates({
      periodStart: dto.periodStart ?? toDateOnly(current.periodStart),
      periodEnd: dto.periodEnd ?? toDateOnly(current.periodEnd),
      selfReviewDue: dto.selfReviewDue ?? toDateOnly(current.selfReviewDue),
      managerReviewDue: dto.managerReviewDue ?? toDateOnly(current.managerReviewDue),
    });
    if (dto.competencyIds) await this.assertCompetencies(user.companyId, dto.competencyIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewCycle.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          periodStart: dto.periodStart ? parseDateOnly(dto.periodStart) : undefined,
          periodEnd: dto.periodEnd ? parseDateOnly(dto.periodEnd) : undefined,
          selfReviewDue: dto.selfReviewDue ? parseDateOnly(dto.selfReviewDue) : undefined,
          managerReviewDue: dto.managerReviewDue ? parseDateOnly(dto.managerReviewDue) : undefined,
          goalWeight: dto.goalWeight,
        },
      });
      if (dto.competencyIds) {
        await tx.reviewCycleCompetency.deleteMany({ where: { cycleId: id } });
        await tx.reviewCycleCompetency.createMany({
          data: dto.competencyIds.map((competencyId) => ({ cycleId: id, competencyId })),
        });
      }
    });
    return this.findOne(user, id);
  }

  /** Opens a review for every active employee hired by the end of the period. */
  async launch(user: AuthUser, id: string): Promise<ReviewCycleDetailDto> {
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, companyId: user.companyId },
      include: { competencies: { select: { competencyId: true } } },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status !== ReviewCycleStatus.DRAFT) {
      throw new ConflictException('Only draft review cycles can be launched');
    }
    if (cycle.goalWeight < 100 && !cycle.competencies.length) {
      throw new BadRequestException('Pick at least one competency or weight goals 100%');
    }
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: user.companyId,
        deletedAt: null,
        status: EmployeeStatus.ACTIVE,
        hireDate: { lte: cycle.periodEnd },
      },
      select: {
        id: true,
        userId: true,
        manager: { select: { id: true, status: true, deletedAt: true } },
      },
    });
    if (!employees.length) throw new BadRequestException('There are no employees to review');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.reviewCycle.updateMany({
        where: { id, status: ReviewCycleStatus.DRAFT },
        data: { status: ReviewCycleStatus.ACTIVE, launchedAt: new Date() },
      });
      if (!updated.count) throw new ConflictException('Only draft review cycles can be launched');
      for (const employee of employees) {
        const manager = employee.manager;
        await tx.performanceReview.create({
          data: {
            companyId: user.companyId,
            cycleId: id,
            employeeId: employee.id,
            reviewerId:
              manager && manager.status === EmployeeStatus.ACTIVE && !manager.deletedAt
                ? manager.id
                : null,
            ratings: {
              create: cycle.competencies.map((c) => ({ competencyId: c.competencyId })),
            },
          },
        });
      }
    });
    await this.notifications.notify({
      companyId: user.companyId,
      userIds: employees
        .map((e) => e.userId)
        .filter((userId): userId is string => !!userId && userId !== user.id),
      type: 'performance.cycleLaunched',
      title: `Performans değerlendirmesi başladı: ${cycle.name}`,
      body: `Hedeflerinizi girip öz değerlendirmenizi ${formatDay(cycle.selfReviewDue)} tarihine kadar tamamlayın.`,
      link: '/performance/my',
    });
    return this.findOne(user, id);
  }

  async close(user: AuthUser, id: string): Promise<ReviewCycleDetailDto> {
    const current = await this.get(user.companyId, id);
    if (current.status !== ReviewCycleStatus.ACTIVE) {
      throw new ConflictException('Only active review cycles can be closed');
    }
    await this.prisma.reviewCycle.update({
      where: { id },
      data: { status: ReviewCycleStatus.CLOSED, closedAt: new Date() },
    });
    return this.findOne(user, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const current = await this.get(companyId, id);
    if (current.status !== ReviewCycleStatus.DRAFT) {
      throw new ConflictException('Only draft review cycles can be deleted');
    }
    await this.prisma.reviewCycle.delete({ where: { id } });
  }

  private async get(companyId: string, id: string): Promise<CycleRow> {
    const row = await this.prisma.reviewCycle.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Review cycle not found');
    return row;
  }

  private async assertCompetencies(companyId: string, ids: string[]) {
    if (!ids.length) return;
    const count = await this.prisma.competency.count({
      where: { id: { in: ids }, companyId, isActive: true },
    });
    if (count !== ids.length) throw new BadRequestException('Competencies must be active');
  }

  private async stats(ids: string[]) {
    const groups = ids.length
      ? await this.prisma.performanceReview.groupBy({
          by: ['cycleId', 'status'],
          where: { cycleId: { in: ids } },
          _count: { _all: true },
          _avg: { overallScore: true },
        })
      : [];
    const result = new Map<string, { total: number; completed: number; average: string | null }>();
    for (const group of groups) {
      const entry = result.get(group.cycleId) ?? { total: 0, completed: 0, average: null };
      entry.total += group._count._all;
      if (group.status === PerformanceReviewStatus.COMPLETED) {
        entry.completed = group._count._all;
        entry.average = score(group._avg.overallScore);
      }
      result.set(group.cycleId, entry);
    }
    return result;
  }
}

function assertDates(dto: {
  periodStart: string;
  periodEnd: string;
  selfReviewDue: string;
  managerReviewDue: string;
}) {
  if (dto.periodEnd < dto.periodStart) {
    throw new BadRequestException('The period cannot end before it starts');
  }
  if (dto.managerReviewDue < dto.selfReviewDue) {
    throw new BadRequestException('The manager review cannot be due before the self review');
  }
}

function mean(values: number[]): string | null {
  if (!values.length) return null;
  return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
}

function formatDay(value: Date) {
  return value.toLocaleDateString('tr-TR', { timeZone: 'UTC' });
}

function toDto(
  row: CycleRow,
  stats: { total: number; completed: number; average: string | null } | undefined,
): ReviewCycleDto {
  return {
    id: row.id,
    name: row.name,
    periodStart: toDateOnly(row.periodStart),
    periodEnd: toDateOnly(row.periodEnd),
    selfReviewDue: toDateOnly(row.selfReviewDue),
    managerReviewDue: toDateOnly(row.managerReviewDue),
    goalWeight: row.goalWeight,
    status: row.status,
    launchedAt: row.launchedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    reviewCount: stats?.total ?? 0,
    completedCount: stats?.completed ?? 0,
    averageScore: stats?.average ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
