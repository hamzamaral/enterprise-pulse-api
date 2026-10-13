import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketEventType, TicketStatus, type Ticket } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { DownloadUrlDto } from '../files/dto/file.dto';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import type {
  AddTicketCommentDto,
  ChangeTicketStatusDto,
  CloseTicketDto,
  CreateTicketDto,
  MyTicketQueryDto,
  RateTicketDto,
  ReopenTicketDto,
  TicketDetailDto,
  TicketDto,
  TicketQueryDto,
  UpdateTicketDto,
} from './dto/support.dto';
import {
  TICKET_ENTITY,
  fullName,
  lockTicket,
  slaTargets,
  ticketInclude,
  toTicketDto,
} from './support-helpers';
import {
  ACTIVE_STATUSES,
  TRANSITIONS,
  dueDates,
  isActive,
  pausedMinutesSince,
} from './support-math';
import { AGENT_PERMISSION, TicketCategoriesService } from './ticket-categories.service';

const SORTABLE = [
  'number',
  'subject',
  'priority',
  'status',
  'createdAt',
  'updatedAt',
  'resolutionDueAt',
] as const;
const MINUTE_MS = 60_000;

const isAgent = (user: AuthUser) => hasPermission(user, AGENT_PERMISSION);
/** Support staff see every ticket and the internal notes. */
const isStaff = (user: AuthUser) => isAgent(user) || hasPermission(user, 'support:read');

interface Notice {
  userIds: (string | null | undefined)[];
  title: string;
  body: string;
}

/** Destek talepleri: self-service requests, the agent queue, SLA tracking and the conversation. */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly categories: TicketCategoriesService,
  ) {}

  async findAll(user: AuthUser, query: TicketQueryDto) {
    const now = new Date();
    const search = query.search?.trim();
    const where: Prisma.TicketWhereInput = {
      companyId: user.companyId,
      status: query.status ?? (query.active === 'true' ? { in: ACTIVE_STATUSES } : undefined),
      priority: query.priority,
      categoryId: query.categoryId,
      assigneeId:
        query.assignee === 'me'
          ? user.id
          : query.assignee === 'unassigned'
            ? null
            : query.assignee || undefined,
      AND: [
        search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { subject: { contains: search, mode: 'insensitive' } },
                { requester: { firstName: { contains: search, mode: 'insensitive' } } },
                { requester: { lastName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {},
        query.overdue === 'true' ? this.overdueWhere(now) : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: ticketInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return paginated(
      rows.map((row) => toTicketDto(row, now)),
      total,
      query,
    );
  }

  /** Tickets the user asked for. */
  async mine(user: AuthUser, query: MyTicketQueryDto): Promise<TicketDto[]> {
    const now = new Date();
    const rows = await this.prisma.ticket.findMany({
      where: {
        companyId: user.companyId,
        requesterId: user.id,
        status:
          query.active === 'true'
            ? { in: ACTIVE_STATUSES }
            : query.active === 'false'
              ? { notIn: ACTIVE_STATUSES }
              : undefined,
      },
      include: ticketInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => toTicketDto(row, now));
  }

  async findOne(user: AuthUser, id: string): Promise<TicketDetailDto> {
    const now = new Date();
    const row = await this.prisma.ticket.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        ...ticketInclude,
        requester: { select: { firstName: true, lastName: true, email: true } },
        comments: {
          include: { author: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        events: {
          include: { actor: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row || !this.canView(user, row)) throw new NotFoundException('Ticket not found');

    const files = await this.prisma.fileObject.findMany({
      where: {
        companyId: user.companyId,
        entityType: TICKET_ENTITY,
        entityId: id,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    const uploaderIds = [...new Set(files.map((f) => f.uploadedById).filter((v) => v !== null))];
    const uploaders = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((u) => [u.id, fullName(u)]),
    );

    const staff = isStaff(user);
    const agent = isAgent(user);
    const isRequester = row.requesterId === user.id;
    const open = row.status !== TicketStatus.CLOSED;
    const canComment = open && (agent || (isRequester && isActive(row.status)));
    return {
      ...toTicketDto(row, now),
      description: row.description,
      requesterEmail: row.requester.email,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      pausedMinutes: row.pausedMinutes,
      satisfactionComment: row.satisfactionComment,
      comments: row.comments
        .filter((c) => staff || !c.isInternal)
        .map((c) => ({
          id: c.id,
          authorId: c.authorId,
          authorName: fullName(c.author),
          body: c.body,
          isInternal: c.isInternal,
          fromRequester: c.authorId === row.requesterId,
          createdAt: c.createdAt.toISOString(),
        })),
      events: row.events.map((e) => ({
        id: e.id,
        type: e.type,
        actorName: e.actor ? fullName(e.actor) : null,
        fromValue: e.fromValue,
        toValue: e.toValue,
        createdAt: e.createdAt.toISOString(),
      })),
      attachments: files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        uploadedByName: f.uploadedById ? (uploaders.get(f.uploadedById) ?? null) : null,
        createdAt: f.createdAt.toISOString(),
        canDelete: canComment && (agent || f.uploadedById === user.id),
      })),
      isRequester,
      canManage: agent && open,
      canComment,
      canAttach: canComment,
      canClose: isRequester && open,
      canReopen: isRequester && row.status === TicketStatus.RESOLVED,
      canRate: isRequester && row.status === TicketStatus.CLOSED && row.satisfactionRating === null,
      canDelete: hasPermission(user, 'support:delete'),
      nextStatuses: agent ? TRANSITIONS[row.status] : [],
    };
  }

  async create(user: AuthUser, dto: CreateTicketDto): Promise<TicketDetailDto> {
    const requesterId = dto.requesterId ?? user.id;
    if (requesterId !== user.id) {
      if (!hasPermission(user, 'support:create')) {
        throw new ForbiddenException('Missing permission: support:create');
      }
      const member = await this.prisma.userCompany.count({
        where: { userId: requesterId, companyId: user.companyId, user: { isActive: true } },
      });
      if (!member) throw new BadRequestException('Requester not found');
    }
    const category = dto.categoryId
      ? await this.prisma.ticketCategory.findFirst({
          where: { id: dto.categoryId, companyId: user.companyId, isActive: true },
          include: { defaultAssignee: { select: { firstName: true, lastName: true } } },
        })
      : null;
    if (dto.categoryId && !category) throw new BadRequestException('Category not found');

    const priority = dto.priority ?? 'MEDIUM';
    const now = new Date();
    const targets = await slaTargets(this.prisma, user.companyId);
    const assigneeId = category?.defaultAssigneeId ?? null;
    const ticket = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ticket.create({
        data: {
          companyId: user.companyId,
          number: await this.numbering.next(user.companyId, 'TICKET', tx),
          subject: dto.subject.trim(),
          description: dto.description.trim(),
          categoryId: category?.id ?? null,
          priority,
          requesterId,
          assigneeId,
          ...dueDates(now, targets[priority]),
          createdAt: now,
        },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: row.id,
          actorId: user.id,
          type: TicketEventType.CREATED,
          createdAt: now,
        },
      });
      if (category?.defaultAssignee) {
        await tx.ticketEvent.create({
          data: {
            ticketId: row.id,
            type: TicketEventType.ASSIGNED,
            toValue: fullName(category.defaultAssignee),
            createdAt: new Date(now.getTime() + 1),
          },
        });
      }
      return row;
    });

    const recipients = assigneeId
      ? [assigneeId]
      : await this.notifications.findUserIdsWithPermission(user.companyId, AGENT_PERMISSION);
    await this.notify(user, ticket, {
      userIds: recipients,
      title: `Yeni destek talebi: ${ticket.number}`,
      body: ticket.subject,
    });
    if (requesterId !== user.id) {
      await this.notify(user, ticket, {
        userIds: [requesterId],
        title: `Adınıza destek talebi açıldı: ${ticket.number}`,
        body: ticket.subject,
      });
    }
    return this.findOne(user, ticket.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateTicketDto): Promise<TicketDetailDto> {
    if (dto.assigneeId) await this.categories.assertAgent(user.companyId, dto.assigneeId);
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOpen(tx, user.companyId, id);
      const data: Prisma.TicketUncheckedUpdateInput = {};
      const events: Prisma.TicketEventCreateManyInput[] = [];
      const event = (type: TicketEventType, fromValue: string | null, toValue: string | null) =>
        events.push({ ticketId: id, actorId: user.id, type, fromValue, toValue });

      if (dto.subject !== undefined) data.subject = dto.subject.trim();

      if (dto.categoryId !== undefined && dto.categoryId !== current.categoryId) {
        const [from, to] = await Promise.all([
          this.categoryName(tx, user.companyId, current.categoryId),
          this.categoryName(tx, user.companyId, dto.categoryId, true),
        ]);
        data.categoryId = dto.categoryId;
        event(TicketEventType.CATEGORY_CHANGED, from, to);
      }

      if (dto.priority && dto.priority !== current.priority) {
        const targets = await slaTargets(tx, user.companyId);
        Object.assign(
          data,
          dueDates(current.createdAt, targets[dto.priority], current.pausedMinutes),
        );
        data.priority = dto.priority;
        event(TicketEventType.PRIORITY_CHANGED, current.priority, dto.priority);
      }

      if (dto.assigneeId !== undefined && dto.assigneeId !== current.assigneeId) {
        const [from, to] = await Promise.all([
          this.userName(tx, current.assigneeId),
          this.userName(tx, dto.assigneeId),
        ]);
        data.assigneeId = dto.assigneeId;
        event(TicketEventType.ASSIGNED, from, to);
        if (dto.assigneeId && dto.assigneeId !== user.id) {
          notices.push({
            userIds: [dto.assigneeId],
            title: `Size destek talebi atandı: ${current.number}`,
            body: current.subject,
          });
        }
      }

      await tx.ticket.update({ where: { id }, data });
      const now = Date.now();
      if (events.length) {
        await tx.ticketEvent.createMany({
          data: events.map((e, i) => ({ ...e, createdAt: new Date(now + i) })),
        });
      }
    });
    await this.notifyAll(user, id, notices);
    return this.findOne(user, id);
  }

  async changeStatus(
    user: AuthUser,
    id: string,
    dto: ChangeTicketStatusDto,
  ): Promise<TicketDetailDto> {
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOpen(tx, user.companyId, id);
      if (current.status === dto.status) return;
      if (!TRANSITIONS[current.status].includes(dto.status)) {
        throw new ConflictException(`A ${current.status} ticket cannot become ${dto.status}`);
      }
      const now = new Date();
      const comment = dto.comment?.trim();
      const data = statusChange(current, dto.status, now);
      const events: Prisma.TicketEventCreateManyInput[] = [
        {
          ticketId: id,
          actorId: user.id,
          type: TicketEventType.STATUS_CHANGED,
          fromValue: current.status,
          toValue: dto.status,
          createdAt: now,
        },
      ];
      if (dto.status === TicketStatus.IN_PROGRESS && !current.assigneeId) {
        data.assigneeId = user.id;
        events.push({
          ticketId: id,
          actorId: user.id,
          type: TicketEventType.ASSIGNED,
          toValue: fullName(user),
          createdAt: new Date(now.getTime() + 1),
        });
      }
      if (comment) {
        await tx.ticketComment.create({
          data: { ticketId: id, authorId: user.id, body: comment, createdAt: now },
        });
        if (user.id !== current.requesterId)
          data.firstRespondedAt ??= current.firstRespondedAt ?? now;
      }
      await tx.ticket.update({ where: { id }, data });
      await tx.ticketEvent.createMany({ data: events });

      const title = STATUS_TITLES[dto.status];
      if (title && current.requesterId !== user.id) {
        notices.push({
          userIds: [current.requesterId],
          title: `${current.number} ${title}`,
          body: comment || current.subject,
        });
      }
    });
    await this.notifyAll(user, id, notices);
    return this.findOne(user, id);
  }

  async addComment(user: AuthUser, id: string, dto: AddTicketCommentDto): Promise<TicketDetailDto> {
    const agent = isAgent(user);
    if (dto.isInternal && !agent) {
      throw new ForbiddenException('Only support agents can write internal notes');
    }
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOpen(tx, user.companyId, id);
      const isRequester = current.requesterId === user.id;
      if (!agent && !isRequester) throw new NotFoundException('Ticket not found');
      if (!agent && !isActive(current.status)) {
        throw new ConflictException('Reopen the ticket to add a reply');
      }
      const now = new Date();
      const body = dto.body.trim();
      if (!body) throw new BadRequestException('The reply is empty');
      const internal = !!dto.isInternal;
      await tx.ticketComment.create({
        data: { ticketId: id, authorId: user.id, body, isInternal: internal, createdAt: now },
      });

      const data: Prisma.TicketUncheckedUpdateInput = { updatedAt: now };
      if (!internal && !isRequester && !current.firstRespondedAt) data.firstRespondedAt = now;
      if (isRequester && current.status === TicketStatus.WAITING) {
        const status = current.assigneeId ? TicketStatus.IN_PROGRESS : TicketStatus.OPEN;
        Object.assign(data, statusChange(current, status, now));
        await tx.ticketEvent.create({
          data: {
            ticketId: id,
            actorId: user.id,
            type: TicketEventType.STATUS_CHANGED,
            fromValue: current.status,
            toValue: status,
            createdAt: now,
          },
        });
      }
      await tx.ticket.update({ where: { id }, data });

      if (internal) return;
      if (isRequester) {
        notices.push({
          userIds: current.assigneeId
            ? [current.assigneeId]
            : await this.notifications.findUserIdsWithPermission(user.companyId, AGENT_PERMISSION),
          title: `${current.number} talebine yanıt geldi`,
          body: truncate(body),
        });
      } else {
        notices.push({
          userIds: [current.requesterId],
          title: `${current.number} talebinize yanıt verildi`,
          body: truncate(body),
        });
      }
    });
    await this.notifyAll(user, id, notices);
    return this.findOne(user, id);
  }

  /** The requester closes the ticket, optionally rating the support received. */
  async close(user: AuthUser, id: string, dto: CloseTicketDto): Promise<TicketDetailDto> {
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockRequester(tx, user, id);
      if (current.status === TicketStatus.CLOSED) {
        throw new ConflictException('The ticket is already closed');
      }
      const now = new Date();
      await tx.ticket.update({
        where: { id },
        data: {
          ...statusChange(current, TicketStatus.CLOSED, now, false),
          ...(dto.rating
            ? { satisfactionRating: dto.rating, satisfactionComment: dto.comment?.trim() || null }
            : {}),
        },
      });
      await tx.ticketEvent.createMany({
        data: [
          {
            ticketId: id,
            actorId: user.id,
            type: TicketEventType.STATUS_CHANGED,
            fromValue: current.status,
            toValue: TicketStatus.CLOSED,
            createdAt: now,
          },
          ...(dto.rating
            ? [
                {
                  ticketId: id,
                  actorId: user.id,
                  type: TicketEventType.RATED,
                  toValue: String(dto.rating),
                  createdAt: new Date(now.getTime() + 1),
                },
              ]
            : []),
        ],
      });
      notices.push({
        userIds: [current.assigneeId],
        title: `${current.number} talep sahibi tarafından kapatıldı`,
        body: dto.rating ? `Memnuniyet puanı: ${dto.rating}/5` : current.subject,
      });
    });
    await this.notifyAll(user, id, notices);
    return this.findOne(user, id);
  }

  async rate(user: AuthUser, id: string, dto: RateTicketDto): Promise<TicketDetailDto> {
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockRequester(tx, user, id);
      if (current.status !== TicketStatus.CLOSED) {
        throw new ConflictException('Only closed tickets can be rated');
      }
      if (current.satisfactionRating !== null) {
        throw new ConflictException('The ticket is already rated');
      }
      await tx.ticket.update({
        where: { id },
        data: { satisfactionRating: dto.rating, satisfactionComment: dto.comment?.trim() || null },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          type: TicketEventType.RATED,
          toValue: String(dto.rating),
        },
      });
      notices.push({
        userIds: [current.assigneeId],
        title: `${current.number} değerlendirildi`,
        body: `Memnuniyet puanı: ${dto.rating}/5`,
      });
    });
    await this.notifyAll(user, id, notices);
    return this.findOne(user, id);
  }

  /** The requester says the solution did not work. */
  async reopen(user: AuthUser, id: string, dto: ReopenTicketDto): Promise<TicketDetailDto> {
    const notices: Notice[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockRequester(tx, user, id);
      if (current.status !== TicketStatus.RESOLVED) {
        throw new ConflictException('Only resolved tickets can be reopened');
      }
      const now = new Date();
      const status = current.assigneeId ? TicketStatus.IN_PROGRESS : TicketStatus.OPEN;
      await tx.ticketComment.create({
        data: { ticketId: id, authorId: user.id, body: dto.comment.trim(), createdAt: now },
      });
      await tx.ticket.update({ where: { id }, data: statusChange(current, status, now) });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          type: TicketEventType.REOPENED,
          fromValue: current.status,
          toValue: status,
          createdAt: now,
        },
      });
      notices.push({
        userIds: current.assigneeId
          ? [current.assigneeId]
          : await this.notifications.findUserIdsWithPermission(user.companyId, AGENT_PERMISSION),
        title: `${current.number} yeniden açıldı`,
        body: truncate(dto.comment.trim()),
      });
    });
    await this.notifyAll(user, id, notices);
    return this.findOne(user, id);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.prisma.ticket.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new NotFoundException('Ticket not found');
    const files = await this.prisma.fileObject.findMany({
      where: {
        companyId: user.companyId,
        entityType: TICKET_ENTITY,
        entityId: id,
        deletedAt: null,
      },
      select: { id: true },
    });
    await this.prisma.ticket.delete({ where: { id } });
    for (const file of files) await this.files.remove(user.companyId, file.id);
  }

  async uploadAttachment(
    user: AuthUser,
    id: string,
    file: Express.Multer.File,
  ): Promise<TicketDetailDto> {
    const detail = await this.findOne(user, id);
    if (!detail.canAttach) throw new ConflictException('Files cannot be added to this ticket');
    await this.files.upload(user.companyId, user.id, file, {
      entityType: TICKET_ENTITY,
      entityId: id,
    });
    await this.prisma.ticket.update({ where: { id }, data: { updatedAt: new Date() } });
    return this.findOne(user, id);
  }

  async attachmentUrl(user: AuthUser, id: string, fileId: string): Promise<DownloadUrlDto> {
    const detail = await this.findOne(user, id);
    if (!detail.attachments.some((a) => a.id === fileId)) {
      throw new NotFoundException('File not found');
    }
    return this.files.getDownloadUrl(user.companyId, fileId);
  }

  async removeAttachment(user: AuthUser, id: string, fileId: string): Promise<TicketDetailDto> {
    const detail = await this.findOne(user, id);
    const attachment = detail.attachments.find((a) => a.id === fileId);
    if (!attachment) throw new NotFoundException('File not found');
    if (!attachment.canDelete) throw new ForbiddenException('You cannot delete this file');
    await this.files.remove(user.companyId, fileId);
    return this.findOne(user, id);
  }

  /** Active tickets past their first response or resolution target at `now`. */
  overdueWhere(now: Date): Prisma.TicketWhereInput {
    return {
      status: { in: ACTIVE_STATUSES },
      OR: [
        { firstRespondedAt: null, firstResponseDueAt: { lt: now } },
        { pausedAt: null, resolutionDueAt: { lt: now } },
        { pausedAt: { gt: this.prisma.ticket.fields.resolutionDueAt } },
      ],
    };
  }

  private canView(user: AuthUser, row: Pick<Ticket, 'requesterId' | 'assigneeId'>) {
    return row.requesterId === user.id || row.assigneeId === user.id || isStaff(user);
  }

  /** Locks a ticket an agent works on; closed tickets are read-only. */
  private async lockOpen(tx: PrismaTx, companyId: string, id: string) {
    const row = await tx.ticket.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Ticket not found');
    await lockTicket(tx, id);
    const current = await tx.ticket.findUniqueOrThrow({ where: { id } });
    if (current.status === TicketStatus.CLOSED) {
      throw new ConflictException('Closed tickets cannot be changed');
    }
    return current;
  }

  private async lockRequester(tx: PrismaTx, user: AuthUser, id: string) {
    const row = await tx.ticket.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new NotFoundException('Ticket not found');
    if (row.requesterId !== user.id) {
      if (!isStaff(user)) throw new NotFoundException('Ticket not found');
      throw new ForbiddenException('Only the requester can do this');
    }
    await lockTicket(tx, id);
    return tx.ticket.findUniqueOrThrow({ where: { id } });
  }

  private async categoryName(
    tx: PrismaTx,
    companyId: string,
    id: string | null,
    activeOnly = false,
  ) {
    if (!id) return null;
    const row = await tx.ticketCategory.findFirst({
      where: { id, companyId, ...(activeOnly ? { isActive: true } : {}) },
    });
    if (!row) throw new BadRequestException('Category not found');
    return row.name;
  }

  private async userName(tx: PrismaTx, id: string | null) {
    if (!id) return null;
    const row = await tx.user.findUnique({
      where: { id },
      select: { firstName: true, lastName: true },
    });
    return row ? fullName(row) : null;
  }

  private async notifyAll(user: AuthUser, id: string, notices: Notice[]) {
    for (const notice of notices) await this.notify(user, { id }, notice);
  }

  private async notify(user: AuthUser, ticket: { id: string }, notice: Notice) {
    await this.notifications.notify({
      companyId: user.companyId,
      userIds: notice.userIds.filter((u): u is string => !!u && u !== user.id),
      type: 'support.ticket',
      title: notice.title,
      body: notice.body,
      link: `/support/tickets/${ticket.id}`,
    });
  }
}

const STATUS_TITLES: Partial<Record<TicketStatus, string>> = {
  WAITING: 'talebiniz için bilgi bekleniyor',
  RESOLVED: 'talebiniz çözüldü',
  CLOSED: 'talebiniz kapatıldı',
};

const truncate = (text: string, max = 160) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Field changes for a status change, keeping the SLA clocks consistent. A requester closing an
 * unanswered ticket withdraws it, so it does not count as a response or resolution.
 */
function statusChange(
  current: Ticket,
  to: TicketStatus,
  now: Date,
  byAgent = true,
): Prisma.TicketUncheckedUpdateInput {
  const data: Prisma.TicketUncheckedUpdateInput = { status: to };
  if (current.pausedAt && to !== TicketStatus.WAITING) {
    const minutes = pausedMinutesSince(current.pausedAt, now);
    data.pausedAt = null;
    data.pausedMinutes = current.pausedMinutes + minutes;
    data.resolutionDueAt = new Date(current.resolutionDueAt.getTime() + minutes * MINUTE_MS);
  }
  if (to === TicketStatus.WAITING) data.pausedAt = current.pausedAt ?? now;
  if (byAgent && (to === TicketStatus.RESOLVED || to === TicketStatus.CLOSED)) {
    data.resolvedAt = current.resolvedAt ?? now;
    data.firstRespondedAt = current.firstRespondedAt ?? now;
  }
  if (to === TicketStatus.CLOSED) data.closedAt = now;
  if (current.status === TicketStatus.RESOLVED && isActive(to)) data.resolvedAt = null;
  return data;
}
