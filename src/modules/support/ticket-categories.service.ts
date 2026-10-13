import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateTicketCategoryDto,
  SupportAgentDto,
  TicketCategoryDto,
  TicketSlaPolicyDto,
  UpdateTicketCategoryDto,
  UpdateTicketSlaPoliciesDto,
} from './dto/support.dto';
import { fullName, slaTargets, trimOrNull } from './support-helpers';
import { ACTIVE_STATUSES, PRIORITY_ORDER } from './support-math';

export const AGENT_PERMISSION = 'support:update';

/** Ticket categories, SLA policies and the list of support agents. */
@Injectable()
export class TicketCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(companyId: string): Promise<TicketCategoryDto[]> {
    const [rows, active] = await Promise.all([
      this.prisma.ticketCategory.findMany({
        where: { companyId },
        include: {
          defaultAssignee: { select: { firstName: true, lastName: true } },
          _count: { select: { tickets: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.ticket.groupBy({
        by: ['categoryId'],
        where: { companyId, status: { in: ACTIVE_STATUSES } },
        _count: true,
      }),
    ]);
    const activeByCategory = new Map(active.map((g) => [g.categoryId, g._count]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      defaultAssigneeId: row.defaultAssigneeId,
      defaultAssigneeName: row.defaultAssignee ? fullName(row.defaultAssignee) : null,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      ticketCount: row._count.tickets,
      activeCount: activeByCategory.get(row.id) ?? 0,
    }));
  }

  async create(companyId: string, dto: CreateTicketCategoryDto): Promise<TicketCategoryDto> {
    if (dto.defaultAssigneeId) await this.assertAgent(companyId, dto.defaultAssigneeId);
    const row = await this.unique(() =>
      this.prisma.ticketCategory.create({
        data: {
          companyId,
          name: dto.name.trim(),
          description: trimOrNull(dto.description) ?? null,
          defaultAssigneeId: dto.defaultAssigneeId ?? null,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      }),
    );
    return this.one(companyId, row.id);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTicketCategoryDto,
  ): Promise<TicketCategoryDto> {
    await this.get(companyId, id);
    if (dto.defaultAssigneeId) await this.assertAgent(companyId, dto.defaultAssigneeId);
    await this.unique(() =>
      this.prisma.ticketCategory.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          description: trimOrNull(dto.description),
          defaultAssigneeId: dto.defaultAssigneeId,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
      }),
    );
    return this.one(companyId, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.get(companyId, id);
    if (await this.prisma.ticket.count({ where: { categoryId: id } })) {
      throw new ConflictException('Categories with tickets cannot be deleted; deactivate instead');
    }
    await this.prisma.ticketCategory.delete({ where: { id } });
  }

  async slaPolicies(companyId: string): Promise<TicketSlaPolicyDto[]> {
    const targets = await slaTargets(this.prisma, companyId);
    return PRIORITY_ORDER.map((priority) => ({ priority, ...targets[priority] }));
  }

  /** Applies to new tickets and priority changes; existing due dates stay as they are. */
  async updateSlaPolicies(
    companyId: string,
    dto: UpdateTicketSlaPoliciesDto,
  ): Promise<TicketSlaPolicyDto[]> {
    const priorities = dto.policies.map((p) => p.priority);
    if (new Set(priorities).size !== priorities.length) {
      throw new BadRequestException('Each priority may appear only once');
    }
    for (const policy of dto.policies) {
      if (policy.resolutionHours < policy.firstResponseHours) {
        throw new BadRequestException('The resolution target cannot be shorter than the response');
      }
    }
    await this.prisma.$transaction(
      dto.policies.map((p) =>
        this.prisma.ticketSlaPolicy.upsert({
          where: { companyId_priority: { companyId, priority: p.priority } },
          create: { companyId, ...p },
          update: { firstResponseHours: p.firstResponseHours, resolutionHours: p.resolutionHours },
        }),
      ),
    );
    return this.slaPolicies(companyId);
  }

  async agents(companyId: string): Promise<SupportAgentDto[]> {
    const ids = await this.notifications.findUserIdsWithPermission(companyId, AGENT_PERMISSION);
    const [users, load] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { companyId, assigneeId: { in: ids }, status: { in: ACTIVE_STATUSES } },
        _count: true,
      }),
    ]);
    const active = new Map(load.map((g) => [g.assigneeId, g._count]));
    return users.map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.email,
      activeCount: active.get(u.id) ?? 0,
    }));
  }

  async assertAgent(companyId: string, userId: string) {
    const ids = await this.notifications.findUserIdsWithPermission(companyId, AGENT_PERMISSION);
    if (!ids.includes(userId)) {
      throw new BadRequestException('The assignee must be an active support agent');
    }
  }

  private async one(companyId: string, id: string) {
    const all = await this.findAll(companyId);
    const row = all.find((c) => c.id === id);
    if (!row) throw new NotFoundException('Ticket category not found');
    return row;
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.ticketCategory.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Ticket category not found');
    return row;
  }

  private async unique<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A category with this name already exists');
      }
      throw error;
    }
  }
}
