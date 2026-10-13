import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationActivityType,
  ApplicationStage,
  EmployeeStatus,
  InterviewStatus,
  JobOfferStatus,
  JobPostingStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import type {
  ChangeJobPostingStatusDto,
  CreateJobPostingDto,
  JobPostingDetailDto,
  JobPostingDto,
  JobPostingQueryDto,
  RecruitmentSummaryDto,
  UpdateJobPostingDto,
} from './dto/recruitment.dto';
import { ACTIVE_STAGES, averageDaysToHire, funnel, isActiveStage } from './recruitment-math';
import { baseCurrency, emptyStageCounts, fullName, money, trimOrNull } from './recruitment-support';

const SORTABLE = ['number', 'title', 'closesAt', 'createdAt'] as const;
const ACTIVE_POSTINGS = [JobPostingStatus.OPEN, JobPostingStatus.ON_HOLD];
const DAY_MS = 86_400_000;

/** Allowed status changes; a published posting never goes back to draft. */
const TRANSITIONS: Record<JobPostingStatus, JobPostingStatus[]> = {
  DRAFT: [JobPostingStatus.OPEN, JobPostingStatus.CLOSED],
  OPEN: [JobPostingStatus.ON_HOLD, JobPostingStatus.CLOSED],
  ON_HOLD: [JobPostingStatus.OPEN, JobPostingStatus.CLOSED],
  CLOSED: [JobPostingStatus.OPEN],
};

const listInclude = {
  department: { select: { name: true } },
  position: { select: { name: true } },
  branch: { select: { name: true } },
  hiringManager: { select: { firstName: true, lastName: true } },
} satisfies Prisma.JobPostingInclude;

const detailInclude = {
  ...listInclude,
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.JobPostingInclude;

type ListRow = Prisma.JobPostingGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.JobPostingGetPayload<{ include: typeof detailInclude }>;

/** Job postings (iş ilanları) and the recruitment summary. */
@Injectable()
export class JobPostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async findAll(companyId: string, query: JobPostingQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.JobPostingWhereInput = {
      companyId,
      status: query.status ?? (query.active === 'true' ? { in: ACTIVE_POSTINGS } : undefined),
      departmentId: query.departmentId,
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { title: { contains: search, mode: 'insensitive' } },
              { department: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total, currency] = await Promise.all([
      this.prisma.jobPosting.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.jobPosting.count({ where }),
      baseCurrency(this.prisma, companyId),
    ]);
    const counts = await this.stageCounts(rows.map((r) => r.id));
    return paginated(
      rows.map((row) => toDto(row, counts.get(row.id), currency)),
      total,
      query,
    );
  }

  async findOne(user: AuthUser, id: string): Promise<JobPostingDetailDto> {
    const row = await this.prisma.jobPosting.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Job posting not found');
    const [counts, currency] = await Promise.all([
      this.stageCounts([id]),
      baseCurrency(this.prisma, user.companyId),
    ]);
    return toDetailDto(row, counts.get(id), currency, user);
  }

  async create(user: AuthUser, dto: CreateJobPostingDto): Promise<JobPostingDetailDto> {
    await this.assertReferences(user.companyId, dto);
    assertSalaryRange(dto.salaryMin, dto.salaryMax);
    const status = dto.status ?? JobPostingStatus.DRAFT;
    const row = await this.prisma.$transaction(async (tx) =>
      tx.jobPosting.create({
        data: {
          companyId: user.companyId,
          number: await this.numbering.next(user.companyId, 'JOB_POSTING', tx),
          title: dto.title.trim(),
          departmentId: dto.departmentId ?? null,
          positionId: dto.positionId ?? null,
          branchId: dto.branchId ?? null,
          employmentType: dto.employmentType,
          location: trimOrNull(dto.location),
          description: trimOrNull(dto.description),
          requirements: trimOrNull(dto.requirements),
          openings: dto.openings ?? 1,
          hiringManagerId: dto.hiringManagerId ?? null,
          salaryMin: dto.salaryMin ?? null,
          salaryMax: dto.salaryMax ?? null,
          closesAt: dto.closesAt ? parseDateOnly(dto.closesAt) : null,
          status,
          publishedAt: status === JobPostingStatus.OPEN ? new Date() : null,
          createdById: user.id,
        },
      }),
    );
    return this.findOne(user, row.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateJobPostingDto): Promise<JobPostingDetailDto> {
    const current = await this.get(user.companyId, id);
    await this.assertReferences(user.companyId, dto);
    assertSalaryRange(
      dto.salaryMin === undefined ? current.salaryMin : dto.salaryMin,
      dto.salaryMax === undefined ? current.salaryMax : dto.salaryMax,
    );
    if (dto.openings !== undefined) {
      const hired = await this.prisma.jobApplication.count({
        where: { postingId: id, stage: ApplicationStage.HIRED },
      });
      if (dto.openings < hired) {
        throw new ConflictException(`${hired} people are already hired for this posting`);
      }
    }
    await this.prisma.jobPosting.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        departmentId: dto.departmentId,
        positionId: dto.positionId,
        branchId: dto.branchId,
        employmentType: dto.employmentType,
        location: trimOrNull(dto.location),
        description: trimOrNull(dto.description),
        requirements: trimOrNull(dto.requirements),
        openings: dto.openings,
        hiringManagerId: dto.hiringManagerId,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        closesAt:
          dto.closesAt === undefined ? undefined : dto.closesAt && parseDateOnly(dto.closesAt),
      },
    });
    return this.findOne(user, id);
  }

  async changeStatus(
    user: AuthUser,
    id: string,
    dto: ChangeJobPostingStatusDto,
  ): Promise<JobPostingDetailDto> {
    const current = await this.get(user.companyId, id);
    if (current.status === dto.status) return this.findOne(user, id);
    if (!TRANSITIONS[current.status].includes(dto.status)) {
      throw new ConflictException(`A ${current.status} posting cannot become ${dto.status}`);
    }
    if (current.status === JobPostingStatus.CLOSED) {
      const hired = await this.prisma.jobApplication.count({
        where: { postingId: id, stage: ApplicationStage.HIRED },
      });
      if (hired >= current.openings) {
        throw new ConflictException('All openings are filled; add openings before reopening');
      }
    }
    await this.prisma.jobPosting.update({
      where: { id },
      data: {
        status: dto.status,
        publishedAt:
          dto.status === JobPostingStatus.OPEN && !current.publishedAt ? new Date() : undefined,
        closedAt: dto.status === JobPostingStatus.CLOSED ? new Date() : null,
      },
    });
    return this.findOne(user, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.get(companyId, id);
    const applications = await this.prisma.jobApplication.count({ where: { postingId: id } });
    if (applications > 0) {
      throw new ConflictException('Postings with applications cannot be deleted; close it instead');
    }
    await this.prisma.jobPosting.delete({ where: { id } });
  }

  async summary(companyId: string): Promise<RecruitmentSummaryDto> {
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const monday = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
      ),
    );
    const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);

    const [postings, active, fresh, interviewsThisWeek, pendingOffers, hires, yearApps, upcoming] =
      await Promise.all([
        this.prisma.jobPosting.findMany({
          where: { companyId, status: { in: ACTIVE_POSTINGS } },
          select: {
            openings: true,
            status: true,
            _count: { select: { applications: { where: { stage: ApplicationStage.HIRED } } } },
          },
        }),
        this.prisma.jobApplication.count({
          where: { companyId, stage: { in: ACTIVE_STAGES } },
        }),
        this.prisma.jobApplication.count({ where: { companyId, appliedAt: { gte: weekAgo } } }),
        this.prisma.interview.count({
          where: {
            companyId,
            status: { not: InterviewStatus.CANCELLED },
            scheduledAt: { gte: monday, lt: nextMonday },
          },
        }),
        this.prisma.jobOffer.count({ where: { companyId, status: JobOfferStatus.PENDING } }),
        this.prisma.jobApplication.findMany({
          where: { companyId, stage: ApplicationStage.HIRED, hiredAt: { gte: yearStart } },
          select: { appliedAt: true, hiredAt: true },
        }),
        this.prisma.jobApplication.findMany({
          where: { companyId, appliedAt: { gte: yearStart } },
          select: {
            stage: true,
            candidate: { select: { source: true } },
            activities: {
              where: { type: ApplicationActivityType.STAGE },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { fromStage: true },
            },
          },
        }),
        this.prisma.interview.findMany({
          where: { companyId, status: InterviewStatus.SCHEDULED, scheduledAt: { gte: now } },
          orderBy: { scheduledAt: 'asc' },
          take: 5,
          include: {
            application: {
              select: {
                candidate: { select: { firstName: true, lastName: true } },
                posting: { select: { title: true } },
              },
            },
            participants: {
              include: { employee: { select: { firstName: true, lastName: true } } },
            },
          },
        }),
      ]);

    const bySource = new Map<string, { applications: number; hired: number }>();
    for (const app of yearApps) {
      const entry = bySource.get(app.candidate.source) ?? { applications: 0, hired: 0 };
      entry.applications++;
      if (app.stage === ApplicationStage.HIRED) entry.hired++;
      bySource.set(app.candidate.source, entry);
    }

    return {
      openPostings: postings.filter((p) => p.status === JobPostingStatus.OPEN).length,
      openPositions: postings.reduce(
        (sum, p) => sum + Math.max(0, p.openings - p._count.applications),
        0,
      ),
      activeApplications: active,
      newApplications: fresh,
      interviewsThisWeek,
      pendingOffers,
      hiresThisYear: hires.length,
      averageDaysToHire: averageDaysToHire(
        hires.map((h) => ({ appliedAt: h.appliedAt, hiredAt: h.hiredAt ?? h.appliedAt })),
      ),
      funnel: funnel(
        yearApps.map((app) => ({
          stage: app.stage,
          lastActiveStage:
            !isActiveStage(app.stage) && app.activities[0]?.fromStage
              ? app.activities[0].fromStage
              : ApplicationStage.APPLIED,
        })),
      ),
      bySource: [...bySource.entries()]
        .map(([source, entry]) => ({ source: source as never, ...entry }))
        .sort((a, b) => b.applications - a.applications),
      upcomingInterviews: upcoming.map((i) => ({
        id: i.id,
        applicationId: i.applicationId,
        candidateName: fullName(i.application.candidate),
        postingTitle: i.application.posting.title,
        type: i.type,
        scheduledAt: i.scheduledAt.toISOString(),
        interviewerNames: i.participants.map((p) => fullName(p.employee)),
      })),
    };
  }

  private async stageCounts(ids: string[]) {
    const map = new Map<string, Record<ApplicationStage, number>>();
    if (!ids.length) return map;
    const groups = await this.prisma.jobApplication.groupBy({
      by: ['postingId', 'stage'],
      where: { postingId: { in: ids } },
      _count: true,
    });
    for (const group of groups) {
      const counts = map.get(group.postingId) ?? emptyStageCounts();
      counts[group.stage] = group._count;
      map.set(group.postingId, counts);
    }
    return map;
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.jobPosting.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Job posting not found');
    return row;
  }

  private async assertReferences(companyId: string, dto: UpdateJobPostingDto) {
    const missing = async (count: Promise<number>, message: string) => {
      if (!(await count)) throw new BadRequestException(message);
    };
    await Promise.all([
      dto.departmentId &&
        missing(
          this.prisma.department.count({
            where: { id: dto.departmentId, companyId, deletedAt: null },
          }),
          'Department not found',
        ),
      dto.positionId &&
        missing(
          this.prisma.position.count({ where: { id: dto.positionId, companyId, deletedAt: null } }),
          'Position not found',
        ),
      dto.branchId &&
        missing(
          this.prisma.branch.count({ where: { id: dto.branchId, companyId } }),
          'Branch not found',
        ),
      dto.hiringManagerId &&
        missing(
          this.prisma.employee.count({
            where: {
              id: dto.hiringManagerId,
              companyId,
              deletedAt: null,
              status: EmployeeStatus.ACTIVE,
            },
          }),
          'Hiring manager must be an active employee',
        ),
    ]);
  }
}

function assertSalaryRange(
  min: Prisma.Decimal.Value | null | undefined,
  max: Prisma.Decimal.Value | null | undefined,
) {
  if (min != null && max != null && new Prisma.Decimal(min).gt(max)) {
    throw new BadRequestException('The minimum salary cannot exceed the maximum');
  }
}

function toDto(
  row: ListRow,
  counts: Record<ApplicationStage, number> = emptyStageCounts(),
  currencyCode: string,
): JobPostingDto {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    positionId: row.positionId,
    positionName: row.position?.name ?? null,
    branchName: row.branch?.name ?? null,
    employmentType: row.employmentType,
    location: row.location,
    openings: row.openings,
    status: row.status,
    hiringManagerId: row.hiringManagerId,
    hiringManagerName: row.hiringManager ? fullName(row.hiringManager) : null,
    salaryMin: money(row.salaryMin),
    salaryMax: money(row.salaryMax),
    currencyCode,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    closesAt: toDateOnly(row.closesAt),
    closedAt: row.closedAt?.toISOString() ?? null,
    applicationCount: total,
    activeCount: ACTIVE_STAGES.reduce((sum, stage) => sum + counts[stage], 0),
    hiredCount: counts.HIRED,
    stageCounts: counts,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetailDto(
  row: DetailRow,
  counts: Record<ApplicationStage, number> | undefined,
  currencyCode: string,
  user: AuthUser,
): JobPostingDetailDto {
  const dto = toDto(row, counts, currencyCode);
  return {
    ...dto,
    branchId: row.branchId,
    description: row.description,
    requirements: row.requirements,
    createdByName: fullName(row.createdBy),
    canEdit: hasPermission(user, 'recruitment:update'),
    canDelete: dto.applicationCount === 0 && hasPermission(user, 'recruitment:delete'),
  };
}
