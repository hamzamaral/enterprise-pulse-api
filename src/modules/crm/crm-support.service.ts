import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CrmMemberDto } from './dto/crm.dto';

interface AssignmentNotice {
  ownerId: string | null;
  title: string;
  body: string;
  link: string;
}

/** Lookups and notifications shared by the CRM services. */
@Injectable()
export class CrmSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Active users of the company, for owner and assignee pickers. */
  async members(companyId: string): Promise<CrmMemberDto[]> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, memberships: { some: { companyId } } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email }));
  }

  /** Owners and assignees must be active members of the company. */
  async assertMember(client: PrismaTx | PrismaService, companyId: string, userId: string) {
    const count = await client.user.count({
      where: { id: userId, deletedAt: null, isActive: true, memberships: { some: { companyId } } },
    });
    if (!count) throw new BadRequestException('Assigned user is not a member of this company');
  }

  async assertCurrency(client: PrismaTx | PrismaService, code: string) {
    const count = await client.currency.count({ where: { code } });
    if (!count) throw new BadRequestException(`Unknown currency ${code}`);
  }

  async baseCurrency(client: PrismaTx | PrismaService, companyId: string): Promise<string> {
    const company = await client.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    return company.baseCurrency;
  }

  /** Tells the new owner about a record someone else handed to them. */
  async notifyAssignee(actor: AuthUser, notice: AssignmentNotice) {
    if (!notice.ownerId || notice.ownerId === actor.id) return;
    await this.notifications.notify({
      userIds: [notice.ownerId],
      companyId: actor.companyId,
      type: 'crm.assigned',
      title: notice.title,
      body: `${notice.body} — ${actor.firstName} ${actor.lastName}`,
      link: notice.link,
    });
  }
}
