import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CrmActivityType, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CrmSupportService } from './crm-support.service';
import type {
  ActivityDto,
  ActivityQueryDto,
  ActivityState,
  CreateActivityDto,
  UpdateActivityDto,
} from './dto/crm.dto';

const SORTABLE = ['dueAt', 'subject', 'completedAt', 'createdAt'] as const;

const include = {
  owner: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lead: { select: { number: true, companyName: true } },
  opportunity: { select: { number: true, title: true } },
  partner: { select: { title: true } },
} satisfies Prisma.CrmActivityInclude;

type Row = Prisma.CrmActivityGetPayload<{ include: typeof include }>;

const stateWhere = (state: ActivityState | undefined): Prisma.CrmActivityWhereInput => {
  switch (state) {
    case 'open':
      return { completedAt: null };
    case 'overdue':
      return { completedAt: null, dueAt: { lt: new Date() } };
    case 'done':
      return { completedAt: { not: null } };
    default:
      return {};
  }
};

/** CRM activities: calls, meetings, e-mails, tasks and notes on leads, opportunities or customers. */
@Injectable()
export class CrmActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: CrmSupportService,
  ) {}

  async findAll(user: AuthUser, query: ActivityQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.CrmActivityWhereInput = {
      companyId: user.companyId,
      type: query.type,
      leadId: query.leadId,
      opportunityId: query.opportunityId,
      partnerId: query.partnerId,
      ownerId: query.mine === 'true' ? user.id : query.ownerId,
      ...stateWhere(query.state),
      ...(search && {
        OR: [
          { subject: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmActivity.findMany({
        where,
        include,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.crmActivity.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<ActivityDto> {
    const row = await this.prisma.crmActivity.findFirst({ where: { id, companyId }, include });
    if (!row) throw new NotFoundException('Activity not found');
    return toDto(row);
  }

  async create(user: AuthUser, dto: CreateActivityDto): Promise<ActivityDto> {
    const { companyId } = user;
    const ownerId = dto.ownerId ?? user.id;
    await this.support.assertMember(this.prisma, companyId, ownerId);
    const partnerId = await this.resolvePartner(companyId, dto);
    const done = dto.done || dto.type === CrmActivityType.NOTE;
    const row = await this.prisma.crmActivity.create({
      data: {
        companyId,
        type: dto.type,
        subject: dto.subject.trim(),
        description: dto.description?.trim() || null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        completedAt: done ? new Date() : null,
        ownerId,
        leadId: dto.leadId ?? null,
        opportunityId: dto.opportunityId ?? null,
        partnerId,
        createdById: user.id,
      },
      include,
    });
    if (!done) await this.notifyOwner(user, row);
    return toDto(row);
  }

  async update(user: AuthUser, id: string, dto: UpdateActivityDto): Promise<ActivityDto> {
    const existing = await this.get(user.companyId, id);
    if (dto.ownerId) await this.support.assertMember(this.prisma, user.companyId, dto.ownerId);
    const row = await this.prisma.crmActivity.update({
      where: { id },
      data: {
        type: dto.type,
        subject: dto.subject?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        dueAt: dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null,
        ownerId: dto.ownerId,
      },
      include,
    });
    if (dto.ownerId && dto.ownerId !== existing.ownerId && !row.completedAt) {
      await this.notifyOwner(user, row);
    }
    return toDto(row);
  }

  async complete(user: AuthUser, id: string): Promise<ActivityDto> {
    return this.setCompleted(user, id, true);
  }

  async reopen(user: AuthUser, id: string): Promise<ActivityDto> {
    return this.setCompleted(user, id, false);
  }

  /** The author may delete their own entries; others need crm:delete. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.get(user.companyId, id);
    if (row.createdById !== user.id && !hasPermission(user, 'crm:delete')) {
      throw new ForbiddenException('Only the author can delete this activity');
    }
    await this.prisma.crmActivity.delete({ where: { id } });
  }

  /**
   * Activities are also listed on the customer: an opportunity brings its customer along,
   * a converted lead brings the customer it became.
   */
  private async resolvePartner(companyId: string, dto: CreateActivityDto) {
    let partnerId = dto.partnerId ?? null;
    if (partnerId) {
      const count = await this.prisma.businessPartner.count({
        where: { id: partnerId, companyId, deletedAt: null },
      });
      if (!count) throw new BadRequestException('Partner not found');
    }
    if (dto.opportunityId) {
      const opportunity = await this.prisma.opportunity.findFirst({
        where: { id: dto.opportunityId, companyId },
        select: { partnerId: true },
      });
      if (!opportunity) throw new BadRequestException('Opportunity not found');
      partnerId ??= opportunity.partnerId;
    }
    if (dto.leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: dto.leadId, companyId },
        select: { partnerId: true },
      });
      if (!lead) throw new BadRequestException('Lead not found');
      partnerId ??= lead.partnerId;
    }
    return partnerId;
  }

  private async setCompleted(user: AuthUser, id: string, done: boolean): Promise<ActivityDto> {
    const { count } = await this.prisma.crmActivity.updateMany({
      where: { id, companyId: user.companyId, completedAt: done ? null : { not: null } },
      data: { completedAt: done ? new Date() : null },
    });
    if (!count) {
      await this.get(user.companyId, id);
      throw new ConflictException(done ? 'Activity is already done' : 'Activity is still open');
    }
    return this.findOne(user.companyId, id);
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.crmActivity.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Activity not found');
    return row;
  }

  private notifyOwner(user: AuthUser, row: Row) {
    const about = row.opportunity?.title ?? row.lead?.companyName ?? row.partner?.title;
    return this.support.notifyAssignee(user, {
      ownerId: row.ownerId,
      title: 'Size bir CRM aktivitesi atandı',
      body: about ? `${row.subject} · ${about}` : row.subject,
      link: row.opportunityId
        ? `/crm/opportunities/${row.opportunityId}`
        : row.leadId
          ? `/crm/leads/${row.leadId}`
          : '/crm/activities',
    });
  }
}

function toDto(row: Row): ActivityDto {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    description: row.description,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    overdue: !row.completedAt && !!row.dueAt && row.dueAt < new Date(),
    ownerId: row.ownerId,
    ownerName: `${row.owner.firstName} ${row.owner.lastName}`,
    leadId: row.leadId,
    leadNumber: row.lead?.number ?? null,
    leadCompanyName: row.lead?.companyName ?? null,
    opportunityId: row.opportunityId,
    opportunityNumber: row.opportunity?.number ?? null,
    opportunityTitle: row.opportunity?.title ?? null,
    partnerId: row.partnerId,
    partnerTitle: row.partner?.title ?? null,
    createdById: row.createdById,
    createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    createdAt: row.createdAt,
  };
}
