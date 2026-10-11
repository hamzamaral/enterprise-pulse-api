import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContext } from '../../common/context/request-context';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditLogQueryDto } from './dto/audit-log.dto';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  /** Defaults to the user of the current request. */
  userId?: string;
  userEmail?: string;
}

/**
 * Data changes are audited automatically by the Prisma audit extension.
 * Use `record` for business events that are not plain row changes (LOGIN, APPROVE, EXPORT...).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = RequestContext.get();
    await this.prisma.auditLog.create({
      data: {
        ...entry,
        userId: entry.userId ?? ctx?.userId,
        userEmail: entry.userEmail ?? ctx?.userEmail,
        companyId: ctx?.companyId,
        ip: ctx?.ip,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
      },
    });
  }

  async findAll(companyId: string, query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      OR: [{ companyId }, { companyId: null }],
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      userId: query.userId,
      createdAt: { gte: query.from, lte: query.to },
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { userEmail: { contains: query.search, mode: 'insensitive' } },
                  { entityType: { contains: query.search, mode: 'insensitive' } },
                  { entityId: { contains: query.search } },
                ],
              },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
        ...toPageArgs(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(data, total, query);
  }
}
