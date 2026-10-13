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
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { EmployeesService } from '../hr/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SalariesService } from '../payroll/salaries.service';
import { reorder } from '../projects/project-math';
import type {
  CreateJobApplicationDto,
  CreateJobOfferDto,
  HireCandidateDto,
  JobApplicationDetailDto,
  JobApplicationDto,
  JobApplicationQueryDto,
  JobOfferDto,
  MoveJobApplicationDto,
  UpdateJobApplicationDto,
} from './dto/recruitment.dto';
import {
  ACTIVE_STAGES,
  advanceTo,
  daysBetween,
  feedbackScore,
  isActiveStage,
} from './recruitment-math';
import {
  addActivity,
  baseCurrency,
  fullName,
  interviewInclude,
  lockPosting,
  money,
  toInterviewDto,
} from './recruitment-support';

const SORTABLE = ['appliedAt', 'stageChangedAt', 'rating'] as const;
const TAKES_APPLICATIONS: JobPostingStatus[] = [JobPostingStatus.OPEN, JobPostingStatus.ON_HOLD];
const LIVE_OFFERS: JobOfferStatus[] = [JobOfferStatus.PENDING, JobOfferStatus.ACCEPTED];

const listInclude = {
  posting: { select: { number: true, title: true } },
  candidate: {
    select: {
      firstName: true,
      lastName: true,
      email: true,
      currentTitle: true,
      source: true,
      cvFileId: true,
    },
  },
  interviews: {
    select: {
      status: true,
      scheduledAt: true,
      participants: { select: { rating: true, recommendation: true } },
    },
  },
  offers: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.JobApplicationInclude;

const offerInclude = {
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.JobOfferInclude;

const detailInclude = {
  ...listInclude,
  posting: {
    select: {
      number: true,
      title: true,
      status: true,
      salaryMin: true,
      salaryMax: true,
      department: { select: { name: true } },
      position: { select: { name: true } },
      hiringManager: { select: { firstName: true, lastName: true } },
    },
  },
  candidate: {
    select: {
      ...listInclude.candidate.select,
      phone: true,
      city: true,
      expectedSalary: true,
    },
  },
  employee: { select: { employeeNo: true } },
} satisfies Prisma.JobApplicationInclude;

type ListRow = Prisma.JobApplicationGetPayload<{ include: typeof listInclude }>;

/** Applications (başvurular) through the pipeline, offers and hiring. */
@Injectable()
export class JobApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly salaries: SalariesService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(companyId: string, query: JobApplicationQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.JobApplicationWhereInput = {
      companyId,
      postingId: query.postingId,
      candidateId: query.candidateId,
      stage: query.stage ?? (query.active === 'true' ? { in: ACTIVE_STAGES } : undefined),
      ...(search
        ? {
            OR: [
              { candidate: { firstName: { contains: search, mode: 'insensitive' } } },
              { candidate: { lastName: { contains: search, mode: 'insensitive' } } },
              { candidate: { email: { contains: search, mode: 'insensitive' } } },
              { posting: { title: { contains: search, mode: 'insensitive' } } },
              { posting: { number: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'appliedAt'), { appliedAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.jobApplication.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  /** Every application of a posting in board order. */
  async board(companyId: string, postingId: string): Promise<JobApplicationDto[]> {
    const posting = await this.prisma.jobPosting.count({ where: { id: postingId, companyId } });
    if (!posting) throw new NotFoundException('Job posting not found');
    const rows = await this.prisma.jobApplication.findMany({
      where: { postingId },
      include: listInclude,
      orderBy: [{ sortOrder: 'asc' }, { appliedAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  async findOne(user: AuthUser, id: string): Promise<JobApplicationDetailDto> {
    const row = await this.prisma.jobApplication.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Application not found');
    const [interviews, offers, activities, currency] = await Promise.all([
      this.prisma.interview.findMany({
        where: { applicationId: id },
        include: interviewInclude,
        orderBy: { scheduledAt: 'desc' },
      }),
      this.prisma.jobOffer.findMany({
        where: { applicationId: id },
        include: offerInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.applicationActivity.findMany({
        where: { applicationId: id },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      baseCurrency(this.prisma, user.companyId),
    ]);
    const active = isActiveStage(row.stage);
    const accepted = offers.some((o) => o.status === JobOfferStatus.ACCEPTED);
    return {
      ...toDto(row),
      candidatePhone: row.candidate.phone,
      candidateCity: row.candidate.city,
      expectedSalary: money(row.candidate.expectedSalary),
      currencyCode: currency,
      departmentName: row.posting.department?.name ?? null,
      positionName: row.posting.position?.name ?? null,
      hiringManagerName: row.posting.hiringManager ? fullName(row.posting.hiringManager) : null,
      salaryMin: money(row.posting.salaryMin),
      salaryMax: money(row.posting.salaryMax),
      postingStatus: row.posting.status,
      rejectReason: row.rejectReason,
      hiredAt: row.hiredAt?.toISOString() ?? null,
      employeeId: row.employeeId,
      employeeNo: row.employee?.employeeNo ?? null,
      interviews: interviews.map(toInterviewDto),
      offers: offers.map((o) => toOfferDto(o, currency)),
      activities: activities.map((a) => ({
        id: a.id,
        type: a.type,
        fromStage: a.fromStage,
        toStage: a.toStage,
        body: a.body,
        createdByName: fullName(a.createdBy),
        createdAt: a.createdAt.toISOString(),
      })),
      feedback: feedbackScore(
        interviews
          .filter((i) => i.status !== InterviewStatus.CANCELLED)
          .flatMap((i) => i.participants),
      ),
      canEdit: active && hasPermission(user, 'recruitment:create'),
      canHire:
        row.stage === ApplicationStage.OFFER && accepted && hasPermission(user, 'recruitment:hire'),
      canReopen:
        !active &&
        row.stage !== ApplicationStage.HIRED &&
        TAKES_APPLICATIONS.includes(row.posting.status) &&
        hasPermission(user, 'recruitment:create'),
      canDelete: row.stage !== ApplicationStage.HIRED && hasPermission(user, 'recruitment:delete'),
    };
  }

  async create(user: AuthUser, dto: CreateJobApplicationDto): Promise<JobApplicationDetailDto> {
    const { companyId } = user;
    const [posting, candidate] = await Promise.all([
      this.prisma.jobPosting.findFirst({ where: { id: dto.postingId, companyId } }),
      this.prisma.candidate.findFirst({ where: { id: dto.candidateId, companyId } }),
    ]);
    if (!posting) throw new NotFoundException('Job posting not found');
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (posting.status !== JobPostingStatus.OPEN) {
      throw new ConflictException('Only open postings take applications');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      await lockPosting(tx, posting.id);
      const exists = await tx.jobApplication.count({
        where: { postingId: posting.id, candidateId: candidate.id },
      });
      if (exists) throw new ConflictException('The candidate already applied to this posting');
      const sortOrder = await nextSortOrder(tx, posting.id, ApplicationStage.APPLIED);
      const row = await tx.jobApplication.create({
        data: {
          companyId,
          postingId: posting.id,
          candidateId: candidate.id,
          sortOrder,
          createdById: user.id,
        },
      });
      await addActivity(tx, {
        applicationId: row.id,
        type: ApplicationActivityType.STAGE,
        toStage: ApplicationStage.APPLIED,
        createdById: user.id,
      });
      const note = dto.note?.trim();
      if (note) {
        await addActivity(tx, {
          applicationId: row.id,
          type: ApplicationActivityType.NOTE,
          body: note,
          createdById: user.id,
        });
      }
      return row.id;
    });
    return this.findOne(user, id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateJobApplicationDto,
  ): Promise<JobApplicationDetailDto> {
    await this.getActive(user.companyId, id);
    await this.prisma.jobApplication.update({ where: { id }, data: { rating: dto.rating } });
    return this.findOne(user, id);
  }

  async move(user: AuthUser, id: string, dto: MoveJobApplicationDto): Promise<JobApplicationDto> {
    const current = await this.getActive(user.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await lockPosting(tx, current.postingId);
      const column = await tx.jobApplication.findMany({
        where: { postingId: current.postingId, stage: dto.stage },
        orderBy: [{ sortOrder: 'asc' }, { appliedAt: 'asc' }],
        select: { id: true },
      });
      const ordered = reorder(
        column.map((a) => a.id),
        id,
        dto.position,
      );
      if (dto.stage !== current.stage) {
        await tx.jobApplication.update({
          where: { id },
          data: { stage: dto.stage, stageChangedAt: new Date() },
        });
        await addActivity(tx, {
          applicationId: id,
          type: ApplicationActivityType.STAGE,
          fromStage: current.stage,
          toStage: dto.stage,
          createdById: user.id,
        });
      }
      await Promise.all(
        ordered.map((appId, index) =>
          tx.jobApplication.update({ where: { id: appId }, data: { sortOrder: index } }),
        ),
      );
    });
    const row = await this.prisma.jobApplication.findUniqueOrThrow({
      where: { id },
      include: listInclude,
    });
    return toDto(row);
  }

  async reject(user: AuthUser, id: string, reason: string): Promise<JobApplicationDetailDto> {
    return this.close(user, id, ApplicationStage.REJECTED, reason.trim());
  }

  async withdraw(user: AuthUser, id: string): Promise<JobApplicationDetailDto> {
    return this.close(user, id, ApplicationStage.WITHDRAWN, null);
  }

  /** Back into the pipeline at the stage it left. */
  async reopen(user: AuthUser, id: string): Promise<JobApplicationDetailDto> {
    const current = await this.get(user.companyId, id);
    if (isActiveStage(current.stage) || current.stage === ApplicationStage.HIRED) {
      throw new ConflictException('Only rejected or withdrawn applications can be reopened');
    }
    if (!TAKES_APPLICATIONS.includes(current.posting.status)) {
      throw new ConflictException('The posting is closed');
    }
    await this.prisma.$transaction(async (tx) => {
      await lockPosting(tx, current.postingId);
      const left = await tx.applicationActivity.findFirst({
        where: { applicationId: id, type: ApplicationActivityType.STAGE, toStage: current.stage },
        orderBy: { createdAt: 'desc' },
        select: { fromStage: true },
      });
      const stage =
        left?.fromStage && isActiveStage(left.fromStage)
          ? left.fromStage
          : ApplicationStage.SCREENING;
      await tx.jobApplication.update({
        where: { id },
        data: {
          stage,
          rejectReason: null,
          stageChangedAt: new Date(),
          sortOrder: await nextSortOrder(tx, current.postingId, stage),
        },
      });
      await addActivity(tx, {
        applicationId: id,
        type: ApplicationActivityType.STAGE,
        fromStage: current.stage,
        toStage: stage,
        createdById: user.id,
      });
    });
    return this.findOne(user, id);
  }

  async addNote(user: AuthUser, id: string, body: string): Promise<JobApplicationDetailDto> {
    await this.get(user.companyId, id);
    await this.prisma.$transaction((tx) =>
      addActivity(tx, {
        applicationId: id,
        type: ApplicationActivityType.NOTE,
        body: body.trim(),
        createdById: user.id,
      }),
    );
    return this.findOne(user, id);
  }

  /**
   * Turns the candidate into an employee: department, position, branch and manager come from the
   * posting, the accepted offer gives the first salary. The posting closes once it is filled.
   */
  async hire(user: AuthUser, id: string, dto: HireCandidateDto): Promise<JobApplicationDetailDto> {
    const { companyId } = user;
    const current = await this.get(companyId, id);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockPosting(tx, current.postingId);
      const row = await tx.jobApplication.findUniqueOrThrow({
        where: { id },
        include: {
          candidate: true,
          posting: {
            include: {
              hiringManager: { select: { id: true, userId: true, status: true, deletedAt: true } },
            },
          },
          offers: { where: { status: JobOfferStatus.ACCEPTED }, orderBy: { createdAt: 'desc' } },
        },
      });
      if (row.stage !== ApplicationStage.OFFER) {
        throw new ConflictException('Only applications at the offer stage can be hired');
      }
      const offer = row.offers[0];
      if (!offer) throw new ConflictException('The candidate has not accepted an offer');
      const hired = await tx.jobApplication.count({
        where: { postingId: row.postingId, stage: ApplicationStage.HIRED },
      });
      if (hired >= row.posting.openings) {
        throw new ConflictException('All openings of this posting are filled');
      }
      const manager = row.posting.hiringManager;
      const hireDate = dto.hireDate ?? toDateOnly(offer.startDate);
      const employee = await this.employees.createInTx(tx, companyId, {
        firstName: row.candidate.firstName,
        lastName: row.candidate.lastName,
        email: row.candidate.email,
        phone: row.candidate.phone,
        hireDate,
        employmentType: row.posting.employmentType,
        departmentId: row.posting.departmentId,
        positionId: row.posting.positionId,
        branchId: row.posting.branchId,
        managerId:
          manager && manager.status === EmployeeStatus.ACTIVE && !manager.deletedAt
            ? manager.id
            : null,
      });
      await this.salaries.createInitial(
        tx,
        user,
        employee.id,
        parseDateOnly(hireDate),
        offer.grossSalary,
        `İşe alım: ${row.posting.number}`,
      );
      await tx.jobApplication.update({
        where: { id },
        data: {
          stage: ApplicationStage.HIRED,
          stageChangedAt: new Date(),
          hiredAt: new Date(),
          employeeId: employee.id,
        },
      });
      await addActivity(tx, {
        applicationId: id,
        type: ApplicationActivityType.HIRED,
        fromStage: ApplicationStage.OFFER,
        toStage: ApplicationStage.HIRED,
        body: employee.employeeNo,
        createdById: user.id,
      });
      if (hired + 1 >= row.posting.openings) {
        await tx.jobPosting.update({
          where: { id: row.postingId },
          data: { status: JobPostingStatus.CLOSED, closedAt: new Date() },
        });
      }
      return {
        managerUserId: manager?.userId ?? null,
        name: fullName(row.candidate),
        postingTitle: row.posting.title,
        employeeId: employee.id,
      };
    });
    if (result.managerUserId && result.managerUserId !== user.id) {
      await this.notifications.notify({
        companyId,
        userIds: [result.managerUserId],
        type: 'recruitment.hired',
        title: `${result.name} işe alındı`,
        body: `${result.postingTitle} pozisyonu için ${result.name} ekibinize katılıyor.`,
        link: `/hr/employees/${result.employeeId}`,
      });
    }
    return this.findOne(user, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const row = await this.get(companyId, id);
    if (row.stage === ApplicationStage.HIRED) {
      throw new ConflictException('Hired applications cannot be deleted');
    }
    await this.prisma.jobApplication.delete({ where: { id } });
  }

  // ---------- Offers ----------

  async createOffer(user: AuthUser, dto: CreateJobOfferDto): Promise<JobApplicationDetailDto> {
    const current = await this.getActive(user.companyId, dto.applicationId);
    const today = toDateOnly(new Date());
    if (dto.expiresAt && dto.expiresAt < today) {
      throw new BadRequestException('The offer cannot expire in the past');
    }
    await this.prisma.$transaction(async (tx) => {
      await lockPosting(tx, current.postingId);
      const live = await tx.jobOffer.count({
        where: { applicationId: current.id, status: { in: LIVE_OFFERS } },
      });
      if (live) throw new ConflictException('Withdraw the current offer before making a new one');
      await tx.jobOffer.create({
        data: {
          companyId: user.companyId,
          applicationId: current.id,
          grossSalary: dto.grossSalary,
          startDate: parseDateOnly(dto.startDate),
          expiresAt: dto.expiresAt ? parseDateOnly(dto.expiresAt) : null,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
        },
      });
      await addActivity(tx, {
        applicationId: current.id,
        type: ApplicationActivityType.OFFER,
        body: JobOfferStatus.PENDING,
        createdById: user.id,
      });
      await this.advance(tx, user, current.id, current.stage, ApplicationStage.OFFER);
    });
    return this.findOne(user, current.id);
  }

  async respondOffer(
    user: AuthUser,
    offerId: string,
    status: 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN',
  ): Promise<JobApplicationDetailDto> {
    const offer = await this.prisma.jobOffer.findFirst({
      where: { id: offerId, companyId: user.companyId },
      include: { application: { select: { stage: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.application.stage === ApplicationStage.HIRED) {
      throw new ConflictException('The candidate is already hired');
    }
    const allowed =
      status === JobOfferStatus.WITHDRAWN
        ? LIVE_OFFERS.includes(offer.status)
        : offer.status === JobOfferStatus.PENDING;
    if (!allowed) throw new ConflictException(`A ${offer.status} offer cannot be ${status}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.jobOffer.update({
        where: { id: offerId },
        data: { status, respondedAt: new Date() },
      });
      await addActivity(tx, {
        applicationId: offer.applicationId,
        type: ApplicationActivityType.OFFER,
        body: status,
        createdById: user.id,
      });
    });
    return this.findOne(user, offer.applicationId);
  }

  /** Moves an application forward (interviews, offers) and logs the stage change. */
  async advance(
    tx: PrismaTx,
    user: AuthUser,
    id: string,
    from: ApplicationStage,
    target: ApplicationStage,
  ) {
    const stage = advanceTo(from, target);
    if (stage === from) return;
    const app = await tx.jobApplication.findUniqueOrThrow({
      where: { id },
      select: { postingId: true },
    });
    await tx.jobApplication.update({
      where: { id },
      data: {
        stage,
        stageChangedAt: new Date(),
        sortOrder: await nextSortOrder(tx, app.postingId, stage),
      },
    });
    await addActivity(tx, {
      applicationId: id,
      type: ApplicationActivityType.STAGE,
      fromStage: from,
      toStage: stage,
      createdById: user.id,
    });
  }

  private async close(
    user: AuthUser,
    id: string,
    stage: ApplicationStage,
    reason: string | null,
  ): Promise<JobApplicationDetailDto> {
    const current = await this.getActive(user.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.jobApplication.update({
        where: { id },
        data: { stage, rejectReason: reason, stageChangedAt: new Date() },
      });
      await tx.jobOffer.updateMany({
        where: { applicationId: id, status: { in: LIVE_OFFERS } },
        data: { status: JobOfferStatus.WITHDRAWN, respondedAt: new Date() },
      });
      await tx.interview.updateMany({
        where: {
          applicationId: id,
          status: InterviewStatus.SCHEDULED,
          scheduledAt: { gt: new Date() },
        },
        data: { status: InterviewStatus.CANCELLED },
      });
      await addActivity(tx, {
        applicationId: id,
        type: ApplicationActivityType.STAGE,
        fromStage: current.stage,
        toStage: stage,
        body: reason,
        createdById: user.id,
      });
    });
    return this.findOne(user, id);
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.jobApplication.findFirst({
      where: { id, companyId },
      include: { posting: { select: { status: true } } },
    });
    if (!row) throw new NotFoundException('Application not found');
    return row;
  }

  /** Still in the pipeline of a posting that is not closed. */
  async getActive(companyId: string, id: string) {
    const row = await this.get(companyId, id);
    if (!isActiveStage(row.stage)) {
      throw new ConflictException('The application is no longer in the pipeline');
    }
    if (row.posting.status === JobPostingStatus.CLOSED) {
      throw new ConflictException('The posting is closed');
    }
    return row;
  }
}

async function nextSortOrder(tx: PrismaTx, postingId: string, stage: ApplicationStage) {
  const last = await tx.jobApplication.aggregate({
    where: { postingId, stage },
    _max: { sortOrder: true },
  });
  return (last._max.sortOrder ?? -1) + 1;
}

function toDto(row: ListRow): JobApplicationDto {
  const now = new Date();
  const upcoming = row.interviews
    .filter((i) => i.status === InterviewStatus.SCHEDULED && i.scheduledAt >= now)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const score = feedbackScore(
    row.interviews
      .filter((i) => i.status !== InterviewStatus.CANCELLED)
      .flatMap((i) => i.participants),
  );
  return {
    id: row.id,
    postingId: row.postingId,
    postingNumber: row.posting.number,
    postingTitle: row.posting.title,
    candidateId: row.candidateId,
    candidateName: fullName(row.candidate),
    candidateEmail: row.candidate.email,
    candidateTitle: row.candidate.currentTitle,
    source: row.candidate.source,
    stage: row.stage,
    rating: row.rating,
    sortOrder: row.sortOrder,
    appliedAt: row.appliedAt.toISOString(),
    stageChangedAt: row.stageChangedAt.toISOString(),
    daysInStage: daysBetween(row.stageChangedAt, now),
    interviewCount: row.interviews.filter((i) => i.status !== InterviewStatus.CANCELLED).length,
    nextInterviewAt: upcoming[0]?.scheduledAt.toISOString() ?? null,
    averageRating: score.averageRating,
    offerStatus: row.offers[0]?.status ?? null,
    hasCv: !!row.candidate.cvFileId,
  };
}

function toOfferDto(
  row: Prisma.JobOfferGetPayload<{ include: typeof offerInclude }>,
  currencyCode: string,
): JobOfferDto {
  return {
    id: row.id,
    applicationId: row.applicationId,
    grossSalary: money(row.grossSalary),
    currencyCode,
    startDate: toDateOnly(row.startDate),
    expiresAt: toDateOnly(row.expiresAt),
    status: row.status,
    notes: row.notes,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    createdByName: fullName(row.createdBy),
    createdAt: row.createdAt.toISOString(),
  };
}
