import { Injectable } from '@nestjs/common';
import type { TicketPriority } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { SupportSummaryDto, TicketTrendPointDto } from './dto/support.dto';
import { slaStates } from './support-helpers';
import { ACTIVE_STATUSES, PRIORITY_ORDER, averageHours, complianceRate } from './support-math';
import { TicketCategoriesService } from './ticket-categories.service';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const TREND_DAYS = 14;

/** Istanbul calendar day of an instant. */
const dayOf = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

@Injectable()
export class SupportSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: TicketCategoriesService,
  ) {}

  async summary(user: AuthUser): Promise<SupportSummaryDto> {
    const companyId = user.companyId;
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const quarterAgo = new Date(now.getTime() - 90 * DAY_MS);
    const trendStart = new Date(now.getTime() - TREND_DAYS * DAY_MS);

    const [active, recent, resolved, responded, rated, categories, agents] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { companyId, status: { in: ACTIVE_STATUSES } },
        select: {
          status: true,
          priority: true,
          categoryId: true,
          assigneeId: true,
          createdAt: true,
          firstResponseDueAt: true,
          firstRespondedAt: true,
          resolutionDueAt: true,
          resolvedAt: true,
          closedAt: true,
          pausedAt: true,
        },
      }),
      this.prisma.ticket.findMany({
        where: { companyId, createdAt: { gte: monthAgo } },
        select: { categoryId: true, createdAt: true },
      }),
      this.prisma.ticket.findMany({
        where: { companyId, resolvedAt: { gte: monthAgo } },
        select: {
          assigneeId: true,
          createdAt: true,
          resolvedAt: true,
          resolutionDueAt: true,
          pausedMinutes: true,
        },
      }),
      this.prisma.ticket.findMany({
        where: { companyId, firstRespondedAt: { gte: monthAgo } },
        select: { createdAt: true, firstRespondedAt: true },
      }),
      this.prisma.ticket.aggregate({
        where: { companyId, closedAt: { gte: quarterAgo }, satisfactionRating: { not: null } },
        _avg: { satisfactionRating: true },
        _count: { satisfactionRating: true },
      }),
      this.prisma.ticketCategory.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.categories.agents(companyId),
    ]);

    const states = active.map((row) => ({ row, ...slaStates(row, now) }));
    const overdue = (s: (typeof states)[number]) =>
      s.responseSla === 'BREACHED' || s.resolutionSla === 'BREACHED';
    const atRisk = (s: (typeof states)[number]) =>
      !overdue(s) && (s.responseSla === 'AT_RISK' || s.resolutionSla === 'AT_RISK');

    const met = resolved.filter((r) => r.resolvedAt && r.resolvedAt <= r.resolutionDueAt).length;

    const byCategory = [...categories, { id: null, name: null }]
      .map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        active: active.filter((t) => t.categoryId === c.id).length,
        recent: recent.filter((t) => t.categoryId === c.id).length,
      }))
      .filter((c) => c.active || c.recent);

    const trend = new Map<string, TicketTrendPointDto>();
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const date = dayOf(new Date(now.getTime() - i * DAY_MS));
      trend.set(date, { date, created: 0, resolved: 0 });
    }
    for (const t of recent) {
      if (t.createdAt >= trendStart) {
        const point = trend.get(dayOf(t.createdAt));
        if (point) point.created++;
      }
    }
    for (const t of resolved) {
      if (t.resolvedAt && t.resolvedAt >= trendStart) {
        const point = trend.get(dayOf(t.resolvedAt));
        if (point) point.resolved++;
      }
    }

    return {
      activeCount: active.length,
      unassignedCount: active.filter((t) => !t.assigneeId).length,
      myActiveCount: active.filter((t) => t.assigneeId === user.id).length,
      overdueCount: states.filter(overdue).length,
      atRiskCount: states.filter(atRisk).length,
      waitingCount: active.filter((t) => t.status === 'WAITING').length,
      createdCount: recent.length,
      resolvedCount: resolved.length,
      averageFirstResponseHours: averageHours(
        responded.map((t) => ({ from: t.createdAt, to: t.firstRespondedAt ?? t.createdAt })),
      ),
      averageResolutionHours: averageHours(
        resolved.map((t) => ({
          from: new Date(t.createdAt.getTime() + t.pausedMinutes * MINUTE_MS),
          to: t.resolvedAt ?? t.createdAt,
        })),
      ),
      slaComplianceRate: complianceRate(met, resolved.length - met),
      satisfactionAverage: rated._avg.satisfactionRating?.toFixed(1) ?? null,
      satisfactionCount: rated._count.satisfactionRating,
      byPriority: PRIORITY_ORDER.map((priority: TicketPriority) => ({
        priority,
        active: states.filter((s) => s.row.priority === priority).length,
        overdue: states.filter((s) => s.row.priority === priority && overdue(s)).length,
      })),
      byCategory,
      byAgent: agents.map((agent) => ({
        userId: agent.id,
        name: agent.name,
        active: agent.activeCount,
        overdue: states.filter((s) => s.row.assigneeId === agent.id && overdue(s)).length,
        resolved: resolved.filter((t) => t.assigneeId === agent.id).length,
      })),
      trend: [...trend.values()],
    };
  }
}
