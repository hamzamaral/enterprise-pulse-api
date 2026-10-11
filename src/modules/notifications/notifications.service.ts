import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { MailService } from '../../infrastructure/mail/mail.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { NotificationQueryDto, SendNotificationDto } from './dto/notification.dto';
import { NotificationsGateway } from './notifications.gateway';

export interface NotifyInput {
  userIds: string[];
  companyId?: string;
  /** Machine readable type, e.g. "workflow.approval_requested". */
  type: string;
  title: string;
  body: string;
  link?: string;
  data?: Prisma.InputJsonValue;
  sendEmail?: boolean;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Other modules call `notify` to reach users in-app (WebSocket) and optionally by e-mail. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly mail: MailService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)];
    if (!userIds.length) return;

    const created = await this.prisma.notification.createManyAndReturn({
      data: userIds.map((userId) => ({
        userId,
        companyId: input.companyId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        data: input.data,
      })),
    });
    for (const notification of created) {
      this.gateway.emitToUser(notification.userId, 'notification', notification);
    }

    if (input.sendEmail) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true, deletedAt: null },
        select: { email: true },
      });
      await Promise.all(
        users.map((u) =>
          this.mail.send({
            to: u.email,
            subject: input.title,
            html: `<p>${escapeHtml(input.body)}</p>`,
            text: input.body,
          }),
        ),
      );
    }
  }

  async send(companyId: string, dto: SendNotificationDto): Promise<void> {
    const userIds =
      dto.userIds ??
      (
        await this.prisma.userCompany.findMany({
          where: { companyId, user: { isActive: true, deletedAt: null } },
          select: { userId: true },
        })
      ).map((m) => m.userId);

    await this.notify({
      userIds,
      companyId,
      type: 'announcement',
      title: dto.title,
      body: dto.body,
      link: dto.link,
      sendEmail: dto.sendEmail,
    });
  }

  async findMine(userId: string, query: NotificationQueryDto) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toPageArgs(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginated(data, total, query);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!result.count) {
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (!exists) throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
