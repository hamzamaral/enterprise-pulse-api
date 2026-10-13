import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { BudgetEntryDto, BudgetEntryQueryDto, CreateBudgetEntryDto } from './dto/budget.dto';

const SORTABLE = ['entryDate', 'amount', 'createdAt'] as const;

const entryInclude = {
  item: { select: { code: true, name: true, kind: true } },
  department: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.BudgetEntryInclude;

type EntryRow = Prisma.BudgetEntryGetPayload<{ include: typeof entryInclude }>;

const toDto = (row: EntryRow): BudgetEntryDto => ({
  id: row.id,
  itemId: row.itemId,
  itemCode: row.item.code,
  itemName: row.item.name,
  kind: row.item.kind,
  departmentId: row.departmentId,
  departmentName: row.department?.name ?? null,
  entryDate: toDateOnly(row.entryDate),
  amount: row.amount.toFixed(2),
  description: row.description,
  createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
  createdAt: row.createdAt.toISOString(),
});

/** Manually recorded actuals, e.g. rent or licences paid outside EnterprisePulse. */
@Injectable()
export class BudgetEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: BudgetEntryQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.BudgetEntryWhereInput = {
      companyId,
      itemId: query.itemId,
      departmentId: query.departmentId,
      ...(query.year
        ? {
            entryDate: {
              gte: new Date(Date.UTC(query.year, 0, 1)),
              lte: new Date(Date.UTC(query.year, 11, 31)),
            },
          }
        : {}),
      ...(search ? { description: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.budgetEntry.findMany({
        where,
        include: entryInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'entryDate'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.budgetEntry.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async create(user: AuthUser, dto: CreateBudgetEntryDto): Promise<BudgetEntryDto> {
    const item = await this.prisma.budgetItem.findFirst({
      where: { id: dto.itemId, companyId: user.companyId, isActive: true },
    });
    if (!item) throw new BadRequestException('Budget item not found');
    if (dto.departmentId) {
      const department = await this.prisma.department.count({
        where: { id: dto.departmentId, companyId: user.companyId, deletedAt: null },
      });
      if (!department) throw new BadRequestException('Department not found');
    }
    const row = await this.prisma.budgetEntry.create({
      data: {
        companyId: user.companyId,
        itemId: item.id,
        departmentId: dto.departmentId ?? null,
        entryDate: parseDateOnly(dto.entryDate),
        amount: dto.amount,
        description: dto.description.trim(),
        createdById: user.id,
      },
      include: entryInclude,
    });
    return toDto(row);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const { count } = await this.prisma.budgetEntry.deleteMany({ where: { id, companyId } });
    if (!count) throw new NotFoundException('Entry not found');
  }
}
