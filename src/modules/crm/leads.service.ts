import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadStatus, OpportunityStage, PartnerType, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CUSTOMER_TYPES, PartnersService } from '../partners/partners.service';
import { ACTIVE_LEAD_STATUSES, defaultProbability } from './crm-math';
import { CrmSupportService } from './crm-support.service';
import type {
  ConvertLeadDto,
  ConvertLeadResultDto,
  CreateLeadDto,
  LeadDetailDto,
  LeadDto,
  LeadQueryDto,
  UpdateLeadDto,
} from './dto/crm.dto';

const SORTABLE = ['number', 'companyName', 'estimatedValue', 'status', 'createdAt'] as const;

const listInclude = {
  owner: { select: { firstName: true, lastName: true } },
  partner: { select: { title: true } },
} satisfies Prisma.LeadInclude;

const detailInclude = {
  ...listInclude,
  createdBy: { select: { firstName: true, lastName: true } },
  opportunities: {
    select: { id: true, number: true, title: true, stage: true, amount: true, currencyCode: true },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.LeadInclude;

type ListRow = Prisma.LeadGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.LeadGetPayload<{ include: typeof detailInclude }>;

const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/** Leads (ADY): prospects worked until they are disqualified or converted into a customer. */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly partners: PartnersService,
    private readonly support: CrmSupportService,
  ) {}

  async findAll(user: AuthUser, query: LeadQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.LeadWhereInput = {
      companyId: user.companyId,
      source: query.source,
      ownerId: query.mine === 'true' ? user.id : query.ownerId,
      status:
        query.status ??
        (query.active === 'true'
          ? { in: ACTIVE_LEAD_STATUSES }
          : query.active === 'false'
            ? { notIn: ACTIVE_LEAD_STATUSES }
            : undefined),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.lead.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<LeadDetailDto> {
    const row = await this.prisma.lead.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Lead not found');
    return toDetailDto(row);
  }

  async create(user: AuthUser, dto: CreateLeadDto): Promise<LeadDetailDto> {
    const { companyId } = user;
    const ownerId = dto.ownerId ?? user.id;
    const lead = await this.prisma.$transaction(async (tx) => {
      await this.support.assertMember(tx, companyId, ownerId);
      const currencyCode = dto.currencyCode ?? (await this.support.baseCurrency(tx, companyId));
      await this.support.assertCurrency(tx, currencyCode);
      const number = await this.numbering.next(companyId, 'LEAD', tx);
      return tx.lead.create({
        data: {
          companyId,
          number,
          companyName: dto.companyName.trim(),
          contactName: trimOrNull(dto.contactName),
          email: trimOrNull(dto.email),
          phone: trimOrNull(dto.phone),
          city: trimOrNull(dto.city),
          source: dto.source,
          estimatedValue: dto.estimatedValue,
          currencyCode,
          notes: trimOrNull(dto.notes),
          ownerId,
          createdById: user.id,
        },
      });
    });
    await this.notifyOwner(user, lead);
    return this.findOne(companyId, lead.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateLeadDto): Promise<LeadDetailDto> {
    const { companyId } = user;
    const existing = await this.get(companyId, id);
    if (!ACTIVE_LEAD_STATUSES.includes(existing.status)) {
      throw new ConflictException('Converted or disqualified leads cannot be edited');
    }
    if (dto.ownerId) await this.support.assertMember(this.prisma, companyId, dto.ownerId);
    if (dto.currencyCode) await this.support.assertCurrency(this.prisma, dto.currencyCode);
    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        companyName: dto.companyName?.trim(),
        contactName: trimOrNull(dto.contactName),
        email: trimOrNull(dto.email),
        phone: trimOrNull(dto.phone),
        city: trimOrNull(dto.city),
        source: dto.source,
        status: dto.status,
        estimatedValue: dto.estimatedValue,
        currencyCode: dto.currencyCode,
        notes: trimOrNull(dto.notes),
        ownerId: dto.ownerId,
      },
    });
    if (dto.ownerId && dto.ownerId !== existing.ownerId) await this.notifyOwner(user, lead);
    return this.findOne(companyId, id);
  }

  async disqualify(user: AuthUser, id: string, reason: string): Promise<LeadDetailDto> {
    const { count } = await this.prisma.lead.updateMany({
      where: { id, companyId: user.companyId, status: { in: ACTIVE_LEAD_STATUSES } },
      data: { status: LeadStatus.DISQUALIFIED, disqualifyReason: reason.trim() },
    });
    if (!count) {
      await this.get(user.companyId, id);
      throw new ConflictException('Only open leads can be disqualified');
    }
    return this.findOne(user.companyId, id);
  }

  /** Back to work: a disqualified lead returns to CONTACTED. */
  async reopen(user: AuthUser, id: string): Promise<LeadDetailDto> {
    const { count } = await this.prisma.lead.updateMany({
      where: { id, companyId: user.companyId, status: LeadStatus.DISQUALIFIED },
      data: { status: LeadStatus.CONTACTED, disqualifyReason: null },
    });
    if (!count) {
      await this.get(user.companyId, id);
      throw new ConflictException('Only disqualified leads can be reopened');
    }
    return this.findOne(user.companyId, id);
  }

  /**
   * Turns the lead into a customer — a new partner built from the lead, or an existing one —
   * and optionally opens an opportunity for it. Lead activities follow the customer.
   */
  async convert(user: AuthUser, id: string, dto: ConvertLeadDto): Promise<ConvertLeadResultDto> {
    const { companyId } = user;
    if (!dto.partnerId && !hasPermission(user, 'partners:create')) {
      throw new ForbiddenException('Creating a customer requires partners:create');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM leads WHERE id = ${id}::uuid FOR UPDATE`;
      const lead = await tx.lead.findFirst({ where: { id, companyId } });
      if (!lead) throw new NotFoundException('Lead not found');
      if (!ACTIVE_LEAD_STATUSES.includes(lead.status)) {
        throw new ConflictException('Only open leads can be converted');
      }

      const partner = dto.partnerId
        ? await this.partners.getForDocument(tx, companyId, dto.partnerId, CUSTOMER_TYPES)
        : await this.partners.createInTx(tx, companyId, {
            title: lead.companyName,
            type: PartnerType.CUSTOMER,
            contactName: lead.contactName,
            email: lead.email,
            phone: lead.phone,
            city: lead.city,
            currencyCode: lead.currencyCode,
          });

      let opportunityId: string | null = null;
      if (dto.createOpportunity) {
        const amount = dto.amount ?? lead.estimatedValue;
        if (amount === null || amount === undefined) {
          throw new BadRequestException('Opportunity amount is required');
        }
        const stage = OpportunityStage.QUALIFICATION;
        const opportunity = await tx.opportunity.create({
          data: {
            companyId,
            number: await this.numbering.next(companyId, 'OPPORTUNITY', tx),
            title: dto.opportunityTitle?.trim() || lead.companyName,
            partnerId: partner.id,
            leadId: lead.id,
            stage,
            probability: defaultProbability(stage),
            amount,
            currencyCode: lead.currencyCode,
            expectedCloseDate: dto.expectedCloseDate ? parseDateOnly(dto.expectedCloseDate) : null,
            ownerId: lead.ownerId ?? user.id,
            description: lead.notes,
            createdById: user.id,
          },
        });
        opportunityId = opportunity.id;
      }

      await tx.lead.update({
        where: { id },
        data: { status: LeadStatus.CONVERTED, partnerId: partner.id, convertedAt: new Date() },
      });
      await tx.crmActivity.updateMany({
        where: { leadId: id, partnerId: null },
        data: { partnerId: partner.id },
      });
      return { partnerId: partner.id, opportunityId };
    });
  }

  /** Converted leads stay as history of the customer. */
  async remove(companyId: string, id: string): Promise<void> {
    const lead = await this.get(companyId, id);
    if (lead.status === LeadStatus.CONVERTED) {
      throw new ConflictException('Converted leads cannot be deleted');
    }
    await this.prisma.lead.delete({ where: { id } });
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.lead.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Lead not found');
    return row;
  }

  private notifyOwner(
    user: AuthUser,
    lead: { id: string; number: string; companyName: string; ownerId: string | null },
  ) {
    return this.support.notifyAssignee(user, {
      ownerId: lead.ownerId,
      title: 'Size bir potansiyel müşteri atandı',
      body: `${lead.number} · ${lead.companyName}`,
      link: `/crm/leads/${lead.id}`,
    });
  }
}

function toDto(row: ListRow): LeadDto {
  return {
    id: row.id,
    number: row.number,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    city: row.city,
    source: row.source,
    status: row.status,
    estimatedValue: row.estimatedValue?.toFixed(2) ?? null,
    currencyCode: row.currencyCode,
    ownerId: row.ownerId,
    ownerName: row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : null,
    partnerId: row.partnerId,
    partnerTitle: row.partner?.title ?? null,
    convertedAt: row.convertedAt,
    createdAt: row.createdAt,
  };
}

function toDetailDto(row: DetailRow): LeadDetailDto {
  return {
    ...toDto(row),
    notes: row.notes,
    disqualifyReason: row.disqualifyReason,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    updatedAt: row.updatedAt,
    opportunities: row.opportunities.map((o) => ({
      id: o.id,
      number: o.number,
      title: o.title,
      stage: o.stage,
      amount: o.amount.toFixed(2),
      currencyCode: o.currencyCode,
    })),
  };
}
