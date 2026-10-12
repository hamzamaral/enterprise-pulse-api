import { Injectable } from '@nestjs/common';
import { LeadStatus, OpportunityStage, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { toBase } from '../../common/money/document-totals';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TreasuryService } from '../finance/treasury.service';
import { ACTIVE_LEAD_STATUSES, OPEN_STAGES, weightedAmount, winRate } from './crm-math';
import { CrmSupportService } from './crm-support.service';
import type { CrmSummaryDto } from './dto/crm.dto';

const WIN_RATE_DAYS = 90;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Pipeline KPIs for the CRM pages and the dashboard, in the company currency. */
@Injectable()
export class CrmSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasury: TreasuryService,
    private readonly support: CrmSupportService,
  ) {}

  async summary(user: AuthUser): Promise<CrmSummaryDto> {
    const { companyId } = user;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const winRateSince = new Date(now.getTime() - WIN_RATE_DAYS * 86_400_000);
    const myOpen = { companyId, ownerId: user.id, completedAt: null };

    const [open, wonThisMonth, lostThisMonth, closedRecently, leads, activities] =
      await Promise.all([
        this.prisma.opportunity.findMany({
          where: { companyId, stage: { in: OPEN_STAGES } },
          select: { stage: true, amount: true, probability: true, currencyCode: true },
        }),
        this.prisma.opportunity.findMany({
          where: { companyId, stage: OpportunityStage.WON, closedAt: { gte: monthStart } },
          select: { amount: true, currencyCode: true },
        }),
        this.prisma.opportunity.count({
          where: { companyId, stage: OpportunityStage.LOST, closedAt: { gte: monthStart } },
        }),
        this.prisma.opportunity.groupBy({
          by: ['stage'],
          where: {
            companyId,
            stage: { in: [OpportunityStage.WON, OpportunityStage.LOST] },
            closedAt: { gte: winRateSince },
          },
          _count: { _all: true },
        }),
        this.prisma.lead.groupBy({
          by: ['status'],
          where: { companyId, status: { in: ACTIVE_LEAD_STATUSES } },
          _count: { _all: true },
        }),
        Promise.all([
          this.prisma.crmActivity.count({ where: myOpen }),
          this.prisma.crmActivity.count({ where: { ...myOpen, dueAt: { lt: now } } }),
          this.prisma.crmActivity.count({
            where: { ...myOpen, dueAt: { gte: dayStart, lt: dayEnd } },
          }),
        ]),
      ]);

    const currencies = [...open, ...wonThisMonth].map((o) => o.currencyCode);
    const rates = await this.treasury.latestRates(companyId, currencies);
    const unconverted = new Set<string>();
    const inBase = (amount: Prisma.Decimal, currencyCode: string) => {
      const rate = rates.get(currencyCode);
      if (!rate) {
        unconverted.add(currencyCode);
        return dec(0);
      }
      return toBase(amount, rate);
    };

    const stages = OPEN_STAGES.map((stage) => {
      const rows = open.filter((o) => o.stage === stage);
      const amount = rows.reduce((sum, o) => sum.plus(inBase(o.amount, o.currencyCode)), dec(0));
      const weighted = rows.reduce(
        (sum, o) => sum.plus(weightedAmount(inBase(o.amount, o.currencyCode), o.probability)),
        dec(0),
      );
      return { stage, count: rows.length, amount, weighted };
    });
    const countOf = (stage: OpportunityStage) =>
      closedRecently.find((g) => g.stage === stage)?._count._all ?? 0;
    const leadCount = (status?: LeadStatus) =>
      leads
        .filter((g) => !status || g.status === status)
        .reduce((sum, g) => sum + g._count._all, 0);

    return {
      currencyCode: await this.support.baseCurrency(this.prisma, companyId),
      openCount: open.length,
      pipelineAmount: stages.reduce((sum, s) => sum.plus(s.amount), dec(0)).toFixed(2),
      weightedAmount: stages.reduce((sum, s) => sum.plus(s.weighted), dec(0)).toFixed(2),
      stages: stages.map((s) => ({
        stage: s.stage,
        count: s.count,
        amount: s.amount.toFixed(2),
        weighted: s.weighted.toFixed(2),
      })),
      wonThisMonth: wonThisMonth.length,
      wonAmountThisMonth: wonThisMonth
        .reduce((sum, o) => sum.plus(inBase(o.amount, o.currencyCode)), dec(0))
        .toFixed(2),
      lostThisMonth,
      winRate: winRate(countOf(OpportunityStage.WON), countOf(OpportunityStage.LOST)),
      newLeads: leadCount(LeadStatus.NEW),
      activeLeads: leadCount(),
      myOpenActivities: activities[0],
      myOverdueActivities: activities[1],
      myActivitiesDueToday: activities[2],
      unconvertedCurrencies: [...unconverted].sort(),
    };
  }
}
