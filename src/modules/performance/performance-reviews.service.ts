import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerformanceReviewStatus, Prisma, ReviewCycleStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateReviewGoalDto,
  ManagerReviewDto,
  PerformanceReviewDetailDto,
  PerformanceReviewDto,
  ReviewViewer,
  SelfReviewDto,
  UpdateReviewGoalDto,
} from './dto/performance.dto';
import {
  competencyScore,
  goalScore,
  missingRatings,
  overallScore,
  totalWeight,
} from './performance-math';
import { fullName, reviewListInclude, score, toReviewDto, trimOrNull } from './performance-support';

const MAX_GOALS = 10;

const detailInclude = {
  ...reviewListInclude,
  goals: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  ratings: {
    include: {
      competency: { select: { name: true, description: true, sortOrder: true } },
    },
    orderBy: [{ competency: { sortOrder: 'asc' } }, { competency: { name: 'asc' } }],
  },
} satisfies Prisma.PerformanceReviewInclude;

type DetailRow = Prisma.PerformanceReviewGetPayload<{ include: typeof detailInclude }>;

interface Access {
  row: DetailRow;
  viewer: ReviewViewer;
  /** `performance:update` acting on someone else's review. */
  hrEditor: boolean;
}

/**
 * Performans değerlendirmeleri. The employee fills in the self review, the reviewer (their
 * manager at launch, or HR with `performance:update`) completes it; each side sees the other's
 * ratings only once they are handed over.
 */
@Injectable()
export class PerformanceReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async mine(user: AuthUser): Promise<PerformanceReviewDto[]> {
    const employeeId = await this.ownEmployeeId(user);
    if (!employeeId) return [];
    const rows = await this.prisma.performanceReview.findMany({
      where: { employeeId, cycle: { status: { not: ReviewCycleStatus.DRAFT } } },
      include: reviewListInclude,
      orderBy: { cycle: { periodEnd: 'desc' } },
    });
    return rows.map((row) => hideScore(toReviewDto(row), row.status));
  }

  /** Reviews the caller gives as the manager. */
  async team(user: AuthUser): Promise<PerformanceReviewDto[]> {
    const employeeId = await this.ownEmployeeId(user);
    if (!employeeId) return [];
    const rows = await this.prisma.performanceReview.findMany({
      where: { reviewerId: employeeId },
      include: reviewListInclude,
      orderBy: [{ cycle: { periodEnd: 'desc' } }, { employee: { firstName: 'asc' } }],
    });
    return rows.map(toReviewDto);
  }

  async findOne(user: AuthUser, id: string): Promise<PerformanceReviewDetailDto> {
    return this.toDetail(user, await this.access(user, id));
  }

  async addGoal(
    user: AuthUser,
    id: string,
    dto: CreateReviewGoalDto,
  ): Promise<PerformanceReviewDetailDto> {
    const access = await this.access(user, id);
    this.assertCanEditGoals(user, access);
    if (access.row.goals.length >= MAX_GOALS) {
      throw new ConflictException(`A review can have at most ${MAX_GOALS} goals`);
    }
    await this.prisma.performanceGoal.create({
      data: {
        reviewId: id,
        title: dto.title.trim(),
        description: trimOrNull(dto.description),
        weight: dto.weight,
        progress: dto.progress ?? 0,
        sortOrder: (access.row.goals.at(-1)?.sortOrder ?? 0) + 1,
      },
    });
    return this.findOne(user, id);
  }

  async updateGoal(
    user: AuthUser,
    goalId: string,
    dto: UpdateReviewGoalDto,
  ): Promise<PerformanceReviewDetailDto> {
    const goal = await this.goal(user, goalId);
    const access = await this.access(user, goal.reviewId);
    this.assertCanEditGoals(user, access);
    await this.prisma.performanceGoal.update({
      where: { id: goalId },
      data: {
        title: dto.title?.trim(),
        description: trimOrNull(dto.description),
        weight: dto.weight,
        progress: dto.progress,
      },
    });
    return this.findOne(user, goal.reviewId);
  }

  async removeGoal(user: AuthUser, goalId: string): Promise<PerformanceReviewDetailDto> {
    const goal = await this.goal(user, goalId);
    const access = await this.access(user, goal.reviewId);
    this.assertCanEditGoals(user, access);
    await this.prisma.performanceGoal.delete({ where: { id: goalId } });
    return this.findOne(user, goal.reviewId);
  }

  async saveSelf(
    user: AuthUser,
    id: string,
    dto: SelfReviewDto,
  ): Promise<PerformanceReviewDetailDto> {
    const access = await this.access(user, id);
    const { row } = access;
    if (!this.flags(user, access).canSelfReview) {
      throw new ForbiddenException('Only the employee fills in the self review while it is open');
    }
    const goals = byId(row.goals, dto.goals, 'goal');
    const ratings = byId(row.ratings, dto.competencies, 'competency');
    const nextGoals = row.goals.map((g) => ({
      weight: g.weight,
      rating: goals.has(g.id) ? (goals.get(g.id)!.rating ?? null) : g.selfRating,
    }));
    const nextRatings = row.ratings.map((r) => ({
      rating: ratings.has(r.id) ? (ratings.get(r.id)!.rating ?? null) : r.selfRating,
    }));
    if (dto.submit) {
      assertComplete(row.cycle.goalWeight, nextGoals, nextRatings);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [goalId, input] of goals) {
        await tx.performanceGoal.update({
          where: { id: goalId },
          data: {
            selfRating: input.rating === undefined ? undefined : input.rating,
            progress: input.progress,
          },
        });
      }
      for (const [ratingId, input] of ratings) {
        if (input.rating === undefined) continue;
        await tx.competencyRating.update({
          where: { id: ratingId },
          data: { selfRating: input.rating },
        });
      }
      await tx.performanceReview.update({
        where: { id },
        data: {
          selfComment: trimOrNull(dto.selfComment),
          ...(dto.submit
            ? { status: PerformanceReviewStatus.MANAGER_REVIEW, selfSubmittedAt: new Date() }
            : {}),
        },
      });
    });
    if (dto.submit && row.reviewer?.userId && row.reviewer.userId !== user.id) {
      await this.notifications.notify({
        companyId: user.companyId,
        userIds: [row.reviewer.userId],
        type: 'performance.selfSubmitted',
        title: `Öz değerlendirme tamamlandı: ${fullName(row.employee)}`,
        body: `${row.cycle.name} dönemi için yönetici değerlendirmenizi bekliyor.`,
        link: `/performance/reviews/${id}`,
      });
    }
    return this.findOne(user, id);
  }

  async saveManager(
    user: AuthUser,
    id: string,
    dto: ManagerReviewDto,
  ): Promise<PerformanceReviewDetailDto> {
    const access = await this.access(user, id);
    const { row } = access;
    if (!this.flags(user, access).canManagerReview) {
      throw new ForbiddenException('Only the reviewer completes the review once it is handed over');
    }
    const goals = byId(row.goals, dto.goals, 'goal');
    const ratings = byId(row.ratings, dto.competencies, 'competency');
    const nextGoals = row.goals.map((g) => ({
      weight: g.weight,
      rating: goals.has(g.id) ? (goals.get(g.id)!.rating ?? null) : g.managerRating,
    }));
    const nextRatings = row.ratings.map((r) => ({
      rating: ratings.has(r.id) ? (ratings.get(r.id)!.rating ?? null) : r.managerRating,
    }));
    let scores: { goal: number | null; competency: number | null; overall: number | null } | null =
      null;
    if (dto.submit) {
      const weight = row.cycle.goalWeight;
      assertComplete(weight, nextGoals, nextRatings);
      const goal = weight > 0 ? goalScore(nextGoals) : null;
      const competency = weight < 100 ? competencyScore(nextRatings.map((r) => r.rating)) : null;
      scores = { goal, competency, overall: overallScore(goal, competency, weight) };
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [goalId, input] of goals) {
        if (input.rating === undefined) continue;
        await tx.performanceGoal.update({
          where: { id: goalId },
          data: { managerRating: input.rating },
        });
      }
      for (const [ratingId, input] of ratings) {
        await tx.competencyRating.update({
          where: { id: ratingId },
          data: {
            managerRating: input.rating === undefined ? undefined : input.rating,
            comment: trimOrNull(input.comment),
          },
        });
      }
      await tx.performanceReview.update({
        where: { id },
        data: {
          managerComment: trimOrNull(dto.managerComment),
          strengths: trimOrNull(dto.strengths),
          improvements: trimOrNull(dto.improvements),
          ...(scores
            ? {
                status: PerformanceReviewStatus.COMPLETED,
                managerSubmittedAt: new Date(),
                goalScore: scores.goal,
                competencyScore: scores.competency,
                overallScore: scores.overall,
              }
            : {}),
        },
      });
    });
    if (scores && row.employee.userId && row.employee.userId !== user.id) {
      await this.notifications.notify({
        companyId: user.companyId,
        userIds: [row.employee.userId],
        type: 'performance.completed',
        title: `Performans değerlendirmeniz tamamlandı`,
        body: `${row.cycle.name} dönemi sonucunuzu görüntüleyip onaylayabilirsiniz.`,
        link: `/performance/reviews/${id}`,
      });
    }
    return this.findOne(user, id);
  }

  /** The reviewer sends the self review back for changes. */
  async returnToEmployee(user: AuthUser, id: string): Promise<PerformanceReviewDetailDto> {
    const access = await this.access(user, id);
    if (!this.flags(user, access).canReturn) {
      throw new ConflictException('Only a submitted self review can be sent back');
    }
    await this.prisma.performanceReview.update({
      where: { id },
      data: { status: PerformanceReviewStatus.SELF_REVIEW, selfSubmittedAt: null },
    });
    const { row } = access;
    if (row.employee.userId && row.employee.userId !== user.id) {
      await this.notifications.notify({
        companyId: user.companyId,
        userIds: [row.employee.userId],
        type: 'performance.returned',
        title: 'Öz değerlendirmeniz geri gönderildi',
        body: `${row.cycle.name} dönemi için hedeflerinizi ve öz değerlendirmenizi güncelleyin.`,
        link: `/performance/reviews/${id}`,
      });
    }
    return this.findOne(user, id);
  }

  async acknowledge(user: AuthUser, id: string): Promise<PerformanceReviewDetailDto> {
    const access = await this.access(user, id);
    if (!this.flags(user, access).canAcknowledge) {
      throw new ConflictException('Only the employee acknowledges a completed review');
    }
    await this.prisma.performanceReview.update({
      where: { id },
      data: { acknowledgedAt: new Date() },
    });
    return this.findOne(user, id);
  }

  /** HR reopens a completed review for the reviewer; the scores are cleared. */
  async reopen(user: AuthUser, id: string): Promise<PerformanceReviewDetailDto> {
    const access = await this.access(user, id);
    if (!this.flags(user, access).canReopen) {
      throw new ConflictException('Only completed reviews of an active cycle can be reopened');
    }
    await this.prisma.performanceReview.update({
      where: { id },
      data: {
        status: PerformanceReviewStatus.MANAGER_REVIEW,
        managerSubmittedAt: null,
        acknowledgedAt: null,
        goalScore: null,
        competencyScore: null,
        overallScore: null,
      },
    });
    return this.findOne(user, id);
  }

  /** The employee, their reviewer and `performance:read` see a review; others get 404. */
  private async access(user: AuthUser, id: string): Promise<Access> {
    const row = await this.prisma.performanceReview.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row || row.cycle.status === ReviewCycleStatus.DRAFT) {
      throw new NotFoundException('Performance review not found');
    }
    let viewer: ReviewViewer | null = null;
    if (row.employee.userId === user.id) viewer = 'EMPLOYEE';
    else if (row.reviewer?.userId === user.id) viewer = 'REVIEWER';
    else if (hasPermission(user, 'performance:read')) viewer = 'HR';
    if (!viewer) throw new NotFoundException('Performance review not found');
    return {
      row,
      viewer,
      hrEditor: viewer !== 'EMPLOYEE' && hasPermission(user, 'performance:update'),
    };
  }

  private flags(user: AuthUser, { row, viewer, hrEditor }: Access) {
    const open = row.cycle.status === ReviewCycleStatus.ACTIVE;
    const reviewer = viewer === 'REVIEWER' || hrEditor;
    return {
      canEditGoals:
        open &&
        row.status !== PerformanceReviewStatus.COMPLETED &&
        ((viewer === 'EMPLOYEE' && row.status === PerformanceReviewStatus.SELF_REVIEW) || reviewer),
      canSelfReview:
        open && viewer === 'EMPLOYEE' && row.status === PerformanceReviewStatus.SELF_REVIEW,
      canManagerReview: open && reviewer && row.status === PerformanceReviewStatus.MANAGER_REVIEW,
      canReturn: open && reviewer && row.status === PerformanceReviewStatus.MANAGER_REVIEW,
      canAcknowledge:
        viewer === 'EMPLOYEE' &&
        row.status === PerformanceReviewStatus.COMPLETED &&
        !row.acknowledgedAt,
      canReopen: open && hrEditor && row.status === PerformanceReviewStatus.COMPLETED,
    };
  }

  private assertCanEditGoals(user: AuthUser, access: Access) {
    if (!this.flags(user, access).canEditGoals) {
      throw new ForbiddenException('Goals of this review cannot be changed now');
    }
  }

  private toDetail(user: AuthUser, access: Access): PerformanceReviewDetailDto {
    const { row, viewer } = access;
    const completed = row.status === PerformanceReviewStatus.COMPLETED;
    // The employee sees the manager's side once completed; others see the self side once handed over.
    const showManager = viewer !== 'EMPLOYEE' || completed;
    const showSelf = viewer === 'EMPLOYEE' || !!row.selfSubmittedAt || completed;
    return {
      ...toReviewDto(row),
      overallScore: showManager ? score(row.overallScore) : null,
      goalWeight: row.cycle.goalWeight,
      selfComment: showSelf ? row.selfComment : null,
      managerComment: showManager ? row.managerComment : null,
      strengths: showManager ? row.strengths : null,
      improvements: showManager ? row.improvements : null,
      goalScore: showManager ? score(row.goalScore) : null,
      competencyScore: showManager ? score(row.competencyScore) : null,
      goals: row.goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        weight: g.weight,
        progress: g.progress,
        selfRating: showSelf ? g.selfRating : null,
        managerRating: showManager ? g.managerRating : null,
      })),
      competencies: row.ratings.map((r) => ({
        id: r.id,
        competencyId: r.competencyId,
        name: r.competency.name,
        description: r.competency.description,
        selfRating: showSelf ? r.selfRating : null,
        managerRating: showManager ? r.managerRating : null,
        comment: showManager ? r.comment : null,
      })),
      viewer,
      ...this.flags(user, access),
    };
  }

  private async goal(user: AuthUser, goalId: string) {
    const goal = await this.prisma.performanceGoal.findFirst({
      where: { id: goalId, review: { companyId: user.companyId } },
      select: { reviewId: true },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    return goal;
  }

  private async ownEmployeeId(user: AuthUser): Promise<string | null> {
    const row = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }
}

function hideScore(dto: PerformanceReviewDto, status: PerformanceReviewStatus) {
  return status === PerformanceReviewStatus.COMPLETED ? dto : { ...dto, overallScore: null };
}

/** Maps inputs to rows of the review; unknown ids are rejected. */
function byId<T extends { id: string }>(rows: { id: string }[], inputs: T[], what: string) {
  const ids = new Set(rows.map((r) => r.id));
  const map = new Map<string, T>();
  for (const input of inputs) {
    if (!ids.has(input.id)) throw new BadRequestException(`Unknown ${what} ${input.id}`);
    map.set(input.id, input);
  }
  return map;
}

function assertComplete(
  goalWeight: number,
  goals: { weight: number; rating: number | null }[],
  competencies: { rating: number | null }[],
) {
  if (goalWeight > 0) {
    if (!goals.length) throw new BadRequestException('Add at least one goal');
    if (totalWeight(goals) !== 100) {
      throw new BadRequestException('Goal weights must add up to 100');
    }
  }
  const missing = missingRatings(goalWeight > 0 ? goals : [], goalWeight < 100 ? competencies : []);
  if (missing.goals || missing.competencies) {
    throw new BadRequestException('Rate every goal and competency before submitting');
  }
}
