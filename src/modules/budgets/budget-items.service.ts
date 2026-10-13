import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BudgetItemKind, BudgetSource, Prisma, type BudgetItem } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  BudgetItemDto,
  BudgetItemOptionsDto,
  CreateBudgetItemDto,
  UpdateBudgetItemDto,
} from './dto/budget.dto';

const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/** Sources whose items split the actuals by category. */
const CATEGORIZED: BudgetSource[] = [BudgetSource.EXPENSES, BudgetSource.PURCHASES];

/** Bütçe kalemleri: income and expense lines and where their actuals come from. */
@Injectable()
export class BudgetItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<BudgetItemDto[]> {
    const [rows, expenseCategories, productCategories, planned] = await Promise.all([
      this.prisma.budgetItem.findMany({
        where: { companyId },
        include: { _count: { select: { entries: true } } },
        orderBy: [{ kind: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.expenseCategory.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
      this.prisma.productCategory.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
      this.prisma.budgetLine.findMany({
        where: { item: { companyId } },
        distinct: ['budgetId', 'itemId'],
        select: { itemId: true },
      }),
    ]);
    const names = new Map(
      [...expenseCategories, ...productCategories].map((c) => [c.id, c.name] as const),
    );
    const budgetCount = new Map<string, number>();
    for (const line of planned) {
      budgetCount.set(line.itemId, (budgetCount.get(line.itemId) ?? 0) + 1);
    }
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      source: row.source,
      categories: row.categoryIds.map((id) => ({ id, name: names.get(id) ?? '—' })),
      description: row.description,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      budgetCount: budgetCount.get(row.id) ?? 0,
      entryCount: row._count.entries,
    }));
  }

  async options(companyId: string): Promise<BudgetItemOptionsDto> {
    const [expenseCategories, productCategories] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productCategory.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { expenseCategories, productCategories };
  }

  async create(companyId: string, dto: CreateBudgetItemDto): Promise<BudgetItemDto> {
    const source = dto.source ?? BudgetSource.MANUAL;
    const categoryIds = [...new Set(dto.categoryIds ?? [])];
    const isActive = dto.isActive ?? true;
    await this.assertMapping(companyId, null, dto.kind, source, categoryIds, isActive);
    const row = await this.unique(() =>
      this.prisma.budgetItem.create({
        data: {
          companyId,
          code: dto.code.trim(),
          name: dto.name.trim(),
          kind: dto.kind,
          source,
          categoryIds,
          description: trimOrNull(dto.description) ?? null,
          isActive,
          sortOrder: dto.sortOrder ?? 0,
        },
      }),
    );
    return this.one(companyId, row.id);
  }

  async update(companyId: string, id: string, dto: UpdateBudgetItemDto): Promise<BudgetItemDto> {
    const current = await this.find(companyId, id);
    const kind = dto.kind ?? current.kind;
    const source = dto.source ?? current.source;
    const categoryIds = dto.categoryIds
      ? [...new Set(dto.categoryIds)]
      : source === current.source
        ? current.categoryIds
        : [];
    const isActive = dto.isActive ?? current.isActive;
    await this.assertMapping(companyId, id, kind, source, categoryIds, isActive);
    await this.unique(() =>
      this.prisma.budgetItem.update({
        where: { id },
        data: {
          code: dto.code?.trim(),
          name: dto.name?.trim(),
          kind,
          source,
          categoryIds,
          description: trimOrNull(dto.description),
          isActive,
          sortOrder: dto.sortOrder,
        },
      }),
    );
    return this.one(companyId, id);
  }

  /** Items used in a plan or by manual entries are deactivated instead. */
  async remove(companyId: string, id: string): Promise<void> {
    await this.find(companyId, id);
    const [lines, entries] = await Promise.all([
      this.prisma.budgetLine.count({ where: { itemId: id } }),
      this.prisma.budgetEntry.count({ where: { itemId: id } }),
    ]);
    if (lines || entries) {
      throw new ConflictException('Item is used by budgets or entries; deactivate it instead');
    }
    await this.prisma.budgetItem.delete({ where: { id } });
  }

  private async one(companyId: string, id: string): Promise<BudgetItemDto> {
    const items = await this.findAll(companyId);
    return items.find((i) => i.id === id)!;
  }

  private async find(companyId: string, id: string): Promise<BudgetItem> {
    const row = await this.prisma.budgetItem.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Budget item not found');
    return row;
  }

  /**
   * Keeps every actual counted once: a category belongs to one active item, each categorized
   * source has at most one catch-all item and payroll / sales feed a single item.
   */
  private async assertMapping(
    companyId: string,
    id: string | null,
    kind: BudgetItemKind,
    source: BudgetSource,
    categoryIds: string[],
    isActive: boolean,
  ) {
    if (source === BudgetSource.SALES && kind !== BudgetItemKind.INCOME) {
      throw new BadRequestException('Sales items must be income items');
    }
    if (
      source !== BudgetSource.SALES &&
      source !== BudgetSource.MANUAL &&
      kind !== BudgetItemKind.EXPENSE
    ) {
      throw new BadRequestException('Expense, payroll and purchase items must be expense items');
    }
    if (!CATEGORIZED.includes(source) && categoryIds.length) {
      throw new BadRequestException('Only expense and purchase items take categories');
    }
    if (categoryIds.length) {
      const found =
        source === BudgetSource.EXPENSES
          ? await this.prisma.expenseCategory.count({
              where: { companyId, id: { in: categoryIds } },
            })
          : await this.prisma.productCategory.count({
              where: { companyId, id: { in: categoryIds } },
            });
      if (found !== categoryIds.length) throw new BadRequestException('Category not found');
    }
    if (!isActive || source === BudgetSource.MANUAL) return;

    const others = await this.prisma.budgetItem.findMany({
      where: { companyId, source, isActive: true, ...(id ? { id: { not: id } } : {}) },
      select: { name: true, categoryIds: true },
    });
    if (!CATEGORIZED.includes(source)) {
      if (others.length) {
        throw new ConflictException(`"${others[0].name}" already takes the ${source} actuals`);
      }
      return;
    }
    if (!categoryIds.length) {
      const catchAll = others.find((o) => !o.categoryIds.length);
      if (catchAll) {
        throw new ConflictException(`"${catchAll.name}" already takes the remaining categories`);
      }
      return;
    }
    const clash = others.find((o) => o.categoryIds.some((c) => categoryIds.includes(c)));
    if (clash) throw new ConflictException(`A category is already mapped to "${clash.name}"`);
  }

  private async unique<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An item with this code already exists');
      }
      throw error;
    }
  }
}
