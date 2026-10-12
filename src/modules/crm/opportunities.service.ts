import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OpportunityStage, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { toBase } from '../../common/money/document-totals';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { TreasuryService } from '../finance/treasury.service';
import { NumberingService } from '../numbering/numbering.service';
import { CUSTOMER_TYPES, PartnersService } from '../partners/partners.service';
import {
  CLOSED_STAGES,
  defaultProbability,
  isOpenStage,
  OPEN_STAGES,
  stageAfterQuote,
  weightedAmount,
} from './crm-math';
import { CrmSupportService } from './crm-support.service';
import type {
  BoardDto,
  BoardQueryDto,
  CreateOpportunityDto,
  OpportunityDetailDto,
  OpportunityDto,
  OpportunityQueryDto,
  UpdateOpportunityDto,
} from './dto/crm.dto';

const SORTABLE = [
  'number',
  'title',
  'amount',
  'probability',
  'expectedCloseDate',
  'stage',
  'createdAt',
] as const;
const BOARD_LIMIT = 50;
const CLOSED_BOARD_DAYS = 90;

const listInclude = {
  partner: { select: { code: true, title: true } },
  owner: { select: { firstName: true, lastName: true } },
  _count: { select: { quotes: true } },
} satisfies Prisma.OpportunityInclude;

const detailInclude = {
  ...listInclude,
  lead: { select: { number: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  quotes: {
    select: {
      id: true,
      number: true,
      quoteDate: true,
      status: true,
      grandTotal: true,
      currencyCode: true,
      order: { select: { id: true, number: true } },
    },
    orderBy: { quoteDate: 'desc' },
  },
} satisfies Prisma.OpportunityInclude;

type ListRow = Prisma.OpportunityGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.OpportunityGetPayload<{ include: typeof detailInclude }>;

const today = () => parseDateOnly(new Date().toISOString().slice(0, 10));
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Opportunities (FRS): potential deals with a customer, moved through the sales pipeline. */
@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly treasury: TreasuryService,
    private readonly support: CrmSupportService,
  ) {}

  async findAll(user: AuthUser, query: OpportunityQueryDto) {
    const where = this.where(user, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  /** Kanban columns: every open stage, plus WON / LOST closed in the last 90 days. */
  async board(user: AuthUser, query: BoardQueryDto): Promise<BoardDto> {
    const { companyId } = user;
    const closedSince = new Date(Date.now() - CLOSED_BOARD_DAYS * 86_400_000);
    const base = this.where(user, query);
    const stages = [...OPEN_STAGES, ...CLOSED_STAGES];
    const scoped = (stage: OpportunityStage): Prisma.OpportunityWhereInput => ({
      ...base,
      stage,
      ...(isOpenStage(stage) ? {} : { closedAt: { gte: closedSince } }),
    });
    const [groups, columns] = await Promise.all([
      Promise.all(
        stages.map((stage) =>
          this.prisma.opportunity.groupBy({
            by: ['currencyCode'],
            where: scoped(stage),
            _sum: { amount: true },
            _count: { _all: true },
          }),
        ),
      ),
      Promise.all(
        stages.map((stage) =>
          this.prisma.opportunity.findMany({
            where: scoped(stage),
            include: listInclude,
            orderBy: isOpenStage(stage)
              ? [{ expectedCloseDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]
              : [{ closedAt: 'desc' }],
            take: BOARD_LIMIT,
          }),
        ),
      ),
    ]);
    const currencies = groups.flat().map((g) => g.currencyCode);
    const rates = await this.treasury.latestRates(companyId, currencies);
    const currencyCode = await this.support.baseCurrency(this.prisma, companyId);
    return {
      currencyCode,
      columns: stages.map((stage, i) => ({
        stage,
        count: groups[i].reduce((sum, g) => sum + g._count._all, 0),
        amount: groups[i]
          .reduce((sum, g) => {
            const rate = rates.get(g.currencyCode);
            return rate ? sum.plus(toBase(g._sum.amount ?? 0, rate)) : sum;
          }, dec(0))
          .toFixed(2),
        items: columns[i].map(toDto),
      })),
    };
  }

  async findOne(companyId: string, id: string): Promise<OpportunityDetailDto> {
    const row = await this.prisma.opportunity.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Opportunity not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateOpportunityDto): Promise<OpportunityDetailDto> {
    const { companyId } = user;
    const ownerId = dto.ownerId ?? user.id;
    const stage = dto.stage ?? OpportunityStage.PROSPECTING;
    const row = await this.prisma.$transaction(async (tx) => {
      const partner = await this.partners.getForDocument(
        tx,
        companyId,
        dto.partnerId,
        CUSTOMER_TYPES,
      );
      await this.support.assertMember(tx, companyId, ownerId);
      const currencyCode = dto.currencyCode ?? partner.currencyCode;
      await this.support.assertCurrency(tx, currencyCode);
      return tx.opportunity.create({
        data: {
          companyId,
          number: await this.numbering.next(companyId, 'OPPORTUNITY', tx),
          title: dto.title.trim(),
          partnerId: partner.id,
          stage,
          probability: dto.probability ?? defaultProbability(stage),
          amount: dto.amount,
          currencyCode,
          expectedCloseDate: dto.expectedCloseDate ? parseDateOnly(dto.expectedCloseDate) : null,
          ownerId,
          description: dto.description?.trim() || null,
          createdById: user.id,
        },
      });
    });
    await this.notifyOwner(user, row);
    return this.findOne(companyId, row.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateOpportunityDto,
  ): Promise<OpportunityDetailDto> {
    const { companyId } = user;
    const existing = await this.getOpen(companyId, id);
    if (dto.ownerId) await this.support.assertMember(this.prisma, companyId, dto.ownerId);
    if (dto.currencyCode) await this.support.assertCurrency(this.prisma, dto.currencyCode);
    const row = await this.prisma.opportunity.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        amount: dto.amount,
        currencyCode: dto.currencyCode,
        probability: dto.probability,
        expectedCloseDate:
          dto.expectedCloseDate === undefined
            ? undefined
            : dto.expectedCloseDate
              ? parseDateOnly(dto.expectedCloseDate)
              : null,
        ownerId: dto.ownerId,
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
      },
    });
    if (dto.ownerId && dto.ownerId !== existing.ownerId) await this.notifyOwner(user, row);
    return this.findOne(companyId, id);
  }

  /** Moves an open opportunity to another open stage; the probability resets to the stage default. */
  async changeStage(
    user: AuthUser,
    id: string,
    stage: OpportunityStage,
  ): Promise<OpportunityDetailDto> {
    const existing = await this.getOpen(user.companyId, id);
    if (existing.stage !== stage) {
      await this.prisma.opportunity.update({
        where: { id },
        data: { stage, probability: defaultProbability(stage) },
      });
    }
    return this.findOne(user.companyId, id);
  }

  async win(user: AuthUser, id: string): Promise<OpportunityDetailDto> {
    return this.close(user, id, OpportunityStage.WON, null);
  }

  async lose(user: AuthUser, id: string, reason: string): Promise<OpportunityDetailDto> {
    return this.close(user, id, OpportunityStage.LOST, reason.trim());
  }

  /** A closed opportunity is back on the table, in NEGOTIATION. */
  async reopen(user: AuthUser, id: string): Promise<OpportunityDetailDto> {
    const stage = OpportunityStage.NEGOTIATION;
    const { count } = await this.prisma.opportunity.updateMany({
      where: { id, companyId: user.companyId, stage: { in: CLOSED_STAGES } },
      data: { stage, probability: defaultProbability(stage), closedAt: null, lostReason: null },
    });
    if (!count) {
      await this.get(user.companyId, id);
      throw new ConflictException('Only won or lost opportunities can be reopened');
    }
    return this.findOne(user.companyId, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.get(companyId, id);
    const quotes = await this.prisma.salesQuote.count({ where: { opportunityId: id } });
    if (quotes) throw new ConflictException('Opportunities with quotes cannot be deleted');
    await this.prisma.opportunity.delete({ where: { id } });
  }

  /**
   * Called when a sales quote is created for the opportunity: it must be open and belong to the
   * quote's customer; early stages move on to PROPOSAL.
   */
  async attachQuote(tx: PrismaTx, companyId: string, id: string, partnerId: string) {
    const row = await tx.opportunity.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Opportunity not found');
    if (!isOpenStage(row.stage)) throw new ConflictException('Opportunity is already closed');
    if (row.partnerId !== partnerId) {
      throw new ConflictException('Quote customer differs from the opportunity customer');
    }
    const stage = stageAfterQuote(row.stage);
    if (stage !== row.stage) {
      await tx.opportunity.update({
        where: { id },
        data: { stage, probability: defaultProbability(stage) },
      });
    }
  }

  /** Called when a quote of the opportunity turns into an order. */
  async markWonByQuote(tx: PrismaTx, id: string) {
    await tx.opportunity.updateMany({
      where: { id, stage: { in: OPEN_STAGES } },
      data: { stage: OpportunityStage.WON, probability: 100, closedAt: new Date() },
    });
  }

  private where(
    user: AuthUser,
    query: OpportunityQueryDto | BoardQueryDto,
  ): Prisma.OpportunityWhereInput {
    const search = query.search?.trim();
    const filters: Partial<OpportunityQueryDto> = query;
    return {
      companyId: user.companyId,
      ownerId: query.mine === 'true' ? user.id : query.ownerId,
      partnerId: filters.partnerId,
      stage:
        filters.stage ??
        (filters.open === 'true'
          ? { in: OPEN_STAGES }
          : filters.open === 'false'
            ? { in: CLOSED_STAGES }
            : undefined),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { partner: { title: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
  }

  private async close(
    user: AuthUser,
    id: string,
    stage: OpportunityStage,
    lostReason: string | null,
  ): Promise<OpportunityDetailDto> {
    const { count } = await this.prisma.opportunity.updateMany({
      where: { id, companyId: user.companyId, stage: { in: OPEN_STAGES } },
      data: { stage, probability: defaultProbability(stage), closedAt: new Date(), lostReason },
    });
    if (!count) {
      await this.get(user.companyId, id);
      throw new ConflictException('Opportunity is already closed');
    }
    return this.findOne(user.companyId, id);
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.opportunity.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Opportunity not found');
    return row;
  }

  private async getOpen(companyId: string, id: string) {
    const row = await this.get(companyId, id);
    if (!isOpenStage(row.stage)) {
      throw new ConflictException('Closed opportunities cannot be changed; reopen it first');
    }
    return row;
  }

  private notifyOwner(
    user: AuthUser,
    row: { id: string; number: string; title: string; ownerId: string | null },
  ) {
    return this.support.notifyAssignee(user, {
      ownerId: row.ownerId,
      title: 'Size bir satış fırsatı atandı',
      body: `${row.number} · ${row.title}`,
      link: `/crm/opportunities/${row.id}`,
    });
  }
}

function toDto(row: ListRow): OpportunityDto {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    partnerId: row.partnerId,
    partnerCode: row.partner.code,
    partnerTitle: row.partner.title,
    stage: row.stage,
    amount: row.amount.toFixed(2),
    currencyCode: row.currencyCode,
    probability: row.probability,
    weightedAmount: weightedAmount(row.amount, row.probability).toFixed(2),
    expectedCloseDate: row.expectedCloseDate ? toDateOnly(row.expectedCloseDate) : null,
    overdue: isOpenStage(row.stage) && !!row.expectedCloseDate && row.expectedCloseDate < today(),
    ownerId: row.ownerId,
    ownerName: row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : null,
    closedAt: row.closedAt,
    quoteCount: row._count.quotes,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow): OpportunityDetailDto {
  return {
    ...toDto(row),
    description: row.description,
    lostReason: row.lostReason,
    leadId: row.leadId,
    leadNumber: row.lead?.number ?? null,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    updatedAt: row.updatedAt,
    quotes: row.quotes.map((q) => ({
      id: q.id,
      number: q.number,
      quoteDate: toDateOnly(q.quoteDate),
      status: q.status,
      grandTotal: q.grandTotal.toFixed(2),
      currencyCode: q.currencyCode,
      orderId: q.order?.id ?? null,
      orderNumber: q.order?.number ?? null,
    })),
  };
}
