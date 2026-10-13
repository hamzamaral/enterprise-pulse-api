import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationActivityType,
  ApplicationStage,
  EmployeeStatus,
  InterviewStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { DownloadUrlDto } from '../files/dto/file.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { CandidatesService } from './candidates.service';
import type {
  CreateInterviewDto,
  InterviewDto,
  InterviewFeedbackDto,
  MyInterviewDto,
  MyInterviewQueryDto,
  UpdateInterviewDto,
} from './dto/recruitment.dto';
import { JobApplicationsService } from './job-applications.service';
import { addActivity, fullName, interviewInclude, toInterviewDto } from './recruitment-support';

const mineInclude = {
  ...interviewInclude,
  application: {
    select: {
      candidateId: true,
      candidate: {
        select: { firstName: true, lastName: true, currentTitle: true, cvFileId: true },
      },
      posting: { select: { number: true, title: true } },
    },
  },
} satisfies Prisma.InterviewInclude;

type MineRow = Prisma.InterviewGetPayload<{ include: typeof mineInclude }>;

/** Interviews (mülakatlar); interviewers rate their own interviews without a permission. */
@Injectable()
export class InterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: JobApplicationsService,
    private readonly candidates: CandidatesService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: AuthUser, dto: CreateInterviewDto): Promise<InterviewDto> {
    const application = await this.applications.getActive(user.companyId, dto.applicationId);
    const interviewers = await this.interviewers(user.companyId, dto.interviewerIds);
    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.interview.create({
        data: {
          companyId: user.companyId,
          applicationId: application.id,
          type: dto.type,
          scheduledAt: new Date(dto.scheduledAt),
          durationMinutes: dto.durationMinutes ?? 60,
          location: dto.location?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
          participants: { create: interviewers.map((e) => ({ employeeId: e.id })) },
        },
      });
      await addActivity(tx, {
        applicationId: application.id,
        type: ApplicationActivityType.INTERVIEW,
        body: InterviewStatus.SCHEDULED,
        createdById: user.id,
      });
      await this.applications.advance(
        tx,
        user,
        application.id,
        application.stage,
        ApplicationStage.INTERVIEW,
      );
      return row.id;
    });
    const result = await this.get(user.companyId, id);
    await this.notify(
      user,
      result,
      interviewers.map((e) => e.userId),
      'scheduled',
    );
    return toInterviewDto(result);
  }

  async update(user: AuthUser, id: string, dto: UpdateInterviewDto): Promise<InterviewDto> {
    const current = await this.get(user.companyId, id);
    if (current.status !== InterviewStatus.SCHEDULED) {
      throw new ConflictException('Only scheduled interviews can be changed');
    }
    const interviewers = dto.interviewerIds
      ? await this.interviewers(user.companyId, dto.interviewerIds)
      : null;
    const existing = new Set(current.participants.map((p) => p.employeeId));
    await this.prisma.$transaction(async (tx) => {
      await tx.interview.update({
        where: { id },
        data: {
          type: dto.type,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
          durationMinutes: dto.durationMinutes,
          location: dto.location === undefined ? undefined : dto.location?.trim() || null,
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
        },
      });
      if (interviewers) {
        const keep = interviewers.map((e) => e.id);
        await tx.interviewParticipant.deleteMany({
          where: { interviewId: id, employeeId: { notIn: keep } },
        });
        await tx.interviewParticipant.createMany({
          data: keep
            .filter((employeeId) => !existing.has(employeeId))
            .map((employeeId) => ({ interviewId: id, employeeId })),
        });
      }
    });
    const result = await this.get(user.companyId, id);
    const added = (interviewers ?? []).filter((e) => !existing.has(e.id)).map((e) => e.userId);
    await this.notify(user, result, added, 'scheduled');
    return toInterviewDto(result);
  }

  async cancel(user: AuthUser, id: string): Promise<InterviewDto> {
    const current = await this.get(user.companyId, id);
    if (current.status !== InterviewStatus.SCHEDULED) {
      throw new ConflictException('Only scheduled interviews can be cancelled');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.interview.update({ where: { id }, data: { status: InterviewStatus.CANCELLED } });
      await addActivity(tx, {
        applicationId: current.applicationId,
        type: ApplicationActivityType.INTERVIEW,
        body: InterviewStatus.CANCELLED,
        createdById: user.id,
      });
    });
    const result = await this.get(user.companyId, id);
    await this.notify(
      user,
      result,
      current.participants.map((p) => p.employee.userId),
      'cancelled',
    );
    return toInterviewDto(result);
  }

  /** The interviewer's own feedback; the interview completes once everybody has answered. */
  async feedback(user: AuthUser, id: string, dto: InterviewFeedbackDto): Promise<MyInterviewDto> {
    const employeeId = await this.ownEmployeeId(user);
    const current = await this.getMine(user.companyId, id);
    const participant = current.participants.find((p) => p.employeeId === employeeId);
    if (!participant) throw new ForbiddenException('You are not an interviewer of this interview');
    if (current.status === InterviewStatus.CANCELLED) {
      throw new ConflictException('The interview is cancelled');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.interviewParticipant.update({
        where: { id: participant.id },
        data: {
          rating: dto.rating,
          recommendation: dto.recommendation,
          feedback: dto.feedback?.trim() || null,
          submittedAt: new Date(),
        },
      });
      const pending = current.participants.filter(
        (p) => p.id !== participant.id && !p.submittedAt,
      ).length;
      if (current.status === InterviewStatus.SCHEDULED && pending === 0) {
        await tx.interview.update({ where: { id }, data: { status: InterviewStatus.COMPLETED } });
        await addActivity(tx, {
          applicationId: current.applicationId,
          type: ApplicationActivityType.INTERVIEW,
          body: InterviewStatus.COMPLETED,
          createdById: user.id,
        });
      }
    });
    return toMineDto(await this.getMine(user.companyId, id), employeeId);
  }

  async mine(user: AuthUser, query: MyInterviewQueryDto): Promise<MyInterviewDto[]> {
    const employeeId = await this.ownEmployeeId(user, false);
    if (!employeeId) return [];
    const upcoming = query.upcoming === 'true';
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const rows = await this.prisma.interview.findMany({
      where: {
        companyId: user.companyId,
        participants: { some: { employeeId } },
        ...(upcoming ? { status: InterviewStatus.SCHEDULED, scheduledAt: { gte: today } } : {}),
      },
      include: mineInclude,
      orderBy: { scheduledAt: upcoming ? 'asc' : 'desc' },
      take: 200,
    });
    return rows.map((row) => toMineDto(row, employeeId));
  }

  async findMine(user: AuthUser, id: string): Promise<MyInterviewDto> {
    const row = await this.visible(user, id);
    const employeeId = await this.ownEmployeeId(user, false);
    return toMineDto(row, employeeId);
  }

  async cvUrl(user: AuthUser, id: string): Promise<DownloadUrlDto> {
    const row = await this.visible(user, id);
    return this.candidates.cvUrl(user.companyId, row.application.candidateId);
  }

  /** Interviewers and `recruitment:read` see an interview. */
  private async visible(user: AuthUser, id: string): Promise<MineRow> {
    const row = await this.getMine(user.companyId, id);
    if (hasPermission(user, 'recruitment:read')) return row;
    const employeeId = await this.ownEmployeeId(user, false);
    if (!employeeId || !row.participants.some((p) => p.employeeId === employeeId)) {
      throw new NotFoundException('Interview not found');
    }
    return row;
  }

  private async interviewers(companyId: string, ids: string[]) {
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
      select: { id: true, userId: true },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException('Interviewers must be active employees');
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

  private async get(companyId: string, id: string) {
    const row = await this.prisma.interview.findFirst({
      where: { id, companyId },
      include: interviewInclude,
    });
    if (!row) throw new NotFoundException('Interview not found');
    return row;
  }

  private async getMine(companyId: string, id: string): Promise<MineRow> {
    const row = await this.prisma.interview.findFirst({
      where: { id, companyId },
      include: mineInclude,
    });
    if (!row) throw new NotFoundException('Interview not found');
    return row;
  }

  private async notify(
    user: AuthUser,
    interview: { id: string; applicationId: string; scheduledAt: Date },
    userIds: (string | null)[],
    kind: 'scheduled' | 'cancelled',
  ) {
    const targets = userIds.filter((id): id is string => !!id && id !== user.id);
    if (!targets.length) return;
    const app = await this.prisma.jobApplication.findUniqueOrThrow({
      where: { id: interview.applicationId },
      select: {
        candidate: { select: { firstName: true, lastName: true } },
        posting: { select: { title: true } },
      },
    });
    const name = fullName(app.candidate);
    const when = interview.scheduledAt.toLocaleString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    await this.notifications.notify({
      companyId: user.companyId,
      userIds: targets,
      type: kind === 'scheduled' ? 'recruitment.interview' : 'recruitment.interviewCancelled',
      title: kind === 'scheduled' ? `Mülakat: ${name}` : `Mülakat iptal edildi: ${name}`,
      body:
        kind === 'scheduled'
          ? `${app.posting.title} pozisyonu için ${when} tarihindeki mülakata davetlisiniz.`
          : `${app.posting.title} pozisyonu için ${when} tarihindeki mülakat iptal edildi.`,
      link: '/recruitment/interviews',
    });
  }
}

function toMineDto(row: MineRow, employeeId: string | null): MyInterviewDto {
  const mine = row.participants.find((p) => p.employeeId === employeeId);
  return {
    id: row.id,
    applicationId: row.applicationId,
    candidateId: row.application.candidateId,
    candidateName: fullName(row.application.candidate),
    candidateTitle: row.application.candidate.currentTitle,
    postingNumber: row.application.posting.number,
    postingTitle: row.application.posting.title,
    type: row.type,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMinutes: row.durationMinutes,
    location: row.location,
    notes: row.notes,
    hasCv: !!row.application.candidate.cvFileId,
    otherInterviewers: row.participants
      .filter((p) => p.employeeId !== employeeId)
      .map((p) => fullName(p.employee)),
    myRating: mine?.rating ?? null,
    myRecommendation: mine?.recommendation ?? null,
    myFeedback: mine?.feedback ?? null,
    mySubmittedAt: mine?.submittedAt?.toISOString() ?? null,
    canGiveFeedback: !!mine && row.status !== InterviewStatus.CANCELLED,
  };
}
